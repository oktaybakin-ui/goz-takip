/**
 * Automatic Recalibration System
 * Continuously improves the gaze model during use by detecting fixations on UI elements
 */

import { GazeModel, CalibrationSample, EyeFeatures } from './gazeModel';
import { Fixation } from './fixation';
import { logger } from './logger';

export interface RecalibrationConfig {
  minFixationDuration: number;      // Minimum fixation time to consider (ms)
  minConfidence: number;            // Minimum confidence for samples
  bufferSize: number;               // Max samples to keep
  updateInterval: number;           // How often to update model (ms)
  clickRadius: number;              // Radius around clicks to collect samples (px)
  uiElementTracking: boolean;       // Track fixations on UI elements
}

export interface ClickEvent {
  x: number;
  y: number;
  timestamp: number;
  element?: string; // Optional element identifier
}

export class AutoRecalibration {
  private config: RecalibrationConfig;
  private sampleBuffer: CalibrationSample[] = [];
  private lastUpdateTime: number = 0;
  private clickHistory: ClickEvent[] = [];
  private fixationBuffer: Array<{
    fixation: Fixation;
    features: EyeFeatures;
  }> = [];
  
  // UI element positions for implicit calibration
  private uiElements: Map<string, { x: number; y: number; width: number; height: number }> = new Map();
  
  // Performance tracking
  private improvementHistory: number[] = [];
  
  constructor(config?: Partial<RecalibrationConfig>) {
    this.config = {
      minFixationDuration: 500,
      minConfidence: 0.7,
      bufferSize: 200,
      updateInterval: 30000, // 30 seconds
      clickRadius: 100,
      uiElementTracking: true,
      ...config
    };
  }
  
  /**
   * Register a click event for implicit calibration
   */
  registerClick(x: number, y: number, element?: string): void {
    const click: ClickEvent = {
      x,
      y,
      timestamp: Date.now(),
      element
    };
    
    this.clickHistory.push(click);
    
    // Keep only recent clicks (last 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.clickHistory = this.clickHistory.filter(c => c.timestamp > fiveMinutesAgo);
    
    // Check if we have recent fixations near this click
    this.checkFixationClickCorrelation(click);
  }
  
  /**
   * Register a fixation for analysis
   */
  registerFixation(fixation: Fixation, features: EyeFeatures): void {
    // Only consider confident, long fixations
    if (fixation.duration < this.config.minFixationDuration || 
        fixation.avgConfidence < this.config.minConfidence) {
      return;
    }
    
    this.fixationBuffer.push({ fixation, features });
    
    // Keep buffer size limited
    if (this.fixationBuffer.length > 100) {
      this.fixationBuffer.shift();
    }
    
    // Check if fixation correlates with UI elements
    if (this.config.uiElementTracking) {
      this.checkUIElementFixation(fixation, features);
    }
  }
  
  /**
   * Register UI element positions for tracking
   */
  registerUIElement(id: string, bounds: { x: number; y: number; width: number; height: number }): void {
    this.uiElements.set(id, bounds);
  }
  
  /**
   * Check if a fixation precedes a click (user looked then clicked)
   */
  private checkFixationClickCorrelation(click: ClickEvent): void {
    const lookBackTime = 2000; // Look for fixations up to 2 seconds before click
    const recentFixations = this.fixationBuffer.filter(f => 
      click.timestamp - f.fixation.endTime < lookBackTime &&
      f.fixation.endTime < click.timestamp
    );
    
    recentFixations.forEach(({ fixation, features }) => {
      const distance = Math.sqrt(
        (fixation.x - click.x) ** 2 + 
        (fixation.y - click.y) ** 2
      );
      
      // If fixation was near the click location
      if (distance < this.config.clickRadius) {
        // Create calibration sample (true gaze position was likely the click location)
        const sample: CalibrationSample = {
          features,
          targetX: click.x,
          targetY: click.y
        };
        
        // Weight by how close in time and space
        const timeWeight = 1 - (click.timestamp - fixation.endTime) / lookBackTime;
        const spaceWeight = 1 - distance / this.config.clickRadius;
        const weight = timeWeight * spaceWeight * features.confidence;
        
        if (weight > 0.5) {
          this.addCalibrationSample(sample);
          logger.log(`[AutoRecal] Added sample from click correlation (weight: ${weight.toFixed(2)})`);
        }
      }
    });
  }
  
