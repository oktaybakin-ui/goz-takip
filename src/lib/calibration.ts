/**
 * Kalibrasyon Modülü
 *
 * 9 noktalı kalibrasyon sistemi:
 * - Noktalar TAM EKRAN (viewport) üzerinde yayılır
 * - Stabilite kontrolü (baş hareketi, yüz tespiti, göz durumu)
 * - Doğrulama testi
 * - Hata hesaplama
 *
 * NOT: Model ekran koordinatlarıyla eğitilir.
 * Tracking sırasında tahminler görüntü koordinatlarına dönüştürülür.
 */

import { EyeFeatures, CalibrationSample, GazeModel } from "./gazeModel";
import { logger } from "./logger";

export interface CalibrationPoint {
  id: number;
  x: number; // Ekrandaki x (piksel - viewport)
  y: number; // Ekrandaki y (piksel - viewport)
  relX: number; // Oransal x (0-1)
  relY: number; // Oransal y (0-1)
}

export interface CalibrationState {
  phase: "idle" | "instructions" | "calibrating" | "validating" | "complete" | "failed";
  currentPointIndex: number;
  totalPoints: number;
  samples: CalibrationSample[];
  samplesPerPoint: Map<number, CalibrationSample[]>;
  progress: number; // 0-100
  countdown: number; // saniye
  message: string;
  subMessage: string;
  warning: string | null;
  meanError: number | null;
  maxError: number | null;
  isStable: boolean;
}

export interface StabilityCheck {
  headStable: boolean;
  faceVisible: boolean;
  eyesOpen: boolean;
  gazeOnTarget: boolean;
  message: string | null;
}

/**
 * 25 noktalı (5×5) kalibrasyon grid'i – daha iyi ekran kapsamı, daha düşük hata.
 */
export function generateCalibrationPoints(
  screenWidth: number,
  screenHeight: number,
  padding: number = 50
): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  let id = 0;
  const cols = 5;
  const rows = 5;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const relX = cols > 1 ? col / (cols - 1) : 0.5;
      const relY = rows > 1 ? row / (rows - 1) : 0.5;
      const x = padding + relX * (screenWidth - 2 * padding);
      const y = padding + relY * (screenHeight - 2 * padding);
      points.push({ id: id++, x, y, relX, relY });
    }
  }
  return shuffleArray(points);
}

/**
 * 5 noktalı doğrulama noktaları (merkez + 4 köşe). Kalibrasyon sonrası hata ölçümü için kullanılır.
 * @param screenWidth - Viewport genişliği (px)
 * @param screenHeight - Viewport yüksekliği (px)
 * @param padding - Kenar boşluğu (px)
 * @returns Doğrulama noktaları
 */
export function generateValidationPoints(
  screenWidth: number,
  screenHeight: number,
  padding: number = 100
): CalibrationPoint[] {
  const positions = [
    { relX: 0.5, relY: 0.5 },   // merkez
    { relX: 0.2, relY: 0.2 },   // sol üst
    { relX: 0.8, relY: 0.2 },   // sağ üst
    { relX: 0.2, relY: 0.8 },   // sol alt
    { relX: 0.8, relY: 0.8 },   // sağ alt
  ];

  return positions.map((pos, i) => ({
    id: i,
    x: padding + pos.relX * (screenWidth - 2 * padding),
    y: padding + pos.relY * (screenHeight - 2 * padding),
    relX: pos.relX,
    relY: pos.relY,
  }));
}

/**
 * Yüz/göz stabilitesi kontrolü. Kalibrasyon sırasında örnek alınmadan önce çağrılır.
 * @param features - Güncel göz özellikleri
 * @param prevFeatures - Önceki frame özellikleri (baş hareketi için)
 * @param thresholds - Eşik değerleri (headMovement, minConfidence, minEyeOpenness)
 * @returns Stabilite sonucu (headStable, faceVisible, eyesOpen, gazeOnTarget, message)
 */
