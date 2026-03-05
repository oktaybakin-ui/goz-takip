/**
 * Attention Analysis Modülü
 *
 * Bakış verisinden dikkat paternlerini çıkartır:
 * - Duration-weighted attention density map
 * - Temporal attention shift (ilk yarı vs son yarı karşılaştırma)
 * - Attention entropy (bakış dağılımının rastgeleliği)
 */

import type { Fixation } from "./fixation";
import type { GazePoint } from "./gazeModel";

export interface AttentionDensityCell {
  row: number;
  col: number;
  centerX: number;
  centerY: number;
  density: number;  // Duration-weighted normalized (0-1)
  rawMs: number;    // Ham dwell time (ms)
}

export interface TemporalShift {
  /** İlk yarı density grid */
  firstHalf: AttentionDensityCell[];
  /** Son yarı density grid */
  secondHalf: AttentionDensityCell[];
  /** Shift büyüklüğü (KL-divergence benzeri metrik, 0=aynı, yüksek=çok farklı) */
  shiftMagnitude: number;
  /** En çok değişen hücre (indeks) */
  maxShiftCell: { row: number; col: number; deltaMs: number } | null;
}

export interface AttentionMetrics {
  /** Duration-weighted dikkat yoğunluk haritası */
  densityMap: AttentionDensityCell[];
  /** Temporal attention shift analizi */
  temporalShift: TemporalShift;
  /** Shannon entropi (bakış dağılımının rastgeleliği, 0=tek noktaya odaklı, yüksek=dağınık) */
  attentionEntropy: number;
  /** Maksimum olası entropi (log2(cell count)) */
  maxEntropy: number;
  /** Normalize entropi (0-1) */
  normalizedEntropy: number;
  /** Grid boyutları */
  gridRows: number;
  gridCols: number;
}

/**
 * Fixation verilerinden dikkat analizi hesapla.
 * @param fixations - Fixation listesi (zamana göre sıralı)
 * @param viewWidth - Görüntü genişliği (px)
 * @param viewHeight - Görüntü yüksekliği (px)
 * @param gridRows - Grid satır sayısı (varsayılan 5)
 * @param gridCols - Grid sütun sayısı (varsayılan 5)
 */
export function computeAttentionMetrics(
  fixations: Fixation[],
  viewWidth: number,
  viewHeight: number,
  gridRows: number = 5,
  gridCols: number = 5
): AttentionMetrics {
  const cellW = viewWidth / gridCols;
  const cellH = viewHeight / gridRows;
  const cellCount = gridRows * gridCols;

  // Duration-weighted density map
  const fullDensity = computeDensity(fixations, cellW, cellH, gridRows, gridCols);

  // Temporal shift: ilk yarı vs son yarı
  const temporalShift = computeTemporalShift(fixations, cellW, cellH, gridRows, gridCols);

  // Attention entropy
  const { entropy, maxEntropy, normalizedEntropy } = computeEntropy(fullDensity);

  return {
    densityMap: fullDensity,
    temporalShift,
    attentionEntropy: entropy,
    maxEntropy,
    normalizedEntropy,
    gridRows,
    gridCols,
  };
}

/**
 * Fixation listesinden density grid hesapla (duration-weighted).
 */
function computeDensity(
  fixations: Fixation[],
  cellW: number,
  cellH: number,
  gridRows: number,
  gridCols: number
): AttentionDensityCell[] {
  const cells: AttentionDensityCell[] = [];
  const rawMs: number[][] = Array.from({ length: gridRows }, () =>
    new Array(gridCols).fill(0)
  );

  // Fixation sürelerini grid hücrelerine dağıt
  for (const f of fixations) {
    const col = Math.min(gridCols - 1, Math.max(0, Math.floor(f.x / cellW)));
    const row = Math.min(gridRows - 1, Math.max(0, Math.floor(f.y / cellH)));
    rawMs[row][col] += f.duration;
  }

  // Normalizasyon (0-1)
  let maxVal = 0;
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      maxVal = Math.max(maxVal, rawMs[r][c]);
    }
  }

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      cells.push({
        row: r,
        col: c,
        centerX: (c + 0.5) * cellW,
        centerY: (r + 0.5) * cellH,
        density: maxVal > 0 ? rawMs[r][c] / maxVal : 0,
        rawMs: rawMs[r][c],
      });
    }
  }

  return cells;
}

/**
 * Temporal attention shift: fixation listesini zamana göre ikiye böl,
 * her yarının density map'ini hesapla, farkı analiz et.
 */
function computeTemporalShift(
  fixations: Fixation[],
  cellW: number,
  cellH: number,
  gridRows: number,
  gridCols: number
): TemporalShift {
  if (fixations.length < 4) {
    return {
      firstHalf: computeDensity(fixations, cellW, cellH, gridRows, gridCols),
      secondHalf: computeDensity([], cellW, cellH, gridRows, gridCols),
      shiftMagnitude: 0,
      maxShiftCell: null,
    };
  }

  const midIdx = Math.floor(fixations.length / 2);
  const firstHalf = fixations.slice(0, midIdx);
  const secondHalf = fixations.slice(midIdx);

  const firstDensity = computeDensity(firstHalf, cellW, cellH, gridRows, gridCols);
  const secondDensity = computeDensity(secondHalf, cellW, cellH, gridRows, gridCols);

  // Shift büyüklüğü: toplam mutlak fark (raw ms bazında normalize)
  const firstTotal = firstDensity.reduce((s, c) => s + c.rawMs, 0) || 1;
  const secondTotal = secondDensity.reduce((s, c) => s + c.rawMs, 0) || 1;

  let shiftMagnitude = 0;
  let maxDelta = 0;
  let maxCell: { row: number; col: number; deltaMs: number } | null = null;

  for (let i = 0; i < firstDensity.length; i++) {
    const p = firstDensity[i].rawMs / firstTotal;
    const q = secondDensity[i].rawMs / secondTotal;
    const diff = Math.abs(p - q);
    shiftMagnitude += diff;

    const deltaMs = secondDensity[i].rawMs - firstDensity[i].rawMs;
    if (Math.abs(deltaMs) > Math.abs(maxDelta)) {
      maxDelta = deltaMs;
      maxCell = {
        row: firstDensity[i].row,
        col: firstDensity[i].col,
        deltaMs,
      };
    }
  }

  return {
    firstHalf: firstDensity,
    secondHalf: secondDensity,
    shiftMagnitude: shiftMagnitude / 2, // Normalize to 0-1 range
    maxShiftCell: maxCell,
  };
}

/**
 * Shannon entropy hesapla — bakış dağılımının rastgeleliği.
 * Düşük entropi = tek bölgeye odaklı, yüksek entropi = dağınık bakış.
 */
function computeEntropy(
  densityCells: AttentionDensityCell[]
): { entropy: number; maxEntropy: number; normalizedEntropy: number } {
  const totalMs = densityCells.reduce((s, c) => s + c.rawMs, 0);
  if (totalMs === 0) return { entropy: 0, maxEntropy: 0, normalizedEntropy: 0 };

  // Olasılık dağılımı
  const probs = densityCells.map((c) => c.rawMs / totalMs);

  // Shannon entropy: H = -Σ p(i) * log2(p(i))
  let entropy = 0;
  for (const p of probs) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Non-zero hücre sayısı üzerinden max entropi (daha anlamlı normalize)
  const nonZeroCount = probs.filter((p) => p > 0).length;
  const maxEntropy = nonZeroCount > 1 ? Math.log2(nonZeroCount) : 0;
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  return { entropy, maxEntropy, normalizedEntropy };
}
