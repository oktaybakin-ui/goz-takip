/**
 * Benchmark Framework
 *
 * Göz takip sistemi doğruluğunu ölçmek için benchmark sınıfı:
 * - 9 veya 16 test noktası
 * - Per-point error (px ve angular degree)
 * - Mean/median/max error
 * - Error heatmap (ekranın hangi bölgesinde hata yüksek)
 * - Spatial accuracy ve precision metrikleri
 * - JSON export
 */

import { GazeModel, GazePoint, EyeFeatures } from "./gazeModel";
import { generateCalibrationPoints, CalibrationPoint } from "./calibration";

export interface BenchmarkPointResult {
  pointId: number;
  targetX: number;
  targetY: number;
  predictions: { x: number; y: number; confidence: number }[];
  meanPredX: number;
  meanPredY: number;
  errorPx: number;        // Ortalama hata (px)
  errorAngularDeg: number; // Açısal hata (derece)
  precision: number;       // Tahminlerin standart sapması (px) — düşük = iyi
  sampleCount: number;
}

export interface BenchmarkResult {
  timestamp: number;
  screenWidth: number;
  screenHeight: number;
  screenDistancePx: number; // Varsayılan ekran mesafesi (px cinsinden)
  pointResults: BenchmarkPointResult[];
  meanErrorPx: number;
  medianErrorPx: number;
  maxErrorPx: number;
  meanAngularErrorDeg: number;
  spatialAccuracy: number;   // Ortalama hata / ekran köşegeni * 100 (%)
  spatialPrecision: number;  // Ortalama precision / ekran köşegeni * 100 (%)
  errorHeatmap: ErrorHeatmapCell[];
}

export interface ErrorHeatmapCell {
  gridRow: number;
  gridCol: number;
  centerX: number;
  centerY: number;
  errorPx: number;
}

/**
 * Varsayılan ekran mesafesi: ~60cm mesafede 1px ≈ 0.022° (96 DPI ekran).
 * screen_distance_px = 60cm / (2.54cm/inch) * 96 DPI ≈ 2268 px
 */
const DEFAULT_SCREEN_DISTANCE_PX = 2268;

export class GazeBenchmark {
  private model: GazeModel;
  private screenWidth: number = 0;
  private screenHeight: number = 0;
  private screenDistancePx: number = DEFAULT_SCREEN_DISTANCE_PX;

  private testPoints: CalibrationPoint[] = [];
  private currentPointIndex: number = 0;
  private currentPointSamples: { x: number; y: number; confidence: number }[] = [];
  private pointResults: BenchmarkPointResult[] = [];

  private isRunning: boolean = false;
  private onPointChange: ((point: CalibrationPoint, index: number, total: number) => void) | null = null;
  private onComplete: ((result: BenchmarkResult) => void) | null = null;

  constructor(model: GazeModel) {
    this.model = model;
  }

