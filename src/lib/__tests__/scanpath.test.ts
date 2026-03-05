import { computeScanpathMetrics } from "../scanpath";
import type { Fixation, Saccade } from "../fixation";

function mkFixation(x: number, y: number, start: number, duration: number): Fixation {
  return { x, y, startTime: start, endTime: start + duration, duration, pointCount: 5, avgConfidence: 0.9 };
}

function mkSaccade(sx: number, sy: number, ex: number, ey: number, st: number, et: number): Saccade {
  const dx = ex - sx;
  const dy = ey - sy;
  const amp = Math.sqrt(dx * dx + dy * dy);
  return {
    startX: sx, startY: sy, endX: ex, endY: ey,
    startTime: st, endTime: et,
    velocity: amp / ((et - st) / 1000),
    amplitude: amp,
    peakVelocity: amp / ((et - st) / 1000),
    direction: Math.atan2(dy, dx),
  };
}

describe("computeScanpathMetrics", () => {
  it("returns zeros for empty data", () => {
    const m = computeScanpathMetrics([], [], 0);
    expect(m.totalScanpathLength).toBe(0);
    expect(m.fixationCount).toBe(0);
    expect(m.saccadeCount).toBe(0);
    expect(m.backtrackRatio).toBe(0);
  });

  it("computes total scanpath length from saccades", () => {
    const saccades: Saccade[] = [
      mkSaccade(0, 0, 100, 0, 1000, 1050),   // 100px
      mkSaccade(100, 0, 100, 100, 1200, 1250), // 100px
    ];
    const m = computeScanpathMetrics([], saccades, 5000);
    expect(m.totalScanpathLength).toBeCloseTo(200, 0);
    expect(m.avgSaccadeLength).toBeCloseTo(100, 0);
  });

  it("computes fixation-saccade ratio", () => {
    const fixations: Fixation[] = [
      mkFixation(100, 100, 1000, 500),
      mkFixation(200, 200, 1600, 500),
    ];
    const m = computeScanpathMetrics(fixations, [], 2000);
    // 1000ms fixation out of 2000ms total
    expect(m.fixationSaccadeRatio).toBeCloseTo(0.5, 1);
  });

  it("detects backtrack when fixation returns to previous position", () => {
    const fixations: Fixation[] = [
      mkFixation(100, 100, 1000, 200),  // position A
      mkFixation(500, 500, 1300, 200),  // position B (far from A)
      mkFixation(105, 105, 1600, 200),  // back near A → backtrack
    ];
    const m = computeScanpathMetrics(fixations, [], 2000);
    expect(m.backtrackRatio).toBeGreaterThan(0);
  });

  it("computes convex hull area > 0 for spread fixations", () => {
    const fixations: Fixation[] = [
      mkFixation(0, 0, 1000, 200),
      mkFixation(100, 0, 1300, 200),
      mkFixation(50, 100, 1600, 200),
    ];
    const m = computeScanpathMetrics(fixations, [], 2000);
    expect(m.convexHullArea).toBeGreaterThan(0);
    expect(m.scanpathRegularity).toBeGreaterThan(0);
    expect(m.scanpathRegularity).toBeLessThanOrEqual(1);
  });
});
