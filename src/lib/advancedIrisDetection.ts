/**
 * Advanced Iris Detection using computer vision techniques
 * Improves upon MediaPipe's iris detection with additional processing
 */

import { logger } from './logger';

export interface IrisFeatures {
  center: { x: number; y: number };
  radius: number;
  confidence: number;
  ellipse?: {
    centerX: number;
    centerY: number;
    radiusX: number;
    radiusY: number;
    rotation: number;
  };
}

export class AdvancedIrisDetector {
  // Iris detection parameters
  private readonly IRIS_RADIUS_RATIO = 0.15; // Typical iris/eye width ratio
  private readonly MIN_IRIS_RADIUS = 0.005;
  private readonly MAX_IRIS_RADIUS = 0.025;
  
  // History for temporal smoothing
  private irisHistory: Map<'left' | 'right', IrisFeatures[]> = new Map([
    ['left', []],
    ['right', []]
  ]);
  private readonly HISTORY_SIZE = 10;
  
  // Ellipse fitting for better accuracy
  private useEllipseFitting: boolean = true;
  
  /**
   * Detect iris with enhanced accuracy using multiple techniques
   */
  detectIris(
    eyeLandmarks: Array<{ x: number; y: number }>,
    irisLandmarks: Array<{ x: number; y: number }>,
    eyeType: 'left' | 'right'
  ): IrisFeatures {
    // Basic iris center from landmarks
    const basicCenter = this.computeCentroid(irisLandmarks);
    
    // Compute eye dimensions
    const eyeBounds = this.computeBoundingBox(eyeLandmarks);
    const eyeWidth = eyeBounds.maxX - eyeBounds.minX;
    
    // Refined center using RANSAC
    const ransacCenter = this.ransacCircleFit(irisLandmarks);
    
    // Combine basic and RANSAC centers
    const combinedCenter = {
      x: basicCenter.x * 0.4 + ransacCenter.center.x * 0.6,
      y: basicCenter.y * 0.4 + ransacCenter.center.y * 0.6
    };
    
    // Estimate iris radius
    let irisRadius = this.estimateIrisRadius(irisLandmarks, combinedCenter, eyeWidth);
    
    // Apply temporal smoothing
    const smoothedFeatures = this.temporalSmoothing({
      center: combinedCenter,
      radius: irisRadius,
      confidence: ransacCenter.confidence
    }, eyeType);
    
    // Ellipse fitting for perspective compensation
    let ellipseParams;
    if (this.useEllipseFitting && irisLandmarks.length >= 5) {
      ellipseParams = this.fitEllipse(irisLandmarks);
    }
    
    return {
      center: smoothedFeatures.center,
      radius: smoothedFeatures.radius,
      confidence: smoothedFeatures.confidence,
      ellipse: ellipseParams
    };
  }
  
  /**
   * RANSAC circle fitting for robust iris center detection
   */
  private ransacCircleFit(
    points: Array<{ x: number; y: number }>,
    iterations: number = 50
  ): { center: { x: number; y: number }; radius: number; confidence: number } {
    if (points.length < 3) {
      return {
        center: this.computeCentroid(points),
        radius: 0.01,
        confidence: 0.1
      };
    }
    
    let bestCenter = { x: 0, y: 0 };
    let bestRadius = 0;
    let bestInliers = 0;
    
    for (let i = 0; i < iterations; i++) {
      // Randomly select 3 points
      const indices = this.randomSample(points.length, 3);
      const p1 = points[indices[0]];
      const p2 = points[indices[1]];
      const p3 = points[indices[2]];
      
      // Fit circle through 3 points
      const circle = this.circleFrom3Points(p1, p2, p3);
      if (!circle) continue;
      
      // Count inliers
      const threshold = 0.003; // 0.3% of image
      let inliers = 0;
      
      points.forEach(p => {
        const dist = Math.sqrt((p.x - circle.x) ** 2 + (p.y - circle.y) ** 2);
        if (Math.abs(dist - circle.r) < threshold) {
          inliers++;
        }
      });
      
      if (inliers > bestInliers) {
        bestInliers = inliers;
        bestCenter = { x: circle.x, y: circle.y };
        bestRadius = circle.r;
      }
    }
    
    const confidence = bestInliers / points.length;
    
    return {
      center: bestCenter,
      radius: bestRadius,
      confidence
    };
  }
  
