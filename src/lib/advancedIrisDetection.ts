/**
 * Advanced Iris Detection — deterministik, kararlı iris merkezi tespiti.
 *
 * Pipeline (minimal smoothing — sinyal korunması öncelikli):
 *  1. Least-squares circle fit (Kåsa yöntemi, deterministik)
 *  2. Hafif 3-frame temporal smoothing (sadece landmark jitter bastırma)
 *  3. Ellipse fitting (perspektif kompanzasyonu)
 *
 * NOT: EMA smoothing kaldırıldı. Birden fazla smoothing katmanı iris sinyalini
 * öldürüyordu (0.15 birimlik bakış aralığını 0.05'e düşürüyordu). Tek smoothing
 * katmanı final output'ta (One Euro Filter, gazeModel.ts) uygulanır.
 */

import { logger } from './logger';

export interface IrisFeatures {
  center: { x: number; y: number };
  radius: number;
  confidence: number;
  ellipse?: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    rotation: number;
  };
}

export class AdvancedIrisDetector {
  private readonly IRIS_RADIUS_RATIO = 0.15;
  private readonly MIN_IRIS_RADIUS = 0.005;
  private readonly MAX_IRIS_RADIUS = 0.025;

  // Hafif temporal smoothing — sadece landmark jitter bastırma (3 frame, hızlı decay)
  private irisHistory: Map<'left' | 'right', IrisFeatures[]> = new Map([
    ['left', []],
    ['right', []]
  ]);
  private readonly HISTORY_SIZE = 3; // 12→3: sinyal koruması için minimal

  private useEllipseFitting: boolean = true;

  /**
   * Deterministik iris tespiti: landmark outlier filtresi + circle fit + temporal smoothing
   */
  detectIris(
    eyeLandmarks: Array<{ x: number; y: number }>,
    irisLandmarks: Array<{ x: number; y: number }>,
    eyeType: 'left' | 'right'
  ): IrisFeatures {
    // Iris landmark outlier filtresi: merkeze çok uzak noktaları bastır
    const filteredIris = this.filterIrisOutliers(irisLandmarks);

    const basicCenter = this.computeCentroid(filteredIris);
    const eyeBounds = this.computeBoundingBox(eyeLandmarks);
    const eyeWidth = eyeBounds.maxX - eyeBounds.minX;

    // Deterministik least-squares circle fit (Kåsa yöntemi — rastgelelik yok)
    const lsCircle = this.leastSquaresCircleFit(filteredIris);

    // Sorun #1: Circle fit kalite validasyonu — RMSE eşiği ile düşük kaliteyi reddet
    // Fitness <0.3 ise circle fit güvenilmez, centroid'e daha çok ağırlık ver
    let combinedCenter: { x: number; y: number };
    if (lsCircle) {
      // Circle fit kalitesine göre ağırlık ayarla — sıkılaştırılmış eşikler
      const fitQuality = Math.max(0, Math.min(1, lsCircle.fitness));
      // Yüksek fitness → LS ağırlığı yüksek, düşük fitness → centroid ağırlığı yüksek
      // 0.6+ = güvenilir circle fit, 0.4-0.6 = orta, <0.4 = centroid'e güven
      const lsWeight = fitQuality > 0.6 ? 0.80 : fitQuality > 0.4 ? 0.55 : 0.15;
      const centroidWeight = 1 - lsWeight;

      // Circle merkezi göz sınırları dışındaysa reddet — daha sıkı sınırlar
      const centerInBounds =
        lsCircle.x >= eyeBounds.minX - eyeWidth * 0.15 &&
        lsCircle.x <= eyeBounds.maxX + eyeWidth * 0.15 &&
        lsCircle.y >= eyeBounds.minY - eyeWidth * 0.15 &&
        lsCircle.y <= eyeBounds.maxY + eyeWidth * 0.15;

      if (centerInBounds && fitQuality > 0.30) {
        combinedCenter = {
          x: basicCenter.x * centroidWeight + lsCircle.x * lsWeight,
          y: basicCenter.y * centroidWeight + lsCircle.y * lsWeight
        };
      } else {
        // Circle fit güvenilmez — sadece centroid kullan
        combinedCenter = basicCenter;
      }
    } else {
      combinedCenter = basicCenter;
    }

    // EMA KALDIRILDI — sinyal korunması için. Eski davranış:
    // Her frame'i öncekiyle karıştırıyordu (alpha=0.35), bakış aralığını daraltıyordu.
    // Artık doğrudan circle fit sonucu kullanılıyor.

    const irisRadius = this.estimateIrisRadius(filteredIris, combinedCenter, eyeWidth);

    // Confidence: LS fit kalitesi
    const confidence = lsCircle ? lsCircle.fitness : 0.5;

    // Fitness-adaptive temporal smoothing: düşük kalitede daha fazla smoothing
    const smoothedFeatures = this.temporalSmoothing({
      center: combinedCenter,
      radius: irisRadius,
      confidence
    }, eyeType, confidence);

    // Ellipse fitting
    let ellipseParams;
    if (this.useEllipseFitting && irisLandmarks.length >= 5) {
      ellipseParams = this.fitEllipse(irisLandmarks);
    }

    return {
      center: smoothedFeatures.center,
      radius: smoothedFeatures.radius,
      confidence: smoothedFeatures.confidence,
      ellipse: ellipseParams
    };
  }

