/**
 * Kalibrasyon Modülü
 *
 * 16 noktalı (4×4) kalibrasyon + birleşik önizleme/doğrulama:
 * - Noktalar TAM EKRAN (viewport) üzerinde yayılır
 * - Stabilite kontrolü (baş hareketi, yüz tespiti, göz durumu)
 * - Doğrulama GazePreview ile birleştirildi (~60s toplam akış)
 *
 * NOT: Model ekran koordinatlarıyla eğitilir.
 * Tracking sırasında tahminler görüntü koordinatlarına dönüştürülür.
 */

import { EyeFeatures, CalibrationSample, GazeModel } from "./gazeModel";
import { logger } from "./logger";
import { isMobileDevice } from "./deviceDetect";
import { CONFIDENCE_MIN_CALIBRATION_SAMPLE } from "@/constants";

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
 * 25 noktalı (5×5) kalibrasyon grid'i — serpantin (yılan) sıralaması.
 * Rastgele sıraya göre göz hareketi çok daha az, kullanıcı deneyimi iyileşir.
 */
export type GridSize = "3x3" | "4x4" | "5x5";

export function generateCalibrationPoints(
  screenWidth: number,
  screenHeight: number,
  padding?: number,
  gridSize?: GridSize
): CalibrationPoint[] {
  const mobile = isMobileDevice();
  const effectivePadding = padding ?? (mobile ? 30 : 50);
  padding = effectivePadding;
  const points: CalibrationPoint[] = [];
  let id = 0;

  // Grid boyutu belirleme: explicit parametre > cihaz default
  let cols: number;
  let rows: number;
  if (gridSize) {
    const [r, c] = gridSize.split("x").map(Number);
    rows = r;
    cols = c;
  } else {
    // Masaustunde 4x4 varsayilan daha iyi dogruluk verir,
    // mobilde 4x3 (12 nokta) — 3x3'ten daha iyi kapsama, süre makul.
    cols = mobile ? 4 : 4;
    rows = mobile ? 3 : 4;
  }

  for (let row = 0; row < rows; row++) {
    const isEvenRow = row % 2 === 0;
    for (let ci = 0; ci < cols; ci++) {
      const col = isEvenRow ? ci : cols - 1 - ci;
      const relX = cols > 1 ? col / (cols - 1) : 0.5;
      const relY = rows > 1 ? row / (rows - 1) : 0.5;
      const x = padding + relX * (screenWidth - 2 * padding);
      const y = padding + relY * (screenHeight - 2 * padding);
      points.push({ id: id++, x, y, relX, relY });
    }
  }
  return points;
}

/** Grid boyutuna göre adaptif minimum örnek sayısı */
export function getMinSamplesPerPoint(gridSize: GridSize): number {
  switch (gridSize) {
    case "5x5": return 30;
    case "4x4": return 35;  // ~1.1s, iris stabilize olması için yeterli süre
    case "3x3": return 40;  // Az nokta → her noktada daha çok örnek gerekli
    default: return 25;
  }
}

/**
 * 9 noktalı doğrulama (merkez + 4 köşe + 4 kenar ortası).
 * 9 nokta afin düzeltme için yeterli veri sağlar ve bölgesel hata tespiti yapar.
 */
