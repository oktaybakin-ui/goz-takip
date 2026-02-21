import { FixationDetector } from "../fixation";
import { GazePoint } from "../gazeModel";

function point(x: number, y: number, t: number, confidence = 0.9): GazePoint {
  return { x, y, timestamp: t, confidence };
}

describe("FixationDetector", () => {
  it("starts with no fixations", () => {
    const d = new FixationDetector(100, 150, 50);
    d.startTracking();
    const m = d.getMetrics();
    expect(m.fixationCount).toBe(0);
    expect(m.allFixations).toHaveLength(0);
  });

  it("detects fixation when points are close and slow", () => {
    const d = new FixationDetector(100, 100, 50);
    d.startTracking();
    const t0 = 1000;
    for (let i = 0; i < 20; i++) {
      d.addGazePoint(point(50 + i * 0.5, 50, t0 + i * 20));
    }
    d.stopTracking();
    const m = d.getMetrics();
    expect(m.fixationCount).toBeGreaterThanOrEqual(1);
  });

  it("getGazePoints returns collected points", () => {
    const d = new FixationDetector();
    d.startTracking();
    d.addGazePoint(point(10, 10, 0));
    d.addGazePoint(point(11, 11, 16));
    expect(d.getGazePoints().length).toBe(2);
  });
});