export function checkStability(
  features: EyeFeatures,
  prevFeatures: EyeFeatures | null,
  thresholds = {
    headMovement: 0.072,
    minConfidence: 0.45,
    minEyeOpenness: 0.08,
  }
): StabilityCheck {
  if (features.confidence < thresholds.minConfidence) {
    return {
      headStable: false,
      faceVisible: false,
      eyesOpen: true,
      gazeOnTarget: false,
      message: "Yüzün kamerada tam görünmüyor. Lütfen ortala.",
    };
  }

  // Göz açıklığı
  if (features.eyeOpenness < thresholds.minEyeOpenness) {
    return {
      headStable: true,
      faceVisible: true,
      eyesOpen: false,
      gazeOnTarget: false,
      message: "Gözlerin kapalı algılandı. Lütfen gözlerini aç.",
    };
  }

  if (prevFeatures && prevFeatures.confidence > 0.3) {
    const yawDiff = Math.abs(features.yaw - prevFeatures.yaw);
    const pitchDiff = Math.abs(features.pitch - prevFeatures.pitch);
    const rollDiff = Math.abs(features.roll - prevFeatures.roll);
    const totalMovement = yawDiff + pitchDiff + rollDiff;
    if (totalMovement > thresholds.headMovement) {
      return {
        headStable: false,
        faceVisible: true,
        eyesOpen: true,
        gazeOnTarget: false,
        message: "Başın çok hareket ediyor. Lütfen sabit tut.",
      };
    }
  }

  return {
    headStable: true,
    faceVisible: true,
    eyesOpen: true,
    gazeOnTarget: true,
    message: null,
  };
}

/**
 * Kalibrasyon akışını yönetir: nokta üretimi, örnek toplama, doğrulama, hata hesaplama.
 * State değişimleri onStateChange callback ile dışarı bildirilir.
 */
export class CalibrationManager {
  private model: GazeModel;
  private state: CalibrationState;
  private calibrationPoints: CalibrationPoint[] = [];
  private validationPoints: CalibrationPoint[] = [];
  private onStateChange: ((state: CalibrationState) => void) | null = null;
  private errorThreshold: number = 85;
  private settleFrames: number = 0;
  private currentPointFrameCount: number = 0;
  private detectedFPS: number = 30;
  private recentIrisBuffer: { x: number; y: number }[] = [];
  private readonly IRIS_BUFFER_SIZE = 20;
  private readonly IRIS_STD_MAX = 0.018;
  private readonly MIN_SAMPLES_PER_POINT = 30;
  private readonly MIN_CONFIDENCE_CALIBRATION = 0.5;
  private readonly RETRY_QUALITY_THRESHOLD = 15;
  private pointQuality: Map<number, number> = new Map();
  private retryQueue: number[] = [];
  private retryAttempts: Map<number, number> = new Map();
  private readonly MAX_RETRIES_PER_POINT = 2;

  constructor(model: GazeModel) {
    this.model = model;
    this.state = this.createInitialState();
  }

  private createInitialState(): CalibrationState {
    return {
      phase: "idle",
      currentPointIndex: 0,
      totalPoints: 25,
      samples: [],
      samplesPerPoint: new Map(),
      progress: 0,
      countdown: 3,
      message: "",
      subMessage: "",
      warning: null,
      meanError: null,
      maxError: null,
      isStable: false,
    };
  }

  setStateChangeCallback(callback: (state: CalibrationState) => void): void {
    this.onStateChange = callback;
  }

  private updateState(partial: Partial<CalibrationState>): void {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }

  getState(): CalibrationState {
    return this.state;
  }

  // Kalibrasyonu başlat - TAM EKRAN boyutları kullanılır
  startCalibration(screenWidth: number, screenHeight: number): void {
    this.calibrationPoints = generateCalibrationPoints(screenWidth, screenHeight);
    this.validationPoints = generateValidationPoints(screenWidth, screenHeight);

    const diagonal = Math.sqrt(screenWidth ** 2 + screenHeight ** 2);
    this.errorThreshold = Math.round(diagonal * 0.055);

    this.updateState({
      phase: "instructions",
      currentPointIndex: 0,
      totalPoints: this.calibrationPoints.length,
      samples: [],
      samplesPerPoint: new Map(),
      progress: 0,
      message: "Kalibrasyon başlıyor.",
      subMessage: "Başını mümkün olduğunca sabit tut. Ekranda beliren noktaya sadece gözlerinle bak.",
      warning: null,
      meanError: null,
      maxError: null,
    });
  }

  /** FPS bilgisini güncelle (kamera FPS'i) */
  setFPS(fps: number): void {
    this.detectedFPS = Math.max(15, Math.min(120, fps));
    this.settleFrames = Math.round(this.detectedFPS * 1.5);
    logger.log("[Calibration] FPS:", this.detectedFPS, "| Settle frames:", this.settleFrames);
  }

