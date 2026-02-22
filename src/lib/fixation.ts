/**
 * Fixation Analiz Modülü
 *
 * I-VT (Velocity Threshold) yöntemi ile fixation tespiti:
 * - Düşük hız = Fixation (≥ 100-200 ms)
 * - Yüksek hız = Saccade
 *
 * Hesaplanan metrikler:
 * - First Fixation Point
 * - Time to First Fixation (TTFF)
 * - İlk 3 fixation sırası
 * - Total fixation duration
 * - ROI clustering (DBSCAN)
 * - Gaze density map
 */

import { GazePoint } from "./gazeModel";

export interface Fixation {
  x: number;
  y: number;
  startTime: number;
  endTime: number;
  duration: number;
  pointCount: number;
  avgConfidence: number;
}

export interface Saccade {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  endTime: number;
  velocity: number;
}

export interface ROICluster {
  id: number;
  centerX: number;
  centerY: number;
  points: GazePoint[];
  totalDuration: number;
  fixationCount: number;
  radius: number;
}

export interface FixationMetrics {
  firstFixation: Fixation | null;
  timeToFirstFixation: number; // ms
  firstThreeFixations: Fixation[];
  longestFixation: Fixation | null;
  totalFixationDuration: number; // ms
  totalViewTime: number; // ms
  fixationCount: number;
  averageFixationDuration: number;
  allFixations: Fixation[];
  saccades: Saccade[];
  roiClusters: ROICluster[];
}

/**
 * I-VT (Velocity Threshold) ile fixation/saccade tespiti ve FixationMetrics hesaplama.
 * DBSCAN ile ROI clustering yapar.
 */
export class FixationDetector {
  // I-VT parametreleri
  private velocityThreshold: number;
  private minFixationDuration: number;
  private maxFixationRadius: number;

  // DBSCAN parametreleri
  private dbscanEps: number;
  private dbscanMinPts: number;

  // Gaze verileri
  private gazePoints: GazePoint[] = [];
  private fixations: Fixation[] = [];
  private saccades: Saccade[] = [];
  private trackingStartTime: number = 0;

  // Canlı fixation tespiti
  private currentFixationPoints: GazePoint[] = [];

  private lastValidTimestamp: number = 0;
  private readonly BLINK_GAP_MS = 100; // Gerçek göz kırpma ~100-400ms
  private readonly POST_BLINK_REJECT = 2; // Göz kırpma sonrası atlanacak frame sayısı
  private postBlinkCounter: number = 0;

  // Kayan pencere hız hesabı için son noktalar
  private readonly VELOCITY_WINDOW = 3;
  private recentValidPoints: GazePoint[] = [];

  constructor(
    velocityThreshold: number = 55,
    minFixationDuration: number = 100,
    maxFixationRadius: number = 40,
    dbscanEps: number = 35,
    dbscanMinPts: number = 5
  ) {
    this.velocityThreshold = velocityThreshold;
    this.minFixationDuration = minFixationDuration;
    this.maxFixationRadius = maxFixationRadius;
    this.dbscanEps = dbscanEps;
    this.dbscanMinPts = dbscanMinPts;
  }

  startTracking(): void {
    this.gazePoints = [];
    this.fixations = [];
    this.saccades = [];
    this.currentFixationPoints = [];
    this.recentValidPoints = [];
    this.postBlinkCounter = 0;
    this.lastValidTimestamp = 0;
    this.trackingStartTime = performance.now();
  }