  /**
   * Fit circle through 3 points
   */
  private circleFrom3Points(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number }
  ): { x: number; y: number; r: number } | null {
    const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
    if (Math.abs(d) < 1e-10) return null;
    
    const ux = ((p1.x * p1.x + p1.y * p1.y) * (p2.y - p3.y) +
                (p2.x * p2.x + p2.y * p2.y) * (p3.y - p1.y) +
                (p3.x * p3.x + p3.y * p3.y) * (p1.y - p2.y)) / d;
                
    const uy = ((p1.x * p1.x + p1.y * p1.y) * (p3.x - p2.x) +
                (p2.x * p2.x + p2.y * p2.y) * (p1.x - p3.x) +
                (p3.x * p3.x + p3.y * p3.y) * (p2.x - p1.x)) / d;
                
    const r = Math.sqrt((p1.x - ux) ** 2 + (p1.y - uy) ** 2);
    
    return { x: ux, y: uy, r };
  }
  
  /**
   * Estimate iris radius using multiple methods
   */
  private estimateIrisRadius(
    irisPoints: Array<{ x: number; y: number }>,
    center: { x: number; y: number },
    eyeWidth: number
  ): number {
    // Method 1: Average distance from center
    const avgDist = irisPoints.reduce((sum, p) => {
      return sum + Math.sqrt((p.x - center.x) ** 2 + (p.y - center.y) ** 2);
    }, 0) / irisPoints.length;
    
    // Method 2: Eye width ratio
    const ratioRadius = eyeWidth * this.IRIS_RADIUS_RATIO;
    
    // Method 3: Bounding box
    const bounds = this.computeBoundingBox(irisPoints);
    const bboxRadius = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    
    // Weighted combination
    let radius = avgDist * 0.5 + ratioRadius * 0.3 + bboxRadius * 0.2;
    
    // Clamp to reasonable bounds
    radius = Math.max(this.MIN_IRIS_RADIUS, Math.min(this.MAX_IRIS_RADIUS, radius));
    
    return radius;
  }
  
  /**
   * Temporal smoothing using exponential moving average
   */
  private temporalSmoothing(
    current: IrisFeatures,
    eyeType: 'left' | 'right'
  ): IrisFeatures {
    const history = this.irisHistory.get(eyeType)!;
    history.push(current);
    
    if (history.length > this.HISTORY_SIZE) {
      history.shift();
    }
    
    if (history.length < 3) {
      return current;
    }
    
    // Weighted average (recent frames have more weight)
    let totalWeight = 0;
    let weightedCenter = { x: 0, y: 0 };
    let weightedRadius = 0;
    let weightedConfidence = 0;
    
    history.forEach((features, i) => {
      const weight = Math.exp(0.5 * (i - history.length + 1));
      weightedCenter.x += features.center.x * weight;
      weightedCenter.y += features.center.y * weight;
      weightedRadius += features.radius * weight;
      weightedConfidence += features.confidence * weight;
      totalWeight += weight;
    });
    
    return {
      center: {
        x: weightedCenter.x / totalWeight,
        y: weightedCenter.y / totalWeight
      },
      radius: weightedRadius / totalWeight,
      confidence: weightedConfidence / totalWeight
    };
  }
  
  /**
   * Fit ellipse to iris points for perspective compensation
   */
  private fitEllipse(points: Array<{ x: number; y: number }>): IrisFeatures['ellipse'] {
    // Simplified ellipse fitting using moments
    const center = this.computeCentroid(points);
    
    // Compute covariance matrix
    let cxx = 0, cyy = 0, cxy = 0;
    points.forEach(p => {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    });
    
    cxx /= points.length;
    cyy /= points.length;
    cxy /= points.length;
    
    // Eigenvalues and eigenvectors
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const lambda1 = trace / 2 + Math.sqrt((trace * trace / 4) - det);
    const lambda2 = trace / 2 - Math.sqrt((trace * trace / 4) - det);
    
    // Rotation angle
    const rotation = Math.atan2(2 * cxy, cxx - cyy) / 2;
    
    return {
      centerX: center.x,
      centerY: center.y,
      radiusX: 2 * Math.sqrt(lambda1),
      radiusY: 2 * Math.sqrt(lambda2),
      rotation
    };
  }
  
  // Utility functions
  private computeCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
    const sum = points.reduce((acc, p) => ({
      x: acc.x + p.x,
      y: acc.y + p.y
    }), { x: 0, y: 0 });
    
    return {
      x: sum.x / points.length,
      y: sum.y / points.length
    };
  }
  
  private computeBoundingBox(points: Array<{ x: number; y: number }>) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys)
    };
  }
  
  private randomSample(n: number, k: number): number[] {
    const indices: number[] = [];
    const used = new Set<number>();
    
    while (indices.length < k) {
      const i = Math.floor(Math.random() * n);
      if (!used.has(i)) {
        indices.push(i);
        used.add(i);
      }
    }
    
    return indices;
  }
  
  reset(): void {
    this.irisHistory.clear();
    this.irisHistory.set('left', []);
    this.irisHistory.set('right', []);
  }
}