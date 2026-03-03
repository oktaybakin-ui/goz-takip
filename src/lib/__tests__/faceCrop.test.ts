/**
 * faceCrop.test.ts
 * Tests for face crop utility - requires heavy DOM/MediaPipe mocking
 */

// Mock faceCrop's internal MediaPipe dependency by mocking at module level
// The module checks window.FaceMesh and document

const mockResults = {
  multiFaceLandmarks: [
    Array.from({ length: 468 }, (_, i) => ({
      x: 0.3 + (i % 20) * 0.02,
      y: 0.2 + Math.floor(i / 20) * 0.02,
      z: 0,
    })),
  ],
};

const mockOnResults = jest.fn();
const mockSend = jest.fn().mockResolvedValue(undefined);

// Setup global mocks before importing the module
beforeAll(() => {
  // Mock window.FaceMesh
  (global as any).window = {
    FaceMesh: jest.fn().mockImplementation(() => ({
      setOptions: jest.fn(),
      onResults: (cb: any) => {
        mockOnResults.mockImplementation(cb);
      },
      send: (opts: any) => {
        // Simulate async face detection by calling onResults
        setTimeout(() => mockOnResults(mockResults), 0);
        return mockSend(opts);
      },
    })),
  };

  // Mock document
  (global as any).document = {
    querySelector: jest.fn().mockReturnValue(null),
    createElement: jest.fn().mockImplementation((tag: string) => {
      if (tag === "script") {
        return {
          src: "",
          crossOrigin: "",
          async: false,
          onerror: null,
          onload: null,
        };
      }
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: jest.fn().mockReturnValue({
            drawImage: jest.fn(),
          }),
          toDataURL: jest.fn().mockReturnValue("data:image/jpeg;base64,cropped"),
        };
      }
      if (tag === "a") {
        return { href: "", download: "", click: jest.fn() };
      }
      return {};
    }),
    head: {
      appendChild: jest.fn(),
    },
  };

  // Mock Image
  (global as any).Image = jest.fn().mockImplementation(() => {
    const img: any = {
      crossOrigin: "",
      src: "",
      onload: null,
      onerror: null,
      naturalWidth: 1920,
      naturalHeight: 1080,
      width: 1920,
      height: 1080,
    };
    // Trigger onload asynchronously when src is set
    Object.defineProperty(img, "src", {
      set(val: string) {
        img._src = val;
        setTimeout(() => img.onload?.(), 0);
      },
      get() {
        return img._src || "";
      },
    });
    return img;
  });
});

// Import after mocks are set up
import { destroyFaceCropMesh, cropImageToFace, cropImagesToFace } from "../faceCrop";

describe("faceCrop", () => {
  describe("destroyFaceCropMesh", () => {
    it("does not throw", () => {
      expect(() => destroyFaceCropMesh()).not.toThrow();
    });
  });

  describe("cropImageToFace", () => {
    it("returns a data URL when face is detected", async () => {
      const result = await cropImageToFace("data:image/png;base64,test");
      expect(result).toBe("data:image/jpeg;base64,cropped");
    });
  });

  describe("cropImagesToFace", () => {
    it("processes multiple images sequentially", async () => {
      const urls = [
        "data:image/png;base64,img1",
        "data:image/png;base64,img2",
      ];
      const results = await cropImagesToFace(urls);
      expect(results).toHaveLength(2);
    });

    it("calls onProgress callback", async () => {
      const progress = jest.fn();
      const urls = ["data:image/png;base64,img1"];

      await cropImagesToFace(urls, 0.25, progress);

      expect(progress).toHaveBeenCalled();
      // Final call should indicate completion
      const lastCall = progress.mock.calls[progress.mock.calls.length - 1];
      expect(lastCall[0]).toBe(lastCall[1]); // done === total
    });
  });
});
