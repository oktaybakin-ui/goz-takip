/**
 * Multi-Model Ensemble for robust eye tracking
 * Trains multiple models with different configurations and combines predictions
 */

import { GazeModel } from './gazeModel';
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
  private lastPrediction: { hash: string; result: any; timestamp: number } | null = null;
  
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
    this.models = this.config.modelConfigs.map(config => 
      new GazeModel(config.lambda)
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
      
      // Add noise for diversity (different random seeds)
      if (i > 0) {
        trainSamples = this.addNoiseToSamples(trainSamples, 0.005 * i);
      }
      
      model.train(trainSamples);
    });
    
    // Initial equal weights
    this.modelWeights = new Array(this.models.length).fill(1 / this.models.length);
  }
  
  /**
   * Get ensemble prediction
   */
  predict(features: any): { x: number; y: number; confidence: number } | null {
    // Simple feature hash for caching
    const featureHash = this.hashFeatures(features);
    const now = Date.now();
    
    // Check cache (valid for 16ms)
    if (this.lastPrediction && 
        this.lastPrediction.hash === featureHash &&
        now - this.lastPrediction.timestamp < 16) {
      return this.lastPrediction.result;
    }
    
    const predictions = this.models.map((model, i) => ({
      pred: model.predict(features),
      weight: this.modelWeights[i]
    })).filter(p => p.pred !== null);
    
    if (predictions.length === 0) return null;
    
    // Weighted average
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
      timestamp: Date.now()
    };
    
    // Cache the result
    this.lastPrediction = {
      hash: featureHash,
      result,
      timestamp: now
    };
    
    return result as any;
  }
  
  /**
   * Update model weights based on validation performance
   */
  updateWeights(validationSamples: CalibrationSample[]): void {
    const errors = this.models.map(model => {
      let totalError = 0;
      let count = 0;
      
      validationSamples.forEach(sample => {
        const pred = model.predict(sample.features);
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
    logger.log('[Ensemble] Updated weights:', this.modelWeights);
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
  
  private addNoiseToSamples(samples: CalibrationSample[], noiseLevel: number): CalibrationSample[] {
    return samples.map(s => ({
      ...s,
      targetX: s.targetX + (Math.random() - 0.5) * noiseLevel * 100,
      targetY: s.targetY + (Math.random() - 0.5) * noiseLevel * 100
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
  getModelPredictions(features: any): Array<{ x: number; y: number; weight: number } | null> {
    return this.models.map((model, i) => {
      const pred = model.predict(features);
      return pred ? { ...pred, weight: this.modelWeights[i] } : null;
    });
  }
  
  reset(): void {
    this.models.forEach(m => m.resetSmoothing());
    this.modelWeights = new Array(this.models.length).fill(1 / this.models.length);
    this.lastPrediction = null;
  }
  
  private hashFeatures(features: any): string {
    // Simple hash based on key feature values
    const vals = [
      features.leftPupil.x.toFixed(3),
      features.leftPupil.y.toFixed(3),
      features.rightPupil.x.toFixed(3),
      features.rightPupil.y.toFixed(3),
      features.leftIris.x.toFixed(3),
      features.leftIris.y.toFixed(3)
    ];
    return vals.join('|');
  }
}