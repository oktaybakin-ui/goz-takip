/**
 * Kalibrasyon Modülü
 *
 * 9 noktalı kalibrasyon sistemi:
 * - Nokta pozisyonları hesaplama
 * - Stabilite kontrolü (baş hareketi, yüz tespiti, göz durumu)
 * - Doğrulama testi
 * - Hata hesaplama
 */

import { EyeFeatures, CalibrationSample, GazeModel } from "./gazeModel";

export interface CalibrationPoint {
  id: number;
  x: number; // Ekrandaki x (piksel)
  y: number; // Ekrandaki y (piksel)
  relX: number; // Görüntü üzerindeki oransal x (0-1)
  relY: number; // Görüntü üzerindeki oransal y (0-1)
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

// 9 noktalı kalibrasyon grid'i oluştur
export function generateCalibrationPoints(
  containerWidth: number,
  containerHeight: number,
  padding: number = 60
): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  const cols = 3;
  const rows = 3;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const relX = col / (cols - 1);
      const relY = row / (rows - 1);
      const x = padding + relX * (containerWidth - 2 * padding);
      const y = padding + relY * (containerHeight - 2 * padding);

      points.push({
        id: row * cols + col,
        x,
        y,
        relX,
        relY,
      });
    }
  }

  // Sırayı karıştır (daha iyi kalibrasyon için)
  return shuffleArray(points);
}

// 5 noktalı doğrulama grid'i oluştur (köşeler + merkez)
export function generateValidationPoints(
  containerWidth: number,
  containerHeight: number,
  padding: number = 80
): CalibrationPoint[] {
  const positions = [
    { relX: 0.5, relY: 0.5 },   // merkez
    { relX: 0.25, relY: 0.25 },  // sol üst
    { relX: 0.75, relY: 0.25 },  // sağ üst
    { relX: 0.25, relY: 0.75 },  // sol alt
    { relX: 0.75, relY: 0.75 },  // sağ alt
  ];

  return positions.map((pos, i) => ({
    id: i,
    x: padding + pos.relX * (containerWidth - 2 * padding),
    y: padding + pos.relY * (containerHeight - 2 * padding),
    relX: pos.relX,
    relY: pos.relY,
  }));
}

