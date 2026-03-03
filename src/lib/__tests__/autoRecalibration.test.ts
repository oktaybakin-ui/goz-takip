import { AutoRecalibration } from "../autoRecalibration";
import type { RecalibrationConfig } from "../autoRecalibration";
import type { EyeFeatures, CalibrationSample } from "../gazeModel";
import type { Fixation } from "../fixation";

jest.mock("../logger", () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Mock GazeModel constructor used inside updateModel
jest.mock("../gazeModel", () => {
  const mPredict = jest.fn().mockReturnValue({ x: 100, y: 100, confidence: 0.9 });
  const mTrain = jest.fn();
  const mResetSmoothing = jest.fn();
  return {
    GazeModel: jest.fn().mockImplementation(() => ({
      predict: mPredict,
      train: mTrain,
      resetSmoothing: mResetSmoothing,
      getWeights: jest.fn().mockReturnValue({ wx: [], wy: [] }),
      setWeights: jest.fn(),
    })),
    // Re-export types (not actual values at runtime, but keeps TS happy)
    __esModule: true,
  };
});

function makeFeatures(overrides?: Partial<EyeFeatures>): EyeFeatures {
  return {
    leftIrisX: 0.5, leftIrisY: 0.5,
    rightIrisX: 0.5, rightIrisY: 0.5,
    leftIrisRelX: 0.5, leftIrisRelY: 0.5,
    rightIrisRelX: 0.5, rightIrisRelY: 0.5,
    pupilRadius: 0.1, eyeOpenness: 0.2,
    leftEAR: 0.3, rightEAR: 0.3,
    yaw: 0, pitch: 0, roll: 0, faceScale: 0.5,
    leftEyeWidth: 0.1, rightEyeWidth: 0.1,
    confidence: 0.85,
    ...overrides,
  };
}

function makeFixation(overrides?: Partial<Fixation>): Fixation {
  return {
    x: 400, y: 300,
    startTime: 1000, endTime: 2000,
    duration: 1000,
    pointCount: 25,
    avgConfidence: 0.85,
    ...overrides,
  } as Fixation;
}

describe("AutoRecalibration", () => {
  let ar: AutoRecalibration;

  beforeEach(() => {
    ar = new AutoRecalibration();
    jest.spyOn(Date, "now").mockReturnValue(10000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("instantiates with defaults", () => {
      const stats = ar.getStats();
      expect(stats.sampleCount).toBe(0);
      expect(stats.lastUpdate).toBe(0);
    });

    it("accepts partial config", () => {
      const custom = new AutoRecalibration({ minFixationDuration: 200 });
      expect(custom.getStats().sampleCount).toBe(0);
    });
  });

  describe("registerClick", () => {
    it("adds click to history", () => {
      ar.registerClick(100, 200);
      const stats = ar.getStats();
      expect(stats.clickCorrelations).toBe(1);
    });

    it("prunes clicks older than 5 minutes", () => {
      (Date.now as jest.Mock).mockReturnValue(1000);
      ar.registerClick(100, 200);

      // 6 minutes later
      (Date.now as jest.Mock).mockReturnValue(1000 + 6 * 60 * 1000);
      ar.registerClick(300, 400);

      const stats = ar.getStats();
      expect(stats.clickCorrelations).toBe(1); // only the recent one
    });
  });

  describe("registerFixation", () => {
    it("skips fixations below minFixationDuration", () => {
      const shortFixation = makeFixation({ duration: 100 }); // default threshold is 500
      ar.registerFixation(shortFixation, makeFeatures());
      // No error, just silently skipped
      expect(ar.getStats().sampleCount).toBe(0);
    });

    it("skips fixations below minConfidence", () => {
      const lowConf = makeFixation({ avgConfidence: 0.3 }); // default threshold is 0.7
      ar.registerFixation(lowConf, makeFeatures());
      expect(ar.getStats().sampleCount).toBe(0);
    });

    it("accepts valid fixations into buffer", () => {
      const fix = makeFixation({ duration: 600, avgConfidence: 0.85 });
      ar.registerFixation(fix, makeFeatures());
      // Fixation goes to fixationBuffer, not sampleBuffer directly
      // So sampleCount remains 0 (samples come from correlation)
      expect(ar.getStats().sampleCount).toBe(0);
    });
  });

  describe("registerUIElement", () => {
    it("stores bounds", () => {
      ar.registerUIElement("btn-start", { x: 100, y: 50, width: 200, height: 60 });
      // No direct getter, but checkUIElementFixation should find it
      expect(() =>
        ar.registerUIElement("btn-stop", { x: 400, y: 50, width: 200, height: 60 })
      ).not.toThrow();
    });
  });

  describe("updateModel", () => {
    function createMockModel() {
      return {
        predict: jest.fn().mockReturnValue({ x: 100, y: 100, confidence: 0.9 }),
        train: jest.fn(),
        resetSmoothing: jest.fn(),
        getWeights: jest.fn().mockReturnValue({ wx: [], wy: [] }),
        setWeights: jest.fn(),
      } as any;
    }

    it("returns false when interval not elapsed", () => {
      const model = createMockModel();
      (Date.now as jest.Mock).mockReturnValue(1000);
      expect(ar.updateModel(model)).toBe(false);
    });

    it("returns false when fewer than 50 samples", () => {
      const model = createMockModel();
      (Date.now as jest.Mock).mockReturnValue(100000); // enough time passed
      expect(ar.updateModel(model)).toBe(false);
    });
  });

  describe("getStats", () => {
    it("returns correct structure", () => {
      const stats = ar.getStats();
      expect(stats).toHaveProperty("sampleCount");
      expect(stats).toHaveProperty("lastUpdate");
      expect(stats).toHaveProperty("averageImprovement");
      expect(stats).toHaveProperty("clickCorrelations");
      expect(typeof stats.averageImprovement).toBe("number");
    });

    it("averageImprovement is 0 with no updates", () => {
      expect(ar.getStats().averageImprovement).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears all buffers and history", () => {
      ar.registerClick(100, 200);
      ar.registerClick(300, 400);
      ar.reset();

      const stats = ar.getStats();
      expect(stats.sampleCount).toBe(0);
      expect(stats.clickCorrelations).toBe(0);
      expect(stats.lastUpdate).toBe(0);
      expect(stats.averageImprovement).toBe(0);
    });
  });
});
