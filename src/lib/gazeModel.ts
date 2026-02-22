/**
 * Gaze Model - Polynomial Regression tabanlı göz takip modeli
 *
 * Input: [Lx, Ly, Rx, Ry, yaw, pitch, roll, scale]
 * Output: (x_image, y_image)
 *
 * 2. derece polinom regresyon kullanarak göz özelliklerinden
 * ekran koordinatlarına haritalama yapar.
 */

import { logger } from "./logger";

export interface EyeFeatures {
  // Ham iris koordinatları (MediaPipe normalized 0-1)
  leftIrisX: number;
  leftIrisY: number;
  rightIrisX: number;
  rightIrisY: number;
  // Göreceli iris pozisyonu (göz konturu içinde 0-1)
  leftIrisRelX: number;
  leftIrisRelY: number;
  rightIrisRelX: number;
  rightIrisRelY: number;
  // Göz metrikleri
  pupilRadius: number;
  eyeOpenness: number;
  leftEAR: number;
  rightEAR: number;
  // Baş pozu
  yaw: number;
  pitch: number;
  roll: number;
  faceScale: number;
  // Göz genişliği (göz konturu genişliği - normalize edici)
  leftEyeWidth: number;
  rightEyeWidth: number;
  confidence: number;
}

export interface GazePoint {
  x: number;
  y: number;
  timestamp: number;
  confidence: number;
}

export interface CalibrationSample {
  features: EyeFeatures;
  targetX: number;
  targetY: number;
}

// 2. derece polinom özellikleri
// [1, x1, x2, ..., x1^2, x1*x2, ..., x2^2, ...]
function createPolynomialFeatures(input: number[]): number[] {
  const features: number[] = [1];
  for (const val of input) features.push(val);
  for (let i = 0; i < input.length; i++) {
    for (let j = i; j < input.length; j++) {
      features.push(input[i] * input[j]);
    }
  }
  return features;
}

/** 2. derece + iris ile ilgili 6 değişkende 3. derece terimler (daha hassas haritalama). */
function createPolynomialFeaturesWithCubic(input: number[]): number[] {
  const base = createPolynomialFeatures(input);
  const cubicCount = Math.min(6, input.length); // avgRelX, avgRelY, L/R iris relX/relY
  for (let i = 0; i < cubicCount; i++) {
    base.push(input[i] * input[i] * input[i]);
  }
  return base;
}

// Özellik vektörünü normalize et
function normalizeFeatures(features: number[], means: number[], stds: number[]): number[] {
  return features.map((f, i) => {
    if (i === 0) return f; // bias terimini atla
    const std = stds[i] || 1;
    return std === 0 ? 0 : (f - means[i]) / std;
  });
}

// Weighted Ridge Regression ile ağırlık hesapla
// (X^T W X + λI)^{-1} X^T W y
// Her örnek confidence skoru ile ağırlıklandırılır
function ridgeRegression(X: number[][], y: number[], lambda: number = 0.01, weights?: number[]): number[] {
  const n = X[0].length;
  const m = X.length;

  // X^T W X hesapla (W = diagonal weight matrix)
  const XtX: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < m; k++) {
        const w = weights ? weights[k] : 1;
        sum += w * X[k][i] * X[k][j];
      }
      XtX[i][j] = sum + (i === j ? lambda : 0); // Ridge regularization
    }
  }

  // X^T W y hesapla
  const Xty: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < m; k++) {
      const w = weights ? weights[k] : 1;
      sum += w * X[k][i] * y[k];
    }
    Xty[i] = sum;
  }

  // Gauss eliminasyonu ile çöz
  return solveLinearSystem(XtX, Xty);
}

