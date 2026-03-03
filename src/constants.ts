/**
 * Uygulama genelinde kullanılan sabitler.
 * Tekrar eden magic number'ları tek yerde toplar.
 */

/** Her fotoğraf için takip süresi (ms). */
export const IMAGE_DURATION_MS = 20_000;

/** Yüz kırpma (crop) işlemi timeout (ms). */
export const CROP_TIMEOUT_MS = 20_000;

/** UI gaze güncelleme aralığı (ms) – 10Hz. */
export const GAZE_UI_THROTTLE_MS = 100;
