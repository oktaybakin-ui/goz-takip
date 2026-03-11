/**
 * Multi-Model Ensemble for robust eye tracking
 * Trains multiple models with different configurations and combines predictions.
 *
 * KRİTİK DÜZELTME: Her model artık kendi One Euro Filter'ini çalıştırmıyor.
 * Raw prediction (affine/drift corrected) ortalaması alınıp EyeTracker'da
 * TEK One Euro Filter uygulanıyor. Bu sayede saccade gecikmesi ve faz kayması
 * ortadan kaldırıldı.
 */

import { GazeModel, EyeFeatures } from './gazeModel';
import { CalibrationSample } from './gazeModel';
import { logger } from './logger';

export interface EnsembleConfig {
  numModels: number;
  modelConfigs: Array<{
    lambda: number;
    featureSubset?: number[]; // Which features to use
    sampleWeight?: 'uniform' | 'confidence' | 'temporal';
  }>;
}

export class MultiModelEnsemble {
  private models: GazeModel[] = [];
  private modelWeights: number[] = [];
  private config: EnsembleConfig;
  private lastPrediction: { hash: string; result: { x: number; y: number; confidence: number; timestamp: number }; timestamp: number } | null = null;

  constructor(config?: Partial<EnsembleConfig>) {
    this.config = {
      numModels: 3,
      modelConfigs: [
        { lambda: 0.001, sampleWeight: 'uniform' },     // Low regularization
        { lambda: 0.008, sampleWeight: 'confidence' },  // Medium regularization
        { lambda: 0.02, sampleWeight: 'temporal' }      // High regularization
      ],
      ...config
    };

    this.initializeModels();
  }

  private initializeModels(): void {
    // lockLambda: true → LOGO-CV lambda araması atlanır, her model kendi lambda'sını korur.
    // Bu sayede ensemble çeşitliliği sağlanır (düşük/orta/yüksek regularization).
    this.models = this.config.modelConfigs.map(config =>
      new GazeModel(config.lambda, true)
    );
    this.modelWeights = new Array(this.models.length).fill(1 / this.models.length);
  }

  /**
   * Train all models in the ensemble
   */
  train(samples: CalibrationSample[]): void {
    if (samples.length < 50) {
      logger.warn('[Ensemble] Insufficient samples for ensemble training');
      // Fall back to single model
      this.models[0].train(samples);
      this.modelWeights = [1, 0, 0];
      return;
    }

    // Train each model with different strategies
    this.config.modelConfigs.forEach((config, i) => {
      const model = this.models[i];
      let trainSamples = [...samples];

      // Apply different sampling strategies
      if (config.sampleWeight === 'confidence') {
        // Oversample high-confidence samples
        trainSamples = this.oversampleByConfidence(samples);
      } else if (config.sampleWeight === 'temporal') {
        // Give more weight to recent samples
        trainSamples = this.weightByTime(samples);
      }

      // Noise'u feature'lara ekle (target'a değil — target'a noise eklemek modeli bozar)
      if (i > 0) {
        trainSamples = this.addNoiseToFeatures(trainSamples, 0.003 * i);
      }

      model.train(trainSamples);
    });

    // Initial equal weights
    this.modelWeights = new Array(this.models.length).fill(1 / this.models.length);
  }

  /**
   * Async train — her model arasında UI thread'e kontrol verir (donma önler)
   */
  async trainAsync(samples: CalibrationSample[]): Promise<void> {
    if (samples.length < 50) {
      logger.warn('[Ensemble] Insufficient samples for ensemble training');
      try { await this.models[0].trainAsync(samples); } catch { this.models[0].train(samples); }
      this.modelWeights = [1, 0, 0];
      return;
    }

    for (let i = 0; i < this.config.modelConfigs.length; i++) {
      const config = this.config.modelConfigs[i];
      const model = this.models[i];
      let trainSamples = [...samples];

      if (config.sampleWeight === 'confidence') {
        trainSamples = this.oversampleByConfidence(samples);
      } else if (config.sampleWeight === 'temporal') {
        trainSamples = this.weightByTime(samples);
      }

      if (i > 0) {
        trainSamples = this.addNoiseToFeatures(trainSamples, 0.003 * i);
      }

      try {
        await model.trainAsync(trainSamples);
      } catch {
        model.train(trainSamples);
      }

      // UI thread'e kontrol ver
      await new Promise(r => setTimeout(r, 0));
    }

    this.modelWeights = new Array(this.models.length).fill(1 / this.models.length);
  }