  /**
   * Yeni bakış noktası ekler; I-VT ile fixation/saccade günceller.
   * @param point - GazePoint (x, y, timestamp, confidence)
   * @returns Tamamlanan fixation varsa onu döner, yoksa null
   */
  addGazePoint(point: GazePoint): Fixation | null {
    this.gazePoints.push(point);

    if (point.confidence < 0.3) return null;

    // Göz kırpma boşluğu tespiti (100-400ms)
    if (this.lastValidTimestamp > 0) {
      const gap = point.timestamp - this.lastValidTimestamp;
      if (gap > this.BLINK_GAP_MS && gap < 400) {
        this.postBlinkCounter = this.POST_BLINK_REJECT;
        return null;
      }
    }

    // Göz kırpma sonrası ilk N frame'i atla (sakkadik toparlanma)
    if (this.postBlinkCounter > 0) {
      this.postBlinkCounter--;
      this.lastValidTimestamp = point.timestamp;
      return null;
    }

    this.lastValidTimestamp = point.timestamp;

    // Kayan pencere için geçerli noktaları tut
    this.recentValidPoints.push(point);
    if (this.recentValidPoints.length > this.VELOCITY_WINDOW + 1) {
      this.recentValidPoints.shift();
    }

    if (this.currentFixationPoints.length === 0) {
      this.currentFixationPoints.push(point);
      return null;
    }

    // Güven-ağırlıklı fixation merkezi
    let sumCW = 0, sumCX = 0, sumCY = 0;
    for (const p of this.currentFixationPoints) {
      const w = Math.max(0.1, p.confidence);
      sumCW += w;
      sumCX += p.x * w;
      sumCY += p.y * w;
    }
    const centerX = sumCW > 0 ? sumCX / sumCW : this.currentFixationPoints[0].x;
    const centerY = sumCW > 0 ? sumCY / sumCW : this.currentFixationPoints[0].y;

    // Kayan pencere hız hesabı: tek frame yerine W frame üzerinden
    // Bu gürültüyü ortalayarak daha kararlı fiksasyon sınıflandırması sağlar
    let velocity = 0;
    if (this.recentValidPoints.length >= 2) {
      const windowStart = this.recentValidPoints[0];
      const dtWindow = (point.timestamp - windowStart.timestamp) / 1000;
      if (dtWindow > 0.001) {
        const distWindow = Math.sqrt(
          (point.x - windowStart.x) ** 2 + (point.y - windowStart.y) ** 2
        );
        velocity = distWindow / dtWindow;
      }
    }

    const lastPoint = this.currentFixationPoints[this.currentFixationPoints.length - 1];
    const dt = (point.timestamp - lastPoint.timestamp) / 1000;
    if (dt <= 0.001) {
      this.currentFixationPoints.push(point);
      return null;
    }

    const distFromCenter = Math.sqrt(
      (point.x - centerX) ** 2 + (point.y - centerY) ** 2
    );

    if (velocity < this.velocityThreshold && distFromCenter < this.maxFixationRadius) {
      this.currentFixationPoints.push(point);
      return null;
    } else {
      const completedFixation = this.finalizeFixation();
      this.currentFixationPoints = [point];

      if (completedFixation && lastPoint) {
        this.saccades.push({
          startX: completedFixation.x,
          startY: completedFixation.y,
          endX: point.x,
          endY: point.y,
          startTime: completedFixation.endTime,
          endTime: point.timestamp,
          velocity,
        });
      }

      return completedFixation;
    }
  }

  private finalizeFixation(): Fixation | null {
    if (this.currentFixationPoints.length < 2) return null;

    const firstPoint = this.currentFixationPoints[0];
    const lastPoint = this.currentFixationPoints[this.currentFixationPoints.length - 1];
    const duration = lastPoint.timestamp - firstPoint.timestamp;

    if (duration < this.minFixationDuration) return null;

    // Güven-ağırlıklı merkez hesabı (yüksek güvenli noktalar daha etkili)
    let sumW = 0, sumX = 0, sumY = 0, sumC = 0;
    for (const p of this.currentFixationPoints) {
      const w = Math.max(0.1, p.confidence);
      sumW += w;
      sumX += p.x * w;
      sumY += p.y * w;
      sumC += p.confidence;
    }

    const fixation: Fixation = {
      x: sumW > 0 ? sumX / sumW : this.currentFixationPoints[0].x,
      y: sumW > 0 ? sumY / sumW : this.currentFixationPoints[0].y,
      startTime: firstPoint.timestamp,
      endTime: lastPoint.timestamp,
      duration,
      pointCount: this.currentFixationPoints.length,
      avgConfidence: sumC / this.currentFixationPoints.length,
    };

    this.fixations.push(fixation);
    return fixation;
  }

  /** Tracking'i bitirir; son fixation finalize edilir. */
  stopTracking(): void {
    this.finalizeFixation();
    this.currentFixationPoints = [];
  }

