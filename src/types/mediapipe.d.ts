/**
 * MediaPipe Face Mesh – minimal tip tanımları (CDN ile yüklendiğinde)
 */
declare global {
  interface Window {
    FaceMesh?: new (options?: {
      locateFile?: (file: string) => string;
    }) => MediaPipeFaceMesh;
  }
}

export interface MediaPipeFaceMesh {
  setOptions(options: {
    maxNumFaces?: number;
    refineLandmarks?: boolean;
    minDetectionConfidence?: number;
    minTrackingConfidence?: number;
  }): void;
  onResults(callback: (results: MediaPipeFaceMeshResults) => void): void;
  send(input: { image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement }): Promise<void>;
}

export interface MediaPipeFaceMeshResults {
  multiFaceLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
}

export {};
