import { GazeBenchmark, BenchmarkResult, BenchmarkPointResult } from "../benchmark";

// Mock GazeModel
function createMockModel(offsetX = 0, offsetY = 0, noise = 0) {
  return {
    predict(features: any) {
      // Return target position + offset + random noise
      const target = (features as any).__target;
      if (!target) return { x: 500 + offsetX, y: 400 + offsetY, confidence: 0.9 };
      return {
        x: target.x + offsetX + (noise > 0 ? (Math.random() - 0.5) * noise : 0),
        y: target.y + offsetY + (noise > 0 ? (Math.random() - 0.5) * noise : 0),
        confidence: 0.9,
      };
    },
  } as any;
}

describe("GazeBenchmark", () => {
  it("generates 9 test points for 3x3 grid", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    let totalPoints = 0;
    bench.start(1000, 800, 9, (_pt, _idx, total) => {
      totalPoints = total;
    }, () => {});

    expect(totalPoints).toBe(9);
    expect(bench.getTotalPoints()).toBe(9);
  });

  it("generates 16 test points for 4x4 grid", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    let totalPoints = 0;
    bench.start(1000, 800, 16, (_pt, _idx, total) => {
      totalPoints = total;
    }, () => {});

    expect(totalPoints).toBe(16);
    expect(bench.getTotalPoints()).toBe(16);
  });

  it("isActive returns true while running", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    expect(bench.isActive()).toBe(false);
    bench.start(1000, 800, 9, () => {}, () => {});
    expect(bench.isActive()).toBe(true);
  });

  it("stop sets isActive to false", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    bench.start(1000, 800, 9, () => {}, () => {});
    bench.stop();
    expect(bench.isActive()).toBe(false);
  });

  it("addSample returns true after 30 samples", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    bench.start(1000, 800, 9, () => {}, () => {});

    let ready = false;
    for (let i = 0; i < 30; i++) {
      ready = bench.addSample({ __target: { x: 80, y: 80 } } as any);
    }
    expect(ready).toBe(true);
  });

  it("addSample returns false when not running", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    expect(bench.addSample({} as any)).toBe(false);
  });

  it("completes a full benchmark cycle and calls onComplete", () => {
    const model = createMockModel(10, 10); // 10px offset = predictable error
    const bench = new GazeBenchmark(model);

    let result: BenchmarkResult | null = null;
    let pointChanges = 0;

    bench.start(1000, 800, 9,
      () => { pointChanges++; },
      (r) => { result = r; }
    );

    // Cycle through all 9 points
    for (let p = 0; p < 9; p++) {
      for (let s = 0; s < 30; s++) {
        bench.addSample({} as any); // uses default prediction
      }
      bench.nextPoint();
    }

    expect(result).not.toBeNull();
    expect(result!.pointResults.length).toBe(9);
    expect(result!.screenWidth).toBe(1000);
    expect(result!.screenHeight).toBe(800);
    expect(result!.meanErrorPx).toBeGreaterThan(0);
    expect(result!.meanAngularErrorDeg).toBeGreaterThan(0);
    expect(result!.spatialAccuracy).toBeGreaterThan(0);
    expect(result!.errorHeatmap.length).toBe(9); // 3x3 heatmap
  });

  it("point results have correct structure", () => {
    const model = createMockModel(5, 5);
    const bench = new GazeBenchmark(model);

    let result: BenchmarkResult | null = null;
    bench.start(800, 600, 9, () => {}, (r) => { result = r; });

    for (let p = 0; p < 9; p++) {
      for (let s = 0; s < 30; s++) bench.addSample({} as any);
      bench.nextPoint();
    }

    const pr = result!.pointResults[0];
    expect(pr).toHaveProperty("pointId");
    expect(pr).toHaveProperty("targetX");
    expect(pr).toHaveProperty("targetY");
    expect(pr).toHaveProperty("errorPx");
    expect(pr).toHaveProperty("errorAngularDeg");
    expect(pr).toHaveProperty("precision");
    expect(pr).toHaveProperty("sampleCount");
    expect(pr.sampleCount).toBe(30);
  });

  it("error heatmap has 9 cells (3x3)", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    let result: BenchmarkResult | null = null;
    bench.start(900, 600, 9, () => {}, (r) => { result = r; });

    for (let p = 0; p < 9; p++) {
      for (let s = 0; s < 30; s++) bench.addSample({} as any);
      bench.nextPoint();
    }

    expect(result!.errorHeatmap.length).toBe(9);
    for (const cell of result!.errorHeatmap) {
      expect(cell).toHaveProperty("gridRow");
      expect(cell).toHaveProperty("gridCol");
      expect(cell).toHaveProperty("centerX");
      expect(cell).toHaveProperty("centerY");
      expect(cell).toHaveProperty("errorPx");
    }
  });

  it("exportJSON produces valid JSON", () => {
    const mockResult: BenchmarkResult = {
      timestamp: 1700000000000,
      screenWidth: 1920,
      screenHeight: 1080,
      screenDistancePx: 2268,
      pointResults: [{
        pointId: 0,
        targetX: 100,
        targetY: 100,
        predictions: [{ x: 110, y: 105, confidence: 0.9 }],
        meanPredX: 110,
        meanPredY: 105,
        errorPx: 11.18,
        errorAngularDeg: 0.28,
        precision: 0,
        sampleCount: 1,
      }],
      meanErrorPx: 11.18,
      medianErrorPx: 11.18,
      maxErrorPx: 11.18,
      meanAngularErrorDeg: 0.28,
      spatialAccuracy: 0.51,
      spatialPrecision: 0,
      errorHeatmap: [{
        gridRow: 0,
        gridCol: 0,
        centerX: 320,
        centerY: 180,
        errorPx: 11.18,
      }],
    };

    const json = GazeBenchmark.exportJSON(mockResult);
    const parsed = JSON.parse(json);
    expect(parsed.benchmark).toBeDefined();
    expect(parsed.benchmark.summary.mean_error_px).toBe(11.2);
    expect(parsed.benchmark.points).toHaveLength(1);
    expect(parsed.benchmark.error_heatmap).toHaveLength(1);
  });

  it("nextPoint returns false when not running", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);
    expect(bench.nextPoint()).toBe(false);
  });

  it("nextPoint returns false on last point (finalize)", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    bench.start(800, 600, 9, () => {}, () => {});

    // Complete all 9 points
    for (let p = 0; p < 8; p++) {
      for (let s = 0; s < 30; s++) bench.addSample({} as any);
      expect(bench.nextPoint()).toBe(true); // still has more
    }
    // Last point
    for (let s = 0; s < 30; s++) bench.addSample({} as any);
    expect(bench.nextPoint()).toBe(false); // done
  });

  it("getCurrentPointIndex advances correctly", () => {
    const model = createMockModel();
    const bench = new GazeBenchmark(model);

    bench.start(800, 600, 9, () => {}, () => {});
    expect(bench.getCurrentPointIndex()).toBe(0);

    for (let s = 0; s < 30; s++) bench.addSample({} as any);
    bench.nextPoint();
    expect(bench.getCurrentPointIndex()).toBe(1);
  });
});
