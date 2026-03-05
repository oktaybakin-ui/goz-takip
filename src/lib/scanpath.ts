/**
 * Scanpath Metrikleri Modülü
 *
 * Göz hareketlerinin uzamsal düzenini analiz eder:
 * - Scanpath uzunluğu (toplam saccade mesafesi)
 * - Scanpath düzeni (convex hull area / toplam alan)
 * - Fixation-saccade oranı
 * - Backtrack oranı (önceki fixation'a geri dönüş)
 */

import type { Fixation, Saccade } from "./fixation";

export interface ScanpathMetrics {
  /** Toplam saccade mesafesi (px) */
  totalScanpathLength: number;
  /** Ortalama saccade mesafesi (px) */
  avgSaccadeLength: number;
  /** Scanpath düzeni: convex hull alanı / bounding box alanı (0-1, düşük = dağınık, yüksek = compact) */
  scanpathRegularity: number;
  /** Fixation süresi / toplam süre (0-1) */
  fixationSaccadeRatio: number;
  /** Geri dönüş oranı: önceki fixation'a yakın yere dönüş / toplam saccade (0-1) */
  backtrackRatio: number;
  /** Toplam fixation süresi (ms) */
  totalFixationDurationMs: number;
  /** Toplam saccade süresi (ms) */
  totalSaccadeDurationMs: number;
  /** Convex hull alanı (px²) */
  convexHullArea: number;
  /** Fixation sayısı */
  fixationCount: number;
  /** Saccade sayısı */
  saccadeCount: number;
}

/**
 * Scanpath metriklerini hesapla.
 * @param fixations - Tespit edilen fixation'lar (zamana göre sıralı)
 * @param saccades - Tespit edilen saccade'lar
 * @param totalViewTimeMs - Toplam görüntüleme süresi (ms)
 */
export function computeScanpathMetrics(
  fixations: Fixation[],
  saccades: Saccade[],
  totalViewTimeMs: number
): ScanpathMetrics {
  // Scanpath uzunluğu
  let totalLength = 0;
  for (const s of saccades) {
    const dx = s.endX - s.startX;
    const dy = s.endY - s.startY;
    totalLength += Math.sqrt(dx * dx + dy * dy);
  }
  const avgLength = saccades.length > 0 ? totalLength / saccades.length : 0;

  // Fixation süreleri
  const totalFixDuration = fixations.reduce((sum, f) => sum + f.duration, 0);
  const totalSaccadeDuration = saccades.reduce(
    (sum, s) => sum + (s.endTime - s.startTime), 0
  );

  // Fixation-saccade oranı
  const totalTime = Math.max(1, totalViewTimeMs);
  const fixSaccRatio = totalFixDuration / totalTime;

  // Convex hull hesabı (Andrew's monotone chain)
  const points = fixations.map((f) => ({ x: f.x, y: f.y }));
  const hullArea = computeConvexHullArea(points);

  // Bounding box alanı
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bboxArea = Math.max(1, (maxX - minX) * (maxY - minY));
  const regularity = points.length >= 3 ? hullArea / bboxArea : 0;

  // Backtrack oranı: fixation i → i+2 arasındaki mesafe < fixation i → i+1 mesafesinin yarısı
  let backtrackCount = 0;
  if (fixations.length >= 3) {
    for (let i = 0; i < fixations.length - 2; i++) {
      const curr = fixations[i];
      const next = fixations[i + 1];
      const nextNext = fixations[i + 2];

      const distForward = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
      const distReturn = Math.sqrt((nextNext.x - curr.x) ** 2 + (nextNext.y - curr.y) ** 2);

      // Eğer 2 adım sonra başlangıca yakınsa → backtrack
      if (distReturn < distForward * 0.5) {
        backtrackCount++;
      }
    }
  }
  const backtrackRatio = fixations.length >= 3
    ? backtrackCount / (fixations.length - 2)
    : 0;

  return {
    totalScanpathLength: totalLength,
    avgSaccadeLength: avgLength,
    scanpathRegularity: Math.min(1, regularity),
    fixationSaccadeRatio: Math.min(1, fixSaccRatio),
    backtrackRatio: Math.min(1, backtrackRatio),
    totalFixationDurationMs: totalFixDuration,
    totalSaccadeDurationMs: totalSaccadeDuration,
    convexHullArea: hullArea,
    fixationCount: fixations.length,
    saccadeCount: saccades.length,
  };
}

/**
 * Convex hull alanı hesapla (Andrew's monotone chain algoritması).
 */
function computeConvexHullArea(points: { x: number; y: number }[]): number {
  if (points.length < 3) return 0;

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const n = sorted.length;

  // Alt ve üst hull
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: { x: number; y: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Son noktaları çıkar (tekrar ediyorlar)
  lower.pop();
  upper.pop();

  const hull = [...lower, ...upper];
  if (hull.length < 3) return 0;

  // Shoelace formülü ile alan
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    area += hull[i].x * hull[j].y;
    area -= hull[j].x * hull[i].y;
  }

  return Math.abs(area) / 2;
}

/** Cross product of vectors OA and OB */
function cross(
  O: { x: number; y: number },
  A: { x: number; y: number },
  B: { x: number; y: number }
): number {
  return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
}
