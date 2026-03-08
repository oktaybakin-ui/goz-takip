/**
 * Heatmap Modülü - Geliştirilmiş Versiyon
 *
 * Gaussian blur tabanlı bakış yoğunluk haritası:
 * - Daha geniş radius ile yumuşak yayılma
 * - Canvas filter blur ile gerçek Gaussian efekti
 * - Zaman ağırlıklı yoğunluk
 * - Renk paleti (mavi → cyan → yeşil → sarı → kırmızı)
 * - PNG export
 */

import { GazePoint } from "./gazeModel";
import { Fixation } from "./fixation";
import { createInlineWorker, postWorkerMessage } from "./workers/createWorker";
import { heatmapWorkerFn, type HeatmapWorkerInput, type HeatmapWorkerOutput } from "./workers/heatmapWorker";

export interface HeatmapConfig {
  radius: number;
  maxOpacity: number;
  minOpacity: number;
  blur: number;
  gradient: Record<number, string>;
  useFixations: boolean;
}

const DEFAULT_CONFIG: HeatmapConfig = {
  radius: 60,           // 30 → 60: daha geniş yayılma
  maxOpacity: 0.75,
  minOpacity: 0.02,
  blur: 25,              // Canvas filter blur miktarı
  gradient: {
    0.0: "rgba(0, 0, 255, 0)",
    0.15: "rgba(0, 0, 255, 1)",
    0.3: "rgba(0, 200, 255, 1)",
    0.45: "rgba(0, 255, 100, 1)",
    0.6: "rgba(128, 255, 0, 1)",
    0.75: "rgba(255, 255, 0, 1)",
    0.9: "rgba(255, 128, 0, 1)",
    1.0: "rgba(255, 0, 0, 1)",
  },
  useFixations: true,
};

/**
 * Gaussian blur ve renk gradyanı ile bakış yoğunluk haritası üretir. Fixation veya ham gaze noktaları kullanılabilir.
 */
export class HeatmapGenerator {
  private config: HeatmapConfig;
  private gradientCanvas: HTMLCanvasElement | null = null;
  private gradientCtx: CanvasRenderingContext2D | null = null;

  private canvasCache = new Map<string, HTMLCanvasElement>();

  // Web Worker for offloading pixel-by-pixel colorization
  private colorizeWorker: Worker | null = null;
  private workerInitialized: boolean = false;

  constructor(config: Partial<HeatmapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getOrCreateCanvas(key: string, w: number, h: number): HTMLCanvasElement {
    let c = this.canvasCache.get(key);
    if (!c || c.width !== w || c.height !== h) {
      c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      this.canvasCache.set(key, c);
    } else {
      const ctx = c.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, w, h);
    }
    return c;
  }

  private ensureGradientPalette(): boolean {
    if (this.gradientCanvas && this.gradientCtx) return true;
    if (typeof document === "undefined") return false;

    this.gradientCanvas = document.createElement("canvas");
    this.gradientCanvas.width = 256;
    this.gradientCanvas.height = 1;
    this.gradientCtx = this.gradientCanvas.getContext("2d")!;

    const gradient = this.gradientCtx.createLinearGradient(0, 0, 256, 0);
    for (const [stop, color] of Object.entries(this.config.gradient)) {
      gradient.addColorStop(parseFloat(stop), color);
    }

    this.gradientCtx.fillStyle = gradient;
    this.gradientCtx.fillRect(0, 0, 256, 1);
    return true;
  }

  /**
   * Heatmap'i verilen canvas'a çizer (gaze veya fixation noktalarına göre).
   * @param canvas - Hedef canvas
   * @param points - Ham bakış noktaları
   * @param fixations - Fixation listesi (useFixations true ise kullanılır)
   * @param imageWidth - Görüntü genişliği (koordinat ölçeği)
   * @param imageHeight - Görüntü yüksekliği
   */
  render(
    canvas: HTMLCanvasElement,
    points: GazePoint[],
    fixations: Fixation[],
    imageWidth: number,
    imageHeight: number
  ): void {
    if (typeof document === "undefined") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Gradient palette'i lazy oluştur
    this.ensureGradientPalette();

    canvas.width = imageWidth;
    canvas.height = imageHeight;

    const intensityCanvas = this.getOrCreateCanvas("intensity", imageWidth, imageHeight);
    const intensityCtx = intensityCanvas.getContext("2d");
    if (!intensityCtx) return;

    if (this.config.useFixations && fixations.length > 0) {
      this.renderFixationHeatmap(intensityCtx, fixations);
    } else if (points.length > 0) {
      this.renderGazeHeatmap(intensityCtx, points);
    } else {
      ctx.clearRect(0, 0, imageWidth, imageHeight);
      return;
    }

    const blurredCanvas = this.getOrCreateCanvas("blurred", imageWidth, imageHeight);
    const blurredCtx = blurredCanvas.getContext("2d");
    if (!blurredCtx) return;

    const supportsFilter = "filter" in blurredCtx;
    if (supportsFilter) {
      blurredCtx.filter = `blur(${this.config.blur}px)`;
    }
    blurredCtx.drawImage(intensityCanvas, 0, 0);
    if (supportsFilter) {
      blurredCtx.filter = "none";
    }

    // 3. Renk haritasına dönüştür
    this.colorize(ctx, blurredCtx, imageWidth, imageHeight);
  }