  beginCalibrationPhase(): void {
    this.currentPointFrameCount = 0;
    this.recentIrisBuffer = [];
    this.retryQueue = [];
    this.retryAttempts.clear();
    if (this.settleFrames === 0) {
      this.settleFrames = Math.round(this.detectedFPS * 1.5);
    }
    this.updateState({
      phase: "calibrating",
      countdown: 3,
      message: "Şimdi bu noktaya bak 👁️",
      subMessage: "Başını sabit tut. Noktaya baktığında gözünü de sabit tut.",
    });
  }

  getCurrentPoint(): CalibrationPoint | null {
    if (this.state.currentPointIndex >= this.calibrationPoints.length) return null;
    return this.calibrationPoints[this.state.currentPointIndex];
  }

  getCurrentValidationPoint(): CalibrationPoint | null {
    if (this.state.phase !== "validating") return null;
    if (this.state.currentPointIndex >= this.validationPoints.length) return null;
    return this.validationPoints[this.state.currentPointIndex];
  }

  updateCountdown(value: number): void {
    this.updateState({ countdown: value });
  }

  addSample(features: EyeFeatures): boolean {
    const point = this.getCurrentPoint();
    if (!point || this.state.phase !== "calibrating") return false;

    this.currentPointFrameCount++;
    if (this.currentPointFrameCount <= this.settleFrames) {
      const settleProgress = (this.currentPointFrameCount / this.settleFrames) * 10;
      this.updateState({ progress: settleProgress });
      return false;
    }

    if (features.confidence < this.MIN_CONFIDENCE_CALIBRATION) return false;

    const avgRelX = (features.leftIrisRelX + features.rightIrisRelX) / 2;
    const avgRelY = (features.leftIrisRelY + features.rightIrisRelY) / 2;
    this.recentIrisBuffer.push({ x: avgRelX, y: avgRelY });
    if (this.recentIrisBuffer.length > this.IRIS_BUFFER_SIZE) this.recentIrisBuffer.shift();
    if (this.recentIrisBuffer.length >= this.IRIS_BUFFER_SIZE) {
      const meanX = this.recentIrisBuffer.reduce((s, p) => s + p.x, 0) / this.recentIrisBuffer.length;
      const meanY = this.recentIrisBuffer.reduce((s, p) => s + p.y, 0) / this.recentIrisBuffer.length;
      const varX = this.recentIrisBuffer.reduce((s, p) => s + (p.x - meanX) ** 2, 0) / this.recentIrisBuffer.length;
      const varY = this.recentIrisBuffer.reduce((s, p) => s + (p.y - meanY) ** 2, 0) / this.recentIrisBuffer.length;
      const stdX = Math.sqrt(varX);
      const stdY = Math.sqrt(varY);
      if (stdX > this.IRIS_STD_MAX || stdY > this.IRIS_STD_MAX) return false;
    }

    const sample: CalibrationSample = {
      features,
      targetX: point.x,
      targetY: point.y,
    };

    const pointSamples = this.state.samplesPerPoint.get(point.id) || [];
    pointSamples.push(sample);
    this.state.samplesPerPoint.set(point.id, pointSamples);
    this.state.samples.push(sample);

    const progress = 10 + (pointSamples.length / this.MIN_SAMPLES_PER_POINT) * 90;
    this.updateState({ progress: Math.min(100, progress) });
    this.pointQuality.set(point.id, pointSamples.length);

    return pointSamples.length >= this.MIN_SAMPLES_PER_POINT;
  }

  nextPoint(): boolean {
    const currentPoint = this.getCurrentPoint();
    if (currentPoint) {
      const quality = this.pointQuality.get(currentPoint.id) ?? 0;
      const retries = this.retryAttempts.get(currentPoint.id) ?? 0;
      if (quality < this.RETRY_QUALITY_THRESHOLD && retries < this.MAX_RETRIES_PER_POINT) {
        logger.warn("[Calibration] Nokta", currentPoint.id, "düşük kalite:", quality, "sample → retry kuyruğuna eklendi");
        this.retryQueue.push(this.state.currentPointIndex);
        this.retryAttempts.set(currentPoint.id, retries + 1);
      }
    }

    const nextIndex = this.state.currentPointIndex + 1;
    this.currentPointFrameCount = 0;
    this.recentIrisBuffer = [];

    if (nextIndex >= this.calibrationPoints.length) {
      if (this.retryQueue.length > 0) {
        const retryIdx = this.retryQueue.shift()!;
        const retryPoint = this.calibrationPoints[retryIdx];
        logger.log("[Calibration] Retry: nokta", retryPoint.id, "(kalan retry:", this.retryQueue.length, ")");
        this.updateState({
          currentPointIndex: retryIdx,
          progress: 0,
          countdown: 3,
          message: "Tekrar: bu noktaya bak 👁️",
          subMessage: "Bu nokta için daha fazla veri gerekli. Lütfen odaklan.",
          warning: null,
        });
        return true;
      }
      this.trainModel();
      return false;
    }

    this.updateState({
      currentPointIndex: nextIndex,
      progress: 0,
      countdown: 3,
      message: "Şimdi bu noktaya bak 👁️",
      subMessage: "Başını sabit tut. Noktaya baktığında gözünü de sabit tut.",
      warning: null,
    });

    return true;
  }