  // DBSCAN kümeleme
  private dbscanClustering(): ROICluster[] {
    if (this.fixations.length === 0) return [];

    const visited = new Set<number>();
    const clustered = new Set<number>();
    const clusters: ROICluster[] = [];

    for (let i = 0; i < this.fixations.length; i++) {
      if (visited.has(i)) continue;
      visited.add(i);

      const neighbors = this.getNeighbors(i);

      if (neighbors.length >= this.dbscanMinPts) {
        const cluster = this.expandCluster(i, neighbors, visited, clustered);
        if (cluster.length > 0) {
          clusters.push(this.createCluster(clusters.length, cluster));
        }
      }
    }

    return clusters.sort((a, b) => b.totalDuration - a.totalDuration);
  }

  private getNeighbors(fixationIndex: number): number[] {
    const fix = this.fixations[fixationIndex];
    const neighbors: number[] = [];

    for (let j = 0; j < this.fixations.length; j++) {
      if (j === fixationIndex) continue;
      const other = this.fixations[j];
      const dist = Math.sqrt((fix.x - other.x) ** 2 + (fix.y - other.y) ** 2);
      if (dist <= this.dbscanEps) {
        neighbors.push(j);
      }
    }

    return neighbors;
  }

  private expandCluster(
    pointIndex: number,
    neighbors: number[],
    visited: Set<number>,
    clustered: Set<number>
  ): number[] {
    const cluster = [pointIndex];
    clustered.add(pointIndex);

    const queue = [...neighbors];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (!visited.has(current)) {
        visited.add(current);
        const currentNeighbors = this.getNeighbors(current);

        if (currentNeighbors.length >= this.dbscanMinPts) {
          queue.push(...currentNeighbors.filter((n) => !visited.has(n)));
        }
      }

      if (!clustered.has(current)) {
        cluster.push(current);
        clustered.add(current);
      }
    }

    return cluster;
  }

  private createCluster(id: number, fixationIndices: number[]): ROICluster {
    const clusterFixations = fixationIndices.map((i) => this.fixations[i]);

    const centerX =
      clusterFixations.reduce((s, f) => s + f.x, 0) / clusterFixations.length;
    const centerY =
      clusterFixations.reduce((s, f) => s + f.y, 0) / clusterFixations.length;

    let maxRadius = 0;
    for (const f of clusterFixations) {
      const dist = Math.sqrt((f.x - centerX) ** 2 + (f.y - centerY) ** 2);
      maxRadius = Math.max(maxRadius, dist);
    }

    const points: GazePoint[] = clusterFixations.map((f) => ({
      x: f.x,
      y: f.y,
      timestamp: f.startTime,
      confidence: f.avgConfidence,
    }));

    return {
      id,
      centerX,
      centerY,
      points,
      totalDuration: clusterFixations.reduce((s, f) => s + f.duration, 0),
      fixationCount: clusterFixations.length,
      radius: maxRadius + this.dbscanEps / 2,
    };
  }

  /** İlk bakış, TTFF, toplam süre, ROI kümeleri vb. tüm metrikleri döner. */
  getMetrics(): FixationMetrics {
    const allFixations = [...this.fixations];
    const sortedByTime = allFixations.sort((a, b) => a.startTime - b.startTime);

    const firstFixation = sortedByTime.length > 0 ? sortedByTime[0] : null;
    const timeToFirstFixation = firstFixation
      ? firstFixation.startTime - this.trackingStartTime
      : 0;
    const firstThreeFixations = sortedByTime.slice(0, 3);

    const longestFixation =
      allFixations.length > 0
        ? allFixations.reduce((max, f) => (f.duration > max.duration ? f : max))
        : null;

    const totalFixationDuration = allFixations.reduce((s, f) => s + f.duration, 0);

    const lastGazeTime =
      this.gazePoints.length > 0
        ? this.gazePoints[this.gazePoints.length - 1].timestamp
        : this.trackingStartTime;

    return {
      firstFixation,
      timeToFirstFixation,
      firstThreeFixations,
      longestFixation,
      totalFixationDuration,
      totalViewTime: lastGazeTime - this.trackingStartTime,
      fixationCount: allFixations.length,
      averageFixationDuration:
        allFixations.length > 0 ? totalFixationDuration / allFixations.length : 0,
      allFixations: sortedByTime,
      saccades: this.saccades,
      roiClusters: this.dbscanClustering(),
    };
  }

  /** Toplanan tüm gaze noktalarını döner (heatmap vb. için). */
  getGazePoints(): GazePoint[] {
    return this.gazePoints;
  }

  /** Tespit edilen fixation listesini döner. */
  getFixations(): Fixation[] {
    return this.fixations;
  }
}
