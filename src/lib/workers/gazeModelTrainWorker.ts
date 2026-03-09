/**
 * Gaze Model Training Web Worker
 *
 * Ridge regresyon + LOGO cross-validation hesaplarını ana thread'den ayırır.
 * Training 200-500ms sürebilir, bu sürede UI donar — worker ile çözülür.
 *
 * Not: Bu worker, gazeModel.ts'deki saf matematik fonksiyonlarını inline olarak içerir.
 * Modül import yapamadığı için fonksiyonlar burada kopyalanmıştır.
 */

export interface TrainWorkerInput {
  type: "train";
  rawInputs: number[][];
  targetsX: number[];
  targetsY: number[];
  sampleWeights: number[];
  featureMeans: number[];
  featureStds: number[];
  lambdaCandidates: number[];
  defaultLambda: number;
  groupKeys: string[];
  groupIndices: Record<string, number[]>;
}

export interface TrainWorkerOutput {
  type: "trained";
  weightsX: number[];
  weightsY: number[];
  bestLambda: number;
  cvError: number;
}

export function gazeModelTrainWorkerFn() {
  // --- Inline math functions (copied from gazeModel.ts) ---

  function createSelectivePolynomialFeatures(input: number[]): number[] {
    const features: number[] = [1];
    for (const val of input) features.push(val);

    const irisEnd = Math.min(5, input.length - 1);
    for (let i = 0; i <= irisEnd; i++) {
      for (let j = i; j <= irisEnd; j++) {
        features.push(input[i] * input[j]);
      }
    }

    const poseStart = 8;
    const poseEnd = Math.min(11, input.length - 1);
    for (let i = 0; i <= irisEnd; i++) {
      for (let j = poseStart; j <= poseEnd; j++) {
        features.push(input[i] * input[j]);
      }
    }

    for (let i = poseStart; i <= poseEnd; i++) {
      for (let j = i; j <= poseEnd; j++) {
        features.push(input[i] * input[j]);
      }
    }

    const cubicEnd = Math.min(5, input.length - 1);
    for (let i = 0; i <= cubicEnd; i++) {
      features.push(input[i] * input[i] * input[i]);
    }

    return features;
  }

  function solveLinearSystem(A: number[][], b: number[]): number[] {
    const n = A.length;
    const augmented: number[][] = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
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

  function ridgeRegression(
    X: number[][],
    y: number[],
    lambda: number,
    weights?: number[]
  ): number[] {
    const n = X[0].length;
    const m = X.length;

    const XtX: number[][] = Array.from({ length: n }, () =>
      new Array(n).fill(0)
    );
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < m; k++) {
          const w = weights ? weights[k] : 1;
          sum += w * X[k][i] * X[k][j];
        }
        XtX[i][j] = sum + (i === j ? lambda : 0);
      }
    }

    const Xty: number[] = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < m; k++) {
        const w = weights ? weights[k] : 1;
        sum += w * X[k][i] * y[k];
      }
      Xty[i] = sum;
    }

    return solveLinearSystem(XtX, Xty);
  }

  // --- Worker message handler ---

  self.onmessage = (e: MessageEvent) => {
    const msg = e.data as TrainWorkerInput;
    if (msg.type !== "train") return;

    const {
      rawInputs,
      targetsX,
      targetsY,
      sampleWeights,
      featureMeans,
      featureStds,
      lambdaCandidates,
      defaultLambda,
      groupKeys,
      groupIndices,
    } = msg;

    // Normalize + soft tanh clipping + polynomial feature generation
    // KRİTİK: predictRaw ile AYNI clipping uygulanmalı (training/inference tutarlılığı)
    const softTanhClip = (z: number): number => {
      if (Math.abs(z) <= 2.5) return z;
      const sign = z > 0 ? 1 : -1;
      return sign * (2.5 + Math.tanh(z - sign * 2.5));
    };
    const polyFeatures: number[][] = [];
    for (const input of rawInputs) {
      const normalized = input.map((val, i) => {
        const std = featureStds[i] || 1;
        const z = std === 0 ? 0 : (val - featureMeans[i]) / std;
        return softTanhClip(z);
      });
      polyFeatures.push(createSelectivePolynomialFeatures(normalized));
    }

    // LOGO Cross-Validation
    let bestLambda = defaultLambda;
    let bestCV = Infinity;

    if (groupKeys.length >= 5) {
      for (const lam of lambdaCandidates) {
        let totalErr = 0;
        let count = 0;
        for (const holdoutKey of groupKeys) {
          const holdoutIndices = new Set(groupIndices[holdoutKey]);
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
            let px = 0,
              py = 0;
            for (let j = 0; j < polyFeatures[idx].length; j++) {
              px += polyFeatures[idx][j] * (wx[j] || 0);
              py += polyFeatures[idx][j] * (wy[j] || 0);
            }
            totalErr += Math.sqrt(
              (px - targetsX[idx]) ** 2 + (py - targetsY[idx]) ** 2
            );
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
    }

    // Final training with best lambda
    const weightsX = ridgeRegression(
      polyFeatures,
      targetsX,
      bestLambda,
      sampleWeights
    );
    const weightsY = ridgeRegression(
      polyFeatures,
      targetsY,
      bestLambda,
      sampleWeights
    );

    (self as any).postMessage({
      type: "trained",
      weightsX,
      weightsY,
      bestLambda,
      cvError: bestCV,
    });
  };
}
