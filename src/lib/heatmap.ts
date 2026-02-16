/**
 * Heatmap Modülü
 *
 * Gaussian blur tabanlı bakış yoğunluk haritası:
 * - Zaman ağırlıklı yoğunluk
 * - Renk paleti (mavi → yeşil → sarı → kırmızı)
 * - PNG export
 * - Overlay rendering
 */

import { GazePoint } from "./gazeModel";
import { Fixation } from "./fixation";

export interface HeatmapConfig {
  radius: number;       // Gaussian blur yarıçapı (piksel)
  maxOpacity: number;    // Maksimum opaklık (0-1)
  minOpacity: number;    // Minimum opaklık
  blur: number;          // Ek blur miktarı
  gradient: Record<number, string>; // Renk gradyanı
  useFixations: boolean; // Fixation tabanlı mı yoksa ham gaze mi?
}

const DEFAULT_CONFIG: HeatmapConfig = {
  radius: 30,
  maxOpacity: 0.7,
  minOpacity: 0.05,
  blur: 15,
  gradient: {
    0.0: "rgba(0, 0, 255, 0)",
    0.2: "rgba(0, 0, 255, 1)",
    0.4: "rgba(0, 255, 255, 1)",
    0.6: "rgba(0, 255, 0, 1)",
    0.8: "rgba(255, 255, 0, 1)",
    1.0: "rgba(255, 0, 0, 1)",
  },
  useFixations: true,
};

export class HeatmapGenerator {
  private config: HeatmapConfig;
  private gradientCanvas: HTMLCanvasElement | null = null;
  private gradientCtx: CanvasRenderingContext2D | null = null;

  constructor(config: Partial<HeatmapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.createGradientPalette();
  }

  // Renk paleti oluştur
  private createGradientPalette(): void {
    if (typeof document === "undefined") return;

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
  }

  // Heatmap çiz
  render(
    canvas: HTMLCanvasElement,
    points: GazePoint[],
    fixations: Fixation[],
    imageWidth: number,
    imageHeight: number
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = imageWidth;
    canvas.height = imageHeight;

    // Yoğunluk haritası oluştur (grayscale)
    const intensityCanvas = document.createElement("canvas");
    intensityCanvas.width = imageWidth;
    intensityCanvas.height = imageHeight;
    const intensityCtx = intensityCanvas.getContext("2d")!;

    if (this.config.useFixations && fixations.length > 0) {
      this.renderFixationHeatmap(intensityCtx, fixations, imageWidth, imageHeight);
    } else {
      this.renderGazeHeatmap(intensityCtx, points, imageWidth, imageHeight);
    }

    // Grayscale'i renk haritasına dönüştür
    this.colorize(ctx, intensityCtx, imageWidth, imageHeight);
  }

  // Fixation tabanlı heatmap
  private renderFixationHeatmap(
    ctx: CanvasRenderingContext2D,
    fixations: Fixation[],
    width: number,
    height: number
  ): void {
    // Maksimum süreyi bul (normalize etmek için)
    const maxDuration = Math.max(...fixations.map((f) => f.duration), 1);

    for (const fixation of fixations) {
      // Süre ağırlıklı yoğunluk
      const weight = fixation.duration / maxDuration;
      const radius = this.config.radius * (0.5 + weight * 0.5);

      // Radial gradient çiz
      const gradient = ctx.createRadialGradient(
        fixation.x, fixation.y, 0,
        fixation.x, fixation.y, radius
      );

      const alpha = Math.min(1, weight * 0.8 + 0.2);
      gradient.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = gradient;
      ctx.fillRect(
        fixation.x - radius,
        fixation.y - radius,
        radius * 2,
        radius * 2
      );
    }
  }

  // Ham gaze tabanlı heatmap
  private renderGazeHeatmap(
    ctx: CanvasRenderingContext2D,
    points: GazePoint[],
    width: number,
    height: number
  ): void {
    const radius = this.config.radius;

    for (const point of points) {
      const gradient = ctx.createRadialGradient(
        point.x, point.y, 0,
        point.x, point.y, radius
      );

      gradient.addColorStop(0, "rgba(0, 0, 0, 0.1)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = gradient;
      ctx.fillRect(
        point.x - radius,
        point.y - radius,
        radius * 2,
        radius * 2
      );
    }
  }

  // Grayscale yoğunluğu renk haritasına dönüştür
  private colorize(
    outputCtx: CanvasRenderingContext2D,
    intensityCtx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    if (!this.gradientCanvas || !this.gradientCtx) {
      this.createGradientPalette();
      if (!this.gradientCanvas || !this.gradientCtx) return;
    }

    const intensityData = intensityCtx.getImageData(0, 0, width, height);
    const outputData = outputCtx.createImageData(width, height);
    const palette = this.gradientCtx.getImageData(0, 0, 256, 1).data;

    for (let i = 0; i < intensityData.data.length; i += 4) {
      // Alpha kanalını yoğunluk olarak kullan
      const intensity = intensityData.data[i + 3];

      if (intensity > 0) {
        // Palette'ten renk al
        const paletteIndex = Math.min(255, intensity) * 4;
        outputData.data[i] = palette[paletteIndex];       // R
        outputData.data[i + 1] = palette[paletteIndex + 1]; // G
        outputData.data[i + 2] = palette[paletteIndex + 2]; // B

        // Opaklık ayarla
        const opacity =
          this.config.minOpacity +
          (intensity / 255) * (this.config.maxOpacity - this.config.minOpacity);
        outputData.data[i + 3] = Math.round(opacity * 255);
      }
    }

    outputCtx.putImageData(outputData, 0, 0);
  }

  // Heatmap'i PNG olarak dışa aktar
  exportToPNG(
    points: GazePoint[],
    fixations: Fixation[],
    baseImage: HTMLImageElement,
    imageWidth: number,
    imageHeight: number
  ): string {
    // Birleşik canvas oluştur
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = imageWidth;
    exportCanvas.height = imageHeight;
    const exportCtx = exportCanvas.getContext("2d")!;

    // Base image çiz
    exportCtx.drawImage(baseImage, 0, 0, imageWidth, imageHeight);

    // Heatmap overlay çiz
    const heatmapCanvas = document.createElement("canvas");
    this.render(heatmapCanvas, points, fixations, imageWidth, imageHeight);
    exportCtx.drawImage(heatmapCanvas, 0, 0);

    return exportCanvas.toDataURL("image/png");
  }

  // Yapılandırmayı güncelle
  updateConfig(config: Partial<HeatmapConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.gradient) {
      this.createGradientPalette();
    }
  }
}
