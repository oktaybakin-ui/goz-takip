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
import { CONFIDENCE_MIN_FIXATION } from "@/constants";

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
  amplitude: number;      // başlangıç-bitiş mesafesi (px)
  peakVelocity: number;   // saccade içindeki max hız (px/s)
  direction: number;       // saccade açısı (radyan, 0=sağ, π/2=aşağı)
}

export type FixationMode = "ivt" | "idt" | "hybrid";

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

  // I-DT parametreleri
  private maxDispersion: number;
  private idtMinDuration: number;

  // Hybrid mod
  private mode: FixationMode;

  // Saccade acceleration eşiği
  private maxAcceleration: number;

  // DBSCAN parametreleri
  private dbscanEps: number;
  private dbscanMinPts: number;

  // Gaze verileri — circular buffer ile bellek sınırlı
  private gazePoints: GazePoint[] = [];
  private readonly MAX_GAZE_POINTS = 2000; // ~66sn @30fps, 10 görüntü için yeterli
  private fixations: Fixation[] = [];
  private saccades: Saccade[] = [];
  private trackingStartTime: number = 0;

  // Canlı fixation tespiti
  private currentFixationPoints: GazePoint[] = [];

  private lastValidTimestamp: number = 0;
  private readonly BLINK_GAP_MS = 100; // Gerçek göz kırpma ~100-400ms
  private readonly POST_BLINK_REJECT = 2; // Göz kırpma sonrası atlanacak frame sayısı
  private postBlinkCounter: number = 0;

  // Kayan pencere hız hesabı için son noktalar — 5 frame (daha kararlı hız tahmini)
  private readonly VELOCITY_WINDOW = 5;
  private recentValidPoints: GazePoint[] = [];

  // Saccade peak velocity tracking
  private currentSaccadePeakVelocity: number = 0;
  private saccadeStartPoint: GazePoint | null = null;
  private previousVelocity: number = 0;
  private previousTimestamp: number = 0;

  /**
   * @param velocityThreshold - I-VT hız eşiği (px/s). 0 verilirse ekran boyutundan otomatik hesaplanır.
   * @param screenDiagonal - Ekran köşegeni (px). velocityThreshold=0 ise zorunlu.
   */
  constructor(
    velocityThreshold: number = 0,
    minFixationDuration: number = 100,
    maxFixationRadius: number = 0,
    dbscanEps: number = 0,
    dbscanMinPts: number = 3,
    mode: FixationMode = "ivt",
    maxDispersion: number = 0,
    idtMinDuration: number = 150,
    maxAcceleration: number = 8000,
    screenDiagonal: number = 0
  ) {
    // Ekran köşegenini otomatik hesapla
    const diag = screenDiagonal > 0 ? screenDiagonal : (
      typeof window !== "undefined"
        ? Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2)
        : 2203 // 1920x1080 default
    );

    // Ekran boyutuna normalize edilmiş parametreler — sıkılaştırıldı
    this.velocityThreshold = velocityThreshold > 0 ? velocityThreshold : diag * 0.025;
    this.minFixationDuration = minFixationDuration;
    this.maxFixationRadius = maxFixationRadius > 0 ? maxFixationRadius : diag * 0.018;
    this.dbscanEps = dbscanEps > 0 ? dbscanEps : diag * 0.018;
    this.dbscanMinPts = dbscanMinPts;
    this.mode = mode;
    this.maxDispersion = maxDispersion > 0 ? maxDispersion : diag * 0.016;
    this.idtMinDuration = idtMinDuration;
    this.maxAcceleration = maxAcceleration;
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
    this.currentSaccadePeakVelocity = 0;
    this.saccadeStartPoint = null;
    this.previousVelocity = 0;
    this.previousTimestamp = 0;
  }

  /**
   * Yeni bakış noktası ekler; I-VT ile fixation/saccade günceller.
   * @param point - GazePoint (x, y, timestamp, confidence)
   * @returns Tamamlanan fixation varsa onu döner, yoksa null
   */
  addGazePoint(point: GazePoint): Fixation | null {
    // Circular buffer: bellek sınırlaması (Sorun #23)
    this.gazePoints.push(point);
    if (this.gazePoints.length > this.MAX_GAZE_POINTS) {
      this.gazePoints.splice(0, this.gazePoints.length - this.MAX_GAZE_POINTS);
    }

    if (point.confidence < CONFIDENCE_MIN_FIXATION) return null;

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

    // Acceleration hesabı (saccade onset/offset tespiti için)
    let acceleration = 0;
    if (this.previousTimestamp > 0 && dt > 0.001) {
      const dv = velocity - this.previousVelocity;
      acceleration = Math.abs(dv / dt);
    }

    // I-VT kararı: velocity-based fixation
    const ivtIsFixation = velocity < this.velocityThreshold && distFromCenter < this.maxFixationRadius;

    // Debug: ilk 20 karar
    if (this.gazePoints.length <= 20 || (this.gazePoints.length % 200 === 0 && this.fixations.length === 0)) {
      console.log(`[FixDet] pt#${this.gazePoints.length} vel=${Math.round(velocity)} thresh=${Math.round(this.velocityThreshold)} dist=${Math.round(distFromCenter)} maxR=${Math.round(this.maxFixationRadius)} fix=${ivtIsFixation} curPts=${this.currentFixationPoints.length} totalFix=${this.fixations.length}`);
    }

    // I-DT kararı: dispersion-based fixation
    let idtIsFixation = true;
    if (this.mode === "idt" || this.mode === "hybrid") {
      idtIsFixation = this.checkIDTFixation(point);
    }

    // Nihai fixation kararı: mode'a göre
    let isFixation: boolean;
    if (this.mode === "ivt") {
      isFixation = ivtIsFixation;
    } else if (this.mode === "idt") {
      isFixation = idtIsFixation;
    } else {
      // Hybrid: her ikisi de fixation demeli (daha sıkı)
      isFixation = ivtIsFixation && idtIsFixation;
    }

    // Saccade onset tespiti: velocity VEYA acceleration eşiği aşıldı
    const isSaccadeOnset = velocity >= this.velocityThreshold || acceleration >= this.maxAcceleration;

    // Track peak velocity for saccade metrics
    if (isSaccadeOnset && !this.saccadeStartPoint) {
      this.saccadeStartPoint = lastPoint;
      this.currentSaccadePeakVelocity = velocity;
    }
    if (this.saccadeStartPoint) {
      this.currentSaccadePeakVelocity = Math.max(this.currentSaccadePeakVelocity, velocity);
    }

    this.previousVelocity = velocity;
    this.previousTimestamp = point.timestamp;

    if (isFixation) {
      // Saccade bitti (fixation'a geçiş)
      this.saccadeStartPoint = null;
      this.currentSaccadePeakVelocity = 0;

      this.currentFixationPoints.push(point);
      return null;
    } else {
      const completedFixation = this.finalizeFixation();
      this.currentFixationPoints = [point];

      if (completedFixation && lastPoint) {
        const amplitude = Math.sqrt(
          (point.x - completedFixation.x) ** 2 + (point.y - completedFixation.y) ** 2
        );
        const direction = Math.atan2(
          point.y - completedFixation.y,
          point.x - completedFixation.x
        );

        this.saccades.push({
          startX: completedFixation.x,
          startY: completedFixation.y,
          endX: point.x,
          endY: point.y,
          startTime: completedFixation.endTime,
          endTime: point.timestamp,
          velocity,
          amplitude,
          peakVelocity: this.currentSaccadePeakVelocity > 0 ? this.currentSaccadePeakVelocity : velocity,
          direction,
        });
      }

      return completedFixation;
    }
  }

  /**
   * I-DT (Dispersion Threshold) kontrolü:
   * Mevcut fixation penceresindeki tüm noktaların bounding box'ı maxDispersion'dan küçükse
   * VE süre idtMinDuration'dan uzunsa → fixation.
   * Sorun #7 düzeltmesi: Artık düzgün dispersion+süre kontrolü yapılıyor.
   */
  private checkIDTFixation(newPoint: GazePoint): boolean {
    const pts = [...this.currentFixationPoints, newPoint];
    if (pts.length < 2) return true; // Henüz yeterli veri yok, fixation varsay

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const dispersionX = maxX - minX;
    const dispersionY = maxY - minY;
    const dispersion = Math.max(dispersionX, dispersionY);

    // Dispersion çok büyükse → kesinlikle fixation değil
    if (dispersion > this.maxDispersion) {
      return false;
    }

    // Dispersion düşük, ama süre minimum eşiğin altındaysa ve nokta sayısı
    // yeterli bir pencere oluşturuyorsa → henüz karar verme (fixation potansiyel)
    const duration = newPoint.timestamp - pts[0].timestamp;
    if (pts.length >= 4 && duration < this.idtMinDuration) {
      // Kısa süre + düşük dispersion → muhtemelen fixation'ın başlangıcı
      // Dispersion çok düşükse fixation kabul et, orta düzeyde bekle
      return dispersion < this.maxDispersion * 0.5;
    }

    // Yeterli süre + düşük dispersion → fixation
    return true;
  }

  private finalizeFixation(): Fixation | null {
    if (this.currentFixationPoints.length < 2) {
      if (this.fixations.length === 0 && this.gazePoints.length > 10) {
        console.log(`[FixationDetector] finalizeFixation: only ${this.currentFixationPoints.length} points, need >=2. Total gaze: ${this.gazePoints.length}`);
      }
      return null;
    }

    const firstPoint = this.currentFixationPoints[0];
    const lastPoint = this.currentFixationPoints[this.currentFixationPoints.length - 1];
    const duration = lastPoint.timestamp - firstPoint.timestamp;

    if (duration < this.minFixationDuration) {
      if (this.fixations.length === 0 && this.gazePoints.length > 50) {
        console.log(`[FixationDetector] finalizeFixation: duration ${Math.round(duration)}ms < min ${this.minFixationDuration}ms. Points: ${this.currentFixationPoints.length}. Vel threshold: ${Math.round(this.velocityThreshold)}, MaxRadius: ${Math.round(this.maxFixationRadius)}`);
      }
      return null;
    }

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
