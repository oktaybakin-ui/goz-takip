/**
 * Gozluk Tespit Modulu
 *
 * MediaPipe FaceMesh landmark'lari kullanarak gozluk varligini tespit eder:
 * - Z-derinligi tutarsizliklari (gozluk cercevesi derinlik atlayisi olusturur)
 * - Burun koprusu bolgesinde landmark jitter (lens yansimalari)
 * - Geometrik analiz: burun koprusu ve goz landmark mesafe oranlari
 * - Kas-goz arasi bolge cerceve kenari tespiti
 *
 * Temporal smoothing ile kararli sonuc uretir (~30 frame gecmisi).
 */

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface GlassesDetection {
  /** Yuksek guvenle gozluk tespit edildi mi */
  detected: boolean;
  /** 0-1 arasinda olasilik */
  probability: number;
  /** Analiz edilen toplam frame sayisi */
  frameCount: number;
  /** Tespit edilirse kullaniciya gosterilecek mesaj */
  message: string | null;
}

// ---------------------------------------------------------------------------
// Landmark Index Groups
// ---------------------------------------------------------------------------

/** Sol goz cevresi landmark indeksleri (ust + alt kontur) */
const LEFT_EYE_CONTOUR: readonly number[] = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];

/** Sag goz cevresi landmark indeksleri (ust + alt kontur) */
const RIGHT_EYE_CONTOUR: readonly number[] = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466,
];

/** Burun koprusu landmark indeksleri — gozluk koprusunun oturdugu yer */
const NOSE_BRIDGE_INDICES: readonly number[] = [6, 197, 195, 5, 4, 1];

/** Sol kas bolge landmark indeksleri — cerceve ust kenari tespit */
const LEFT_BROW_INDICES: readonly number[] = [66, 105, 107, 63, 70, 46];

/** Sag kas bolge landmark indeksleri — cerceve ust kenari tespit */
const RIGHT_BROW_INDICES: readonly number[] = [296, 334, 336, 293, 300, 276];

/** Yanak bolgesi landmark indeksleri — referans z-derinligi (gozluk olmayan bolge) */
const LEFT_CHEEK_INDICES: readonly number[] = [116, 117, 118, 119, 100, 36];
const RIGHT_CHEEK_INDICES: readonly number[] = [345, 346, 347, 348, 329, 266];

/** Sol goz ile kas arasi bolgesi (cerceve kenari gorulebilir) */
const LEFT_EYE_BROW_GAP: readonly number[] = [66, 105, 107, 159, 160, 161];

/** Sag goz ile kas arasi bolgesi */
const RIGHT_EYE_BROW_GAP: readonly number[] = [296, 334, 336, 386, 387, 388];

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface FrameSignals {
  /** Goz bolgesi z-derinligi varyansi / yanak bolgesi z-derinligi varyansi orani */
  eyeToCheckZVarianceRatio: number;
  /** Burun koprusu z-derinligi deseni skoru (0-1) */
  noseBridgeZScore: number;
  /** Sol-sag z-derinligi simetrisi (0 = tam simetrik) */
  zSymmetryScore: number;
  /** Kas-goz arasi z-derinligi anomali skoru */
  browGapZScore: number;
  /** Burun koprusu landmark jitter (frame-to-frame degisim) */
  noseBridgeJitter: number;
  /** Goz-burun mesafe orani anomali skoru */
  geometricRatioScore: number;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}

function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const diff = values[i] - m;
    sumSq += diff * diff;
  }
  return sumSq / values.length;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function safeLandmark(landmarks: readonly Landmark[], index: number): Landmark | null {
  if (index < 0 || index >= landmarks.length) return null;
  const lm = landmarks[index];
  if (lm == null) return null;
  return lm;
}

function gatherZ(landmarks: readonly Landmark[], indices: readonly number[]): number[] {
  const zValues: number[] = [];
  for (const idx of indices) {
    const lm = safeLandmark(landmarks, idx);
    if (lm !== null) {
      zValues.push(lm.z);
    }
  }
  return zValues;
}

