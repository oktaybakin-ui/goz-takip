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
import { KalmanFilter2D } from "./kalmanFilter";
import { AdvancedIrisDetector } from "./advancedIrisDetection";

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

/**
 * Seçici polinom özellik üreteci — 237 yerine ~80 özellik.
 * Yalnızca anlamlı çapraz terimler üretilir:
 *   - İris grubu (idx 0-5): tam kuadratik → 21 çapraz terim
 *   - İris × Poz (idx 0-5 × 8-11): 24 çapraz terim (baş hareketi kompanzasyonu)
 *   - Poz kendi içi (idx 8-11): 10 çapraz terim
 *   - Kübik: ilk 4 iris özelliği (avgRelX/Y, leftIrisRelX/Y) → 4 terim
 *   - Geri kalan: sadece lineer
 * Toplam: 1 + 20 + 21 + 24 + 10 + 4 = 80
 */
function createSelectivePolynomialFeatures(input: number[]): number[] {
  const features: number[] = [1];

  for (const val of input) features.push(val);

  // Iris grubu kuadratik (avgRelX/Y, L/R irisRelX/Y) → idx 0-5
  const irisEnd = Math.min(5, input.length - 1);
  for (let i = 0; i <= irisEnd; i++) {
    for (let j = i; j <= irisEnd; j++) {
      features.push(input[i] * input[j]);
    }
  }

  // Iris × Pose çapraz (idx 0-5 × 8-11)
  const poseStart = 8;
  const poseEnd = Math.min(11, input.length - 1);
  for (let i = 0; i <= irisEnd; i++) {
    for (let j = poseStart; j <= poseEnd; j++) {
      features.push(input[i] * input[j]);
    }
  }

  // Pose kendi kuadratiği (idx 8-11)
  for (let i = poseStart; i <= poseEnd; i++) {
    for (let j = i; j <= poseEnd; j++) {
      features.push(input[i] * input[j]);
    }
  }

  // Kübik: avgRelX/Y, leftIrisRelX/Y, rightIrisRelX/Y (her iki göz için)
  const cubicEnd = Math.min(5, input.length - 1);
  for (let i = 0; i <= cubicEnd; i++) {
    features.push(input[i] * input[i] * input[i]);
  }

  return features;
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

    // Medyan tabanlı merkez hesabı (outlier'a dayanıklı — mean yerine median)
    const sortedLx = [...groupSamples].sort((a, b) => a.features.leftIrisRelX - b.features.leftIrisRelX);
    const sortedLy = [...groupSamples].sort((a, b) => a.features.leftIrisRelY - b.features.leftIrisRelY);
    const sortedRx = [...groupSamples].sort((a, b) => a.features.rightIrisRelX - b.features.rightIrisRelX);
    const sortedRy = [...groupSamples].sort((a, b) => a.features.rightIrisRelY - b.features.rightIrisRelY);
    const mid = Math.floor(groupSamples.length / 2);
    const medLx = sortedLx[mid].features.leftIrisRelX;
    const medLy = sortedLy[mid].features.leftIrisRelY;
    const medRx = sortedRx[mid].features.rightIrisRelX;
    const medRy = sortedRy[mid].features.rightIrisRelY;

    // Her örneğin medyandan uzaklığı
    const distances = groupSamples.map((sp) => {
      const dlx = sp.features.leftIrisRelX - medLx;
      const dly = sp.features.leftIrisRelY - medLy;
      const drx = sp.features.rightIrisRelX - medRx;
      const dry = sp.features.rightIrisRelY - medRy;
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
  
  // Hareket hızına göre parametreleri dinamik ayarla
  setDynamicParams(velocity: number): void {
    // Hız arttıkça minCutoff artır (daha az smoothing)
    // Sabitken (velocity < 50px/s) daha fazla smoothing
    const speedFactor = Math.min(velocity / 500, 1.0);
    this.minCutoff = 1.0 + speedFactor * 3.0; // 1.0 - 4.0 arası
    this.beta = 0.007 + speedFactor * 0.05; // 0.007 - 0.057 arası
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

  // Affine correction (6 parametre: ölçek, döndürme, kayma, öteleme — sadece ötelemeden çok daha doğru)
  private affineCorrection: {
    a11: number; a12: number; tx: number;
    a21: number; a22: number; ty: number;
  } | null = null;

  // Basit drift fallback (affine yoksa)
  private driftOffsetX: number = 0;
  private driftOffsetY: number = 0;

  // Referans baş pozu (kalibrasyon sırasındaki ortalama)
  private refPose: { yaw: number; pitch: number; roll: number; faceScale: number } | null = null;

  // Tahmin geçmişi (outlier rejection)
  private predictionHistory: { x: number; y: number; t: number }[] = [];
  private readonly historyMaxSize: number = 11;
  
  // Kalman filter for additional smoothing
  private kalmanFilter: KalmanFilter2D | null = null;
  private useKalmanFilter: boolean = true;

  constructor(lambda: number = 0.008, useKalman: boolean = false) {
    this.lambda = lambda;
    this.useKalmanFilter = useKalman;
    if (useKalman) {
      this.kalmanFilter = new KalmanFilter2D(0.1, 5.0);
    }
    // Tek filtre katmanı (landmark filtreleri kaldırıldı)
    // Daha yüksek minCutoff: hızlı saccade'lere daha duyarlı
    // Daha yüksek beta: hız artınca cutoff hızla yükselir → gecikme azalır
    this.filterX = new OneEuroFilter(2.0, 0.07, 1.0);
    this.filterY = new OneEuroFilter(1.7, 0.06, 1.0);
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

    if (cleanSamples.length < 80) {
      throw new Error("Yeterli kalibrasyon verisi yok (en az 80 örnek gerekli – tüm noktaları tamamlayın)");
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
      if (validIndices.length < 70) {
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
      polyFeatures.push(createSelectivePolynomialFeatures(normalized));
    }

    // Hedef değerler
    const targetsX = cleanSamples.map((s) => s.targetX);
    const targetsY = cleanSamples.map((s) => s.targetY);

    // Ekran merkezi ve köşegen (spatial weighting + residual cleanup için)
    const screenCenterX = targetsX.reduce((s, v) => s + v, 0) / targetsX.length;
    const screenCenterY = targetsY.reduce((s, v) => s + v, 0) / targetsY.length;
    const screenDiag = Math.sqrt(
      Math.max(...targetsX.map(x => (x - screenCenterX) ** 2)) +
      Math.max(...targetsY.map(y => (y - screenCenterY) ** 2))
    ) || 1;

    // Spatial + confidence weighting: kenar/köşe örnekleri daha yüksek ağırlık alır
    // Bu sayede model kenar bölgelerini daha iyi öğrenir (kalite artışı, ek süre yok)
    const sampleWeights = cleanSamples.map((s) => {
      const confWeight = Math.max(0.15, s.features.confidence);
      const dist = Math.sqrt(
        (s.targetX - screenCenterX) ** 2 + (s.targetY - screenCenterY) ** 2
      );
      const spatialWeight = 1 + 0.6 * (dist / screenDiag);
      return confWeight * spatialWeight;
    });

    // Leave-one-group-out CV ile en iyi lambda seç
    // Rastgele fold yerine kalibrasyon noktası bazlı fold → veri sızması yok, daha güvenilir
    const lambdaCandidates = [0.0005, 0.001, 0.002, 0.004, 0.008, 0.015, 0.02, 0.05, 0.1];
    let bestLambda = this.lambda;
    let bestCV = Infinity;

    // Örnekleri hedef noktalarına göre grupla
    const pointGroups = new Map<string, number[]>();
    for (let i = 0; i < cleanSamples.length; i++) {
      const key = `${cleanSamples[i].targetX.toFixed(0)}_${cleanSamples[i].targetY.toFixed(0)}`;
      if (!pointGroups.has(key)) pointGroups.set(key, []);
      pointGroups.get(key)!.push(i);
    }
    const groupKeys = Array.from(pointGroups.keys());

    if (groupKeys.length >= 5) {
      for (const lam of lambdaCandidates) {
        let totalErr = 0;
        let count = 0;
        for (const holdoutKey of groupKeys) {
          const holdoutIndices = new Set(pointGroups.get(holdoutKey)!);
          const trainPoly: number[][] = [];
          const trainTX: number[] = [];
          const trainTY: number[] = [];
          const trainW: number[] = [];
          for (let i = 0; i < polyFeatures.length; i++) {
            if (!holdoutIndices.has(i)) {
              trainPoly.push(polyFeatures[i]);
              trainTX.push(targetsX[i]);
              trainTY.push(targetsY[i]);
              trainW.push(sampleWeights[i]);
            }
          }
          if (trainPoly.length < 40) continue;
          const wx = ridgeRegression(trainPoly, trainTX, lam, trainW);
          const wy = ridgeRegression(trainPoly, trainTY, lam, trainW);
          for (const idx of Array.from(holdoutIndices)) {
            let px = 0, py = 0;
            for (let j = 0; j < polyFeatures[idx].length; j++) {
              px += polyFeatures[idx][j] * (wx[j] || 0);
              py += polyFeatures[idx][j] * (wy[j] || 0);
            }
            totalErr += Math.sqrt((px - targetsX[idx]) ** 2 + (py - targetsY[idx]) ** 2);
            count++;
          }
        }
        if (count === 0) continue;
        const avgErr = totalErr / count;
        if (avgErr < bestCV) {
          bestCV = avgErr;
          bestLambda = lam;
        }
      }
      logger.log("[GazeModel] LOGO-CV en iyi lambda:", bestLambda, "| CV hata:", bestCV.toFixed(1));
    }
    this.lambda = bestLambda;

    // Weighted Ridge regression ile ağırlıkları hesapla
    this.weightsX = ridgeRegression(polyFeatures, targetsX, this.lambda, sampleWeights);
    this.weightsY = ridgeRegression(polyFeatures, targetsY, this.lambda, sampleWeights);

    this.trained = true;

    // Pozisyon-normalizeli residual hesabı: kenar noktalar doğal olarak daha yüksek
    // hataya sahip, bu yüzden onları orantısız atmamak için normalize ediyoruz
    const residuals = cleanSamples.map((s, i) => {
      const pred = this.predictRaw(s.features);
      const rawErr = pred
        ? Math.sqrt((pred.x - s.targetX) ** 2 + (pred.y - s.targetY) ** 2)
        : 9999;
      // Kenar noktalar için tolerans artır (merkezden uzaklığa orantılı)
      const distFromCenter = Math.sqrt(
        (s.targetX - screenCenterX) ** 2 + (s.targetY - screenCenterY) ** 2
      );
      const edgeFactor = 1 + 0.5 * (distFromCenter / screenDiag);
      return { i, err: rawErr / edgeFactor };
    });
    residuals.sort((a, b) => b.err - a.err);
    const dropCount = Math.min(Math.floor(cleanSamples.length * 0.12), Math.max(0, cleanSamples.length - 80));
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
        polyFeatures2.push(createSelectivePolynomialFeatures(normalized));
      }
      const targetsX2 = cleanSamples2.map((s) => s.targetX);
      const targetsY2 = cleanSamples2.map((s) => s.targetY);
      // Retrain'de de spatial weighting koru (kenar doğruluğu korunsun)
      const screenCenterX2 = targetsX2.reduce((s, v) => s + v, 0) / targetsX2.length;
      const screenCenterY2 = targetsY2.reduce((s, v) => s + v, 0) / targetsY2.length;
      const screenDiag2 = Math.sqrt(
        Math.max(...targetsX2.map(x => (x - screenCenterX2) ** 2)) +
        Math.max(...targetsY2.map(y => (y - screenCenterY2) ** 2))
      ) || 1;
      const sampleWeights2 = cleanSamples2.map((s) => {
        const confWeight = Math.max(0.15, s.features.confidence);
        const dist = Math.sqrt(
          (s.targetX - screenCenterX2) ** 2 + (s.targetY - screenCenterY2) ** 2
        );
        const spatialWeight = 1 + 0.6 * (dist / screenDiag2);
        return confWeight * spatialWeight;
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
    const poly = createSelectivePolynomialFeatures(normalized);

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
    // Blink detection: EAR çok düşükse göz kapalı
    const avgEAR = (features.leftEAR + features.rightEAR) / 2;
    if (avgEAR < 0.18) {
      // Göz kapalı, takip yapma
      return null;
    }
    
    // Confidence çok düşükse atla
    if (features.confidence < 0.3) {
      return null;
    }
    
    const raw = this.predictRaw(features);
    if (!raw) return null;

    const now = performance.now();

    // Hız hesapla (adaptive smoothing için)
    let velocity = 0;
    if (this.predictionHistory.length > 0) {
      const last = this.predictionHistory[this.predictionHistory.length - 1];
      const dx = raw.x - last.x;
      const dy = raw.y - last.y;
      const dt = (now - last.t) / 1000; // saniye
      if (dt > 0) {
        velocity = Math.sqrt(dx * dx + dy * dy) / dt; // px/s
      }
    }
    
    // Hareket hızına göre filter parametrelerini ayarla
    this.filterX.setDynamicParams(velocity);
    this.filterY.setDynamicParams(velocity);

    // Affine veya drift correction uygula
    let correctedX: number;
    let correctedY: number;
    if (this.affineCorrection) {
      const { a11, a12, tx, a21, a22, ty } = this.affineCorrection;
      correctedX = a11 * raw.x + a12 * raw.y + tx;
      correctedY = a21 * raw.x + a22 * raw.y + ty;
    } else {
      correctedX = raw.x + this.driftOffsetX;
      correctedY = raw.y + this.driftOffsetY;
    }

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
    
    // Kalman filter (opsiyonel ekstra smoothing)
    let finalX = filteredX;
    let finalY = filteredY;
    
    if (this.useKalmanFilter && this.kalmanFilter) {
      const kalmanResult = this.kalmanFilter.filter(filteredX, filteredY, now);
      finalX = kalmanResult.x;
      finalY = kalmanResult.y;
      
      // Update One Euro filter parameters based on Kalman velocity
      const kalmanVelocity = Math.sqrt(kalmanResult.vx ** 2 + kalmanResult.vy ** 2);
      this.filterX.setDynamicParams(kalmanVelocity);
      this.filterY.setDynamicParams(kalmanVelocity);
    }

    // Geçmişe ekle
    this.predictionHistory.push({ x: finalX, y: finalY, t: now });
    if (this.predictionHistory.length > this.historyMaxSize) {
      this.predictionHistory.shift();
    }

    return {
      x: finalX,
      y: finalY,
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

  resetSmoothing(): void {
    this.filterX.reset();
    this.filterY.reset();
    this.driftOffsetX = 0;
    this.driftOffsetY = 0;
    this.affineCorrection = null;
    this.predictionHistory = [];
    if (this.kalmanFilter) {
      this.kalmanFilter.reset();
    }
  }
  
  /**
   * Get/set model weights for ensemble or auto-recalibration
   */
  getWeights(): { weightsX: number[] | null; weightsY: number[] | null } {
    return {
      weightsX: this.weightsX,
      weightsY: this.weightsY
    };
  }
  
  setWeights(weights: { weightsX: number[]; weightsY: number[] }): void {
    this.weightsX = weights.weightsX;
    this.weightsY = weights.weightsY;
    this.trained = true;
  }

  /** Doğrulama sonrası ortalama sapmayı (bias) uygula – tahminleri hedefe yaklaştırır */
  setInitialDriftOffset(meanBiasX: number, meanBiasY: number): void {
    this.driftOffsetX = meanBiasX;
    this.driftOffsetY = meanBiasY;
  }

  /**
   * Doğrulama noktalarından afin düzeltme hesapla (6 parametre).
   * Sadece ötelemeye kıyasla döndürme ve ölçek hatalarını da düzeltir.
   * En az 3 nokta gerekir; 5+ ile en iyi sonuç verir.
   */
  setAffineCorrection(
    points: { predX: number; predY: number; trueX: number; trueY: number }[]
  ): void {
    if (points.length < 3) {
      const bx = points.reduce((s, p) => s + (p.trueX - p.predX), 0) / points.length;
      const by = points.reduce((s, p) => s + (p.trueY - p.predY), 0) / points.length;
      this.setInitialDriftOffset(bx, by);
      return;
    }

    // Least-squares: [trueX] = [predX predY 1] * [a11 a12 tx]^T  (ayrı ayrı X ve Y)
    const n = points.length;
    const A: number[][] = points.map(p => [p.predX, p.predY, 1]);
    const bx = points.map(p => p.trueX);
    const by = points.map(p => p.trueY);

    // Normal denklemler: (A^T A) w = A^T b
    const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const AtBx = [0, 0, 0];
    const AtBy = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          AtA[r][c] += A[i][r] * A[i][c];
        }
        AtBx[r] += A[i][r] * bx[i];
        AtBy[r] += A[i][r] * by[i];
      }
    }

    // Küçük regularization (sayısal kararlılık)
    for (let i = 0; i < 3; i++) AtA[i][i] += 1e-6;

    const wx = solveLinearSystem(AtA, AtBx);
    const wy = solveLinearSystem(AtA, AtBy);

    // Sanity check: afin dönüşüm makul mi? (aşırı ölçek/döndürme yok)
    const scaleX = Math.sqrt(wx[0] * wx[0] + wx[1] * wx[1]);
    const scaleY = Math.sqrt(wy[0] * wy[0] + wy[1] * wy[1]);
    if (scaleX < 0.5 || scaleX > 2 || scaleY < 0.5 || scaleY > 2) {
      logger.warn("[GazeModel] Afin düzeltme aşırı ölçek tespit etti, sadece ötelemeye düşülüyor");
      const mbx = points.reduce((s, p) => s + (p.trueX - p.predX), 0) / n;
      const mby = points.reduce((s, p) => s + (p.trueY - p.predY), 0) / n;
      this.setInitialDriftOffset(mbx, mby);
      return;
    }

    this.affineCorrection = {
      a11: wx[0], a12: wx[1], tx: wx[2],
      a21: wy[0], a22: wy[1], ty: wy[2],
    };
    this.driftOffsetX = 0;
    this.driftOffsetY = 0;
    logger.log("[GazeModel] Afin düzeltme uygulandı:", this.affineCorrection);
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
      affineCorrection: this.affineCorrection,
    });
  }

  importModel(json: string): void {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.weightsX) || !Array.isArray(data.weightsY)) {
        throw new Error("Invalid model data: missing weightsX/weightsY arrays");
      }
      this.weightsX = data.weightsX;
      this.weightsY = data.weightsY;
      this.featureMeans = data.featureMeans ?? [];
      this.featureStds = data.featureStds ?? [];
      this.lambda = data.lambda ?? 0.1;
      this.driftOffsetX = data.driftOffsetX ?? 0;
      this.driftOffsetY = data.driftOffsetY ?? 0;
      this.refPose = data.refPose ?? null;
      this.affineCorrection = data.affineCorrection ?? null;
      this.trained = true;
    } catch (err) {
      this.trained = false;
      throw new Error("Failed to import gaze model: " + (err instanceof Error ? err.message : String(err)));
    }
  }
}
