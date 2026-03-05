import { AOIAnalyzer } from "../aoiAnalysis";
import type { Fixation } from "../fixation";
import type { GazePoint } from "../gazeModel";

function mkFixation(x: number, y: number, start: number, duration: number): Fixation {
  return { x, y, startTime: start, endTime: start + duration, duration, pointCount: 5, avgConfidence: 0.9 };
}

function mkGaze(x: number, y: number, t: number): GazePoint {
  return { x, y, timestamp: t, confidence: 0.9 };
}

describe("AOIAnalyzer", () => {
  it("starts with no regions", () => {
    const analyzer = new AOIAnalyzer();
    expect(analyzer.getRegions()).toHaveLength(0);
  });

  it("adds and removes regions", () => {
    const analyzer = new AOIAnalyzer();
    analyzer.addRegion({ id: "r1", name: "Region 1", x: 0, y: 0, width: 100, height: 100 });
    analyzer.addRegion({ id: "r2", name: "Region 2", x: 200, y: 200, width: 100, height: 100 });
    expect(analyzer.getRegions()).toHaveLength(2);
    analyzer.removeRegion("r1");
    expect(analyzer.getRegions()).toHaveLength(1);
    expect(analyzer.getRegions()[0].id).toBe("r2");
  });

  it("analyzes fixations within AOI regions", () => {
    const analyzer = new AOIAnalyzer();
    analyzer.addRegion({ id: "top-left", name: "Top Left", x: 0, y: 0, width: 200, height: 200 });
    analyzer.addRegion({ id: "center", name: "Center", x: 300, y: 300, width: 200, height: 200 });

    const fixations: Fixation[] = [
      mkFixation(100, 100, 1000, 300),  // in top-left
      mkFixation(350, 350, 1500, 500),  // in center
      mkFixation(150, 150, 2200, 200),  // in top-left
      mkFixation(600, 600, 2600, 400),  // outside both
    ];

    const gazePoints: GazePoint[] = [
      mkGaze(100, 100, 1000),
      mkGaze(100, 100, 1100),
      mkGaze(350, 350, 1500),
      mkGaze(150, 150, 2200),
      mkGaze(600, 600, 2600),
    ];

    const results = analyzer.analyze(fixations, gazePoints, 1000);

    const topLeft = results.find(r => r.regionId === "top-left")!;
    expect(topLeft.fixationCount).toBe(2);
    expect(topLeft.dwellTimeMs).toBe(500); // 300 + 200

    const center = results.find(r => r.regionId === "center")!;
    expect(center.fixationCount).toBe(1);
    expect(center.dwellTimeMs).toBe(500);
  });

  it("computes entry count correctly", () => {
    const analyzer = new AOIAnalyzer();
    analyzer.addRegion({ id: "r1", name: "R1", x: 0, y: 0, width: 100, height: 100 });

    const gazePoints: GazePoint[] = [
      mkGaze(50, 50, 100),   // in
      mkGaze(50, 50, 200),   // in (same entry)
      mkGaze(200, 200, 300), // out
      mkGaze(50, 50, 400),   // in (new entry)
      mkGaze(200, 200, 500), // out
      mkGaze(50, 50, 600),   // in (new entry)
    ];

    const results = analyzer.analyze([], gazePoints, 100);
    expect(results[0].entryCount).toBe(3);
  });

  it("computes transition matrix", () => {
    const analyzer = new AOIAnalyzer();
    analyzer.addRegion({ id: "a", name: "A", x: 0, y: 0, width: 100, height: 100 });
    analyzer.addRegion({ id: "b", name: "B", x: 200, y: 200, width: 100, height: 100 });

    const fixations: Fixation[] = [
      mkFixation(50, 50, 1000, 200),    // in A
      mkFixation(250, 250, 1300, 200),   // in B (A→B)
      mkFixation(50, 50, 1600, 200),     // in A (B→A)
    ];

    const tm = analyzer.getTransitionMatrix(fixations);
    expect(tm.regionIds).toEqual(["a", "b"]);
    expect(tm.matrix[0][1]).toBe(1); // A→B
    expect(tm.matrix[1][0]).toBe(1); // B→A
    expect(tm.matrix[0][0]).toBe(0); // A→A (no self-transition)
  });

  it("returns empty results for no regions", () => {
    const analyzer = new AOIAnalyzer();
    const results = analyzer.analyze([], [], 0);
    expect(results).toHaveLength(0);
  });
});
