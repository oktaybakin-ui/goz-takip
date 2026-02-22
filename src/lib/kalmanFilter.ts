/**
 * 2D Kalman Filter for eye tracking
 * Provides optimal estimation by combining predictions with measurements
 */

export class KalmanFilter2D {
  // State vector: [x, y, vx, vy] (position and velocity)
  private x: number[] = [0, 0, 0, 0];
  
  // State covariance matrix (4x4)
  private P: number[][] = [
    [1000, 0, 0, 0],
    [0, 1000, 0, 0],
    [0, 0, 1000, 0],
    [0, 0, 0, 1000]
  ];
  
  // Process noise covariance
  private Q: number[][];
  
  // Measurement noise covariance
  private R: number[][] = [
    [25, 0],
    [0, 25]
  ];
  
  // State transition matrix
  private F: number[][] = [
    [1, 0, 1, 0], // x = x + vx*dt
    [0, 1, 0, 1], // y = y + vy*dt
    [0, 0, 1, 0], // vx = vx
    [0, 0, 0, 1]  // vy = vy
  ];
  
  // Measurement matrix (we only measure position)
  private H: number[][] = [
    [1, 0, 0, 0],
    [0, 1, 0, 0]
  ];
  
  private lastTime: number | null = null;
  private initialized: boolean = false;
  
  constructor(processNoise: number = 0.1, measurementNoise: number = 5.0) {
    // Process noise (how much we expect velocity to change)
    this.Q = [
      [processNoise, 0, 0, 0],
      [0, processNoise, 0, 0],
      [0, 0, processNoise * 10, 0],
      [0, 0, 0, processNoise * 10]
    ];
    
    // Measurement noise
    this.R = [
      [measurementNoise, 0],
      [0, measurementNoise]
    ];
  }
  
  /**
   * Predict step - estimate next state based on motion model
   */
  private predict(dt: number): void {
    // Update F matrix with actual time delta
    this.F[0][2] = dt;
    this.F[1][3] = dt;
    
    // Predict state: x = F * x
    const newX = this.matrixMultiplyVector(this.F, this.x);
    this.x = newX;
    
    // Predict covariance: P = F * P * F' + Q
    const FP = this.matrixMultiply(this.F, this.P);
    const FPFt = this.matrixMultiply(FP, this.transpose(this.F));
    this.P = this.matrixAdd(FPFt, this.Q);
  }
  
  /**
   * Update step - correct prediction with measurement
   */
  private update(z: number[]): void {
    // Innovation: y = z - H * x
    const Hx = this.matrixMultiplyVector(this.H, this.x);
    const y = [z[0] - Hx[0], z[1] - Hx[1]];
    
    // Innovation covariance: S = H * P * H' + R
    const HP = this.matrixMultiply(this.H, this.P);
    const HPHt = this.matrixMultiply(HP, this.transpose(this.H));
    const S = this.matrixAdd(HPHt, this.R);
    
    // Kalman gain: K = P * H' * S^-1
    const PHt = this.matrixMultiply(this.P, this.transpose(this.H));
    const SInv = this.invert2x2(S);
    const K = this.matrixMultiply(PHt, SInv);
    
    // Update state: x = x + K * y
    const Ky = this.matrixMultiplyVector(K, y);
    this.x = [
      this.x[0] + Ky[0],
      this.x[1] + Ky[1],
      this.x[2] + Ky[2],
      this.x[3] + Ky[3]
    ];
    
    // Update covariance: P = (I - K * H) * P
    const KH = this.matrixMultiply(K, this.H);
    const I = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    const IKH = this.matrixSubtract(I, KH);
    this.P = this.matrixMultiply(IKH, this.P);
  }
  
  /**
   * Process a new measurement and return filtered position
   */
  filter(x: number, y: number, timestamp: number): { x: number; y: number; vx: number; vy: number } {
    if (!this.initialized) {
      this.x = [x, y, 0, 0];
      this.lastTime = timestamp;
      this.initialized = true;
      return { x, y, vx: 0, vy: 0 };
    }
    
    const dt = (timestamp - (this.lastTime || timestamp)) / 1000; // seconds
    this.lastTime = timestamp;
    
    if (dt > 0) {
      this.predict(dt);
    }
    
    this.update([x, y]);
    
    return {
      x: this.x[0],
      y: this.x[1],
      vx: this.x[2],
      vy: this.x[3]
    };
  }
  
  /**
   * Get current velocity magnitude
   */
  getVelocity(): number {
    return Math.sqrt(this.x[2] ** 2 + this.x[3] ** 2);
  }
  
  /**
   * Reset filter state
   */
  reset(): void {
    this.x = [0, 0, 0, 0];
    this.P = [
      [1000, 0, 0, 0],
      [0, 1000, 0, 0],
      [0, 0, 1000, 0],
      [0, 0, 0, 1000]
    ];
    this.initialized = false;
    this.lastTime = null;
  }
  
  // Matrix operations
  private matrixMultiply(A: number[][], B: number[][]): number[][] {
    const rows = A.length;
    const cols = B[0].length;
    const result: number[][] = Array(rows).fill(null).map(() => Array(cols).fill(0));
    
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        for (let k = 0; k < A[0].length; k++) {
          result[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return result;
  }
  
  private matrixMultiplyVector(A: number[][], v: number[]): number[] {
    return A.map(row => row.reduce((sum, val, i) => sum + val * v[i], 0));
  }
  
  private matrixAdd(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((val, j) => val + B[i][j]));
  }
  
  private matrixSubtract(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((val, j) => val - B[i][j]));
  }
  
  private transpose(A: number[][]): number[][] {
    return A[0].map((_, i) => A.map(row => row[i]));
  }
  
  private invert2x2(A: number[][]): number[][] {
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    if (Math.abs(det) < 1e-10) {
      return [[1, 0], [0, 1]]; // Return identity if not invertible
    }
    return [
      [A[1][1] / det, -A[0][1] / det],
      [-A[1][0] / det, A[0][0] / det]
    ];
  }
}