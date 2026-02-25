// Web Worker for heavy gaze calculations
import { EyeFeatures } from '../lib/gazeModel';

interface WorkerMessage {
  type: 'predict' | 'train' | 'updateEnsemble';
  id: string;
  data: any;
}

interface WorkerResponse {
  type: 'result' | 'error';
  id: string;
  data: any;
}

// Simple polynomial regression in worker
class SimpleGazeModel {
  private weightsX: number[] | null = null;
  private weightsY: number[] | null = null;
  
  train(samples: any[]): void {
    // Simplified training logic
    const n = samples.length;
    if (n < 10) return;
    
    // Create feature matrix and targets
    const features = samples.map(s => this.expandFeatures(s.features));
    const targetsX = samples.map(s => s.targetX);
    const targetsY = samples.map(s => s.targetY);
    
    // Simple least squares (simplified)
    this.weightsX = this.fitModel(features, targetsX);
    this.weightsY = this.fitModel(features, targetsY);
  }
  
  private expandFeatures(features: EyeFeatures): number[] {
    const f = [
      1, // bias
      features.leftIrisX, features.leftIrisY,
      features.rightIrisX, features.rightIrisY,
      features.leftIrisRelX, features.leftIrisRelY,
      features.rightIrisRelX, features.rightIrisRelY,
      features.yaw, features.pitch, features.roll,
      features.faceScale,
      features.eyeOpenness,
      features.confidence
    ];
    return f;
  }
  
  private fitModel(X: number[][], y: number[]): number[] {
    // Simplified least squares
    const m = X.length;
    const n = X[0].length;
    const weights = new Array(n).fill(0);
    
    // Very simple gradient descent (for demo)
    const lr = 0.001;
    for (let iter = 0; iter < 100; iter++) {
      const grad = new Array(n).fill(0);
      for (let i = 0; i < m; i++) {
        const pred = X[i].reduce((sum, val, j) => sum + val * weights[j], 0);
        const error = pred - y[i];
        for (let j = 0; j < n; j++) {
          grad[j] += error * X[i][j] / m;
        }
      }
      for (let j = 0; j < n; j++) {
        weights[j] -= lr * grad[j];
      }
    }
    return weights;
  }
  
  predict(features: EyeFeatures): { x: number; y: number } | null {
    if (!this.weightsX || !this.weightsY) return null;
    
    const f = this.expandFeatures(features);
    const x = f.reduce((sum, val, i) => sum + val * this.weightsX![i], 0);
    const y = f.reduce((sum, val, i) => sum + val * this.weightsY![i], 0);
    
    return { x, y };
  }
}

const model = new SimpleGazeModel();

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, id, data } = e.data;
  
  try {
    let result: any;
    
    switch (type) {
      case 'train':
        model.train(data.samples);
        result = { success: true };
        break;
        
      case 'predict':
        result = model.predict(data.features);
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    
    self.postMessage({
      type: 'result',
      id,
      data: result
    } as WorkerResponse);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      data: error instanceof Error ? error.message : 'Unknown error'
    } as WorkerResponse);
  }
};

export {};