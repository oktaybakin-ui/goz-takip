import { KalmanFilter2D } from "../kalmanFilter";

describe("KalmanFilter2D", () => {
  let kf: KalmanFilter2D;

  beforeEach(() => {
    kf = new KalmanFilter2D();
  });

  describe("filter", () => {
    it("returns exact input on first call", () => {
      const result = kf.filter(100, 200, 1000);
      expect(result.x).toBe(100);
      expect(result.y).toBe(200);
      expect(result.vx).toBe(0);
      expect(result.vy).toBe(0);
    });

    it("smooths noisy input (output variance < input variance)", () => {
      const trueX = 500;
      const trueY = 300;
      const inputErrors: number[] = [];
      const outputErrors: number[] = [];

      // Feed 30 noisy measurements
      for (let i = 0; i < 30; i++) {
        const noiseX = (Math.random() - 0.5) * 40;
        const noiseY = (Math.random() - 0.5) * 40;
        const measuredX = trueX + noiseX;
        const measuredY = trueY + noiseY;
        const t = 1000 + i * 33; // ~30fps

        inputErrors.push(noiseX * noiseX + noiseY * noiseY);
        const r = kf.filter(measuredX, measuredY, t);
        outputErrors.push(
          (r.x - trueX) ** 2 + (r.y - trueY) ** 2
        );
      }

      // Last 10 filtered outputs should be closer to truth than raw input
      const avgInputErr =
        inputErrors.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const avgOutputErr =
        outputErrors.slice(-10).reduce((a, b) => a + b, 0) / 10;
      expect(avgOutputErr).toBeLessThan(avgInputErr);
    });

    it("tracks constant velocity motion", () => {
      // Object moving at 10 px per frame to the right
      for (let i = 0; i < 20; i++) {
        kf.filter(100 + i * 10, 200, 1000 + i * 33);
      }
      const last = kf.filter(100 + 20 * 10, 200, 1000 + 20 * 33);
      // Should be close to actual position
      expect(Math.abs(last.x - 300)).toBeLessThan(30);
      expect(last.vx).toBeGreaterThan(0);
    });

    it("handles zero dt gracefully", () => {
      kf.filter(100, 200, 1000);
      const result = kf.filter(110, 210, 1000); // same timestamp
      expect(typeof result.x).toBe("number");
      expect(typeof result.y).toBe("number");
      expect(isFinite(result.x)).toBe(true);
    });
  });

  describe("getVelocity", () => {
    it("returns 0 before any input", () => {
      expect(kf.getVelocity()).toBe(0);
    });

    it("returns 0 after single stationary point", () => {
      kf.filter(100, 200, 1000);
      expect(kf.getVelocity()).toBe(0);
    });

    it("returns non-zero after movement", () => {
      kf.filter(100, 200, 1000);
      kf.filter(200, 300, 1033);
      expect(kf.getVelocity()).toBeGreaterThan(0);
    });
  });

  describe("reset", () => {
    it("resets to uninitialized state", () => {
      kf.filter(100, 200, 1000);
      kf.filter(150, 250, 1033);
      kf.reset();
      expect(kf.getVelocity()).toBe(0);
    });

    it("next filter call returns exact input after reset", () => {
      kf.filter(100, 200, 1000);
      kf.filter(150, 250, 1033);
      kf.reset();
      const result = kf.filter(500, 600, 2000);
      expect(result.x).toBe(500);
      expect(result.y).toBe(600);
    });
  });

  describe("constructor", () => {
    it("accepts custom noise parameters", () => {
      const custom = new KalmanFilter2D(0.5, 10);
      const result = custom.filter(100, 200, 1000);
      expect(result.x).toBe(100);
    });
  });
});
