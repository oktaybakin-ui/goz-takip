/**
 * Advanced Iris Detection — deterministik, kararlı iris merkezi tespiti.
 *
 * RANSAC kaldırıldı (5 noktada rastgele örnekleme frame-to-frame titreşim yaratıyordu).
 * Yerine:
 *  1. Least-squares circle fit (tüm noktaları kullanır, deterministik)
 *  2. Güçlü temporal smoothing (exponential MA, 12 frame geçmiş, yavaş decay)
 *  3. Ellipse fitting (perspektif kompanzasyonu)
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

  // Temporal smoothing geçmişi — uzun geçmiş + yavaş decay = kararlı çıktı
  private irisHistory: Map<'left' | 'right', IrisFeatures[]> = new Map([
    ['left', []],
    ['right', []]
  ]);
  private readonly HISTORY_SIZE = 12;

  // Son kararlı pozisyon (EMA ile sürekli güncellenir)
  private lastStable: Map<'left' | 'right', { x: number; y: number } | null> = new Map([
    ['left', null],
    ['right', null]
  ]);
  private readonly EMA_ALPHA = 0.35; // 0=tamamen geçmiş, 1=tamamen yeni. 0.35 = güçlü smoothing

  private useEllipseFitting: boolean = true;

  /**
   * Deterministik iris tespiti: least-squares circle fit + EMA + temporal smoothing
   */
  detectIris(
    eyeLandmarks: Array<{ x: number; y: number }>,
    irisLandmarks: Array<{ x: number; y: number }>,
    eyeType: 'left' | 'right'
  ): IrisFeatures {
    const basicCenter = this.computeCentroid(irisLandmarks);
    const eyeBounds = this.computeBoundingBox(eyeLandmarks);
    const eyeWidth = eyeBounds.maxX - eyeBounds.minX;

    // Deterministik least-squares circle fit (RANSAC yerine — rastgelelik yok)
    const lsCircle = this.leastSquaresCircleFit(irisLandmarks);

    // Centroid ve LS circle'ı birleştir (LS daha doğru ama centroid daha kararlı)
    let combinedCenter: { x: number; y: number };
    if (lsCircle) {
      combinedCenter = {
        x: basicCenter.x * 0.3 + lsCircle.x * 0.7,
        y: basicCenter.y * 0.3 + lsCircle.y * 0.7
      };
    } else {
      combinedCenter = basicCenter;
    }

    // EMA smoothing: ani sıçramaları bastır
    const lastPos = this.lastStable.get(eyeType);
    if (lastPos) {
      const dist = Math.sqrt((combinedCenter.x - lastPos.x) ** 2 + (combinedCenter.y - lastPos.y) ** 2);
      // Büyük sıçrama: saccade olabilir → daha hızlı takip et
      const alpha = dist > 0.03 ? 0.6 : this.EMA_ALPHA;
      combinedCenter = {
        x: alpha * combinedCenter.x + (1 - alpha) * lastPos.x,
        y: alpha * combinedCenter.y + (1 - alpha) * lastPos.y
      };
    }
    this.lastStable.set(eyeType, { ...combinedCenter });

    const irisRadius = this.estimateIrisRadius(irisLandmarks, combinedCenter, eyeWidth);

    // Confidence: LS fit kalitesi
    const confidence = lsCircle ? lsCircle.fitness : 0.5;

    // Temporal smoothing (geçmiş frame'lerle ağırlıklı ortalama)
    const smoothedFeatures = this.temporalSmoothing({
      center: combinedCenter,
      radius: irisRadius,
      confidence
    }, eyeType);

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

    // Kåsa method: minimize algebraic distance
    // Solve: [x_i^2+y_i^2, x_i, y_i, 1] * [A, B, C, D]^T = 0
    // Center = (-B/2A, -C/2A), R = sqrt(B^2+C^2-4AD) / (2|A|)

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

    // Normal equations: A * [a, b]^T = B where center = (a, b)
    const A11 = sumX2 - sumX * sumX / n;
    const A12 = sumXY - sumX * sumY / n;
    const A22 = sumY2 - sumY * sumY / n;

    const b1 = 0.5 * (sumX3 - sumX * sumX2 / n + sumXY2 - sumX * sumY2 / n);
    const b2 = 0.5 * (sumX2Y - sumY * sumX2 / n + sumY3 - sumY * sumY2 / n);

    const det = A11 * A22 - A12 * A12;
    if (Math.abs(det) < 1e-14) return null;

    const cx = (A22 * b1 - A12 * b2) / det;
    const cy = (A11 * b2 - A12 * b1) / det;

    // Radius
    let sumR = 0;
    for (const p of points) {
      sumR += Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    }
    const r = sumR / n;

    // Fitness: noktaların çembere ne kadar yakın olduğu (0-1)
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
   * Temporal smoothing — daha yavaş decay ile kararlı çıktı.
   * decay=0.3: son frame ağırlığı ~0.74, 5 frame öncesi ~0.22, 10 frame öncesi ~0.05
   */
  private temporalSmoothing(
    current: IrisFeatures,
    eyeType: 'left' | 'right'
  ): IrisFeatures {
    const history = this.irisHistory.get(eyeType)!;
    history.push(current);

    if (history.length > this.HISTORY_SIZE) {
      history.shift();
    }

    if (history.length < 3) {
      return current;
    }

    let totalWeight = 0;
    let weightedCenter = { x: 0, y: 0 };
    let weightedRadius = 0;
    let weightedConfidence = 0;

    // Decay=0.3 (önceki 0.5'ten düşük → daha yavaş unutma → daha kararlı)
    history.forEach((features, i) => {
      const weight = Math.exp(0.3 * (i - history.length + 1));
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
    this.lastStable.set('left', null);
    this.lastStable.set('right', null);
  }
}
