import { computeQualityMetrics, exportCSV, downloadCSV } from "../qualityScore";
import type { GazePoint } from "../gazeModel";

function gp(x: number, y: number, t: number, confidence = 0.9): GazePoint {
  return { x, y, timestamp: t, confidence };
}

describe("qualityScore", () => {
  const dims = { width: 1000, height: 800 };
  const expectedMs = 20000;

  describe("computeQualityMetrics", () => {
    it("returns grade D with zeroed metrics for < 2 points", () => {
      const r = computeQualityMetrics([gp(100, 100, 0)], dims, expectedMs);
      expect(r.grade).toBe("D");
      expect(r.overallScore).toBe(0);
      expect(r.samplingRateHz).toBe(0);
    });

    it("returns empty result for 0 points", () => {
      const r = computeQualityMetrics([], dims, expectedMs);
      expect(r.grade).toBe("D");
    });

    it("returns grade A for high quality data", () => {
      // All on-screen, high confidence, good rate, full duration
      const points: GazePoint[] = [];
      for (let i = 0; i < 500; i++) {
        points.push(gp(500, 400, i * 40, 0.95)); // 25Hz, 20s
      }
      const r = computeQualityMetrics(points, dims, expectedMs);
      expect(r.grade).toBe("A");
      expect(r.overallScore).toBeGreaterThanOrEqual(80);
    });

    it("returns grade B for decent data", () => {
      const points: GazePoint[] = [];
      // 15Hz rate, some off-screen, decent confidence
      for (let i = 0; i < 300; i++) {
        const offScreen = i % 5 === 0;
        points.push(
          gp(
            offScreen ? -200 : 500,
            offScreen ? -200 : 400,
            i * 67, // ~15Hz
            0.6
          )
        );
      }
      const r = computeQualityMetrics(points, dims, expectedMs);
      expect(["A", "B"]).toContain(r.grade);
      expect(r.overallScore).toBeGreaterThanOrEqual(60);
    });

    it("returns grade D for mostly off-screen data", () => {
      const points: GazePoint[] = [];
      for (let i = 0; i < 50; i++) {
        points.push(gp(-500, -500, i * 100, 0.2));
      }
      const r = computeQualityMetrics(points, dims, expectedMs);
      expect(r.grade).toBe("D");
      expect(r.overallScore).toBeLessThan(40);
    });

    it("calculates gazeOnScreenPercent with 5% margin", () => {
      // Point at -4% of width should be on screen (within 5% margin)
      const points = [
        gp(-40, 400, 0, 0.9), // -4% of 1000 → within margin
        gp(500, 400, 1000, 0.9),
      ];
      const r = computeQualityMetrics(points, dims, expectedMs);
      expect(r.gazeOnScreenPercent).toBe(100);
    });

    it("calculates samplingRateHz correctly", () => {
      const points: GazePoint[] = [];
      for (let i = 0; i < 100; i++) {
        points.push(gp(500, 400, i * 40, 0.9)); // 25 Hz
      }
      const r = computeQualityMetrics(points, dims, expectedMs);
      expect(r.samplingRateHz).toBeGreaterThan(20);
      expect(r.samplingRateHz).toBeLessThan(30);
    });

    it("calculates dataIntegrityPercent based on confidence > 0.4", () => {
      const points = [
        gp(500, 400, 0, 0.9),
        gp(500, 400, 40, 0.1), // below threshold
        gp(500, 400, 80, 0.8),
        gp(500, 400, 120, 0.3), // below threshold
      ];
      const r = computeQualityMetrics(points, dims, expectedMs);
      expect(r.dataIntegrityPercent).toBe(50);
    });
  });

  describe("exportCSV", () => {
    it("produces correct header lines", () => {
      const csv = exportCSV([], []);
      expect(csv).toContain("## GAZE POINTS");
      expect(csv).toContain("timestamp_ms,x,y,confidence");
      expect(csv).toContain("## FIXATIONS");
      expect(csv).toContain("fixation_id,x,y,start_ms,end_ms,duration_ms");
    });

    it("includes gaze point rows", () => {
      const points = [gp(100.5, 200.3, 1000, 0.85)];
      const csv = exportCSV(points, []);
      const lines = csv.split("\n");
      const dataLine = lines.find((l) => l.startsWith("1000,"));
      expect(dataLine).toBe("1000,101,200,0.85");
    });

    it("includes fixation rows", () => {
      const fixations = [
        { x: 300, y: 400, startTime: 100, endTime: 600, duration: 500 },
      ];
      const csv = exportCSV([], fixations);
      expect(csv).toContain("1,300,400,100,600,500");
    });

    it("handles empty arrays", () => {
      const csv = exportCSV([], []);
      expect(csv).toContain("## GAZE POINTS");
      expect(csv).toContain("## FIXATIONS");
    });
  });

  describe("downloadCSV", () => {
    it("creates blob and triggers download", () => {
      const mockClick = jest.fn();
      const mockRevokeObjectURL = jest.fn();
      const mockCreateObjectURL = jest.fn(() => "blob:test-url");
      const mockCreateElement = jest.fn(() => ({
        href: "",
        download: "",
        click: mockClick,
      }));

      (global as any).Blob = jest.fn();
      (global as any).URL = {
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL,
      };
      (global as any).document = {
        createElement: mockCreateElement,
      };

      downloadCSV("test,data", "test.csv");

      expect(global.Blob).toHaveBeenCalledWith(
        ["\uFEFF" + "test,data"],
        { type: "text/csv;charset=utf-8;" }
      );
      expect(mockCreateElement).toHaveBeenCalledWith("a");
      expect(mockClick).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:test-url");
    });
  });
});
