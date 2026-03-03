import { AdvancedIrisDetector } from "../advancedIrisDetection";
import type { IrisFeatures } from "../advancedIrisDetection";

jest.mock("../logger", () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/** Generate points on a circle */
function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n: number
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

/** Generate a wider bounding box simulating eye contour */
function eyeContour(
  cx: number,
  cy: number,
  w: number,
  h: number
): Array<{ x: number; y: number }> {
  return [
    { x: cx - w / 2, y: cy },
    { x: cx, y: cy - h / 2 },
    { x: cx + w / 2, y: cy },
    { x: cx, y: cy + h / 2 },
  ];
}

describe("AdvancedIrisDetector", () => {
  let detector: AdvancedIrisDetector;

  beforeEach(() => {
    detector = new AdvancedIrisDetector();
  });

  describe("detectIris", () => {
    it("returns IrisFeatures with center, radius, confidence", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      const iris = circlePoints(0.5, 0.5, 0.01, 8);

      const result = detector.detectIris(eye, iris, "left");

      expect(result).toHaveProperty("center");
      expect(result).toHaveProperty("radius");
      expect(result).toHaveProperty("confidence");
      expect(typeof result.center.x).toBe("number");
      expect(typeof result.center.y).toBe("number");
      expect(result.radius).toBeGreaterThan(0);
    });

    it("detects center near true iris center", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      const iris = circlePoints(0.5, 0.5, 0.012, 8);

      const result = detector.detectIris(eye, iris, "left");

      expect(Math.abs(result.center.x - 0.5)).toBeLessThan(0.02);
      expect(Math.abs(result.center.y - 0.5)).toBeLessThan(0.02);
    });

    it("returns ellipse params when >= 5 iris landmarks", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      // Use a slightly elongated distribution so eigenvalues are well-defined
      const iris = [
        { x: 0.49, y: 0.50 },
        { x: 0.51, y: 0.50 },
        { x: 0.50, y: 0.49 },
        { x: 0.50, y: 0.51 },
        { x: 0.505, y: 0.505 },
        { x: 0.495, y: 0.495 },
      ];

      const result = detector.detectIris(eye, iris, "right");

      expect(result.ellipse).toBeDefined();
      expect(result.ellipse!.centerX).toBeCloseTo(0.5, 1);
      expect(result.ellipse!.centerY).toBeCloseTo(0.5, 1);
      expect(isFinite(result.ellipse!.radiusX)).toBe(true);
      expect(isFinite(result.ellipse!.radiusY)).toBe(true);
      expect(result.ellipse!.radiusX).toBeGreaterThanOrEqual(0);
    });

    it("does not return ellipse when < 5 iris landmarks", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      const iris = circlePoints(0.5, 0.5, 0.012, 4);

      const result = detector.detectIris(eye, iris, "left");

      expect(result.ellipse).toBeUndefined();
    });

    it("handles minimum 3 iris landmarks via RANSAC fallback", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      const iris = [
        { x: 0.49, y: 0.5 },
        { x: 0.51, y: 0.5 },
        { x: 0.5, y: 0.51 },
      ];

      const result = detector.detectIris(eye, iris, "left");
      expect(result.center).toBeDefined();
      expect(result.radius).toBeGreaterThan(0);
    });

    it("falls back to centroid for fewer than 3 landmarks", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      const iris = [
        { x: 0.48, y: 0.5 },
        { x: 0.52, y: 0.5 },
      ];

      const result = detector.detectIris(eye, iris, "right");
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  describe("temporal smoothing", () => {
    it("stabilizes after multiple calls", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      const results: IrisFeatures[] = [];

      // Feed 5 slightly varying detections
      for (let i = 0; i < 5; i++) {
        const jitter = (Math.random() - 0.5) * 0.004;
        const iris = circlePoints(0.5 + jitter, 0.5 + jitter, 0.012, 8);
        results.push(detector.detectIris(eye, iris, "left"));
      }

      // Later results should be closer to 0.5 (smoothed)
      const lastCenter = results[results.length - 1].center;
      expect(Math.abs(lastCenter.x - 0.5)).toBeLessThan(0.01);
      expect(Math.abs(lastCenter.y - 0.5)).toBeLessThan(0.01);
    });
  });

  describe("reset", () => {
    it("clears iris history for both eyes", () => {
      const eye = eyeContour(0.5, 0.5, 0.1, 0.06);
      const iris = circlePoints(0.5, 0.5, 0.012, 8);

      // Build up history
      for (let i = 0; i < 5; i++) {
        detector.detectIris(eye, iris, "left");
        detector.detectIris(eye, iris, "right");
      }

      detector.reset();

      // After reset, first detection should return un-smoothed result
      const result = detector.detectIris(eye, iris, "left");
      expect(result).toHaveProperty("center");
      expect(result.confidence).toBeGreaterThan(0);
    });
  });
});