// Gauss eliminasyonu
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const augmented: number[][] = A.map((row, i) => [...row, b[i]]);

  // İleri eliminasyon
  for (let col = 0; col < n; col++) {
    // Pivot seç (kısmi pivotlama)
    let maxRow = col;
    let maxVal = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > maxVal) {
        maxVal = Math.abs(augmented[row][col]);
        maxRow = row;
      }
    }
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = augmented[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  // Geri yerine koyma
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = augmented[row][n];
    for (let j = row + 1; j < n; j++) {
      sum -= augmented[row][j] * x[j];
    }
    const divisor = augmented[row][row];
    x[row] = Math.abs(divisor) < 1e-12 ? 0 : sum / divisor;
  }

  return x;
}

// Outlier temizleme (Her hedef nokta grubu için ayrı IQR)
function removeOutliers(samples: CalibrationSample[]): CalibrationSample[] {
  if (samples.length < 10) return samples;

  // Hedef noktaya göre grupla
  const groups = new Map<string, CalibrationSample[]>();
  for (const sample of samples) {
    const key = `${sample.targetX.toFixed(0)}_${sample.targetY.toFixed(0)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sample);
  }

  const cleaned: CalibrationSample[] = [];

  groups.forEach((groupSamples) => {
    if (groupSamples.length < 5) {
      cleaned.push(...groupSamples);
      return;
    }

    // Grup içi GÖRECELİ iris pozisyon ortalamaları (baş hareketinden bağımsız)
    const meanLx = groupSamples.reduce((s, sp) => s + sp.features.leftIrisRelX, 0) / groupSamples.length;
    const meanLy = groupSamples.reduce((s, sp) => s + sp.features.leftIrisRelY, 0) / groupSamples.length;
    const meanRx = groupSamples.reduce((s, sp) => s + sp.features.rightIrisRelX, 0) / groupSamples.length;
    const meanRy = groupSamples.reduce((s, sp) => s + sp.features.rightIrisRelY, 0) / groupSamples.length;

    // Her örneğin ortalamadan uzaklığı
    const distances = groupSamples.map((sp) => {
      const dlx = sp.features.leftIrisRelX - meanLx;
      const dly = sp.features.leftIrisRelY - meanLy;
      const drx = sp.features.rightIrisRelX - meanRx;
      const dry = sp.features.rightIrisRelY - meanRy;
      return Math.sqrt(dlx * dlx + dly * dly + drx * drx + dry * dry);
    });

    const sorted = [...distances].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    // Adaptif IQR: küçük gruplarda daha geniş tolerans, büyük gruplarda sıkı
    const iqrMultiplier = groupSamples.length < 10 ? 2.5 :
                          groupSamples.length < 20 ? 2.0 : 1.5;
    const upperBound = q3 + iqrMultiplier * iqr;

    for (let i = 0; i < groupSamples.length; i++) {
      if (distances[i] <= upperBound) {
        cleaned.push(groupSamples[i]);
      }
    }
  });

  return cleaned;
}

/**
 * One Euro Filter - adaptif düşük geçiren filtre.
 * Yavaş hareketlerde jitter azaltır, hızlı hareketlerde gecikmeyi düşürür.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number = 0;
  private tPrev: number | null = null;

  constructor(minCutoff: number = 1.0, beta: number = 0.007, dCutoff: number = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }

    const dt = Math.max((t - this.tPrev) / 1000, 0.001); // saniye
    this.tPrev = t;

    // Türev tahmini
    const dx = (x - this.xPrev) / dt;
    const adx = this.alpha(this.dCutoff, dt);
    const dxHat = adx * dx + (1 - adx) * this.dxPrev;
    this.dxPrev = dxHat;

    // Adaptif cutoff
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const ax = this.alpha(cutoff, dt);
    const xHat = ax * x + (1 - ax) * this.xPrev;
    this.xPrev = xHat;

    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

/**
 * Polinom regresyon tabanlı göz-bakış modeli. Kalibrasyon örnekleriyle eğitilir,
 * sonra EyeFeatures ile ekran koordinatı (GazePoint) tahmin eder. One Euro Filter ve drift düzeltmesi uygular.
 */
export class GazeModel {
  private weightsX: number[] | null = null;
  private weightsY: number[] | null = null;
  private featureMeans: number[] = [];
  private featureStds: number[] = [];
  private trained: boolean = false;
  private lambda: number = 0.008; // En kaliteli kalibrasyon = veriye en iyi uyum

  // One Euro Filter (EMA yerine - adaptif smoothing)
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;

  // Drift correction
  private driftOffsetX: number = 0;
  private driftOffsetY: number = 0;

  // Referans baş pozu (kalibrasyon sırasındaki ortalama)
  private refPose: { yaw: number; pitch: number; roll: number; faceScale: number } | null = null;

  // Tahmin geçmişi (outlier rejection)
  private predictionHistory: { x: number; y: number; t: number }[] = [];
  private readonly historyMaxSize: number = 11;

  constructor(lambda: number = 0.008, _smoothingAlpha: number = 0.4) {
    this.lambda = lambda;
    // OneEuro: X daha hızlı (yatay saccade sık), Y biraz daha yumuşak (dikey saccade nadir)
    this.filterX = new OneEuroFilter(1.5, 0.05, 1.0);
    this.filterY = new OneEuroFilter(1.2, 0.04, 1.0);
  }

  // Eye features'dan input vektörü oluştur
  // WebGazer benzeri zengin feature seti: iris + baş pozu + asimetri + EAR
  // 14 feature → daha iyi regresyon (120-dim WebGazer'a yakın yaklaşım)
  private featuresToInput(features: EyeFeatures): number[] {
    // Baş yana dönükse kameraya yakın göze daha çok güven
    // yaw > 0 → sağa dönük → sol göz kameraya yakın → sol ağırlığı artır
    const yawAbs = Math.abs(features.yaw);
    const yawBias = Math.min(yawAbs * 2.5, 0.8);
    let leftW = 0.5;
    let rightW = 0.5;
    if (features.yaw > 0.05) {
      leftW = 0.5 + yawBias / 2;
      rightW = 1 - leftW;
    } else if (features.yaw < -0.05) {
      rightW = 0.5 + yawBias / 2;
      leftW = 1 - rightW;
    }

    const avgRelX = leftW * features.leftIrisRelX + rightW * features.rightIrisRelX;
    const avgRelY = leftW * features.leftIrisRelY + rightW * features.rightIrisRelY;
    const avgRawX = leftW * features.leftIrisX + rightW * features.rightIrisX;
    const avgRawY = leftW * features.leftIrisY + rightW * features.rightIrisY;

    const irisAsymX = features.leftIrisRelX - features.rightIrisRelX;
    const irisAsymY = features.leftIrisRelY - features.rightIrisRelY;

    const avgEAR = (features.leftEAR + features.rightEAR) / 2;

    // Pose delta: kalibrasyondaki referans pozdan sapma
    const dYaw = this.refPose ? features.yaw - this.refPose.yaw : 0;
    const dPitch = this.refPose ? features.pitch - this.refPose.pitch : 0;
    const dRoll = this.refPose ? features.roll - this.refPose.roll : 0;
    const dScale = this.refPose ? features.faceScale - this.refPose.faceScale : 0;

    return [
      avgRelX,
      avgRelY,
      features.leftIrisRelX,
      features.leftIrisRelY,
      features.rightIrisRelX,
      features.rightIrisRelY,
      avgRawX,
      avgRawY,
      features.yaw,
      features.pitch,
      features.roll,
      features.faceScale,
      irisAsymX,
      irisAsymY,
      avgEAR,
      features.pupilRadius,
      dYaw,
      dPitch,
      dRoll,
      dScale,
    ];
  }

  // Normalizasyon parametrelerini hesapla
  private computeNormalization(inputs: number[][]): void {
    const n = inputs[0].length;
    this.featureMeans = new Array(n).fill(0);
    this.featureStds = new Array(n).fill(0);

    // Ortalama hesapla
    for (const input of inputs) {
      for (let i = 0; i < n; i++) {
        this.featureMeans[i] += input[i];
      }
    }
    for (let i = 0; i < n; i++) {
      this.featureMeans[i] /= inputs.length;
    }

    // Standart sapma hesapla
    for (const input of inputs) {
      for (let i = 0; i < n; i++) {
        const diff = input[i] - this.featureMeans[i];
        this.featureStds[i] += diff * diff;
      }
    }
    for (let i = 0; i < n; i++) {
      this.featureStds[i] = Math.sqrt(this.featureStds[i] / inputs.length);
    }
  }

  /**
   * Kalibrasyon örnekleriyle modeli eğitir. Outlier temizliği yapılır.
   * @param samples - Hedef (targetX, targetY) ve özellik (features) çiftleri
   * @returns Ortalama ve maksimum hata (piksel)
   * @throws Yeterli örnek yoksa (örn. < 50)
   */
  train(samples: CalibrationSample[]): { meanError: number; maxError: number } {
    // Outlier temizle
    const cleanSamples = removeOutliers(samples);

    if (cleanSamples.length < 62) {
      throw new Error("Yeterli kalibrasyon verisi yok (en az 62 örnek gerekli – tüm noktaları tamamlayın)");
    }

    // Referans baş pozunu kalibrasyon verilerinin ortalamasından hesapla
    const refYaw = cleanSamples.reduce((s, sp) => s + sp.features.yaw, 0) / cleanSamples.length;
    const refPitch = cleanSamples.reduce((s, sp) => s + sp.features.pitch, 0) / cleanSamples.length;
    const refRoll = cleanSamples.reduce((s, sp) => s + sp.features.roll, 0) / cleanSamples.length;
    const refScale = cleanSamples.reduce((s, sp) => s + sp.features.faceScale, 0) / cleanSamples.length;
    this.refPose = { yaw: refYaw, pitch: refPitch, roll: refRoll, faceScale: refScale };
    logger.log("[GazeModel] Referans poz:", {
      yaw: refYaw.toFixed(3), pitch: refPitch.toFixed(3),
      roll: refRoll.toFixed(3), scale: refScale.toFixed(3),
    });

    const rawInputs = cleanSamples.map((s) => this.featuresToInput(s.features));

    // NaN kontrolü - features düzgün hesaplanmış mı?
    const validMask = rawInputs.map(row => row.every(v => isFinite(v)));
    const hasNaN = validMask.some(v => !v);
    if (hasNaN) {
      logger.error("[GazeModel] NaN veya Infinity feature değeri tespit edildi!");
      // NaN satırlarını temizle ve cleanSamples/rawInputs'ı güncelle
      const validIndices = validMask.map((ok, i) => ok ? i : -1).filter(i => i >= 0);
      if (validIndices.length < 55) {
        throw new Error("Yeterli geçerli kalibrasyon verisi yok (NaN temizliği sonrası)");
      }
      // Temizlenmiş veriyle devam et
      const filteredSamples = validIndices.map(i => cleanSamples[i]);
      const filteredInputs = validIndices.map(i => rawInputs[i]);
      cleanSamples.length = 0;
      cleanSamples.push(...filteredSamples);
      rawInputs.length = 0;
      rawInputs.push(...filteredInputs);
      logger.warn("[GazeModel] NaN temizliği sonrası örnek sayısı:", cleanSamples.length);
    }

    logger.log("[GazeModel] Feature vector boyutu:", rawInputs[0].length, "| Örnek sayısı:", rawInputs.length);

    // Normalizasyon parametreleri
    this.computeNormalization(rawInputs);

    // Polinom özellikleri (2. + 3. derece iris terimleri) ve normalize et
    const polyFeatures: number[][] = [];
    for (const input of rawInputs) {
      const normalized = input.map((val, i) => {
        const std = this.featureStds[i] || 1;
        return std === 0 ? 0 : (val - this.featureMeans[i]) / std;
      });
      polyFeatures.push(createPolynomialFeaturesWithCubic(normalized));
    }

    // Hedef değerler
    const targetsX = cleanSamples.map((s) => s.targetX);
    const targetsY = cleanSamples.map((s) => s.targetY);

    // Confidence-based sample weights
    const sampleWeights = cleanSamples.map((s) => {
      // Confidence^2 kullan: yüksek confidence örnekleri çok daha değerli
      const c = Math.max(0.1, s.features.confidence);
      return c * c;
    });

    // Cross-validation ile en iyi lambda seç
    const lambdaCandidates = [0.001, 0.004, 0.008, 0.02, 0.05, 0.1];
    let bestLambda = this.lambda;
    let bestCV = Infinity;
    // 5-fold cross-validation
    const foldSize = Math.floor(polyFeatures.length / 5);
    if (foldSize >= 10) {
      for (const lam of lambdaCandidates) {
        let totalErr = 0;
        let count = 0;
        for (let fold = 0; fold < 5; fold++) {
          const valStart = fold * foldSize;
          const valEnd = fold === 4 ? polyFeatures.length : (fold + 1) * foldSize;
          const trainPoly = [...polyFeatures.slice(0, valStart), ...polyFeatures.slice(valEnd)];
          const trainTX = [...targetsX.slice(0, valStart), ...targetsX.slice(valEnd)];
          const trainTY = [...targetsY.slice(0, valStart), ...targetsY.slice(valEnd)];
          const trainW = [...sampleWeights.slice(0, valStart), ...sampleWeights.slice(valEnd)];
          const wx = ridgeRegression(trainPoly, trainTX, lam, trainW);
          const wy = ridgeRegression(trainPoly, trainTY, lam, trainW);
          for (let i = valStart; i < valEnd; i++) {
            let px = 0, py = 0;
            for (let j = 0; j < polyFeatures[i].length; j++) {
              px += polyFeatures[i][j] * (wx[j] || 0);
              py += polyFeatures[i][j] * (wy[j] || 0);
            }
            totalErr += Math.sqrt((px - targetsX[i]) ** 2 + (py - targetsY[i]) ** 2);
            count++;
          }
        }
        const avgErr = totalErr / count;
        if (avgErr < bestCV) {
          bestCV = avgErr;
          bestLambda = lam;
        }
      }
      logger.log("[GazeModel] CV en iyi lambda:", bestLambda, "| CV hata:", bestCV.toFixed(1));
    }
    this.lambda = bestLambda;

    // Weighted Ridge regression ile ağırlıkları hesapla
    this.weightsX = ridgeRegression(polyFeatures, targetsX, this.lambda, sampleWeights);
    this.weightsY = ridgeRegression(polyFeatures, targetsY, this.lambda, sampleWeights);

    this.trained = true;

    // Yüksek residual atıp 1 kez yeniden eğit (ölçülü outlier temizliği)
    const residuals = cleanSamples.map((s, i) => {
      const pred = this.predictRaw(s.features);
      const err = pred
        ? Math.sqrt((pred.x - s.targetX) ** 2 + (pred.y - s.targetY) ** 2)
        : 9999;
      return { i, err };
    });
    residuals.sort((a, b) => b.err - a.err);
    // En kötü %12 örnekleri at (agresif atma model bias'ına yol açabilir)
    const dropCount = Math.min(Math.floor(cleanSamples.length * 0.12), Math.max(0, cleanSamples.length - 72));
    const dropSet = new Set(residuals.slice(0, dropCount).map((r) => r.i));
    if (dropCount > 0) {
      const cleanSamples2 = cleanSamples.filter((_, i) => !dropSet.has(i));
      const rawInputs2 = cleanSamples2.map((s) => this.featuresToInput(s.features));
      this.computeNormalization(rawInputs2);
      const polyFeatures2: number[][] = [];
      for (const input of rawInputs2) {
        const normalized = input.map((val, i) => {
          const std = this.featureStds[i] || 1;
          return std === 0 ? 0 : (val - this.featureMeans[i]) / std;
        });
        polyFeatures2.push(createPolynomialFeaturesWithCubic(normalized));
      }
      const targetsX2 = cleanSamples2.map((s) => s.targetX);
      const targetsY2 = cleanSamples2.map((s) => s.targetY);
      const sampleWeights2 = cleanSamples2.map((s) => {
        const c = Math.max(0.1, s.features.confidence);
        return c * c;
      });
      this.weightsX = ridgeRegression(polyFeatures2, targetsX2, this.lambda, sampleWeights2);
      this.weightsY = ridgeRegression(polyFeatures2, targetsY2, this.lambda, sampleWeights2);
      logger.log("[GazeModel] Yüksek residual ile", dropCount, "örnek atıldı, yeniden eğitildi.");
    }

    // Eğitim hatası hesapla (son model ile)
    const finalSamples = dropCount > 0 ? cleanSamples.filter((_, i) => !dropSet.has(i)) : cleanSamples;
    let totalError = 0;
    let maxError = 0;
    for (let i = 0; i < finalSamples.length; i++) {
      const pred = this.predictRaw(finalSamples[i].features);
      if (pred) {
        const dx = pred.x - finalSamples[i].targetX;
        const dy = pred.y - finalSamples[i].targetY;
        const error = Math.sqrt(dx * dx + dy * dy);
        totalError += error;
        maxError = Math.max(maxError, error);
      }
    }

    return {
      meanError: totalError / finalSamples.length,
      maxError,
    };
  }

  // Ham tahmin (smoothing yok)
  private predictRaw(features: EyeFeatures): { x: number; y: number } | null {
    if (!this.trained || !this.weightsX || !this.weightsY) return null;

    const input = this.featuresToInput(features);

    // NaN kontrolü
    if (input.some(v => isNaN(v) || !isFinite(v))) {
      return null;
    }

    const normalized = input.map((val, i) => {
      const std = this.featureStds[i] || 1;
      return std === 0 ? 0 : (val - this.featureMeans[i]) / std;
    });
    const poly = createPolynomialFeaturesWithCubic(normalized);

    let x = 0;
    let y = 0;
    for (let i = 0; i < poly.length; i++) {
      x += poly[i] * (this.weightsX[i] || 0);
      y += poly[i] * (this.weightsY[i] || 0);
    }

    // NaN sonuç kontrolü
    if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
      logger.warn("[GazeModel] NaN tahmin sonucu!");
      return null;
    }

    return { x, y };
  }

  /**
   * Göz özelliklerinden ekran koordinatı tahmin eder (filtre + drift düzeltmesi + outlier reddi).
   * @param features - Güncel EyeFeatures (iris, EAR, yaw, pitch, roll, vb.)
   * @returns GazePoint (x, y, timestamp, confidence) veya yetersiz veride null
   */
  predict(features: EyeFeatures): GazePoint | null {
    const raw = this.predictRaw(features);
    if (!raw) return null;

    const now = performance.now();

    // Drift correction uygula
    const correctedX = raw.x + this.driftOffsetX;
    const correctedY = raw.y + this.driftOffsetY;

    // Referans pozdan sapma büyükse confidence düşür (ekstrapolasyon güvensiz)
    let poseConfPenalty = 1.0;
    if (this.refPose) {
      const dYaw = Math.abs(features.yaw - this.refPose.yaw);
      const dPitch = Math.abs(features.pitch - this.refPose.pitch);
      if (dYaw > 0.15) poseConfPenalty *= Math.max(0.3, 1 - (dYaw - 0.15) * 2);
      if (dPitch > 0.12) poseConfPenalty *= Math.max(0.3, 1 - (dPitch - 0.12) * 2);
    }

    // Velocity-aware outlier rejection: sadece aşırı sıçramaları reddet (daha az sıkı, veri kaybı azalsın)
    if (this.predictionHistory.length >= 3) {
      const recent = this.predictionHistory.slice(-3);
      const lastPt = recent[recent.length - 1];
      const dt = now - lastPt.t;
      const dist = Math.sqrt((correctedX - lastPt.x) ** 2 + (correctedY - lastPt.y) ** 2);

      let avgVelocity = 0;
      for (let i = 1; i < recent.length; i++) {
        const d = Math.sqrt((recent[i].x - recent[i-1].x) ** 2 + (recent[i].y - recent[i-1].y) ** 2);
        const t = recent[i].t - recent[i-1].t;
        if (t > 0) avgVelocity += d / t;
      }
      avgVelocity /= Math.max(1, recent.length - 1);

      const screenMax = typeof window !== "undefined"
        ? Math.max(window.innerWidth, window.innerHeight)
        : 1920;
      // Daha gevşek eşik: daha az nokta reddedilsin, heatmap verisi toplanabilsin
      const baseThreshold = screenMax * 0.22;
      const velocityBonus = Math.min(avgVelocity * 120, screenMax * 0.2);
      const jumpThreshold = baseThreshold + velocityBonus;

      if (dist > jumpThreshold) {
        if (this.predictionHistory.length >= 2) {
          const prevDist = Math.sqrt(
            (lastPt.x - recent[recent.length - 2].x) ** 2 +
            (lastPt.y - recent[recent.length - 2].y) ** 2
          );
          if (prevDist > jumpThreshold * 0.6) {
            this.predictionHistory = [];
            this.filterX.reset();
            this.filterY.reset();
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
    }

    // One Euro Filter uygula
    const filteredX = this.filterX.filter(correctedX, now);
    const filteredY = this.filterY.filter(correctedY, now);

    // Geçmişe ekle
    this.predictionHistory.push({ x: filteredX, y: filteredY, t: now });
    if (this.predictionHistory.length > this.historyMaxSize) {
      this.predictionHistory.shift();
    }

    return {
      x: filteredX,
      y: filteredY,
      timestamp: now,
      confidence: features.confidence * poseConfPenalty,
    };
  }

  isTrained(): boolean {
    return this.trained;
  }

  /**
   * Drift correction uygula.
   * Bilinen bir ekran pozisyonuyla (trueX/Y) karşılaştırılarak
   * exponential moving average ile offset hesaplanır.
   */
  applyDriftCorrection(trueX: number, trueY: number, predictedX: number, predictedY: number): void {
    const alpha = 0.3; // Güncelleme hızı
    this.driftOffsetX = alpha * (trueX - predictedX) + (1 - alpha) * this.driftOffsetX;
    this.driftOffsetY = alpha * (trueY - predictedY) + (1 - alpha) * this.driftOffsetY;
  }

  // Filtreleri ve drift'i sıfırla
  resetSmoothing(): void {
    this.filterX.reset();
    this.filterY.reset();
    this.driftOffsetX = 0;
    this.driftOffsetY = 0;
    this.predictionHistory = [];
  }

  /** Doğrulama sonrası ortalama sapmayı (bias) uygula – tahminleri hedefe yaklaştırır */
  setInitialDriftOffset(meanBiasX: number, meanBiasY: number): void {
    this.driftOffsetX = meanBiasX;
    this.driftOffsetY = meanBiasY;
  }

  getDriftOffset(): { x: number; y: number } {
    return { x: this.driftOffsetX, y: this.driftOffsetY };
  }

  getRefPose(): { yaw: number; pitch: number; roll: number; faceScale: number } | null {
    return this.refPose;
  }

  exportModel(): string {
    return JSON.stringify({
      weightsX: this.weightsX,
      weightsY: this.weightsY,
      featureMeans: this.featureMeans,
      featureStds: this.featureStds,
      lambda: this.lambda,
      driftOffsetX: this.driftOffsetX,
      driftOffsetY: this.driftOffsetY,
      refPose: this.refPose,
    });
  }

  importModel(json: string): void {
    const data = JSON.parse(json);
    this.weightsX = data.weightsX;
    this.weightsY = data.weightsY;
    this.featureMeans = data.featureMeans ?? [];
    this.featureStds = data.featureStds ?? [];
    this.lambda = data.lambda ?? 0.1;
    this.driftOffsetX = data.driftOffsetX ?? 0;
    this.driftOffsetY = data.driftOffsetY ?? 0;
    this.refPose = data.refPose ?? null;
    this.trained = true;
  }
}