  /** Benchmark'ı başlat */
  start(
    screenWidth: number,
    screenHeight: number,
    pointCount: 9 | 16 = 9,
    onPointChange: (point: CalibrationPoint, index: number, total: number) => void,
    onComplete: (result: BenchmarkResult) => void
  ): void {
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    this.onPointChange = onPointChange;
    this.onComplete = onComplete;

    // Test noktaları oluştur
    const gridSize = pointCount === 16 ? "4x4" : "3x3";
    const [rows, cols] = gridSize.split("x").map(Number);
    this.testPoints = [];
    let id = 0;
    const padding = 80;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const relX = cols > 1 ? col / (cols - 1) : 0.5;
        const relY = rows > 1 ? row / (rows - 1) : 0.5;
        const x = padding + relX * (screenWidth - 2 * padding);
        const y = padding + relY * (screenHeight - 2 * padding);
        this.testPoints.push({ id: id++, x, y, relX, relY });
      }
    }

    this.currentPointIndex = 0;
    this.pointResults = [];
    this.currentPointSamples = [];
    this.isRunning = true;

    this.onPointChange(this.testPoints[0], 0, this.testPoints.length);
  }

  /** Her frame'de çağrılır — mevcut test noktası için tahmin ekler */
  addSample(features: EyeFeatures): boolean {
    if (!this.isRunning) return false;

    const prediction = this.model.predict(features);
    if (!prediction) return false;

    this.currentPointSamples.push({
      x: prediction.x,
      y: prediction.y,
      confidence: prediction.confidence,
    });

    return this.currentPointSamples.length >= 30; // 30 sample yeterli
  }

  /** Mevcut noktayı tamamla ve sonrakine geç */
  nextPoint(): boolean {
    if (!this.isRunning || this.testPoints.length === 0) return false;

    const target = this.testPoints[this.currentPointIndex];
    const samples = this.currentPointSamples;

    if (samples.length > 0) {
      const meanX = samples.reduce((s, p) => s + p.x, 0) / samples.length;
      const meanY = samples.reduce((s, p) => s + p.y, 0) / samples.length;
      const errorPx = Math.sqrt((meanX - target.x) ** 2 + (meanY - target.y) ** 2);

      // Açısal hata hesabı
      const errorAngularDeg = Math.atan2(errorPx, this.screenDistancePx) * (180 / Math.PI);

      // Precision: tahminlerin birbirine yakınlığı (std dev)
      const varX = samples.reduce((s, p) => s + (p.x - meanX) ** 2, 0) / samples.length;
      const varY = samples.reduce((s, p) => s + (p.y - meanY) ** 2, 0) / samples.length;
      const precision = Math.sqrt(varX + varY);

      this.pointResults.push({
        pointId: target.id,
        targetX: target.x,
        targetY: target.y,
        predictions: [...samples],
        meanPredX: meanX,
        meanPredY: meanY,
        errorPx,
        errorAngularDeg,
        precision,
        sampleCount: samples.length,
      });
    }

    this.currentPointSamples = [];
    this.currentPointIndex++;

    if (this.currentPointIndex >= this.testPoints.length) {
      this.finalize();
      return false;
    }

    this.onPointChange?.(
      this.testPoints[this.currentPointIndex],
      this.currentPointIndex,
      this.testPoints.length
    );
    return true;
  }

  /** Benchmark'ı tamamla ve sonuçları hesapla */
  private finalize(): void {
    this.isRunning = false;

    const errors = this.pointResults.map((r) => r.errorPx);
    const sortedErrors = [...errors].sort((a, b) => a - b);

    const diagonal = Math.sqrt(this.screenWidth ** 2 + this.screenHeight ** 2);
    const meanError = errors.length > 0 ? errors.reduce((s, e) => s + e, 0) / errors.length : 0;
    const medianError = sortedErrors.length > 0
      ? sortedErrors[Math.floor(sortedErrors.length / 2)]
      : 0;
    const maxError = sortedErrors.length > 0 ? sortedErrors[sortedErrors.length - 1] : 0;

    const meanAngular = this.pointResults.length > 0
      ? this.pointResults.reduce((s, r) => s + r.errorAngularDeg, 0) / this.pointResults.length
      : 0;

    const meanPrecision = this.pointResults.length > 0
      ? this.pointResults.reduce((s, r) => s + r.precision, 0) / this.pointResults.length
      : 0;

    // Error heatmap: 3x3 grid
    const heatmap = this.computeErrorHeatmap();

    const result: BenchmarkResult = {
      timestamp: Date.now(),
      screenWidth: this.screenWidth,
      screenHeight: this.screenHeight,
      screenDistancePx: this.screenDistancePx,
      pointResults: this.pointResults,
      meanErrorPx: meanError,
      medianErrorPx: medianError,
      maxErrorPx: maxError,
      meanAngularErrorDeg: meanAngular,
      spatialAccuracy: diagonal > 0 ? (meanError / diagonal) * 100 : 0,
      spatialPrecision: diagonal > 0 ? (meanPrecision / diagonal) * 100 : 0,
      errorHeatmap: heatmap,
    };

    this.onComplete?.(result);
  }

  /** Ekranı 3×3 grid'e böl ve her bölgenin ortalama hatasını hesapla */
  private computeErrorHeatmap(): ErrorHeatmapCell[] {
    const gridRows = 3;
    const gridCols = 3;
    const cellW = this.screenWidth / gridCols;
    const cellH = this.screenHeight / gridRows;
    const cells: ErrorHeatmapCell[] = [];

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const cellCenterX = (c + 0.5) * cellW;
        const cellCenterY = (r + 0.5) * cellH;

        // Bu hücredeki test noktalarının hatalarını bul
        const cellErrors: number[] = [];
        for (const pr of this.pointResults) {
          if (
            pr.targetX >= c * cellW &&
            pr.targetX < (c + 1) * cellW &&
            pr.targetY >= r * cellH &&
            pr.targetY < (r + 1) * cellH
          ) {
            cellErrors.push(pr.errorPx);
          }
        }

        cells.push({
          gridRow: r,
          gridCol: c,
          centerX: cellCenterX,
          centerY: cellCenterY,
          errorPx: cellErrors.length > 0
            ? cellErrors.reduce((s, e) => s + e, 0) / cellErrors.length
            : 0,
        });
      }
    }

    return cells;
  }

  /** Sonuçları JSON olarak export et */
  static exportJSON(result: BenchmarkResult): string {
    return JSON.stringify({
      benchmark: {
        timestamp: new Date(result.timestamp).toISOString(),
        screen: {
          width: result.screenWidth,
          height: result.screenHeight,
          distance_px: result.screenDistancePx,
        },
        summary: {
          mean_error_px: Math.round(result.meanErrorPx * 10) / 10,
          median_error_px: Math.round(result.medianErrorPx * 10) / 10,
          max_error_px: Math.round(result.maxErrorPx * 10) / 10,
          mean_angular_error_deg: Math.round(result.meanAngularErrorDeg * 100) / 100,
          spatial_accuracy_pct: Math.round(result.spatialAccuracy * 100) / 100,
          spatial_precision_pct: Math.round(result.spatialPrecision * 100) / 100,
        },
        points: result.pointResults.map((p) => ({
          id: p.pointId,
          target: { x: Math.round(p.targetX), y: Math.round(p.targetY) },
          mean_prediction: { x: Math.round(p.meanPredX), y: Math.round(p.meanPredY) },
          error_px: Math.round(p.errorPx * 10) / 10,
          error_deg: Math.round(p.errorAngularDeg * 100) / 100,
          precision_px: Math.round(p.precision * 10) / 10,
          sample_count: p.sampleCount,
        })),
        error_heatmap: result.errorHeatmap.map((c) => ({
          grid: [c.gridRow, c.gridCol],
          center: { x: Math.round(c.centerX), y: Math.round(c.centerY) },
          error_px: Math.round(c.errorPx * 10) / 10,
        })),
      },
    }, null, 2);
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getCurrentPointIndex(): number {
    return this.currentPointIndex;
  }

  getTotalPoints(): number {
    return this.testPoints.length;
  }

  stop(): void {
    this.isRunning = false;
  }
}