  /**
   * Least-squares circle fit (Kåsa yöntemi) — deterministik, tüm noktaları kullanır.
   * RANSAC'ın aksine her frame aynı girdiyle aynı sonucu verir → titreşim yok.
   */
  private leastSquaresCircleFit(
    points: Array<{ x: number; y: number }>
  ): { x: number; y: number; r: number; fitness: number } | null {
    const n = points.length;
    if (n < 3) return null;

    let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
    let sumXY = 0, sumX3 = 0, sumY3 = 0, sumX2Y = 0, sumXY2 = 0;

    for (const p of points) {
      const x2 = p.x * p.x;
      const y2 = p.y * p.y;
      sumX += p.x;
      sumY += p.y;
      sumX2 += x2;
      sumY2 += y2;
      sumXY += p.x * p.y;
      sumX3 += x2 * p.x;
      sumY3 += y2 * p.y;
      sumX2Y += x2 * p.y;
      sumXY2 += p.x * y2;
    }

    const A11 = sumX2 - sumX * sumX / n;
    const A12 = sumXY - sumX * sumY / n;
    const A22 = sumY2 - sumY * sumY / n;

    const b1 = 0.5 * (sumX3 - sumX * sumX2 / n + sumXY2 - sumX * sumY2 / n);
    const b2 = 0.5 * (sumX2Y - sumY * sumX2 / n + sumY3 - sumY * sumY2 / n);

    const det = A11 * A22 - A12 * A12;
    if (Math.abs(det) < 1e-14) return null;

    const cx = (A22 * b1 - A12 * b2) / det;
    const cy = (A11 * b2 - A12 * b1) / det;

    let sumR = 0;
    for (const p of points) {
      sumR += Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    }
    const r = sumR / n;

    let totalResidual = 0;
    for (const p of points) {
      const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
      totalResidual += Math.abs(d - r);
    }
    const avgResidual = totalResidual / n;
    const fitness = Math.max(0, 1 - avgResidual / (r || 0.01));

    return { x: cx, y: cy, r, fitness };
  }

  private estimateIrisRadius(
    irisPoints: Array<{ x: number; y: number }>,
    center: { x: number; y: number },
    eyeWidth: number
  ): number {
    const avgDist = irisPoints.reduce((sum, p) => {
      return sum + Math.sqrt((p.x - center.x) ** 2 + (p.y - center.y) ** 2);
    }, 0) / irisPoints.length;

    const ratioRadius = eyeWidth * this.IRIS_RADIUS_RATIO;
    const bounds = this.computeBoundingBox(irisPoints);
    const bboxRadius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;

    let radius = avgDist * 0.5 + ratioRadius * 0.3 + bboxRadius * 0.2;
    radius = Math.max(this.MIN_IRIS_RADIUS, Math.min(this.MAX_IRIS_RADIUS, radius));
    return radius;
  }

  /**
   * Iris landmark outlier filtresi: medyan mesafeden çok uzak noktaları ağırlığını düşür.
   * 5 noktanın 1-2'si hatalı olabilir, bu onları yumuşak şekilde bastırır.
   */
  private filterIrisOutliers(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (points.length <= 3) return points;

    const centroid = this.computeCentroid(points);
    const distances = points.map(p =>
      Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2)
    );

