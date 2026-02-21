import {
  generateCalibrationPoints,
  generateValidationPoints,
  checkStability,
} from "../calibration";
import type { EyeFeatures } from "../gazeModel";

describe("calibration", () => {
  describe("generateCalibrationPoints", () => {
    it("returns 25 points for 5x5 grid", () => {
      const points = generateCalibrationPoints(800, 600, 50);
      expect(points).toHaveLength(25);
      const ids = new Set<number>();
      points.forEach((p) => {
        expect(p).toHaveProperty("id");
        expect(p.id).toBeGreaterThanOrEqual(0);
        expect(p.id).toBeLessThan(25);
        ids.add(p.id);
        expect(p).toHaveProperty("x");
        expect(p).toHaveProperty("y");
        expect(p).toHaveProperty("relX");
        expect(p).toHaveProperty("relY");
        expect(typeof p.x).toBe("number");
        expect(typeof p.y).toBe("number");
      });
      expect(ids.size).toBe(25);
    });

    it("uses padding for bounds", () => {
      const points = generateCalibrationPoints(1000, 800, 100);
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(100);
      expect(Math.max(...xs)).toBeLessThanOrEqual(900);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(100);
      expect(Math.max(...ys)).toBeLessThanOrEqual(700);
    });
  });

  describe("generateValidationPoints", () => {
    it("returns 5 validation points", () => {
      const points = generateValidationPoints(800, 600, 100);
      expect(points).toHaveLength(5);
      points.forEach((p) => {
        expect(p).toHaveProperty("id");
        expect(p).toHaveProperty("x");
        expect(p).toHaveProperty("y");
        expect(p.relX).toBeGreaterThanOrEqual(0);
        expect(p.relX).toBeLessThanOrEqual(1);
        expect(p.relY).toBeGreaterThanOrEqual(0);
        expect(p.relY).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("checkStability", () => {
    const baseFeatures: EyeFeatures = {
      leftIrisX: 0.5,
      leftIrisY: 0.5,
      rightIrisX: 0.5,
      rightIrisY: 0.5,
      leftIrisRelX: 0.5,
      leftIrisRelY: 0.5,
      rightIrisRelX: 0.5,
      rightIrisRelY: 0.5,
      pupilRadius: 0.1,
      eyeOpenness: 0.2,
      leftEAR: 0.3,
      rightEAR: 0.3,
      yaw: 0,
      pitch: 0,
      roll: 0,
      faceScale: 0.5,
      leftEyeWidth: 0.1,
      rightEyeWidth: 0.1,
      confidence: 0.8,
    };

    it("returns face not visible when confidence low", () => {
      const r = checkStability({ ...baseFeatures, confidence: 0.05 }, null);
      expect(r.faceVisible).toBe(false);
      expect(r.message).toBeTruthy();
    });

    it("returns eyes open when eyeOpenness above threshold", () => {
      const r = checkStability({ ...baseFeatures, eyeOpenness: 0.1 }, null);
      expect(r.eyesOpen).toBe(true);
    });
  });
});
