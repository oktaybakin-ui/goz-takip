import {
  saveCalibration,
  loadCalibration,
  hasStoredCalibration,
  clearCalibration,
  CALIBRATION_STORAGE_KEY,
} from "../calibrationStorage";

const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = value;
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
};

describe("calibrationStorage", () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
    (global as any).localStorage = localStorageMock;
  });

  it("saveCalibration stores valid data", () => {
    saveCalibration('{"weightsX":[]}', 12.5);
    expect(storage[CALIBRATION_STORAGE_KEY]).toBeTruthy();
    const parsed = JSON.parse(storage[CALIBRATION_STORAGE_KEY]);
    expect(parsed.modelJson).toBe('{"weightsX":[]}');
    expect(parsed.meanErrorPx).toBe(12.5);
    expect(parsed.savedAt).toBeGreaterThan(0);
  });

  it("loadCalibration returns null when empty", () => {
    expect(loadCalibration()).toBeNull();
  });

  it("loadCalibration returns data after save", () => {
    saveCalibration("model-json", 10);
    const loaded = loadCalibration();
    expect(loaded).not.toBeNull();
    expect(loaded!.modelJson).toBe("model-json");
    expect(loaded!.meanErrorPx).toBe(10);
  });

  it("loadCalibration returns null for invalid json", () => {
    storage[CALIBRATION_STORAGE_KEY] = "not json";
    expect(loadCalibration()).toBeNull();
  });

  it("hasStoredCalibration reflects storage", () => {
    expect(hasStoredCalibration()).toBe(false);
    saveCalibration("x", 0);
    expect(hasStoredCalibration()).toBe(true);
  });

  it("clearCalibration removes key", () => {
    saveCalibration("x", 0);
    clearCalibration();
    expect(loadCalibration()).toBeNull();
  });
});