// Stabilite kontrolü
export function checkStability(
  features: EyeFeatures,
  prevFeatures: EyeFeatures | null,
  thresholds = {
    headMovement: 0.05,     // yaw/pitch/roll değişim eşiği
    minConfidence: 0.5,     // minimum yüz tespiti güveni
    minEyeOpenness: 0.15,   // minimum göz açıklığı
  }
): StabilityCheck {
  // Yüz görünürlüğü
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

  // Baş hareketi kontrolü
  if (prevFeatures) {
    const yawDiff = Math.abs(features.yaw - prevFeatures.yaw);
    const pitchDiff = Math.abs(features.pitch - prevFeatures.pitch);
    const rollDiff = Math.abs(features.roll - prevFeatures.roll);

    if (yawDiff > thresholds.headMovement ||
        pitchDiff > thresholds.headMovement ||
        rollDiff > thresholds.headMovement) {
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

// Kalibrasyon yöneticisi
export class CalibrationManager {
  private model: GazeModel;
  private state: CalibrationState;
  private calibrationPoints: CalibrationPoint[] = [];
  private validationPoints: CalibrationPoint[] = [];
  private samplesPerPointTarget: number = 45;
  private onStateChange: ((state: CalibrationState) => void) | null = null;
  private errorThreshold: number = 80; // piksel

  constructor(model: GazeModel) {
    this.model = model;
    this.state = this.createInitialState();
  }

  private createInitialState(): CalibrationState {
    return {
      phase: "idle",
      currentPointIndex: 0,
      totalPoints: 9,
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

  // Kalibrasyonu başlat
  startCalibration(containerWidth: number, containerHeight: number): void {
    this.calibrationPoints = generateCalibrationPoints(containerWidth, containerHeight);
    this.validationPoints = generateValidationPoints(containerWidth, containerHeight);

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

  // Talimat ekranından kalibrasyon başlat
  beginCalibrationPhase(): void {
    this.updateState({
      phase: "calibrating",
      countdown: 3,
      message: "Şimdi bu noktaya bak 👁️",
      subMessage: "Başını sabit tut. Sadece gözlerin hareket etsin.",
    });
  }

  // Mevcut kalibrasyon noktasını al
  getCurrentPoint(): CalibrationPoint | null {
    if (this.state.currentPointIndex >= this.calibrationPoints.length) return null;
    return this.calibrationPoints[this.state.currentPointIndex];
  }

  // Mevcut doğrulama noktasını al
  getCurrentValidationPoint(): CalibrationPoint | null {
    if (this.state.phase !== "validating") return null;
    if (this.state.currentPointIndex >= this.validationPoints.length) return null;
    return this.validationPoints[this.state.currentPointIndex];
  }

  // Countdown güncelle
  updateCountdown(value: number): void {
    this.updateState({ countdown: value });
  }

  // Kalibrasyon örneği ekle
  addSample(features: EyeFeatures): boolean {
    const point = this.getCurrentPoint();
    if (!point || this.state.phase !== "calibrating") return false;

    const sample: CalibrationSample = {
      features,
      targetX: point.x,
      targetY: point.y,
    };

    const pointSamples = this.state.samplesPerPoint.get(point.id) || [];
    pointSamples.push(sample);
    this.state.samplesPerPoint.set(point.id, pointSamples);
    this.state.samples.push(sample);

    // Nokta için yeterli örnek toplandı mı?
    const progress = (pointSamples.length / this.samplesPerPointTarget) * 100;
    this.updateState({
      progress,
    });

    return pointSamples.length >= this.samplesPerPointTarget;
  }

  // Sonraki noktaya geç
  nextPoint(): boolean {
    const nextIndex = this.state.currentPointIndex + 1;

    if (nextIndex >= this.calibrationPoints.length) {
      // Kalibrasyon bitti, modeli eğit
      this.trainModel();
      return false;
    }

    this.updateState({
      currentPointIndex: nextIndex,
      progress: 0,
      countdown: 3,
      message: "Şimdi bu noktaya bak 👁️",
      subMessage: "Başını sabit tut. Sadece gözlerin hareket etsin.",
      warning: null,
    });

    return true;
  }

  // Modeli eğit
  private trainModel(): void {
    try {
      const result = this.model.train(this.state.samples);

      // Doğrulama aşamasına geç
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
      this.updateState({
        phase: "failed",
        message: "Kalibrasyon başarısız oldu.",
        subMessage: (error as Error).message,
      });
    }
  }

  // Doğrulama örneği ekle ve hata hesapla
  addValidationSample(features: EyeFeatures): { error: number } | null {
    const point = this.getCurrentValidationPoint();
    if (!point) return null;

    const prediction = this.model.predict(features);
    if (!prediction) return null;

    const dx = prediction.x - point.x;
    const dy = prediction.y - point.y;
    const error = Math.sqrt(dx * dx + dy * dy);

    return { error };
  }

  // Doğrulama sonraki nokta
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

  // Doğrulamayı tamamla
  completeValidation(meanError: number): void {
    const passed = meanError <= this.errorThreshold;

    this.updateState({
      phase: "complete",
      meanError,
      message: "Kalibrasyon tamamlandı.",
      subMessage: passed
        ? `Ortalama hata: ${Math.round(meanError)} px - Başarılı!`
        : `Ortalama hata: ${Math.round(meanError)} px - Doğruluk düşük. Tekrar önerilir.`,
    });
  }

  // Kalibrasyonu sıfırla
  reset(): void {
    this.state = this.createInitialState();
    this.onStateChange?.(this.state);
  }

  // Uyarı göster
  setWarning(message: string | null): void {
    this.updateState({ warning: message });
  }

  // Stabilite durumunu güncelle
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