  /**
   * Sorun #11: "lighter" composite yerine "screen" kullanılıyor.
   * "lighter" 255'te doyuyor ve >30 fixation'da kontrast kaybına neden oluyordu.
   * "screen" formülü: result = 1 - (1-a)*(1-b), daha iyi dinamik aralık sağlar.
   * Ek olarak alpha değerleri düşürüldü — doyma riski azaltıldı.
   */
  private renderFixationHeatmap(
    ctx: CanvasRenderingContext2D,
    fixations: Fixation[]
  ): void {
    if (fixations.length === 0) return;

    const maxDuration = Math.max(...fixations.map((f) => f.duration), 1);
    const radius = this.config.radius;

    // "screen" composite operation — lighter'a göre doyma problemi çok daha az
    ctx.globalCompositeOperation = "screen";

    // Fixation sayısına göre alpha ölçeklendirme: çok fixation → düşük alpha per fixation
    const fixCountScale = Math.max(0.3, 1.0 - (fixations.length - 10) * 0.015);

    for (const fixation of fixations) {
      const weight = fixation.duration / maxDuration;
      const r = radius * (0.6 + weight * 0.8);

      // Tek katman — daha temiz birikim, daha az doyma
      const baseAlpha = Math.min(0.7, (weight * 0.4 + 0.1) * fixCountScale);

      const gradient = ctx.createRadialGradient(
        fixation.x, fixation.y, 0,
        fixation.x, fixation.y, r
      );

      gradient.addColorStop(0, `rgba(0, 0, 0, ${baseAlpha})`);
      gradient.addColorStop(0.4, `rgba(0, 0, 0, ${baseAlpha * 0.55})`);
      gradient.addColorStop(0.7, `rgba(0, 0, 0, ${baseAlpha * 0.2})`);
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.fillStyle = gradient;
      ctx.fillRect(
        fixation.x - r,
        fixation.y - r,
        r * 2,
        r * 2
      );
    }
  }

