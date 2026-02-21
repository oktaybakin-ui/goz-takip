import { HeatmapGenerator } from "../heatmap";
import type { GazePoint } from "../gazeModel";
import type { Fixation } from "../fixation";

describe("HeatmapGenerator", () => {
  it("instantiates with default config", () => {
    const gen = new HeatmapGenerator();
    expect(gen).toBeDefined();
  });

  it("accepts partial config", () => {
    const gen = new HeatmapGenerator({ radius: 80, blur: 30 });
    expect(gen).toBeDefined();
  });

  it("updateConfig does not throw", () => {
    const gen = new HeatmapGenerator();
    expect(() => gen.updateConfig({ maxOpacity: 0.8 })).not.toThrow();
  });

  it("render with empty points does not throw (no document)", () => {
    const gen = new HeatmapGenerator();
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    if (!canvas) {
      expect(typeof document).toBe("undefined");
      return;
    }
    gen.render(canvas, [], [], 100, 100);
  });

  it("render with mock gaze points does not throw when document exists", () => {
    if (typeof document === "undefined") return;
    const gen = new HeatmapGenerator();
    const canvas = document.createElement("canvas");
    const points: GazePoint[] = [
      { x: 50, y: 50, timestamp: 1000, confidence: 0.9 },
      { x: 55, y: 52, timestamp: 1100, confidence: 0.85 },
    ];
    expect(() => gen.render(canvas, points, [], 200, 200)).not.toThrow();
  });

  it("render with mock fixations does not throw when document exists", () => {
    if (typeof document === "undefined") return;
    const gen = new HeatmapGenerator();
    const canvas = document.createElement("canvas");
    const fixations: Fixation[] = [
      {
        x: 100,
        y: 100,
        startTime: 0,
        endTime: 200,
        duration: 200,
        pointCount: 10,
        avgConfidence: 0.9,
      },
    ];
    expect(() => gen.render(canvas, [], fixations, 200, 200)).not.toThrow();
  });
});