  /**
   * Check if fixation is on a known UI element
   */
  private checkUIElementFixation(fixation: Fixation, features: EyeFeatures): void {
    for (const [elementId, bounds] of this.uiElements) {
      if (this.isPointInBounds(fixation.x, fixation.y, bounds)) {
        // User is looking at a UI element - use element center as ground truth
        const sample: CalibrationSample = {
          features,
          targetX: bounds.x + bounds.width / 2,
          targetY: bounds.y + bounds.height / 2
        };
        
        // Only add if fixation is relatively centered on element
        const centerDist = Math.sqrt(
          (fixation.x - sample.targetX) ** 2 + 
          (fixation.y - sample.targetY) ** 2
        );
        
        if (centerDist < Math.min(bounds.width, bounds.height) / 3) {
          this.addCalibrationSample(sample);
          logger.log(`[AutoRecal] Added sample from UI element: ${elementId}`);
        }
        break;
      }
    }
  }
  
  /**
   * Add calibration sample to buffer
   */
  private addCalibrationSample(sample: CalibrationSample): void {
    this.sampleBuffer.push(sample);
    
    // Maintain buffer size
    if (this.sampleBuffer.length > this.config.bufferSize) {
      // Remove oldest samples but keep some diversity
      const toRemove = Math.floor(this.config.bufferSize * 0.2);
      this.sampleBuffer.splice(0, toRemove);
    }
  }
  
  /**
   * Update the model if enough time has passed
   */
  updateModel(model: GazeModel): boolean {
    const now = Date.now();
    
    // Check if it's time to update
    if (now - this.lastUpdateTime < this.config.updateInterval) {
      return false;
    }
    
    // Need minimum samples for update
    if (this.sampleBuffer.length < 50) {
      return false;
    }
    
    logger.log(`[AutoRecal] Updating model with ${this.sampleBuffer.length} samples`);
    
    // Get current model error on buffer
    const beforeError = this.evaluateModel(model, this.sampleBuffer);
    
    // Create a temporary model to test improvement
    const tempModel = new GazeModel(0.01);
    
    // Combine original calibration data with new samples (if available)
    // Weight recent samples more heavily
    const weightedSamples = this.sampleBuffer.map((s, i) => ({
      ...s,
      weight: 0.5 + 0.5 * (i / this.sampleBuffer.length) // Recent samples weighted more
    }));
    
    // Train temporary model
    tempModel.train(weightedSamples as CalibrationSample[]);
    
    // Evaluate improvement
    const afterError = this.evaluateModel(tempModel, this.sampleBuffer);
    const improvement = (beforeError - afterError) / beforeError;
    
    logger.log(`[AutoRecal] Error before: ${beforeError.toFixed(2)}, after: ${afterError.toFixed(2)}, improvement: ${(improvement * 100).toFixed(1)}%`);
    
    // Only update if there's significant improvement
    if (improvement > 0.05) { // 5% improvement threshold
      // Transfer the improved model weights
      const tempWeights = (tempModel as any).getWeights();
      if (tempWeights) {
        (model as any).setWeights(tempWeights);
      }
      
      this.improvementHistory.push(improvement);
      this.lastUpdateTime = now;
      
      // Clear old samples after successful update
      this.sampleBuffer = this.sampleBuffer.slice(-50);
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Evaluate model error on samples
   */
  private evaluateModel(model: GazeModel, samples: CalibrationSample[]): number {
    let totalError = 0;
    let count = 0;
    
    samples.forEach(sample => {
      const prediction = model.predict(sample.features);
      if (prediction) {
        const error = Math.sqrt(
          (prediction.x - sample.targetX) ** 2 +
          (prediction.y - sample.targetY) ** 2
        );
        totalError += error;
        count++;
      }
    });
    
    return count > 0 ? totalError / count : Infinity;
  }
  
  /**
   * Check if point is within bounds
   */
  private isPointInBounds(
    x: number, 
    y: number, 
    bounds: { x: number; y: number; width: number; height: number }
  ): boolean {
    return x >= bounds.x && 
           x <= bounds.x + bounds.width &&
           y >= bounds.y && 
           y <= bounds.y + bounds.height;
  }
  
  /**
   * Get recalibration statistics
   */
  getStats(): {
    sampleCount: number;
    lastUpdate: number;
    averageImprovement: number;
    clickCorrelations: number;
  } {
    const avgImprovement = this.improvementHistory.length > 0
      ? this.improvementHistory.reduce((a, b) => a + b, 0) / this.improvementHistory.length
      : 0;
    
    return {
      sampleCount: this.sampleBuffer.length,
      lastUpdate: this.lastUpdateTime,
      averageImprovement: avgImprovement,
      clickCorrelations: this.clickHistory.length
    };
  }
  
  /**
   * Reset recalibration system
   */
  reset(): void {
    this.sampleBuffer = [];
    this.clickHistory = [];
    this.fixationBuffer = [];
    this.improvementHistory = [];
    this.lastUpdateTime = 0;
  }
}