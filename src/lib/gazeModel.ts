/**
 * Gaze Model - Polynomial Regression tabanlı göz takip modeli
 *
 * Input: [Lx, Ly, Rx, Ry, yaw, pitch, roll, scale]
 * Output: (x_image, y_image)
 *
 * 2. derece polinom regresyon kullanarak göz özelliklerinden
 * ekran koordinatlarına haritalama yapar.
 */

export interface EyeFeatures {
  leftIrisX: number;
  leftIrisY: number;
  rightIrisX: number;
  rightIrisY: number;
  pupilRadius: number;
  eyeOpenness: number;
  yaw: number;
  pitch: number;
  roll: number;
  faceScale: number;
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

// 2. derece polinom özellikleri oluştur
// [1, x1, x2, ..., x1^2, x1*x2, ..., x2^2, ...]
function createPolynomialFeatures(input: number[]): number[] {
  const features: number[] = [1]; // bias terimi

  // 1. derece terimler
  for (const val of input) {
    features.push(val);
  }

  // 2. derece terimler (çapraz ve kare)
  for (let i = 0; i < input.length; i++) {
    for (let j = i; j < input.length; j++) {
      features.push(input[i] * input[j]);
    }
  }

  return features;
}

// Özellik vektörünü normalize et
function normalizeFeatures(features: number[], means: number[], stds: number[]): number[] {
  return features.map((f, i) => {
    if (i === 0) return f; // bias terimini atla
    const std = stds[i] || 1;
    return std === 0 ? 0 : (f - means[i]) / std;
  });
}

// Ridge Regression ile ağırlık hesapla
// (X^T X + λI)^{-1} X^T y
function ridgeRegression(X: number[][], y: number[], lambda: number = 0.01): number[] {
  const n = X[0].length;
  const m = X.length;

  // X^T X hesapla
  const XtX: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < m; k++) {
        sum += X[k][i] * X[k][j];
      }
      XtX[i][j] = sum + (i === j ? lambda : 0); // Ridge regularization
    }
  }

  // X^T y hesapla
  const Xty: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < m; k++) {
      sum += X[k][i] * y[k];
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

// Outlier temizleme (IQR yöntemi)
function removeOutliers(samples: CalibrationSample[]): CalibrationSample[] {
  if (samples.length < 10) return samples;

  const errors: number[] = [];
  const meanX = samples.reduce((s, sp) => s + sp.features.leftIrisX, 0) / samples.length;
  const meanY = samples.reduce((s, sp) => s + sp.features.leftIrisY, 0) / samples.length;

  for (const sample of samples) {
    const dx = sample.features.leftIrisX - meanX;
    const dy = sample.features.leftIrisY - meanY;
    errors.push(Math.sqrt(dx * dx + dy * dy));
  }

  errors.sort((a, b) => a - b);
  const q1 = errors[Math.floor(errors.length * 0.25)];
  const q3 = errors[Math.floor(errors.length * 0.75)];
  const iqr = q3 - q1;
  const upperBound = q3 + 1.5 * iqr;

  return samples.filter((_, i) => errors[i] <= upperBound);
}

export class GazeModel {
  private weightsX: number[] | null = null;
  private weightsY: number[] | null = null;
  private featureMeans: number[] = [];
  private featureStds: number[] = [];
  private trained: boolean = false;
  private lambda: number = 0.01;

  // EMA smoothing parametreleri
  private smoothingAlpha: number = 0.3;
  private lastGaze: GazePoint | null = null;

  constructor(lambda: number = 0.01, smoothingAlpha: number = 0.3) {
    this.lambda = lambda;
    this.smoothingAlpha = smoothingAlpha;
  }

  // Eye features'dan input vektörü oluştur
  private featuresToInput(features: EyeFeatures): number[] {
    return [
      features.leftIrisX,
      features.leftIrisY,
      features.rightIrisX,
      features.rightIrisY,
      features.yaw,
      features.pitch,
      features.roll,
      features.faceScale,
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

  // Modeli eğit
  train(samples: CalibrationSample[]): { meanError: number; maxError: number } {
    // Outlier temizle
    const cleanSamples = removeOutliers(samples);

    if (cleanSamples.length < 9) {
      throw new Error("Yeterli kalibrasyon verisi yok (en az 9 örnek gerekli)");
    }

    // Ham input vektörleri
    const rawInputs = cleanSamples.map((s) => this.featuresToInput(s.features));

    // Normalizasyon parametreleri
    this.computeNormalization(rawInputs);

    // Polinom özellikleri oluştur ve normalize et
    const polyFeatures: number[][] = [];
    for (const input of rawInputs) {
      const normalized = input.map((val, i) => {
        const std = this.featureStds[i] || 1;
        return std === 0 ? 0 : (val - this.featureMeans[i]) / std;
      });
      polyFeatures.push(createPolynomialFeatures(normalized));
    }

    // Hedef değerler
    const targetsX = cleanSamples.map((s) => s.targetX);
    const targetsY = cleanSamples.map((s) => s.targetY);

    // Ridge regression ile ağırlıkları hesapla
    this.weightsX = ridgeRegression(polyFeatures, targetsX, this.lambda);
    this.weightsY = ridgeRegression(polyFeatures, targetsY, this.lambda);

    this.trained = true;

    // Eğitim hatası hesapla
    let totalError = 0;
    let maxError = 0;

    for (let i = 0; i < cleanSamples.length; i++) {
      const pred = this.predictRaw(cleanSamples[i].features);
      if (pred) {
        const dx = pred.x - targetsX[i];
        const dy = pred.y - targetsY[i];
        const error = Math.sqrt(dx * dx + dy * dy);
        totalError += error;
        maxError = Math.max(maxError, error);
      }
    }

    return {
      meanError: totalError / cleanSamples.length,
      maxError,
    };
  }

  // Ham tahmin (smoothing yok)
  private predictRaw(features: EyeFeatures): { x: number; y: number } | null {
    if (!this.trained || !this.weightsX || !this.weightsY) return null;

    const input = this.featuresToInput(features);
    const normalized = input.map((val, i) => {
      const std = this.featureStds[i] || 1;
      return std === 0 ? 0 : (val - this.featureMeans[i]) / std;
    });
    const poly = createPolynomialFeatures(normalized);

    let x = 0;
    let y = 0;
    for (let i = 0; i < poly.length; i++) {
      x += poly[i] * (this.weightsX[i] || 0);
      y += poly[i] * (this.weightsY[i] || 0);
    }

    return { x, y };
  }

  // EMA smoothing ile tahmin
  predict(features: EyeFeatures): GazePoint | null {
    const raw = this.predictRaw(features);
    if (!raw) return null;

    const now = performance.now();

    if (this.lastGaze) {
      raw.x = this.smoothingAlpha * raw.x + (1 - this.smoothingAlpha) * this.lastGaze.x;
      raw.y = this.smoothingAlpha * raw.y + (1 - this.smoothingAlpha) * this.lastGaze.y;
    }

    const gazePoint: GazePoint = {
      x: raw.x,
      y: raw.y,
      timestamp: now,
      confidence: features.confidence,
    };

    this.lastGaze = gazePoint;
    return gazePoint;
  }

  // Smoothing parametresini ayarla
  setSmoothingAlpha(alpha: number): void {
    this.smoothingAlpha = Math.max(0.1, Math.min(1.0, alpha));
  }

  // Model eğitilmiş mi?
  isTrained(): boolean {
    return this.trained;
  }

  // Son gaze'i sıfırla (drift correction sonrası)
  resetSmoothing(): void {
    this.lastGaze = null;
  }

  // Model verisini JSON olarak dışa aktar
  exportModel(): string {
    return JSON.stringify({
      weightsX: this.weightsX,
      weightsY: this.weightsY,
      featureMeans: this.featureMeans,
      featureStds: this.featureStds,
      lambda: this.lambda,
      smoothingAlpha: this.smoothingAlpha,
    });
  }

  // Model verisini JSON'dan içe aktar
  importModel(json: string): void {
    const data = JSON.parse(json);
    this.weightsX = data.weightsX;
    this.weightsY = data.weightsY;
    this.featureMeans = data.featureMeans;
    this.featureStds = data.featureStds;
    this.lambda = data.lambda;
    this.smoothingAlpha = data.smoothingAlpha;
    this.trained = true;
  }
}
