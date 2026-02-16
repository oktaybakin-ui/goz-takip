/**
 * Face Tracker Modülü
 *
 * MediaPipe FaceMesh + Iris ile göz takibi:
 * - Yüz landmark tespiti
 * - İris merkezi hesaplama
 * - Head pose estimation (yaw, pitch, roll)
 * - Eye openness hesaplama
 * - Blink tespiti
 */

import { EyeFeatures } from "./gazeModel";

// MediaPipe landmark indeksleri
const LEFT_EYE_INDICES = {
  // Sol göz çevresi
  upper: [159, 145, 133, 173, 157, 158, 153, 144, 163, 7],
  lower: [145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  // Sol iris
  iris: [468, 469, 470, 471, 472],
  center: 468,
};

const RIGHT_EYE_INDICES = {
  // Sağ göz çevresi
  upper: [386, 374, 362, 398, 384, 385, 380, 373, 390, 249],
  lower: [374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  // Sağ iris
  iris: [473, 474, 475, 476, 477],
  center: 473,
};

// Head pose için referans noktaları
const FACE_POSE_LANDMARKS = {
  noseTip: 1,
  chin: 199,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftMouthCorner: 61,
  rightMouthCorner: 291,
  foreheadCenter: 10,
};

interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export class FaceTracker {
  private faceMesh: any = null;
  private camera: any = null;
  private videoElement: HTMLVideoElement | null = null;
  private isRunning: boolean = false;
  private onFeaturesCallback: ((features: EyeFeatures) => void) | null = null;
  private lastFeatures: EyeFeatures | null = null;
  private frameCount: number = 0;
  private fps: number = 0;
  private lastFpsTime: number = 0;

  async initialize(videoElement: HTMLVideoElement): Promise<boolean> {
    this.videoElement = videoElement;

    try {
      // Kamera erişimi
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, min: 15 },
          facingMode: "user",
        },
      });

      videoElement.srcObject = stream;
      await videoElement.play();

      // MediaPipe FaceMesh yükle
      await this.loadFaceMesh();

      return true;
    } catch (error) {
      console.error("Kamera başlatılamadı:", error);
      return false;
    }
  }

  private async loadFaceMesh(): Promise<void> {
    // @ts-ignore - MediaPipe global olarak yüklenir
    const FaceMesh = window.FaceMesh;

    if (!FaceMesh) {
      throw new Error("MediaPipe FaceMesh yüklenemedi. CDN script'ini kontrol edin.");
    }

    this.faceMesh = new FaceMesh({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      },
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true, // Iris landmark'ları için gerekli
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.faceMesh.onResults((results: any) => this.processResults(results));
  }

  // Frame döngüsünü başlat
  startTracking(callback: (features: EyeFeatures) => void): void {
    this.onFeaturesCallback = callback;
    this.isRunning = true;
    this.lastFpsTime = performance.now();
    this.frameCount = 0;
    this.processFrame();
  }

  // Frame döngüsünü durdur
  stopTracking(): void {
    this.isRunning = false;
    this.onFeaturesCallback = null;
  }

  private async processFrame(): Promise<void> {
    if (!this.isRunning || !this.videoElement || !this.faceMesh) return;

    try {
      await this.faceMesh.send({ image: this.videoElement });
    } catch (e) {
      // Frame hatası - devam et
    }

    // FPS hesapla
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    if (this.isRunning) {
      requestAnimationFrame(() => this.processFrame());
    }
  }

  private processResults(results: any): void {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      // Yüz bulunamadı
      if (this.onFeaturesCallback) {
        this.onFeaturesCallback({
          leftIrisX: 0,
          leftIrisY: 0,
          rightIrisX: 0,
          rightIrisY: 0,
          pupilRadius: 0,
          eyeOpenness: 0,
          yaw: 0,
          pitch: 0,
          roll: 0,
          faceScale: 0,
          confidence: 0,
        });
      }
      return;
    }

    const landmarks: FaceLandmark[] = results.multiFaceLandmarks[0];
    const features = this.extractFeatures(landmarks);
    this.lastFeatures = features;

    if (this.onFeaturesCallback) {
      this.onFeaturesCallback(features);
    }
  }

  private extractFeatures(landmarks: FaceLandmark[]): EyeFeatures {
    // İris merkezleri
    const leftIris = this.getIrisCenter(landmarks, LEFT_EYE_INDICES);
    const rightIris = this.getIrisCenter(landmarks, RIGHT_EYE_INDICES);

    // Pupil yarıçapı (iris landmark'larından)
    const pupilRadius = this.calculatePupilRadius(landmarks);

    // Göz açıklığı
    const eyeOpenness = this.calculateEyeOpenness(landmarks);

    // Head pose
    const headPose = this.estimateHeadPose(landmarks);

    // Yüz ölçeği (bounding box)
    const faceScale = this.calculateFaceScale(landmarks);

    // Güven skoru
    const confidence = eyeOpenness > 0.1 ? 0.9 : 0.1;

    return {
      leftIrisX: leftIris.x,
      leftIrisY: leftIris.y,
      rightIrisX: rightIris.x,
      rightIrisY: rightIris.y,
      pupilRadius,
      eyeOpenness,
      yaw: headPose.yaw,
      pitch: headPose.pitch,
      roll: headPose.roll,
      faceScale,
      confidence,
    };
  }

  private getIrisCenter(
    landmarks: FaceLandmark[],
    eyeIndices: typeof LEFT_EYE_INDICES
  ): { x: number; y: number } {
    if (landmarks.length <= eyeIndices.center) {
      // Iris landmark'ları yoksa göz merkezini kullan
      const upperPoints = eyeIndices.upper
        .filter((i) => i < landmarks.length)
        .map((i) => landmarks[i]);
      const lowerPoints = eyeIndices.lower
        .filter((i) => i < landmarks.length)
        .map((i) => landmarks[i]);

      const allPoints = [...upperPoints, ...lowerPoints];
      if (allPoints.length === 0) return { x: 0.5, y: 0.5 };

      return {
        x: allPoints.reduce((s, p) => s + p.x, 0) / allPoints.length,
        y: allPoints.reduce((s, p) => s + p.y, 0) / allPoints.length,
      };
    }

    const center = landmarks[eyeIndices.center];
    return { x: center.x, y: center.y };
  }

  private calculatePupilRadius(landmarks: FaceLandmark[]): number {
    if (landmarks.length <= 472) return 0.01;

    // Sol iris çevresi
    const irisPoints = LEFT_EYE_INDICES.iris
      .filter((i) => i < landmarks.length)
      .map((i) => landmarks[i]);

    if (irisPoints.length < 2) return 0.01;

    const center = landmarks[LEFT_EYE_INDICES.center];
    let totalDist = 0;
    let count = 0;

    for (const point of irisPoints) {
      if (point === center) continue;
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      totalDist += Math.sqrt(dx * dx + dy * dy);
      count++;
    }

    return count > 0 ? totalDist / count : 0.01;
  }

  private calculateEyeOpenness(landmarks: FaceLandmark[]): number {
    // Sol göz için dikey açıklık / yatay genişlik
    const leftUpper = landmarks[159]; // Üst kapak
    const leftLower = landmarks[145]; // Alt kapak
    const leftInner = landmarks[133]; // İç köşe
    const leftOuter = landmarks[33];  // Dış köşe

    if (!leftUpper || !leftLower || !leftInner || !leftOuter) return 0.5;

    const verticalDist = Math.sqrt(
      (leftUpper.x - leftLower.x) ** 2 + (leftUpper.y - leftLower.y) ** 2
    );
    const horizontalDist = Math.sqrt(
      (leftInner.x - leftOuter.x) ** 2 + (leftInner.y - leftOuter.y) ** 2
    );

    if (horizontalDist < 0.001) return 0;

    return verticalDist / horizontalDist;
  }

  private estimateHeadPose(landmarks: FaceLandmark[]): {
    yaw: number;
    pitch: number;
    roll: number;
  } {
    const noseTip = landmarks[FACE_POSE_LANDMARKS.noseTip];
    const chin = landmarks[FACE_POSE_LANDMARKS.chin];
    const leftEye = landmarks[FACE_POSE_LANDMARKS.leftEyeOuter];
    const rightEye = landmarks[FACE_POSE_LANDMARKS.rightEyeOuter];
    const forehead = landmarks[FACE_POSE_LANDMARKS.foreheadCenter];

    if (!noseTip || !chin || !leftEye || !rightEye || !forehead) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    // Yaw (sağ-sol dönüş)
    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const yaw = (noseTip.x - eyeMidX) * 2;

    // Pitch (yukarı-aşağı)
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const faceHeight = Math.abs(forehead.y - chin.y);
    const pitch = faceHeight > 0.001
      ? ((noseTip.y - eyeMidY) / faceHeight - 0.5) * 2
      : 0;

    // Roll (eğilme)
    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

    return { yaw, pitch, roll };
  }

  private calculateFaceScale(landmarks: FaceLandmark[]): number {
    const leftEye = landmarks[FACE_POSE_LANDMARKS.leftEyeOuter];
    const rightEye = landmarks[FACE_POSE_LANDMARKS.rightEyeOuter];
    const chin = landmarks[FACE_POSE_LANDMARKS.chin];
    const forehead = landmarks[FACE_POSE_LANDMARKS.foreheadCenter];

    if (!leftEye || !rightEye || !chin || !forehead) return 1;

    const eyeWidth = Math.sqrt(
      (rightEye.x - leftEye.x) ** 2 + (rightEye.y - leftEye.y) ** 2
    );
    const faceHeight = Math.sqrt(
      (forehead.x - chin.x) ** 2 + (forehead.y - chin.y) ** 2
    );

    return (eyeWidth + faceHeight) / 2;
  }

  // Kamerayı durdur
  destroy(): void {
    this.isRunning = false;

    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.videoElement.srcObject = null;
    }

    this.faceMesh = null;
  }

  getFPS(): number {
    return this.fps;
  }

  getLastFeatures(): EyeFeatures | null {
    return this.lastFeatures;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
