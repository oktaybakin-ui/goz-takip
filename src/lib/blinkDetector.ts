/**
 * Gelişmiş Blink Detection Modülü
 *
 * EAR (Eye Aspect Ratio) tabanlı göz kırpma tespiti:
 * - State machine: OPEN → CLOSING → CLOSED → OPENING → OPEN
 * - Consecutive frame kontrolü (3 frame = ~100ms @30 FPS)
 * - Blink metrikleri: blinkCount, blinkRate, avgBlinkDuration
 * - Post-blink rejection: blink sonrası 2 frame atla
 */

export type BlinkState = "OPEN" | "CLOSING" | "CLOSED" | "OPENING";

export interface BlinkMetrics {
  blinkCount: number;
  blinkRate: number; // per minute
  avgBlinkDuration: number; // ms
  lastBlinkTimestamp: number;
  isBlinking: boolean;
  currentState: BlinkState;
}

export interface BlinkEvent {
  startTime: number;
  endTime: number;
  duration: number;
  minEAR: number; // blink sırasındaki minimum EAR
}

export class BlinkDetector {
  // EAR eşikleri
  private readonly earThreshold: number;
  private readonly earOpenThreshold: number;
  private readonly consecutiveFrames: number;
  private readonly postBlinkRejectFrames: number;

  // State machine
  private state: BlinkState = "OPEN";
  private closingFrameCount: number = 0;
  private openingFrameCount: number = 0;

  // Blink tracking
  private blinkEvents: BlinkEvent[] = [];
  private currentBlinkStart: number = 0;
  private currentBlinkMinEAR: number = 1;
  private trackingStartTime: number = 0;

  // Post-blink rejection
  private postBlinkCounter: number = 0;

  constructor(
    earThreshold: number = 0.20,
    consecutiveFrames: number = 3,
    postBlinkRejectFrames: number = 2
  ) {
    this.earThreshold = earThreshold;
    this.earOpenThreshold = earThreshold + 0.04; // Hysteresis: açılma eşiği biraz yüksek
    this.consecutiveFrames = consecutiveFrames;
    this.postBlinkRejectFrames = postBlinkRejectFrames;
  }

  /** Tracking başlat — state'i sıfırla */
  start(): void {
    this.state = "OPEN";
    this.closingFrameCount = 0;
    this.openingFrameCount = 0;
    this.blinkEvents = [];
    this.currentBlinkStart = 0;
    this.currentBlinkMinEAR = 1;
    this.postBlinkCounter = 0;
    this.trackingStartTime = performance.now();
  }

  /**
   * Yeni frame EAR değeri ile güncelle.
   * @param leftEAR - Sol göz EAR
   * @param rightEAR - Sağ göz EAR
   * @param timestamp - Frame timestamp (ms)
   * @returns true ise göz şu an kapalı (blink) — bu frame atlanmalı
   */
  update(leftEAR: number, rightEAR: number, timestamp: number): boolean {
    const avgEAR = (leftEAR + rightEAR) / 2;

    // Post-blink rejection: blink sonrası ilk N frame atla
    if (this.postBlinkCounter > 0) {
      this.postBlinkCounter--;
      return true; // Hâlâ post-blink dönemi
    }

    switch (this.state) {
      case "OPEN":
        if (avgEAR < this.earThreshold) {
          this.closingFrameCount++;
          if (this.closingFrameCount >= this.consecutiveFrames) {
            // Blink başladı
            this.state = "CLOSING";
            this.currentBlinkStart = timestamp - (this.closingFrameCount - 1) * 33; // ~30fps
            this.currentBlinkMinEAR = avgEAR;
          }
        } else {
          this.closingFrameCount = 0;
        }
        break;

      case "CLOSING":
        if (avgEAR < this.earThreshold) {
          this.state = "CLOSED";
          this.currentBlinkMinEAR = Math.min(this.currentBlinkMinEAR, avgEAR);
        } else {
          // Çok kısa kapanma — yanlış pozitif
          this.state = "OPEN";
          this.closingFrameCount = 0;
        }
        break;

      case "CLOSED":
        this.currentBlinkMinEAR = Math.min(this.currentBlinkMinEAR, avgEAR);
        if (avgEAR > this.earOpenThreshold) {
          this.openingFrameCount++;
          if (this.openingFrameCount >= 1) {
            this.state = "OPENING";
          }
        } else {
          this.openingFrameCount = 0;
        }
        break;

      case "OPENING":
        if (avgEAR >= this.earOpenThreshold) {
          // Blink tamamlandı
          const blinkEnd = timestamp;
          const duration = blinkEnd - this.currentBlinkStart;

          // Gerçek blink: 50ms - 500ms arası (çok kısa veya uzun = artefakt)
          if (duration >= 50 && duration <= 500) {
            this.blinkEvents.push({
              startTime: this.currentBlinkStart,
              endTime: blinkEnd,
              duration,
              minEAR: this.currentBlinkMinEAR,
            });
          }

          this.state = "OPEN";
          this.closingFrameCount = 0;
          this.openingFrameCount = 0;
          this.postBlinkCounter = this.postBlinkRejectFrames;
          return true; // Post-blink rejection başlat
        } else if (avgEAR < this.earThreshold) {
          // Tekrar kapandı
          this.state = "CLOSED";
          this.openingFrameCount = 0;
        }
        break;
    }

    return this.state === "CLOSING" || this.state === "CLOSED" || this.state === "OPENING";
  }

  /** Göz şu an kapalı mı? */
  isBlinking(): boolean {
    return this.state !== "OPEN" || this.postBlinkCounter > 0;
  }

  /** Post-blink rejection döneminde mi? */
  isInPostBlinkPeriod(): boolean {
    return this.postBlinkCounter > 0;
  }

  /** Tüm blink metriklerini döner */
  getMetrics(): BlinkMetrics {
    const now = performance.now();
    const elapsedMinutes = Math.max(0.01, (now - this.trackingStartTime) / 60000);
    const count = this.blinkEvents.length;
    const avgDuration = count > 0
      ? this.blinkEvents.reduce((s, b) => s + b.duration, 0) / count
      : 0;

    return {
      blinkCount: count,
      blinkRate: count / elapsedMinutes,
      avgBlinkDuration: avgDuration,
      lastBlinkTimestamp: count > 0 ? this.blinkEvents[count - 1].endTime : 0,
      isBlinking: this.isBlinking(),
      currentState: this.state,
    };
  }

  /** Tüm blink olaylarını döner */
  getBlinkEvents(): BlinkEvent[] {
    return [...this.blinkEvents];
  }

  /** State'i sıfırla */
  reset(): void {
    this.start();
  }
}
