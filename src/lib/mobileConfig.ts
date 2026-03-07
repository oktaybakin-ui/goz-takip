/**
 * Merkezi Mobil/Masaüstü Konfigürasyon (Sorun #20)
 *
 * Tüm modüllerde dağınık olan mobil eşik değerlerini tek yerde toplar.
 * Her modül bu dosyadan import ederek tutarlılık sağlanır.
 */

import { isMobileDevice } from "./deviceDetect";

export interface DeviceConfig {
  // Confidence eşikleri
  minCalibrationConfidence: number;
  minPredictionConfidence: number;
  minValidationConfidence: number;

  // EAR (göz açıklığı) eşikleri
  eyeOpennessThreshold: number;
  blinkEARThreshold: number;

  // Yüz ölçeği
  minFaceScale: number;

  // İris asimetri toleransı
  irisAsymmetryBase: number;

  // Kalibrasyon
  headMovementThreshold: number;
  minEyeOpenness: number;
  irisStdMax: number;
  minSamplesPerPoint: number;

  // Fixation
  velocityThresholdFactor: number; // screenDiag ile çarpılır

  // Genel
  isMobile: boolean;
}

const MOBILE_CONFIG: DeviceConfig = {
  minCalibrationConfidence: 0.08,
  minPredictionConfidence: 0.05,
  minValidationConfidence: 0.08,
  eyeOpennessThreshold: 0.10,
  blinkEARThreshold: 0.12,
  minFaceScale: 0.06,
  irisAsymmetryBase: 0.38,
  headMovementThreshold: 0.25,
  minEyeOpenness: 0.06,
  irisStdMax: 0.055,
  minSamplesPerPoint: 40,
  velocityThresholdFactor: 0.035,
  isMobile: true,
};

const DESKTOP_CONFIG: DeviceConfig = {
  minCalibrationConfidence: 0.45,
  minPredictionConfidence: 0.15,
  minValidationConfidence: 0.35,
  eyeOpennessThreshold: 0.15,
  blinkEARThreshold: 0.18,
  minFaceScale: 0.08,
  irisAsymmetryBase: 0.30,
  headMovementThreshold: 0.10,
  minEyeOpenness: 0.12,
  irisStdMax: 0.025,
  minSamplesPerPoint: 75,
  velocityThresholdFactor: 0.03,
  isMobile: false,
};

let _cachedConfig: DeviceConfig | null = null;

/** Cihaz tipine göre konfigürasyon döner. Sonuç cache'lenir. */
export function getDeviceConfig(): DeviceConfig {
  if (_cachedConfig) return _cachedConfig;
  _cachedConfig = isMobileDevice() ? { ...MOBILE_CONFIG } : { ...DESKTOP_CONFIG };
  return _cachedConfig;
}

/** Cache'i temizle (test veya cihaz değişikliği için) */
export function resetDeviceConfigCache(): void {
  _cachedConfig = null;
}
