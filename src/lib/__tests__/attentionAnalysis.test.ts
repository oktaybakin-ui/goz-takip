import { computeAttentionMetrics } from "../attentionAnalysis";
import type { Fixation } from "../fixation";

function mkFixation(x: number, y: number, start: number, duration: number): Fixation {
  return { x, y, startTime: start, endTime: start + duration, duration, pointCount: 5, avgConfidence: 0.9 };
}

describe("computeAttentionMetrics", () => {
  it("returns zero entropy for empty fixations", () => {
    const m = computeAttentionMetrics([], 500, 500);
    expect(m.attentionEntropy).toBe(0);
    expect(m.normalizedEntropy).toBe(0);
    expect(m.densityMap.length).toBe(25); // 5x5 grid
  });

  it("returns low entropy when all fixations are in one cell", () => {
    const fixations: Fixation[] = [
      mkFixation(50, 50, 1000, 500),
      mkFixation(55, 55, 1600, 500),
      mkFixation(45, 45, 2200, 500),
    ];
    const m = computeAttentionMetrics(fixations, 500, 500, 5, 5);
    // All in top-left cell → zero normalized entropy (only 1 cell has data)
    expect(m.normalizedEntropy).toBe(0);
    expect(m.attentionEntropy).toBe(0);
  });

  it("returns higher entropy when fixations are spread", () => {
    const fixations: Fixation[] = [
      mkFixation(50, 50, 1000, 500),     // top-left
      mkFixation(250, 250, 1600, 500),   // center
      mkFixation(450, 450, 2200, 500),   // bottom-right
      mkFixation(50, 450, 2800, 500),    // bottom-left
      mkFixation(450, 50, 3400, 500),    // top-right
    ];
    const m = computeAttentionMetrics(fixations, 500, 500, 5, 5);
    expect(m.normalizedEntropy).toBeGreaterThan(0);
    expect(m.attentionEntropy).toBeGreaterThan(0);
  });

  it("density map has correct dimensions", () => {
    const fixations: Fixation[] = [mkFixation(100, 100, 1000, 200)];
    const m = computeAttentionMetrics(fixations, 400, 300, 3, 4);
    expect(m.gridRows).toBe(3);
    expect(m.gridCols).toBe(4);
    expect(m.densityMap.length).toBe(12);
  });

  it("density map cells have rawMs summing total fixation duration", () => {
    const fixations: Fixation[] = [
      mkFixation(50, 50, 1000, 300),
      mkFixation(150, 150, 1400, 700),
    ];
    const m = computeAttentionMetrics(fixations, 500, 500, 5, 5);
    const totalRawMs = m.densityMap.reduce((s, c) => s + c.rawMs, 0);
    expect(totalRawMs).toBe(1000); // 300 + 700
  });

  it("temporal shift has firstHalf and secondHalf", () => {
    const fixations: Fixation[] = [
      mkFixation(50, 50, 1000, 300),    // first half
      mkFixation(50, 50, 1400, 300),    // first half
      mkFixation(450, 450, 1800, 300),  // second half
      mkFixation(450, 450, 2200, 300),  // second half
    ];
    const m = computeAttentionMetrics(fixations, 500, 500, 5, 5);
    expect(m.temporalShift.firstHalf.length).toBe(25);
    expect(m.temporalShift.secondHalf.length).toBe(25);
    // First half is top-left, second half is bottom-right → shift > 0
    expect(m.temporalShift.shiftMagnitude).toBeGreaterThan(0);
  });
});