  /**
   * Get ensemble prediction — RAW corrected predictions ortalaması (filter YOK).
   * Her model kendi One Euro Filter'ini çalıştırmıyor, böylece saccade gecikmesi
   * ve faz kayması ortadan kaldırılıyor.
   */
  predict(features: EyeFeatures): { x: number; y: number; confidence: number; timestamp: number } | null {
    // Simple feature hash for caching
    const featureHash = this.hashFeatures(features);
    const now = Date.now();

    // Check cache (valid for 16ms)
    if (this.lastPrediction &&
        this.lastPrediction.hash === featureHash &&
        now - this.lastPrediction.timestamp < 16) {
      return this.lastPrediction.result;
    }

    // predictRawCorrected kullan (filter yok, affine/drift var)
    const predictions = this.models.map((model, i) => ({
      pred: model.predictRawCorrected(features),
      weight: this.modelWeights[i]
    })).filter(p => p.pred !== null);

    if (predictions.length === 0) return null;

    // Weighted average of RAW corrected predictions
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let minConfidence = 1;

    predictions.forEach(({ pred, weight }) => {
      if (pred) {
        weightedX += pred.x * weight;
        weightedY += pred.y * weight;
        totalWeight += weight;
        minConfidence = Math.min(minConfidence, pred.confidence);
      }
    });

    if (totalWeight === 0) return null;

    // Calculate prediction variance for confidence
    const avgX = weightedX / totalWeight;
    const avgY = weightedY / totalWeight;

    let variance = 0;
    predictions.forEach(({ pred, weight }) => {
      if (pred) {
        const dx = pred.x - avgX;
        const dy = pred.y - avgY;
        variance += (dx * dx + dy * dy) * weight;
      }
    });
    variance /= totalWeight;

    // Higher variance = lower confidence
    const ensembleConfidence = minConfidence * Math.exp(-variance / 1000);

    const result = {
      x: avgX,
      y: avgY,
      confidence: ensembleConfidence,
      timestamp: now
    };

    // Cache the result
    this.lastPrediction = {
      hash: featureHash,
      result,
      timestamp: now
    };

    return result;
  }

  /**
   * Update model weights based on validation performance
   */
  updateWeights(validationSamples: CalibrationSample[]): void {
    if (validationSamples.length < 3) return;

    const errors = this.models.map(model => {
      let totalError = 0;
      let count = 0;

      validationSamples.forEach(sample => {
        const pred = model.predictRawCorrected(sample.features);
        if (pred) {
          const dx = pred.x - sample.targetX;
          const dy = pred.y - sample.targetY;
          totalError += Math.sqrt(dx * dx + dy * dy);
          count++;
        }
      });

      return count > 0 ? totalError / count : Infinity;
    });

    // Convert errors to weights (lower error = higher weight)
    const minError = Math.min(...errors);
    const weights = errors.map(e => Math.exp(-(e - minError) / 50));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    this.modelWeights = weights.map(w => w / totalWeight);
    logger.log('[Ensemble] Updated weights:', this.modelWeights.map(w => w.toFixed(3)), 'errors:', errors.map(e => e.toFixed(1)));
  }

  private oversampleByConfidence(samples: CalibrationSample[]): CalibrationSample[] {
    const highConfidenceSamples = samples.filter(s => s.features.confidence > 0.8);
    const augmented = [...samples];

    // Add high confidence samples twice more
    highConfidenceSamples.forEach(s => {
      augmented.push(s, s);
    });

    return this.shuffleArray(augmented);
  }

  private weightByTime(samples: CalibrationSample[]): CalibrationSample[] {
    // Duplicate recent samples
    const recentThreshold = samples.length * 0.7;
    const augmented = [...samples];

    samples.slice(recentThreshold).forEach(s => {
      augmented.push(s); // Add recent samples again
    });

    return augmented;
  }

  /**
   * Feature'lara noise ekle (target'a DEĞİL — target'a noise eklemek modeli bozar).
   * Iris pozisyonlarına küçük gaussian noise ekleyerek model çeşitliliği sağlar.
   */
  private addNoiseToFeatures(samples: CalibrationSample[], noiseLevel: number): CalibrationSample[] {
    return samples.map(s => ({
      ...s,
      features: {
        ...s.features,
        leftIrisRelX: s.features.leftIrisRelX + (Math.random() - 0.5) * noiseLevel,
        leftIrisRelY: s.features.leftIrisRelY + (Math.random() - 0.5) * noiseLevel,
        rightIrisRelX: s.features.rightIrisRelX + (Math.random() - 0.5) * noiseLevel,
        rightIrisRelY: s.features.rightIrisRelY + (Math.random() - 0.5) * noiseLevel,
      }
    }));
  }

  private shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Get individual model predictions for debugging
   */
  getModelPredictions(features: EyeFeatures): Array<{ x: number; y: number; weight: number } | null> {
    return this.models.map((model, i) => {
      const pred = model.predictRawCorrected(features);
      return pred ? { ...pred, weight: this.modelWeights[i] } : null;
    });
  }

  reset(): void {
    this.models.forEach(m => m.resetSmoothing());
    this.modelWeights = new Array(this.models.length).fill(1 / this.models.length);
    this.lastPrediction = null;
  }

  private hashFeatures(features: EyeFeatures): string {
    // Simple hash based on key feature values
    const vals = [
      features.leftIrisX.toFixed(3),
      features.leftIrisY.toFixed(3),
      features.rightIrisX.toFixed(3),
      features.rightIrisY.toFixed(3),
      features.leftIrisRelX.toFixed(3),
      features.leftIrisRelY.toFixed(3)
    ];
    return vals.join('|');
  }
}
