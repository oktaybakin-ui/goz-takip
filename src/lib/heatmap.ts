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

  /** @param config - radius, blur, gradient, useFixations vb. (varsayılanlar DEFAULT_CONFIG ile doldurulur) */
  constructor(config: Partial<HeatmapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // createGradientPalette() burada çağrılmaz!
    // İlk render() veya exportToPNG() çağrısında lazy olarak oluşturulur.
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

    // 1. Yoğunluk haritası oluştur (grayscale alpha)
    const intensityCanvas = document.createElement("canvas");
    intensityCanvas.width = imageWidth;
    intensityCanvas.height = imageHeight;
    const intensityCtx = intensityCanvas.getContext("2d")!;

    if (this.config.useFixations && fixations.length > 0) {
      this.renderFixationHeatmap(intensityCtx, fixations, imageWidth, imageHeight);
    } else if (points.length > 0) {
      this.renderGazeHeatmap(intensityCtx, points, imageWidth, imageHeight);
    } else {
      ctx.clearRect(0, 0, imageWidth, imageHeight);
      return;
    }

    // 2. Gaussian blur uygula (canvas filter)
    const blurredCanvas = document.createElement("canvas");
    blurredCanvas.width = imageWidth;
    blurredCanvas.height = imageHeight;
    const blurredCtx = blurredCanvas.getContext("2d")!;

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

  private renderFixationHeatmap(
    ctx: CanvasRenderingContext2D,
    fixations: Fixation[],
    width: number,
    height: number
  ): void {
    if (fixations.length === 0) return;

    const maxDuration = Math.max(...fixations.map((f) => f.duration), 1);
    const radius = this.config.radius;

    ctx.globalCompositeOperation = "lighter";

    for (const fixation of fixations) {
      const weight = fixation.duration / maxDuration;

      // Süreye göre radius ölçekle - ama minimum büyüklük koru
      const r = radius * (0.6 + weight * 0.8);

      // Birden fazla katman çiz - daha yoğun merkez
      for (let layer = 0; layer < 3; layer++) {
        const layerR = r * (1 - layer * 0.25);
        const layerAlpha = Math.min(1, (weight * 0.5 + 0.15) * (1 + layer * 0.3));

        const gradient = ctx.createRadialGradient(
          fixation.x, fixation.y, 0,
          fixation.x, fixation.y, layerR
        );

        gradient.addColorStop(0, `rgba(0, 0, 0, ${layerAlpha})`);
        gradient.addColorStop(0.5, `rgba(0, 0, 0, ${layerAlpha * 0.5})`);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = gradient;
        ctx.fillRect(
          fixation.x - layerR,
          fixation.y - layerR,
          layerR * 2,
          layerR * 2
        );
      }
    }
  }

  private renderGazeHeatmap(
    ctx: CanvasRenderingContext2D,
    points: GazePoint[],
    width: number,
    height: number
  ): void {
    const radius = this.config.radius * 0.7;

    ctx.globalCompositeOperation = "lighter";

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

    // Maksimum yoğunluğu bul (normalize etmek için)
    let maxIntensity = 0;
    for (let i = 3; i < intensityData.data.length; i += 4) {
      if (intensityData.data[i] > maxIntensity) {
        maxIntensity = intensityData.data[i];
      }
    }

    if (maxIntensity === 0) return;

    // Normalize ve renk uygula
    const normFactor = 255 / maxIntensity;

    for (let i = 0; i < intensityData.data.length; i += 4) {
      // Alpha kanalını yoğunluk olarak kullan
      const rawIntensity = intensityData.data[i + 3];

      if (rawIntensity > 0) {
        // Normalize et
        const intensity = Math.min(255, Math.round(rawIntensity * normFactor));

        // Palette'ten renk al
        const paletteIndex = intensity * 4;
        outputData.data[i] = palette[paletteIndex];       // R
        outputData.data[i + 1] = palette[paletteIndex + 1]; // G
        outputData.data[i + 2] = palette[paletteIndex + 2]; // B

        // Opaklık - yoğunluğa orantılı
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

  updateConfig(config: Partial<HeatmapConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.gradient) {
      // Gradient değiştiyse eski palette'i sıfırla, lazy yeniden oluşturulacak
      this.gradientCanvas = null;
      this.gradientCtx = null;
    }
  }
}
