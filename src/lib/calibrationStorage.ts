/**
 * Kalibrasyon modelini localStorage'da saklama / yükleme
 */

export const CALIBRATION_STORAGE_KEY = "eye-tracking-calibration-v2";

export interface StoredCalibration {
  modelJson: string;
  meanErrorPx: number;
  savedAt: number;
}

export function saveCalibration(modelJson: string, meanErrorPx: number): void {
  try {
    const data: StoredCalibration = {
      modelJson,
      meanErrorPx,
      savedAt: Date.now(),
    };
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
    return;
  } catch {
    // localStorage full veya private mode
  }
}

export function loadCalibration(): StoredCalibration | null {
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredCalibration;
    if (!data.modelJson || typeof data.meanErrorPx !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

export function hasStoredCalibration(): boolean {
  return loadCalibration() !== null;
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(CALIBRATION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
