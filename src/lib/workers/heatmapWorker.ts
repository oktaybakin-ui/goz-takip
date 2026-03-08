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

    // Percentile-based normalizasyon (histogram yöntemi — O(n) sort gerektirmez)
    const histogram = new Uint32Array(256);
    let totalNonZero = 0;
    for (let i = 3; i < len; i += 4) {
      const v = intensityData[i];
      if (v > 0) {
        histogram[v]++;
        totalNonZero++;
      }
    }

    if (totalNonZero === 0) {
      (self as any).postMessage(
        { type: "colorized", outputData, width, height },
        [outputData.buffer]
      );
      return;
    }

    // p98 değerini histogram üzerinden bul
    const p98Target = Math.floor(totalNonZero * 0.98);
    let cumulative = 0;
    let p98Value = 1;
    for (let v = 1; v < 256; v++) {
      cumulative += histogram[v];
      if (cumulative >= p98Target) {
        p98Value = v;
        break;
      }
    }
    const normFactor = 255 / Math.max(1, p98Value);

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
