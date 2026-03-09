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

// ─── EAR (Eye Aspect Ratio) Eşikleri ────────────────────────────────
/** Göz kırpma EAR eşiği (desktop). Tüm modüller bu değeri kullanır. */
export const EAR_BLINK_THRESHOLD = 0.18;
/** Göz kırpma EAR eşiği (mobil — düşük çözünürlükte EAR doğal olarak düşük). */
export const EAR_BLINK_THRESHOLD_MOBILE = 0.11;

// ─── Confidence Eşikleri ─────────────────────────────────────────────
/** Tracking sırasında minimum confidence (desktop). */
export const CONFIDENCE_MIN_TRACKING = 0.15;
/** Tracking sırasında minimum confidence (mobil — artırıldı, gürültülü veri azaltılır). */
export const CONFIDENCE_MIN_TRACKING_MOBILE = 0.10;
/** Fixation detector'da noktayı kabul etmek için minimum confidence. */
export const CONFIDENCE_MIN_FIXATION = 0.15;
/** Kalibrasyon sırasında sample toplama minimum confidence. */
export const CONFIDENCE_MIN_CALIBRATION_SAMPLE = 0.10;

// ─── Spatial Weighting ──────────────────────────────────────────────
/** Kenar noktası ağırlığı — ilk eğitim ve retrain'de aynı değer. */
export const SPATIAL_EDGE_WEIGHT = 0.35;
