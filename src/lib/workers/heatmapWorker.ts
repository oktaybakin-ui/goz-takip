/**
 * Heatmap Colorization Web Worker
 *
 * Ana thread'den gelen yoğunluk verisini (intensityData) renk paletine dönüştürür.
 * Pixel-by-pixel işlem O(width × height) olduğundan ana thread'i bloklamaz.
 *
 * Input: { type: 'colorize', intensityData, palette, width, height, minOpacity, maxOpacity }
 * Output: { type: 'colorized', outputData, width, height }
 */

export interface HeatmapWorkerInput {
  type: "colorize";
  intensityData: Uint8ClampedArray;
  palette: Uint8ClampedArray;
  width: number;
  height: number;
  minOpacity: number;
  maxOpacity: number;
}

export interface HeatmapWorkerOutput {
  type: "colorized";
  outputData: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Worker fonksiyonu — createInlineWorker ile blob olarak çalıştırılır.
 */
export function heatmapWorkerFn() {
  self.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type !== "colorize") return;

    const {
      intensityData,
      palette,
      width,
      height,
      minOpacity,
      maxOpacity,
    } = msg;

    const len = width * height * 4;
    const outputData = new Uint8ClampedArray(len);

    // Maksimum yoğunluğu bul
    let maxIntensity = 0;
    for (let i = 3; i < len; i += 4) {
      if (intensityData[i] > maxIntensity) {
        maxIntensity = intensityData[i];
      }
    }

    if (maxIntensity === 0) {
      (self as any).postMessage(
        { type: "colorized", outputData, width, height },
        [outputData.buffer]
      );
      return;
    }

    const normFactor = 255 / maxIntensity;

    for (let i = 0; i < len; i += 4) {
      const rawIntensity = intensityData[i + 3];
      if (rawIntensity > 0) {
        const intensity = Math.min(
          255,
          Math.round(rawIntensity * normFactor)
        );
        const paletteIndex = intensity * 4;

        outputData[i] = palette[paletteIndex]; // R
        outputData[i + 1] = palette[paletteIndex + 1]; // G
        outputData[i + 2] = palette[paletteIndex + 2]; // B

        const normalizedIntensity = intensity / 255;
        const opacity =
          minOpacity + normalizedIntensity * (maxOpacity - minOpacity);
        outputData[i + 3] = Math.round(opacity * 255);
      }
    }

    (self as any).postMessage(
      { type: "colorized", outputData, width, height },
      [outputData.buffer]
    );
  };
}
