import { GazeModel, OneEuroFilter } from "../gazeModel";

describe("GazeModel", () => {
  it("starts untrained", () => {
    const model = new GazeModel(0.5);
    expect(model.isTrained()).toBe(false);
    expect(model.predict({} as any)).toBeNull();
  });

  it("exportModel returns JSON string", () => {
    const model = new GazeModel(0.5);
    const json = model.exportModel();
    expect(typeof json).toBe("string");
    const data = JSON.parse(json);
    expect(data).toHaveProperty("weightsX");
    expect(data).toHaveProperty("lambda");
  });

  it("importModel restores trained state", () => {
    const model = new GazeModel(0.5);
    const json = model.exportModel();
    const model2 = new GazeModel(0.5);
    model2.importModel(json);
    expect(model2.isTrained()).toBe(true);
  });
});

describe("OneEuroFilter", () => {
  it("returns first value on first call", () => {
    const f = new OneEuroFilter(1, 0.01, 1);
    expect(f.filter(10, 0)).toBe(10);
  });

  it("smooths subsequent values", () => {
    const f = new OneEuroFilter(1, 0.01, 1);
    f.filter(10, 0);
    const out = f.filter(12, 100);
    expect(out).toBeGreaterThanOrEqual(10);
    expect(out).toBeLessThanOrEqual(12);
  });

  it("reset clears state", () => {
    const f = new OneEuroFilter(1, 0.01, 1);
    f.filter(10, 0);
    f.reset();
    expect(f.filter(5, 0)).toBe(5);
  });
});