  private trainModel(): void {
    try {
      logger.log("[Calibration] Model eğitimi başlıyor. Toplam örnek:", this.state.samples.length);

      // İlk birkaç örneğin feature'larını logla
      if (this.state.samples.length > 0) {
        const s0 = this.state.samples[0].features;
        logger.log("[Calibration] İlk örnek features:", {
          leftIrisRelX: s0.leftIrisRelX?.toFixed(3),
          leftIrisRelY: s0.leftIrisRelY?.toFixed(3),
          rightIrisRelX: s0.rightIrisRelX?.toFixed(3),
          rightIrisRelY: s0.rightIrisRelY?.toFixed(3),
          confidence: s0.confidence?.toFixed(2),
          yaw: s0.yaw?.toFixed(3),
          pitch: s0.pitch?.toFixed(3),
        });
      }

      const result = this.model.train(this.state.samples);

      logger.log("[Calibration] Eğitim tamamlandı. MeanError:", Math.round(result.meanError), "px, MaxError:", Math.round(result.maxError), "px");
      logger.log("[Calibration] Model trained:", this.model.isTrained());

      this.updateState({
        phase: "validating",
        currentPointIndex: 0,
        progress: 0,
        countdown: 3,
        message: "Kalibrasyon tamamlandı. Şimdi doğrulama yapıyoruz.",
        subMessage: "Doğrulama noktalarına bakın.",
        meanError: result.meanError,
        maxError: result.maxError,
      });
    } catch (error) {
      logger.error("[Calibration] Eğitim HATASI:", error);
      this.updateState({
        phase: "failed",
        message: "Kalibrasyon başarısız oldu.",
        subMessage: (error as Error).message,
      });
    }
  }

  addValidationSample(features: EyeFeatures): { error: number; biasX: number; biasY: number } | null {
    const point = this.getCurrentValidationPoint();
    if (!point) return null;

    const prediction = this.model.predict(features);
    if (!prediction) return null;

    const dx = prediction.x - point.x;
    const dy = prediction.y - point.y;
    const error = Math.sqrt(dx * dx + dy * dy);
    // Sapma: hedef - tahmin (takip sırasında bu offset uygulanacak)
    const biasX = point.x - prediction.x;
    const biasY = point.y - prediction.y;

    return { error, biasX, biasY };
  }

  nextValidationPoint(): boolean {
    const nextIndex = this.state.currentPointIndex + 1;

    if (nextIndex >= this.validationPoints.length) {
      return false;
    }

    this.updateState({
      currentPointIndex: nextIndex,
      progress: 0,
      countdown: 3,
    });

    return true;
  }

  completeValidation(meanError: number, meanBiasX?: number, meanBiasY?: number): void {
    const passed = meanError <= this.errorThreshold;
    this.updateState({
      phase: "complete",
      meanError,
      message: "Kalibrasyon tamamlandı.",
      subMessage: passed
        ? `Ortalama hata: ${Math.round(meanError)} px - Başarılı!`
        : `Ortalama hata: ${Math.round(meanError)} px - Doğruluk düşük. Tekrar önerilir.`,
    });
    if (typeof meanBiasX === "number" && typeof meanBiasY === "number") {
      this.model.setInitialDriftOffset(meanBiasX, meanBiasY);
    }
  }

  reset(): void {
    this.state = this.createInitialState();
    this.retryQueue = [];
    this.retryAttempts.clear();
    this.pointQuality.clear();
    this.onStateChange?.(this.state);
  }

  setWarning(message: string | null): void {
    this.updateState({ warning: message });
  }

  setStability(stable: boolean): void {
    this.updateState({ isStable: stable });
  }

  getModel(): GazeModel {
    return this.model;
  }

  getErrorThreshold(): number {
    return this.errorThreshold;
  }
}

// Fisher-Yates karıştırma
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