export function generateValidationPoints(
  screenWidth: number,
  screenHeight: number,
  padding: number = 100
): CalibrationPoint[] {
  const positions = [
    { relX: 0.5, relY: 0.5 },   // merkez
    { relX: 0.15, relY: 0.15 }, // sol üst köşe
    { relX: 0.85, relY: 0.15 }, // sağ üst köşe
    { relX: 0.15, relY: 0.85 }, // sol alt köşe
    { relX: 0.85, relY: 0.85 }, // sağ alt köşe
    { relX: 0.5, relY: 0.15 },  // üst orta
    { relX: 0.5, relY: 0.85 },  // alt orta
    { relX: 0.15, relY: 0.5 },  // sol orta
    { relX: 0.85, relY: 0.5 },  // sağ orta
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
    headMovement: isMobileDevice() ? 0.09 : 0.07,    // Sıkılaştırıldı: stabil baş gerekli
    minConfidence: isMobileDevice() ? 0.20 : 0.25,   // Artırıldı: düşük kalite veri reddi
    minEyeOpenness: isMobileDevice() ? 0.07 : 0.12,  // Artırıldı: güvenilir göz algılama
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

  const prevConfThreshold = isMobileDevice() ? 0.15 : 0.3;
  if (prevFeatures && prevFeatures.confidence > prevConfThreshold) {
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
  private readonly IRIS_BUFFER_SIZE = 10; // 5→10: daha uzun pencere, medium-term drift yakalama
  private readonly IRIS_STD_MAX = isMobileDevice() ? 0.045 : 0.035;  // Sıkılaştırıldı
  private prevPoseForCalib: { yaw: number; pitch: number } | null = null;
  private MIN_SAMPLES_PER_POINT = isMobileDevice() ? 28 : 30;        // Artırıldı: daha güvenilir ortalama
  private gridSize: GridSize | undefined = undefined;
  private readonly MIN_CONFIDENCE_CALIBRATION = isMobileDevice() ? 0.15 : 0.35; // Sıkılaştırıldı: düşük kalite veri reddedilir
  private readonly RETRY_QUALITY_THRESHOLD = 3; // Kalite < 3 ise retry
  private pointQuality: Map<number, number> = new Map();
  private retryQueue: number[] = [];
  private retryAttempts: Map<number, number> = new Map();
  private readonly MAX_RETRIES_PER_POINT = 1;
  // Düşük kaliteli noktalar için retry aktif
  private totalRetryCount: number = 0;
  private readonly MAX_TOTAL_RETRIES = 3;

  // Bölgesel kalite haritası (ekranın hangi bölgelerinde hata yüksek)
  private regionErrors: Map<string, number[]> = new Map();

  constructor(model: GazeModel) {
    this.model = model;
    this.state = this.createInitialState();
  }

  private createInitialState(): CalibrationState {
    return {
      phase: "idle",
      currentPointIndex: 0,
      totalPoints: this.gridSize ? parseInt(this.gridSize.split("x")[0]) ** 2 : (isMobileDevice() ? 9 : 16),
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

  /** Grid boyutunu ayarla (kalibrasyon başlatılmadan önce) (Sorun #12: durum kontrolü) */
  setGridSize(size: GridSize): void {
    if (this.state.phase !== "idle" && this.state.phase !== "instructions") {
      logger.warn("[Calibration] Grid boyutu kalibrasyon başladıktan sonra değiştirilemez!");
      return;
    }
    this.gridSize = size;
    this.MIN_SAMPLES_PER_POINT = getMinSamplesPerPoint(size);
  }

  // Kalibrasyonu başlat - TAM EKRAN boyutları kullanılır
  startCalibration(screenWidth: number, screenHeight: number): void {
    this.calibrationPoints = generateCalibrationPoints(screenWidth, screenHeight, undefined, this.gridSize);
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
    this.settleFrames = Math.round(this.detectedFPS * 0.3); // Hızlı geçiş
    logger.log("[Calibration] FPS:", this.detectedFPS, "| Settle frames:", this.settleFrames);
  }

  beginCalibrationPhase(): void {
    this.currentPointFrameCount = 0;
    this.recentIrisBuffer = [];
    this.retryQueue = [];
    this.retryAttempts.clear();
    if (this.settleFrames === 0) {
      this.settleFrames = Math.round(this.detectedFPS * 0.5);
    }
    this.updateState({
      phase: "calibrating",
      countdown: 1,
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

    // Settle: noktaya geçişten sonra göz stabilize olana kadar bekle
    this.currentPointFrameCount++;
    if (this.currentPointFrameCount <= this.settleFrames) {
      return false;
    }

    // Minimum güven kontrolü — yapılandırılabilir eşik (düşük kalite veri reddedilir)
    if (features.confidence < this.MIN_CONFIDENCE_CALIBRATION) return false;

    // Baş poz korelasyonu: frame-to-frame baş hareketi büyükse iris STD eşiğini düşür
    const poseMovement = this.prevPoseForCalib
      ? Math.abs(features.yaw - this.prevPoseForCalib.yaw) + Math.abs(features.pitch - this.prevPoseForCalib.pitch)
      : 0;
    this.prevPoseForCalib = { yaw: features.yaw, pitch: features.pitch };
    // Baş hareket ederken iris eşiğini %40 düşür (hareket sırasında alınan veri güvenilmez)
    const effectiveIrisStdMax = poseMovement > 0.02 ? this.IRIS_STD_MAX * 0.6 : this.IRIS_STD_MAX;

    // Multi-scale iris stabilite kontrolü
    const irisAvg = (features.leftIrisRelX + features.rightIrisRelX) / 2;
    this.recentIrisBuffer.push({ x: irisAvg, y: (features.leftIrisRelY + features.rightIrisRelY) / 2 });
    if (this.recentIrisBuffer.length > this.IRIS_BUFFER_SIZE) this.recentIrisBuffer.shift();

    if (this.recentIrisBuffer.length >= 4) {
      // Global pencere STD kontrolü (tüm buffer)
      const meanX = this.recentIrisBuffer.reduce((s, p) => s + p.x, 0) / this.recentIrisBuffer.length;
      const meanY = this.recentIrisBuffer.reduce((s, p) => s + p.y, 0) / this.recentIrisBuffer.length;
      const stdX = Math.sqrt(this.recentIrisBuffer.reduce((s, p) => s + (p.x - meanX) ** 2, 0) / this.recentIrisBuffer.length);
      const stdY = Math.sqrt(this.recentIrisBuffer.reduce((s, p) => s + (p.y - meanY) ** 2, 0) / this.recentIrisBuffer.length);
      if (stdX > effectiveIrisStdMax || stdY > effectiveIrisStdMax) return false;

      // Kısa pencere kontrolü (son 4 frame) — ani jitter yakalama
      const recent4 = this.recentIrisBuffer.slice(-4);
      const r4meanX = recent4.reduce((s, p) => s + p.x, 0) / 4;
      const r4meanY = recent4.reduce((s, p) => s + p.y, 0) / 4;
      const r4stdX = Math.sqrt(recent4.reduce((s, p) => s + (p.x - r4meanX) ** 2, 0) / 4);
      const r4stdY = Math.sqrt(recent4.reduce((s, p) => s + (p.y - r4meanY) ** 2, 0) / 4);
      // Kısa pencere eşiği biraz daha toleranslı (henüz stabilize olmayabilir)
      if (r4stdX > effectiveIrisStdMax * 1.2 || r4stdY > effectiveIrisStdMax * 1.2) return false;
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

  async nextPoint(): Promise<boolean> {
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
      // Sorun #27: Global retry limiti kontrolü
      if (this.retryQueue.length > 0 && this.totalRetryCount < this.MAX_TOTAL_RETRIES) {
        this.totalRetryCount++;
        const retryIdx = this.retryQueue.shift()!;
        const retryPoint = this.calibrationPoints[retryIdx];
        logger.log("[Calibration] Retry: nokta", retryPoint.id, "(kalan retry:", this.retryQueue.length, ")");
        this.updateState({
          currentPointIndex: retryIdx,
          progress: 0,
          countdown: 1,
          message: "Tekrar: bu noktaya bak 👁️",
          subMessage: "Bu nokta için daha fazla veri gerekli. Lütfen odaklan.",
          warning: null,
        });
        return true;
      }
      await this.trainModel();
      return false;
    }

    this.updateState({
      currentPointIndex: nextIndex,
      progress: 0,
      countdown: 1,
      message: "Şimdi bu noktaya bak 👁️",
      subMessage: "Başını sabit tut. Noktaya baktığında gözünü de sabit tut.",
      warning: null,
    });

    return true;
  }

  private async trainModel(): Promise<void> {
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

      // Web Worker ile async training (UI donmasını önler)
      let result: { meanError: number; maxError: number };
      try {
        result = await this.model.trainAsync(this.state.samples);
      } catch {
        // Async başarısız olursa sync fallback
        result = this.model.train(this.state.samples);
      }

      logger.log("[Calibration] Eğitim tamamlandı. MeanError:", Math.round(result.meanError), "px, MaxError:", Math.round(result.maxError), "px");
      logger.log("[Calibration] Model trained:", this.model.isTrained());

      this.updateState({
        phase: "complete",
        currentPointIndex: 0,
        progress: 100,
        message: "Kalibrasyon tamamlandı.",
        subMessage: `Ortalama hata: ${Math.round(result.meanError)} px`,
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

  completeValidation(
    meanError: number,
    _meanBiasX?: number,
    _meanBiasY?: number,
    affinePoints?: { predX: number; predY: number; trueX: number; trueY: number }[]
  ): void {
    const passed = meanError <= this.errorThreshold;
    this.updateState({
      phase: "complete",
      meanError,
      message: "Kalibrasyon tamamlandı.",
      subMessage: passed
        ? `Ortalama hata: ${Math.round(meanError)} px - Başarılı!`
        : `Ortalama hata: ${Math.round(meanError)} px - Doğruluk düşük. Tekrar önerilir.`,
    });

    // Afin düzeltme: 3+ doğrulama noktası varsa afin, yoksa basit öteleme
    if (affinePoints && affinePoints.length >= 3) {
      this.model.setAffineCorrection(affinePoints);
    } else if (typeof _meanBiasX === "number" && typeof _meanBiasY === "number") {
      this.model.setInitialDriftOffset(_meanBiasX, _meanBiasY);
    }
  }

  reset(): void {
    this.state = this.createInitialState();
    this.retryQueue = [];
    this.retryAttempts.clear();
    this.pointQuality.clear();
    this.totalRetryCount = 0;
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