  private renderGazeHeatmap(
    ctx: CanvasRenderingContext2D,
    points: GazePoint[]
  ): void {
    const radius = this.config.radius * 0.7;

    ctx.globalCompositeOperation = "screen";

    // Çok fazla nokta varsa aralıklı çiz (performans)
    const step = points.length > 1000 ? Math.floor(points.length / 1000) : 1;

    for (let i = 0; i < points.length; i += step) {
      const point = points[i];

      const gradient = ctx.createRadialGradient(
        point.x, point.y, 0,
        point.x, point.y, radius
      );

      gradient.addColorStop(0, "rgba(0, 0, 0, 0.15)");
      gradient.addColorStop(0.4, "rgba(0, 0, 0, 0.08)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.fillStyle = gradient;
      ctx.fillRect(
        point.x - radius,
        point.y - radius,
        radius * 2,
        radius * 2
      );
    }
  }

  private colorize(
    outputCtx: CanvasRenderingContext2D,
    intensityCtx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    if (!this.gradientCanvas || !this.gradientCtx) {
      if (!this.ensureGradientPalette()) return;
    }

    const gradientCtx = this.gradientCtx!;
    const intensityData = intensityCtx.getImageData(0, 0, width, height);
    const outputData = outputCtx.createImageData(width, height);
    const palette = gradientCtx.getImageData(0, 0, 256, 1).data;

    // Percentile-based normalizasyon: p98 değerini referans al
    // Az fiksasyonla (3-10 adet) bile kırmızı renk üretilebilir
    const nonZeroValues: number[] = [];
    for (let i = 3; i < intensityData.data.length; i += 4) {
      if (intensityData.data[i] > 0) {
        nonZeroValues.push(intensityData.data[i]);
      }
    }

    if (nonZeroValues.length === 0) return;

    nonZeroValues.sort((a, b) => a - b);
    const p98Index = Math.floor(nonZeroValues.length * 0.98);
    const p98Value = nonZeroValues[Math.min(p98Index, nonZeroValues.length - 1)];
    // Üst %2 kırmızıya saturate olur, geri kalanı tam gradyan aralığına yayılır
    const normCeil = Math.max(1, p98Value);
    const normFactor = 255 / normCeil;

    for (let i = 0; i < intensityData.data.length; i += 4) {
      const rawIntensity = intensityData.data[i + 3];

      if (rawIntensity > 0) {
        const intensity = Math.min(255, Math.round(rawIntensity * normFactor));

        const paletteIndex = intensity * 4;
        outputData.data[i] = palette[paletteIndex];       // R
        outputData.data[i + 1] = palette[paletteIndex + 1]; // G
        outputData.data[i + 2] = palette[paletteIndex + 2]; // B

        const normalizedIntensity = intensity / 255;
        const opacity =
          this.config.minOpacity +
          normalizedIntensity * (this.config.maxOpacity - this.config.minOpacity);
        outputData.data[i + 3] = Math.round(opacity * 255);
      }
    }

    outputCtx.putImageData(outputData, 0, 0);
  }

  /**
   * Heatmap'i base image üzerine çizip Data URL (PNG) olarak döner.
   * @param points - Ham bakış noktaları
   * @param fixations - Fixation listesi
   * @param baseImage - Alt katman görüntü
   * @param imageWidth - Görüntü genişliği
   * @param imageHeight - Görüntü yüksekliği
   * @returns data:image/png;base64,... URL
   */
  exportToPNG(
    points: GazePoint[],
    fixations: Fixation[],
    baseImage: HTMLImageElement,
    imageWidth: number,
    imageHeight: number
  ): string {
    if (typeof document === "undefined") return "";
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = imageWidth;
    exportCanvas.height = imageHeight;
    const exportCtx = exportCanvas.getContext("2d")!;

    // Base image
    exportCtx.drawImage(baseImage, 0, 0, imageWidth, imageHeight);

    // Heatmap overlay
    const heatmapCanvas = document.createElement("canvas");
    this.render(heatmapCanvas, points, fixations, imageWidth, imageHeight);
    exportCtx.drawImage(heatmapCanvas, 0, 0);

    return exportCanvas.toDataURL("image/png");
  }

  /**
   * Asenkron heatmap render — colorization adımı Web Worker'da çalışır.
   * Canvas API gerektiren intensity ve blur adımları main thread'de kalır.
   * Worker yoksa sync fallback kullanır.
   */
  async renderAsync(
    canvas: HTMLCanvasElement,
    points: GazePoint[],
    fixations: Fixation[],
    imageWidth: number,
    imageHeight: number
  ): Promise<void> {
    if (typeof document === "undefined") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    this.ensureGradientPalette();

    canvas.width = imageWidth;
    canvas.height = imageHeight;

    const intensityCanvas = this.getOrCreateCanvas("intensity", imageWidth, imageHeight);
    const intensityCtx = intensityCanvas.getContext("2d");
    if (!intensityCtx) return;

    if (this.config.useFixations && fixations.length > 0) {
      this.renderFixationHeatmap(intensityCtx, fixations);
    } else if (points.length > 0) {
      this.renderGazeHeatmap(intensityCtx, points);
    } else {
      ctx.clearRect(0, 0, imageWidth, imageHeight);
      return;
    }

    const blurredCanvas = this.getOrCreateCanvas("blurred", imageWidth, imageHeight);
    const blurredCtx = blurredCanvas.getContext("2d");
    if (!blurredCtx) return;

    const supportsFilter = "filter" in blurredCtx;
    if (supportsFilter) {
      blurredCtx.filter = `blur(${this.config.blur}px)`;
    }
    blurredCtx.drawImage(intensityCanvas, 0, 0);
    if (supportsFilter) {
      blurredCtx.filter = "none";
    }

    // Worker ile colorize
    if (!this.workerInitialized) {
      this.colorizeWorker = createInlineWorker(heatmapWorkerFn);
      this.workerInitialized = true;
    }

    if (this.colorizeWorker && this.gradientCtx) {
      try {
        const intensityData = blurredCtx.getImageData(0, 0, imageWidth, imageHeight);
        const palette = this.gradientCtx.getImageData(0, 0, 256, 1).data;

        const input: HeatmapWorkerInput = {
          type: "colorize",
          intensityData: new Uint8ClampedArray(intensityData.data),
          palette: new Uint8ClampedArray(palette),
          width: imageWidth,
          height: imageHeight,
          minOpacity: this.config.minOpacity,
          maxOpacity: this.config.maxOpacity,
        };

        const result = await postWorkerMessage<HeatmapWorkerInput, HeatmapWorkerOutput>(
          this.colorizeWorker,
          input,
          [input.intensityData.buffer, input.palette.buffer]
        );

        const outputImageData = ctx.createImageData(imageWidth, imageHeight);
        outputImageData.data.set(result.outputData);
        ctx.putImageData(outputImageData, 0, 0);
        return;
      } catch (err) {
        // Sorun #24: Worker hata detayları loglansın
        if (typeof console !== "undefined") {
          console.warn("[HeatmapGenerator] Colorize worker başarısız, sync fallback kullanılıyor:", err);
        }
      }
    }

    // Sync fallback
    this.colorize(ctx, blurredCtx, imageWidth, imageHeight);
  }

  /**
   * Worker'ı sonlandırır ve kaynakları temizler.
   */
  destroy(): void {
    if (this.colorizeWorker) {
      this.colorizeWorker.terminate();
      this.colorizeWorker = null;
    }
    this.workerInitialized = false;
    this.canvasCache.clear();
  }

  updateConfig(config: Partial<HeatmapConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.gradient) {
      // Gradient değiştiyse eski palette'i sıfırla, lazy yeniden oluşturulacak
      this.gradientCanvas = null;
      this.gradientCtx = null;
    }
  }
}