function gatherLandmarks(
  landmarks: readonly Landmark[],
  indices: readonly number[]
): Landmark[] {
  const result: Landmark[] = [];
  for (const idx of indices) {
    const lm = safeLandmark(landmarks, idx);
    if (lm !== null) {
      result.push(lm);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// GlassesDetector
// ---------------------------------------------------------------------------

/** Frame gecmisi boyutu — kararli tespit icin gereken frame sayisi */
const HISTORY_SIZE = 30;

/** Minimum frame sayisi — tespit sonucu uretmek icin gereken minimum */
const MIN_FRAMES_FOR_DETECTION = 20;

/** Tespit esigi — bu deger ustu "gozluk var" sayilir */
const DETECTION_THRESHOLD = 0.55;

/** Tespit mesaji */
const DETECTION_MESSAGE =
  "Gözlük tespit edildi. İris takibi gözlüğe rağmen çalışır ancak yansımalar doğruluğu düşürebilir.";

export class GlassesDetector {
  private history: FrameSignals[] = [];
  private totalFrameCount: number = 0;
  private lastNoseBridgeZ: number[] | null = null;
  private currentState: GlassesDetection;

  constructor() {
    this.currentState = {
      detected: false,
      probability: 0,
      frameCount: 0,
      message: null,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Her frame'de landmark dizisini besle, guncel tespit sonucunu al.
   * @param landmarks MediaPipe FaceMesh ciktisi (468+ landmark, her biri {x, y, z})
   */
  update(landmarks: Array<{ x: number; y: number; z: number }>): GlassesDetection {
    this.totalFrameCount++;

    // Yetersiz landmark — tespit yapilamaz
    if (landmarks.length < 400) {
      this.currentState = {
        detected: false,
        probability: 0,
        frameCount: this.totalFrameCount,
        message: null,
      };
      return this.currentState;
    }

    const signals = this.computeFrameSignals(landmarks);
    this.history.push(signals);

    // Gecmis boyutunu sinirla
    if (this.history.length > HISTORY_SIZE) {
      this.history.shift();
    }

    this.currentState = this.evaluateDetection();
    return this.currentState;
  }

  /**
   * Mevcut tespit durumunu getir (son update sonucu).
   */
  getState(): GlassesDetection {
    return this.currentState;
  }

  /**
   * Tespit gecmisini sifirla.
   */
  reset(): void {
    this.history = [];
    this.totalFrameCount = 0;
    this.lastNoseBridgeZ = null;
    this.currentState = {
      detected: false,
      probability: 0,
      frameCount: 0,
      message: null,
    };
  }

  // -------------------------------------------------------------------------
  // Signal Extraction
  // -------------------------------------------------------------------------

  private computeFrameSignals(
    landmarks: Array<{ x: number; y: number; z: number }>
  ): FrameSignals {
    // ---- 1) Goz vs yanak z-derinligi varyans orani ----
    const leftEyeZ = gatherZ(landmarks, LEFT_EYE_CONTOUR);
    const rightEyeZ = gatherZ(landmarks, RIGHT_EYE_CONTOUR);
    const leftCheekZ = gatherZ(landmarks, LEFT_CHEEK_INDICES);
    const rightCheekZ = gatherZ(landmarks, RIGHT_CHEEK_INDICES);

    const eyeZValues = [...leftEyeZ, ...rightEyeZ];
    const cheekZValues = [...leftCheekZ, ...rightCheekZ];

    const eyeZVar = variance(eyeZValues);
    const cheekZVar = variance(cheekZValues);

    // Gozluk oldugunda goz bolgesi z-varyansi yanak bolgesine gore cok daha yuksek
    // Normallestirilmis oran: cheekZVar 0 ise buyuk oran kabul et
    const eyeToCheckZVarianceRatio =
      cheekZVar > 1e-10 ? eyeZVar / cheekZVar : eyeZVar > 1e-10 ? 10.0 : 1.0;

    // ---- 2) Burun koprusu z-derinligi deseni ----
    const noseBridgeZ = gatherZ(landmarks, NOSE_BRIDGE_INDICES);
    const noseBridgeZScore = this.computeNoseBridgeZScore(noseBridgeZ);

    // ---- 3) Sol-sag z-derinligi simetri ----
    const zSymmetryScore = this.computeZSymmetry(leftEyeZ, rightEyeZ);

    // ---- 4) Kas-goz arasi z-derinligi anomali ----
    const browGapZScore = this.computeBrowGapZScore(landmarks);

    // ---- 5) Burun koprusu jitter (frame-to-frame) ----
    const noseBridgeJitter = this.computeNoseBridgeJitter(noseBridgeZ);
    this.lastNoseBridgeZ = noseBridgeZ.length > 0 ? noseBridgeZ : this.lastNoseBridgeZ;

    // ---- 6) Geometrik mesafe orani anomalisi ----
    const geometricRatioScore = this.computeGeometricRatioScore(landmarks);

    return {
      eyeToCheckZVarianceRatio,
      noseBridgeZScore,
      zSymmetryScore,
      browGapZScore,
      noseBridgeJitter,
      geometricRatioScore,
    };
  }

  /**
   * Burun koprusu z-derinligi deseni analizi.
   *
   * Gozluk koprusu burun ustunde oturur ve burun koprusu landmark'larinin
   * z-degerlerinde karakteristik bir "cikinti" (daha yakin z) olusturur.
   * Normal yuzde burun koprusu z-degerleri monoton azalir (ust->alt),
   * gozlukluyken kopru bolgesinde bir z-platforu veya sap oluşur.
   *
   * Skor: 0 = normal desen, 1 = gozluk deseni.
   */
  private computeNoseBridgeZScore(noseBridgeZ: readonly number[]): number {
    if (noseBridgeZ.length < 3) return 0;

    // Normalde z-degerleri yukaridan asagiya dogru artar (kameraya yaklasir).
    // Gozluk koprusu bu trendi bozar — orta bolgede z-degerleri beklenenden
    // daha yakin (daha negatif) olur.

    // Ust ve alt ucun ortalamasini al, orta bolgenin bundan sapmasini olc
    const top = noseBridgeZ[0];
    const bottom = noseBridgeZ[noseBridgeZ.length - 1];
    const expectedMiddle = (top + bottom) / 2;

    // Orta indeks(ler)
    const midStart = Math.floor(noseBridgeZ.length / 3);
    const midEnd = Math.ceil((noseBridgeZ.length * 2) / 3);
    const middleValues = noseBridgeZ.slice(midStart, midEnd);
    const actualMiddle = mean(middleValues);

    // Sapma: gozlukte orta bolge beklenenden daha negatif (kameraya yakin)
    const span = Math.abs(bottom - top);
    if (span < 1e-6) return 0;

    const deviation = (expectedMiddle - actualMiddle) / span;
    // deviation > 0 ise orta kisim beklenenden yakın -> gozluk sinyali
    return clamp(deviation * 3.0, 0, 1);
  }

  /**
   * Sol ve sag goz z-derinligi simetri analizi.
   *
   * Gozluk cerceveleri simetrik oldugu icin, gozlukluyken sol ve sag goz
   * z-varyans profilleri birbirine cok benzer.
   * Normal yuzde de simetri vardir ama gozluk z-varyansindaki artisi
   * simetrik olarak arttirir.
   *
   * Skor: 0 = asimetrik (gozluk degil), daha yuksek = simetrik yuksek varyans
   */
  private computeZSymmetry(
    leftEyeZ: readonly number[],
    rightEyeZ: readonly number[]
  ): number {
    if (leftEyeZ.length < 3 || rightEyeZ.length < 3) return 0;

    const leftVar = variance(leftEyeZ);
    const rightVar = variance(rightEyeZ);

    const maxVar = Math.max(leftVar, rightVar);
    if (maxVar < 1e-10) return 0;

    // Simetri: iki varyans birbirine ne kadar yakin
    const minVar = Math.min(leftVar, rightVar);
    const symmetryRatio = minVar / maxVar; // 0-1, 1 = tam simetrik

    // Simetrik VE yuksek varyans = gozluk sinyali
    // Her iki goz bolgesinin de yuksek z-varyansi olmasi gerekir
    const avgVar = (leftVar + rightVar) / 2;

    // Z-derinligi varyansi esigi: gozluk ~2-5x artirir
    // Normal yuz z-varyansi ~0.0001-0.001, gozluk ~0.001-0.01
    const varianceSignal = clamp(avgVar / 0.0005, 0, 1);

    return symmetryRatio * varianceSignal;
  }

  /**
   * Kas-goz arasi bolgedeki z-derinligi anomali tespiti.
   *
   * Gozluk cercevesinin ust kenari kas ile goz arasinda yer alir.
   * Bu bolgedeki landmark'larin z-degerleri gozluksuz yuzde duzgun bir
   * gec is gosterirken, gozluklu yuzde cerceve kenarinda ani z-sıcraması olur.
   */
  private computeBrowGapZScore(
    landmarks: readonly Landmark[]
  ): number {
    const leftGapLm = gatherLandmarks(landmarks, LEFT_EYE_BROW_GAP);
    const rightGapLm = gatherLandmarks(landmarks, RIGHT_EYE_BROW_GAP);
    const leftBrowLm = gatherLandmarks(landmarks, LEFT_BROW_INDICES);
    const rightBrowLm = gatherLandmarks(landmarks, RIGHT_BROW_INDICES);

    if (leftGapLm.length < 3 || rightGapLm.length < 3) return 0;
    if (leftBrowLm.length < 3 || rightBrowLm.length < 3) return 0;

    // Kas z-degerleri ortalamasini al
    const leftBrowZ = mean(leftBrowLm.map((lm) => lm.z));
    const rightBrowZ = mean(rightBrowLm.map((lm) => lm.z));
    const browMeanZ = (leftBrowZ + rightBrowZ) / 2;

    // Gap bolgesi (kas-goz arasi) z-degerleri
    const gapZ = [...leftGapLm, ...rightGapLm].map((lm) => lm.z);
    const gapMeanZ = mean(gapZ);
    const gapVarZ = variance(gapZ);

    // Gozluklu yuzde gap bolgesi z-varyansi yuksek olur (cerceve kenari)
    // ve gap ortalamasi kas ortalamasina gore beklenenden farkli olur
    const zJump = Math.abs(gapMeanZ - browMeanZ);

    // Normalize et
    const jumpSignal = clamp(zJump / 0.01, 0, 1);
    const varSignal = clamp(gapVarZ / 0.0003, 0, 1);

    return (jumpSignal * 0.4 + varSignal * 0.6);
  }

  /**
   * Burun koprusu landmark jitter olcumu (frame-to-frame degisim).
   *
   * Gozluk lens yansimalari burun koprusu landmark'larinda ek jitter olusturur.
   * Normal yuzde bu bolge oldukca stabil olurken, yansimalar z-degerlerinde
   * frame'den frame'e dalgalanmaya neden olur.
   */
  private computeNoseBridgeJitter(currentNoseBridgeZ: readonly number[]): number {
    if (
      this.lastNoseBridgeZ === null ||
      this.lastNoseBridgeZ.length === 0 ||
      currentNoseBridgeZ.length === 0
    ) {
      return 0;
    }

    const minLen = Math.min(this.lastNoseBridgeZ.length, currentNoseBridgeZ.length);
    let totalDiff = 0;

    for (let i = 0; i < minLen; i++) {
      totalDiff += Math.abs(currentNoseBridgeZ[i] - this.lastNoseBridgeZ[i]);
    }

    const avgDiff = totalDiff / minLen;

    // Normalize: normal jitter ~0.0001-0.001, gozluk jitteri ~0.001-0.01
    return clamp(avgDiff / 0.003, 0, 1);
  }

  /**
   * Geometrik mesafe orani anomali tespiti.
   *
   * Gozluk olmadiginda burun koprusu-goz mesafe oranlari belirli bir aralikta yer alir.
   * Gozluk varligi bu oranlari degistirir cunku:
   * - Cerceve goz landmark'larini hafifce kaydirir
   * - Lens kirilmasi z-derinligini etkiler
   * - Burun padi cerceve agrligini tasir ve burun koprusu sekli degisir
   */
  private computeGeometricRatioScore(
    landmarks: readonly Landmark[]
  ): number {
    // Burun koprusu ust noktasi (indeks 6) ve goz ic koseler (133, 362)
    const noseBridgeTop = safeLandmark(landmarks, 6);
    const leftInnerCorner = safeLandmark(landmarks, 133);
    const rightInnerCorner = safeLandmark(landmarks, 362);
    const noseTip = safeLandmark(landmarks, 1);
    const leftOuterCorner = safeLandmark(landmarks, 33);
    const rightOuterCorner = safeLandmark(landmarks, 263);

    if (
      !noseBridgeTop ||
      !leftInnerCorner ||
      !rightInnerCorner ||
      !noseTip ||
      !leftOuterCorner ||
      !rightOuterCorner
    ) {
      return 0;
    }

    // Burun koprusu ustu ile goz ic koseleri arasindaki mesafe
    const leftDist = Math.sqrt(
      (noseBridgeTop.x - leftInnerCorner.x) ** 2 +
        (noseBridgeTop.y - leftInnerCorner.y) ** 2 +
        (noseBridgeTop.z - leftInnerCorner.z) ** 2
    );
    const rightDist = Math.sqrt(
      (noseBridgeTop.x - rightInnerCorner.x) ** 2 +
        (noseBridgeTop.y - rightInnerCorner.y) ** 2 +
        (noseBridgeTop.z - rightInnerCorner.z) ** 2
    );

    // Gozler arasi mesafe (ic koseler)
    const interEyeDist = Math.sqrt(
      (leftInnerCorner.x - rightInnerCorner.x) ** 2 +
        (leftInnerCorner.y - rightInnerCorner.y) ** 2 +
        (leftInnerCorner.z - rightInnerCorner.z) ** 2
    );

    if (interEyeDist < 1e-6) return 0;

    // Burun uzunlugu (kopru ustu -> burun ucu)
    const noseLength = Math.sqrt(
      (noseBridgeTop.x - noseTip.x) ** 2 +
        (noseBridgeTop.y - noseTip.y) ** 2 +
        (noseBridgeTop.z - noseTip.z) ** 2
    );

    // Goz dis kose arasi mesafe
    const outerEyeDist = Math.sqrt(
      (leftOuterCorner.x - rightOuterCorner.x) ** 2 +
        (leftOuterCorner.y - rightOuterCorner.y) ** 2 +
        (leftOuterCorner.z - rightOuterCorner.z) ** 2
    );

    if (outerEyeDist < 1e-6 || noseLength < 1e-6) return 0;

    // Oran 1: Burun koprusu-goz mesafesi / gozler arasi mesafe
    // Gozluklu yuzde cerceve burun koprusu landmark'ini etkiler
    const bridgeToEyeRatio = (leftDist + rightDist) / (2 * interEyeDist);

    // Oran 2: Burun uzunlugu / dis goz mesafesi
    const noseToOuterEyeRatio = noseLength / outerEyeDist;

    // Oran 3: Z-derinligi bazli — burun koprusu z-degeri ile goz ic kose z arasindaki fark
    // Gozluklu yuzde kopru z-degeri goz ic kosesine gore daha yakin (daha negatif)
    const leftZDiff = noseBridgeTop.z - leftInnerCorner.z;
    const rightZDiff = noseBridgeTop.z - rightInnerCorner.z;
    const avgZDiff = (leftZDiff + rightZDiff) / 2;

    // Normal yuzde bridgeToEyeRatio ~0.25-0.40 araligindadir
    // Gozluklu yuzde ~0.18-0.28 araligina kayar (cerceve etkisi)
    // Esik: normal araliktan sapma
    const ratioDeviation = Math.abs(bridgeToEyeRatio - 0.33);
    const ratioSignal = clamp(ratioDeviation / 0.1, 0, 1);

    // Z-derinligi fark sinyali — gozluklu yuzde avgZDiff daha negatif
    const zDiffSignal = clamp(Math.abs(avgZDiff) / 0.02, 0, 1);

    // Burun orani sapma sinyali
    const noseRatioDeviation = Math.abs(noseToOuterEyeRatio - 0.45);
    const noseRatioSignal = clamp(noseRatioDeviation / 0.1, 0, 1);

    return ratioSignal * 0.3 + zDiffSignal * 0.4 + noseRatioSignal * 0.3;
  }

  // -------------------------------------------------------------------------
  // Detection Evaluation
  // -------------------------------------------------------------------------

  /**
   * Gecmisteki tum frame sinyallerini birlestirir ve nihai tespit sonucu uretir.
   * Temporal smoothing ile kararli sonuc verir.
   */
  private evaluateDetection(): GlassesDetection {
    const frameCount = this.totalFrameCount;

    // Yeterli frame toplanmadi
    if (this.history.length < MIN_FRAMES_FOR_DETECTION) {
      return {
        detected: false,
        probability: 0,
        frameCount,
        message: null,
      };
    }

    // Her sinyal icin gecmis uzerinden ortalama al (temporal smoothing)
    const avgEyeToCheckRatio = mean(
      this.history.map((s) => s.eyeToCheckZVarianceRatio)
    );
    const avgNoseBridgeZ = mean(this.history.map((s) => s.noseBridgeZScore));
    const avgZSymmetry = mean(this.history.map((s) => s.zSymmetryScore));
    const avgBrowGap = mean(this.history.map((s) => s.browGapZScore));
    const avgNoseJitter = mean(this.history.map((s) => s.noseBridgeJitter));
    const avgGeometric = mean(this.history.map((s) => s.geometricRatioScore));

    // Her sinyali 0-1 araligina normalize et ve agirlikli birlestir
    // Z-derinligi varyans orani: oran > 2 gozluk sinyali
    const s1 = clamp((avgEyeToCheckRatio - 1.0) / 3.0, 0, 1);

    // Burun koprusu z-deseni: direkt 0-1 skor
    const s2 = clamp(avgNoseBridgeZ, 0, 1);

    // Z simetri: direkt 0-1 skor
    const s3 = clamp(avgZSymmetry, 0, 1);

    // Kas-goz arasi anomali: direkt 0-1 skor
    const s4 = clamp(avgBrowGap, 0, 1);

    // Burun koprusu jitter: direkt 0-1 skor
    const s5 = clamp(avgNoseJitter, 0, 1);

    // Geometrik oran anomalisi: direkt 0-1 skor
    const s6 = clamp(avgGeometric, 0, 1);

    // Agirlikli toplam — z-derinligi sinyalleri en guclu
    const weights = {
      eyeToCheckRatio: 0.25,
      noseBridgeZ: 0.20,
      zSymmetry: 0.10,
      browGap: 0.15,
      noseJitter: 0.10,
      geometric: 0.20,
    };

    const probability = clamp(
      s1 * weights.eyeToCheckRatio +
        s2 * weights.noseBridgeZ +
        s3 * weights.zSymmetry +
        s4 * weights.browGap +
        s5 * weights.noseJitter +
        s6 * weights.geometric,
      0,
      1
    );

    const detected = probability >= DETECTION_THRESHOLD;

    if (detected && this.totalFrameCount % 300 === 0) {
      logger.log(
        "[GlassesDetector] Gozluk tespit edildi. Prob:",
        probability.toFixed(3),
        "| Signals — eyeZ:",
        s1.toFixed(2),
        "noseZ:",
        s2.toFixed(2),
        "sym:",
        s3.toFixed(2),
        "brow:",
        s4.toFixed(2),
        "jitter:",
        s5.toFixed(2),
        "geo:",
        s6.toFixed(2)
      );
    }

    return {
      detected,
      probability,
      frameCount,
      message: detected ? DETECTION_MESSAGE : null,
    };
  }
}
