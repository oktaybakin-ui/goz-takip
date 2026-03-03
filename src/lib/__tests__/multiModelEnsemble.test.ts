import { MultiModelEnsemble } from "../multiModelEnsemble";
import type { CalibrationSample, EyeFeatures } from "../gazeModel";

jest.mock("../logger", () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Track mock instances so we can control per-model behavior
const mockInstances: any[] = [];

jest.mock("../gazeModel", () => {
  return {
    GazeModel: jest.fn().mockImplementation((lambda: number) => {
      const instance = {
        lambda,
        _trained: false,
        train: jest.fn().mockImplementation(() => {
          instance._trained = true;
        }),
        predict: jest.fn().mockImplementation((features: any) => {
          if (!instance._trained) return null;
          return { x: 500 + lambda * 100, y: 400 + lambda * 50, confidence: 0.9 };
        }),
        resetSmoothing: jest.fn(),
      };
      mockInstances.push(instance);
      return instance;
    }),
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

// Features with the shape hashFeatures expects
function makePredictFeatures() {
  return {
    ...makeFeatures(),
    leftPupil: { x: 0.5, y: 0.5 },
    rightPupil: { x: 0.5, y: 0.5 },
    leftIris: { x: 0.5, y: 0.5 },
    rightIris: { x: 0.5, y: 0.5 },
  };
}

function makeSample(targetX: number, targetY: number): CalibrationSample {
  return { features: makeFeatures(), targetX, targetY };
}

function makeSamples(n: number): CalibrationSample[] {
  const samples: CalibrationSample[] = [];
  for (let i = 0; i < n; i++) {
    samples.push(makeSample(100 + i * 10, 200 + i * 5));
  }
  return samples;
}

describe("MultiModelEnsemble", () => {
  beforeEach(() => {
    mockInstances.length = 0;
  });

  describe("constructor", () => {
    it("creates 3 models by default", () => {
      const ensemble = new MultiModelEnsemble();
      expect(mockInstances).toHaveLength(3);
    });

    it("accepts custom config", () => {
      mockInstances.length = 0;
      const ensemble = new MultiModelEnsemble({
        modelConfigs: [
          { lambda: 0.01, sampleWeight: "uniform" },
          { lambda: 0.05, sampleWeight: "confidence" },
        ],
      });
      expect(mockInstances).toHaveLength(2);
    });
  });

  describe("train", () => {
    it("trains all models when >= 50 samples", () => {
      const ensemble = new MultiModelEnsemble();
      const samples = makeSamples(60);

      ensemble.train(samples);

      mockInstances.forEach((m) => {
        expect(m.train).toHaveBeenCalled();
      });
    });

    it("falls back to single model when < 50 samples", () => {
      const ensemble = new MultiModelEnsemble();
      const samples = makeSamples(30);

      ensemble.train(samples);

      // Only first model should be trained
      expect(mockInstances[0].train).toHaveBeenCalled();
    });
  });

  describe("predict", () => {
    it("returns null when no models trained", () => {
      const ensemble = new MultiModelEnsemble();
      const result = ensemble.predict(makePredictFeatures());
      expect(result).toBeNull();
    });

    it("returns weighted average when models produce predictions", () => {
      const ensemble = new MultiModelEnsemble();
      ensemble.train(makeSamples(60));

      const result = ensemble.predict(makePredictFeatures());
      expect(result).not.toBeNull();
      expect(result!.x).toBeGreaterThan(0);
      expect(result!.y).toBeGreaterThan(0);
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it("returns null when all predictions null", () => {
      const ensemble = new MultiModelEnsemble();
      // Models are not trained so predict returns null
      const result = ensemble.predict(makePredictFeatures());
      expect(result).toBeNull();
    });
  });

  describe("getModelPredictions", () => {
    it("returns per-model predictions with weights", () => {
      const ensemble = new MultiModelEnsemble();
      ensemble.train(makeSamples(60));

      const preds = ensemble.getModelPredictions(makePredictFeatures());
      expect(preds).toHaveLength(3);
      preds.forEach((p) => {
        if (p !== null) {
          expect(p).toHaveProperty("weight");
          expect(p).toHaveProperty("x");
          expect(p).toHaveProperty("y");
        }
      });
    });
  });

  describe("reset", () => {
    it("resets smoothing and clears cache", () => {
      const ensemble = new MultiModelEnsemble();
      ensemble.train(makeSamples(60));
      ensemble.predict(makePredictFeatures()); // populate cache

      ensemble.reset();

      mockInstances.forEach((m) => {
        expect(m.resetSmoothing).toHaveBeenCalled();
      });
    });
  });
});