    // Median mesafe
    const sorted = [...distances].sort((a, b) => a - b);
    const medianDist = sorted[Math.floor(sorted.length / 2)];

    // MAD (Median Absolute Deviation)
    const absDevs = distances.map(d => Math.abs(d - medianDist));
    const sortedDevs = [...absDevs].sort((a, b) => a - b);
    const mad = sortedDevs[Math.floor(sortedDevs.length / 2)] || 0.0001;

    // Outlier noktaları tamamen atmak yerine centroid'e çek (soft rejection)
    return points.map((p, i) => {
      const modZ = 0.6745 * Math.abs(distances[i] - medianDist) / mad;
      if (modZ > 3.0) {
        // Outlier → centroid'e %70 çek (tamamen atmak sinyal kaybı yapar)
        return {
          x: p.x * 0.3 + centroid.x * 0.7,
          y: p.y * 0.3 + centroid.y * 0.7,
        };
      }
      return p;
    });
  }

  /**
   * Fitness-adaptive temporal smoothing — kalite yüksekse hızlı decay (sinyale güven),
   * kalite düşükse yavaş decay (geçmişe güven, gürültü bastırma).
   */
  private temporalSmoothing(
    current: IrisFeatures,
    eyeType: 'left' | 'right',
    fitness: number = 0.5
  ): IrisFeatures {
    const history = this.irisHistory.get(eyeType)!;
    history.push(current);

    if (history.length > this.HISTORY_SIZE) {
      history.shift();
    }

    if (history.length < 2) {
      return current;
    }

    let totalWeight = 0;
    let weightedCenter = { x: 0, y: 0 };
    let weightedRadius = 0;
    let weightedConfidence = 0;

    // Adaptive decay: yüksek fitness (>0.5) → 0.9 decay (sinyale güven)
    //                  düşük fitness (<0.3) → 0.5 decay (geçmişe güven, gürültü bastır)
    const decay = 0.5 + Math.min(fitness, 0.8) * 0.5; // 0.5→0.9 arası

    history.forEach((features, i) => {
      // Confidence-weighted: her frame'in kendi kalitesi de ağırlığa katılır
      const timeWeight = Math.exp(decay * (i - history.length + 1));
      const confWeight = Math.max(0.3, features.confidence);
      const weight = timeWeight * confWeight;
      weightedCenter.x += features.center.x * weight;
      weightedCenter.y += features.center.y * weight;
      weightedRadius += features.radius * weight;
      weightedConfidence += features.confidence * weight;
      totalWeight += weight;
    });

    return {
      center: {
        x: weightedCenter.x / totalWeight,
        y: weightedCenter.y / totalWeight
      },
      radius: weightedRadius / totalWeight,
      confidence: weightedConfidence / totalWeight
    };
  }

  private fitEllipse(points: Array<{ x: number; y: number }>): IrisFeatures['ellipse'] {
    const center = this.computeCentroid(points);

    let cxx = 0, cyy = 0, cxy = 0;
    points.forEach(p => {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    });

    cxx /= points.length;
    cyy /= points.length;
    cxy /= points.length;

    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.max(0, trace * trace / 4 - det);
    const lambda1 = trace / 2 + Math.sqrt(disc);
    const lambda2 = trace / 2 - Math.sqrt(disc);

    const rotation = Math.atan2(2 * cxy, cxx - cyy) / 2;

    return {
      centerX: center.x,
      centerY: center.y,
      radiusX: 2 * Math.sqrt(Math.max(0, lambda1)),
      radiusY: 2 * Math.sqrt(Math.max(0, lambda2)),
      rotation
    };
  }

  private computeCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
    const sum = points.reduce((acc, p) => ({
      x: acc.x + p.x,
      y: acc.y + p.y
    }), { x: 0, y: 0 });

    return {
      x: sum.x / points.length,
      y: sum.y / points.length
    };
  }

  private computeBoundingBox(points: Array<{ x: number; y: number }>) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);

    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    };
  }

  reset(): void {
    this.irisHistory.clear();
    this.irisHistory.set('left', []);
    this.irisHistory.set('right', []);
  }
}
