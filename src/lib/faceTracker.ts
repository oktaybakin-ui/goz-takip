/**
 * Face Tracker Modülü
 *
 * MediaPipe FaceMesh + Iris ile göz takibi:
 * - Yüz landmark tespiti
 * - İris merkezi hesaplama
 * - Head pose estimation (yaw, pitch, roll)
 * - Eye openness hesaplama
 * - Blink tespiti
 *
 * Kamera bağlantısını korur, tracking durduğunda stream kesilmez.
 */

import { EyeFeatures } from "./gazeModel";
import { logger } from "./logger";

// MediaPipe landmark indeksleri
const LEFT_EYE_INDICES = {
  upper: [159, 145, 133, 173, 157, 158, 153, 144, 163, 7],
  lower: [145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  iris: [468, 469, 470, 471, 472],
  center: 468,
  // Göz köşe noktaları (göreceli iris hesabı için)
  innerCorner: 133,  // İç köşe
  outerCorner: 33,   // Dış köşe
  topMid: 159,       // Üst orta
  bottomMid: 145,    // Alt orta
  // EAR hesabı için
  earP1: 33,   // dış köşe
  earP2: 160,  // üst-dış
  earP3: 158,  // üst-iç
  earP4: 133,  // iç köşe
  earP5: 153,  // alt-iç
  earP6: 144,  // alt-dış
};

const RIGHT_EYE_INDICES = {
  upper: [386, 374, 362, 398, 384, 385, 380, 373, 390, 249],
  lower: [374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  iris: [473, 474, 475, 476, 477],
  center: 473,
  // Göz köşe noktaları (göreceli iris hesabı için)
  innerCorner: 362,  // İç köşe
  outerCorner: 263,  // Dış köşe
  topMid: 386,       // Üst orta
  bottomMid: 374,    // Alt orta
  // EAR hesabı için
  earP1: 263,  // dış köşe
  earP2: 387,  // üst-dış
  earP3: 385,  // üst-iç
  earP4: 362,  // iç köşe
  earP5: 380,  // alt-iç
  earP6: 373,  // alt-dış
};

const FACE_POSE_LANDMARKS = {
  noseTip: 1,
  chin: 199,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftMouthCorner: 61,
  rightMouthCorner: 291,
  foreheadCenter: 10,
};

/** Göz bölgesi ROI zoom için landmark indeksleri. */
const EYE_REGION_INDICES = [
  ...LEFT_EYE_INDICES.upper,
  ...LEFT_EYE_INDICES.lower,
  ...LEFT_EYE_INDICES.iris,
  ...RIGHT_EYE_INDICES.upper,
  ...RIGHT_EYE_INDICES.lower,
  ...RIGHT_EYE_INDICES.iris,
];

interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export class FaceTracker {
  private faceMesh: import("@/types/mediapipe").MediaPipeFaceMesh | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private isRunning: boolean = false;
  private isModelReady: boolean = false;
  private isProcessingFrame: boolean = false;
  private onFeaturesCallback: ((features: EyeFeatures) => void) | null = null;
  private lastFeatures: EyeFeatures | null = null;
  private frameCount: number = 0;
  private fps: number = 0;
  private lastFpsTime: number = 0;
  private animFrameId: number = 0;
  private cameraInitialized: boolean = false;
  private consecutiveErrors: number = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 8;
  private errorCooldownUntil: number = 0;

  /** Göz bölgesi zoom: önceki karenin göz bölgesini kırpıp büyüterek iris için daha fazla piksel. */
  private zoomCanvas: HTMLCanvasElement | null = null;
  private lastEyeBbox: { x: number; y: number; w: number; h: number } | null = null;
  private currentCropBounds: { x: number; y: number; w: number; h: number } | null = null;
  private zoomDisabledFrames: number = 0;
  private readonly EYE_ZOOM_PADDING = 0.25;
  private readonly MAX_ZOOM_FACTOR = 3;
  /** Son gönderilen frame göz bölgesi zoom ile mi işlendi (UI göstergesi için). */
  private lastFrameUsedZoom: boolean = false;

  /** Kullanıcı manuel hizalama sonrası iris offset (normalize 0-1). Kalibrasyon öncesi isteğe bağlı adımda ayarlanır. */
  private irisOffsetLeft: { x: number; y: number } = { x: 0, y: 0 };
  private irisOffsetRight: { x: number; y: number } = { x: 0, y: 0 };

  constructor() {
    // No-op: landmark filtreleri kaldırıldı — model çıktısındaki One Euro Filter
    // tek başına yeterli (çift filtreleme ~80ms gecikme ekliyordu)
  }

  /**
   * Kamera ve FaceMesh'i başlat.
   * Kamera stream'i bir kez açılır ve destroy() çağrılana kadar açık kalır.
   */
  async initialize(videoElement: HTMLVideoElement): Promise<boolean> {
    this.videoElement = videoElement;

    try {
      // Kamera zaten açıksa tekrar açma
      if (!this.cameraInitialized) {
        // Önce yüksek çözünürlük dene; mobilde çoğu cihaz 1280x720 desteklemez, fallback kullan
        const constraintsList: MediaTrackConstraints[] = [
          {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30, min: 20 },
            facingMode: "user",
          },
          { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          { facingMode: "user" },
        ];
        let lastError: Error | null = null;
        for (const video of constraintsList) {
          try {
            this.stream = await navigator.mediaDevices.getUserMedia({ video });
            break;
          } catch (e) {
            lastError = e as Error;
          }
        }
        if (!this.stream) {
          throw lastError ?? new Error("Kamera açılamadı.");
        }

        videoElement.srcObject = this.stream;
        await new Promise<void>((resolve, reject) => {
          videoElement.onloadedmetadata = () => {
            videoElement.play().then(resolve).catch(reject);
          };
          // Timeout ile koruma
          setTimeout(() => reject(new Error("Video yükleme zaman aşımı")), 10000);
        });

        this.cameraInitialized = true;
        logger.log("[FaceTracker] Kamera başlatıldı:", videoElement.videoWidth, "x", videoElement.videoHeight);
      }

      // FaceMesh'i yükle (eğer henüz yüklenmemişse)
      if (!this.faceMesh) {
        await this.loadFaceMesh();
      }

      return true;
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes("MediaPipe") || err.message?.includes("yüklenemedi")) {
        throw new Error("MediaPipe göz takip modeli yüklenemedi. İnternet bağlantınızı kontrol edin.");
      }
      if (err.name === "NotAllowedError" || err.message?.includes("Permission")) {
        throw new Error("Kamera izni reddedildi. Tarayıcı ayarlarından izin verin.");
      }
      if (err.name === "NotFoundError") {
        throw new Error("Kamera bulunamadı. Webcam bağlı olduğundan emin olun.");
      }
      if (err.message?.includes("zaman aşımı")) {
        throw new Error("Kamera başlatma zaman aşımı. Cihazı yeniden deneyin.");
      }
      throw err;
    }
  }

  private async loadFaceMesh(): Promise<void> {
    // MediaPipe FaceMesh'in yüklenmesini bekle
    await this.waitForMediaPipe();

    const FaceMeshClass = window.FaceMesh;
    if (!FaceMeshClass) {
      throw new Error("MediaPipe FaceMesh yüklenemedi. İnternet bağlantınızı kontrol edin.");
    }

    this.faceMesh = new FaceMeshClass({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
      },
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true, // İris landmark'ları için zorunlu
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });

    this.faceMesh.onResults((results: import("@/types/mediapipe").MediaPipeFaceMeshResults) => {
      this.isProcessingFrame = false;
      this.consecutiveErrors = 0;
      try {
        this.processResults(results);
      } catch (e) {
        this.zoomDisabledFrames = 90;
        logger.warn("[FaceTracker] processResults hatası (zoom devre dışı):", e);
      }
    });

    // Modelin ilk yüklenmesini tetikle — warm-up frame ile WASM indirilir
    logger.log("[FaceTracker] FaceMesh modeli yükleniyor...");
    let warmupOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (this.videoElement && this.videoElement.readyState >= 2) {
          await this.faceMesh.send({ image: this.videoElement });
          warmupOk = true;
          break;
        } else {
          // Video henüz hazır değil — kısa bekle ve tekrar dene
          await new Promise(r => setTimeout(r, 500));
          if (this.videoElement && this.videoElement.readyState >= 2) {
            await this.faceMesh.send({ image: this.videoElement });
            warmupOk = true;
            break;
          }
        }
      } catch (e) {
        logger.warn(`[FaceTracker] Warm-up denemesi ${attempt + 1}/3 başarısız:`, e);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!warmupOk) {
      logger.error("[FaceTracker] FaceMesh warm-up 3 denemede başarısız. WASM dosyaları yüklenememiş olabilir.");
    }

    this.isModelReady = true;
    this.consecutiveErrors = 0;
    logger.log("[FaceTracker] FaceMesh modeli hazır (warmup:", warmupOk ? "başarılı" : "atlandı", ")");
  }

  /**
   * MediaPipe script'ini yükle ve hazır olmasını bekle.
   * Script henüz DOM'da yoksa dinamik olarak ekler.
   */
  private waitForMediaPipe(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.FaceMesh) {
        logger.log("[FaceTracker] MediaPipe FaceMesh zaten yüklü");
        resolve();
        return;
      }

      // Script DOM'da var mı kontrol et
      const existingScript = document.querySelector(
        'script[src*="@mediapipe/face_mesh"]'
      );

      let scriptFailed = false;

      if (!existingScript) {
        // Script'i dinamik olarak ekle
        logger.log("[FaceTracker] MediaPipe script'i yükleniyor...");
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js";
        script.crossOrigin = "anonymous";
        script.async = true;
        script.onerror = () => {
          scriptFailed = true;
          reject(
            new Error(
              "MediaPipe FaceMesh script'i indirilemedi. " +
                "CDN erişilemez veya internet bağlantısı yok."
            )
          );
        };
        document.head.appendChild(script);
      }

      // Yüklenmesini bekle
      let attempts = 0;
      const maxAttempts = 200; // 20 saniye

      const check = () => {
        if (scriptFailed) return;

        if (window.FaceMesh) {
          logger.log("[FaceTracker] MediaPipe FaceMesh hazır");
          resolve();
          return;
        }

        attempts++;
        if (attempts >= maxAttempts) {
          reject(
            new Error(
              "MediaPipe FaceMesh 20 saniye içinde yüklenemedi. " +
                "İnternet bağlantınızı kontrol edin veya sayfayı yenileyin."
            )
          );
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  /**
   * Tracking döngüsünü başlat.
   * Kamerayı kesmez, sadece frame işlemeyi aktif eder.
   */
  startTracking(callback: (features: EyeFeatures) => void): void {
    this.onFeaturesCallback = callback;
    this.isRunning = true;
    this.lastFpsTime = performance.now();
    this.frameCount = 0;

    // Önceki döngüyü iptal et
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }

    logger.log("[FaceTracker] Tracking başlatıldı");
    this.processFrame();
  }

  /**
   * Tracking döngüsünü durdur.
   * Kamera açık kalır! Sadece frame işleme durur.
   */
  stopTracking(): void {
    this.isRunning = false;
    this.onFeaturesCallback = null;

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }

    logger.log("[FaceTracker] Tracking durduruldu (kamera açık)");
  }

  private async processFrame(): Promise<void> {
    if (!this.isRunning || !this.videoElement || !this.faceMesh) return;

    const now = performance.now();

    // Hata cooldown: art arda hata varsa üstel bekle (2s, 4s, 8s...) sonra tekrar dene
    if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS && now < this.errorCooldownUntil) {
      // Cooldown süresinde — frame gönderme, sadece döngüyü devam ettir
    } else if (
      this.videoElement.readyState >= 2 &&
      this.isModelReady &&
      !this.isProcessingFrame
    ) {
      // Cooldown bittiyse hata sayacını sıfırla ve tekrar dene
      if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        logger.log("[FaceTracker] Cooldown bitti, tekrar deneniyor...");
        this.consecutiveErrors = 0;
      }

      try {
        this.isProcessingFrame = true;
        const vw = this.videoElement.videoWidth;
        const vh = this.videoElement.videoHeight;
        if (vw === 0 || vh === 0) {
          this.isProcessingFrame = false;
        } else {
          if (this.zoomDisabledFrames > 0) {
            this.zoomDisabledFrames--;
          }

          // Zoom crop — hata geçmişi varsa zoom'u atla (basit frame gönder)
          let sent = false;
          if (
            this.lastEyeBbox &&
            vw >= 640 &&
            this.zoomDisabledFrames === 0 &&
            this.consecutiveErrors === 0
          ) {
            const { x, y, w, h } = this.lastEyeBbox;
            if (!this.zoomCanvas) this.zoomCanvas = document.createElement("canvas");
            this.zoomCanvas.width = vw;
            this.zoomCanvas.height = vh;
            const ctx = this.zoomCanvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(
                this.videoElement,
                x * vw, y * vh, w * vw, h * vh,
                0, 0, vw, vh
              );
              try {
                this.currentCropBounds = this.lastEyeBbox;
                await this.faceMesh.send({ image: this.zoomCanvas });
                sent = true;
              } catch {
                this.zoomDisabledFrames = 60;
                this.currentCropBounds = null;
              }
            }
          }
          if (!sent) {
            this.currentCropBounds = null;
            await this.faceMesh.send({ image: this.videoElement });
          }
          this.lastFrameUsedZoom = sent;
          this.consecutiveErrors = 0;
        }
      } catch (e) {
        this.isProcessingFrame = false;
        this.consecutiveErrors++;
        // Üstel cooldown: 2^n saniye (max 16s)
        const cooldownSec = Math.min(16, Math.pow(2, Math.floor(this.consecutiveErrors / this.MAX_CONSECUTIVE_ERRORS)));
        this.errorCooldownUntil = now + cooldownSec * 1000;
        if (this.consecutiveErrors % this.MAX_CONSECUTIVE_ERRORS === 0) {
          logger.warn("[FaceTracker] Ardışık", this.consecutiveErrors, "hata —", cooldownSec, "s cooldown");
        }
      }
    }

    // FPS hesapla
    this.frameCount++;
    const fpsNow = performance.now();
    if (fpsNow - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = fpsNow;
    }

    if (this.isRunning) {
      this.animFrameId = requestAnimationFrame(() => this.processFrame());
    }
  }

  private processResults(results: import("@/types/mediapipe").MediaPipeFaceMeshResults): void {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this.lastEyeBbox = null;
      // Yüz bulunamadı - confidence 0 gönder
      const emptyFeatures: EyeFeatures = {
        leftIrisX: 0,
        leftIrisY: 0,
        rightIrisX: 0,
        rightIrisY: 0,
        leftIrisRelX: 0.5,
        leftIrisRelY: 0.5,
        rightIrisRelX: 0.5,
        rightIrisRelY: 0.5,
        pupilRadius: 0,
        eyeOpenness: 0,
        leftEAR: 0,
        rightEAR: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        faceScale: 0,
        leftEyeWidth: 0,
        rightEyeWidth: 0,
        confidence: 0,
      };
      this.lastFeatures = emptyFeatures;
      if (this.onFeaturesCallback) {
        this.onFeaturesCallback(emptyFeatures);
      }
      return;
    }

    let landmarks: FaceLandmark[] = results.multiFaceLandmarks[0];

    if (this.currentCropBounds) {
      const { x: cx, y: cy, w: cw, h: ch } = this.currentCropBounds;
      landmarks = landmarks.map((lm) => ({
        ...lm,
        x: cx + lm.x * cw,
        y: cy + lm.y * ch,
      }));
    }

    const eyePts = EYE_REGION_INDICES.map((i) => landmarks[i]).filter(Boolean);
    if (eyePts.length >= 5) {
      const xs = eyePts.map((p) => p.x);
      const ys = eyePts.map((p) => p.y);
      let minX = Math.max(0, Math.min(...xs) - this.EYE_ZOOM_PADDING);
      let minY = Math.max(0, Math.min(...ys) - this.EYE_ZOOM_PADDING);
      let maxX = Math.min(1, Math.max(...xs) + this.EYE_ZOOM_PADDING);
      let maxY = Math.min(1, Math.max(...ys) + this.EYE_ZOOM_PADDING);
      let w = maxX - minX;
      let h = maxY - minY;
      // Max zoom sınırla: çok fazla zoom iris distorsiyonu yapar
      const minW = 1 / this.MAX_ZOOM_FACTOR;
      const minH = 1 / this.MAX_ZOOM_FACTOR;
      if (w < minW) {
        const cx = (minX + maxX) / 2;
        minX = Math.max(0, cx - minW / 2);
        maxX = Math.min(1, minX + minW);
        w = maxX - minX;
      }
      if (h < minH) {
        const cy = (minY + maxY) / 2;
        minY = Math.max(0, cy - minH / 2);
        maxY = Math.min(1, minY + minH);
        h = maxY - minY;
      }
      this.lastEyeBbox = w > 0.05 && h > 0.05 ? { x: minX, y: minY, w, h } : null;
    } else {
      this.lastEyeBbox = null;
    }

    const features = this.extractFeatures(landmarks);
    this.lastFeatures = features;

    if (this.onFeaturesCallback) {
      this.onFeaturesCallback(features);
    }
  }

  private extractFeatures(landmarks: FaceLandmark[]): EyeFeatures {
    // Ham iris merkezi: 5 iris landmark'ının centroid'i
    // Landmark filtreleri kaldırıldı — model çıktısındaki One Euro Filter yeterli
    const leftIrisRaw = this.getIrisCenter(landmarks, LEFT_EYE_INDICES);
    const rightIrisRaw = this.getIrisCenter(landmarks, RIGHT_EYE_INDICES);

    // Kullanıcı manuel offset (kalibrasyon öncesi hizalama)
    const leftIris = { x: leftIrisRaw.x + this.irisOffsetLeft.x, y: leftIrisRaw.y + this.irisOffsetLeft.y };
    const rightIris = { x: rightIrisRaw.x + this.irisOffsetRight.x, y: rightIrisRaw.y + this.irisOffsetRight.y };

    // Göreceli iris pozisyonu (düzeltilmiş merkezden; göz konturu içinde 0-1)
    const leftRel = this.getRelativeIrisFromPoint(leftIris, landmarks, LEFT_EYE_INDICES);
    const rightRel = this.getRelativeIrisFromPoint(rightIris, landmarks, RIGHT_EYE_INDICES);

    const pupilRadius = this.calculatePupilRadius(landmarks);
    const leftEAR = this.calculateSingleEAR(landmarks, LEFT_EYE_INDICES);
    const rightEAR = this.calculateSingleEAR(landmarks, RIGHT_EYE_INDICES);
    const eyeOpenness = (leftEAR + rightEAR) / 2;
    const headPose = this.estimateHeadPose(landmarks);
    const faceScale = this.calculateFaceScale(landmarks);

    // Göz genişlikleri
    const leftEyeWidth = this.getEyeWidth(landmarks, LEFT_EYE_INDICES);
    const rightEyeWidth = this.getEyeWidth(landmarks, RIGHT_EYE_INDICES);

    // Sürekli çok faktörlü güven skoru
    let confidence = 1.0;

    // Göz açıklığı faktörü (EAR): tamamen kapalı=0, normal açık=1
    if (eyeOpenness < 0.15) {
      confidence *= Math.max(0, eyeOpenness / 0.15);
    }

    // Yüz boyutu faktörü: çok küçük yüz = düşük güven
    if (faceScale < 0.08) {
      confidence *= Math.max(0.1, faceScale / 0.08);
    }

    // İris tespit edilemedi
    if (leftIris.x === 0 && leftIris.y === 0) confidence = 0;

    // İris göreceli pozisyon aşırı uç ise güven düşür
    const irisRange = (v: number) => v < -0.3 ? Math.max(0.2, 1 + (v + 0.3) * 2) :
                                      v > 1.3 ? Math.max(0.2, 1 - (v - 1.3) * 2) : 1;
    confidence *= Math.min(irisRange(leftRel.x), irisRange(rightRel.x));
    confidence *= Math.min(irisRange(leftRel.y), irisRange(rightRel.y));

    // Sol-sağ iris tutarsızlığı: baş yana dönükse tolerans artır
    const irisAsymX = Math.abs(leftRel.x - rightRel.x);
    const irisAsymY = Math.abs(leftRel.y - rightRel.y);
    const asymTolerance = Math.min(Math.abs(headPose.yaw) * 1.5, 0.25);
    const asymThreshX = 0.3 + asymTolerance;
    const asymThreshY = 0.3 + asymTolerance * 0.5;
    if (irisAsymX > asymThreshX) confidence *= Math.max(0.3, 1 - (irisAsymX - asymThreshX) * 2);
    if (irisAsymY > asymThreshY) confidence *= Math.max(0.3, 1 - (irisAsymY - asymThreshY) * 2);

    // Debug: Her 120 frame'de bir iris pozisyonlarını logla
    // NOT: frameCount artırılmaz, processFrame() içinde zaten artırılıyor
    if (this.frameCount % 120 === 1) {
      logger.log("[FaceTracker] RelIris L:", leftRel.x.toFixed(3), leftRel.y.toFixed(3),
        "| R:", rightRel.x.toFixed(3), rightRel.y.toFixed(3),
        "| Yaw:", headPose.yaw.toFixed(3), "| Conf:", confidence.toFixed(2));
    }

    return {
      leftIrisX: leftIris.x,
      leftIrisY: leftIris.y,
      rightIrisX: rightIris.x,
      rightIrisY: rightIris.y,
      leftIrisRelX: leftRel.x,
      leftIrisRelY: leftRel.y,
      rightIrisRelX: rightRel.x,
      rightIrisRelY: rightRel.y,
      pupilRadius,
      eyeOpenness,
      leftEAR,
      rightEAR,
      yaw: headPose.yaw,
      pitch: headPose.pitch,
      roll: headPose.roll,
      faceScale,
      leftEyeWidth,
      rightEyeWidth,
      confidence,
    };
  }

  /**
   * Verilen iris noktası (örn. kullanıcı düzeltmesi sonrası) için göreceli pozisyon hesapla.
   */
  private getRelativeIrisFromPoint(
    iris: { x: number; y: number },
    landmarks: FaceLandmark[],
    eyeIndices: typeof LEFT_EYE_INDICES
  ): { x: number; y: number } {
    const innerCorner = landmarks[eyeIndices.innerCorner];
    const outerCorner = landmarks[eyeIndices.outerCorner];
    const topMid = landmarks[eyeIndices.topMid];
    const bottomMid = landmarks[eyeIndices.bottomMid];
    if (!innerCorner || !outerCorner || !topMid || !bottomMid) return { x: 0.5, y: 0.5 };
    const eyeDx = outerCorner.x - innerCorner.x;
    const eyeDy = outerCorner.y - innerCorner.y;
    const eyeLen = Math.sqrt(eyeDx * eyeDx + eyeDy * eyeDy);
    if (eyeLen < 0.001) return { x: 0.5, y: 0.5 };
    const irisDx = iris.x - innerCorner.x;
    const irisDy = iris.y - innerCorner.y;
    // X: göz ekseni boyunca projeksiyon
    const rawRelX = (irisDx * eyeDx + irisDy * eyeDy) / (eyeLen * eyeLen);
    // Y: göz eğimine (tilt) kompanse edilmiş dikey hesaplama
    // Göz ekseni açısını bul ve iris pozisyonunu bu eksene dik yönde hesapla
    const eyeAngle = Math.atan2(eyeDy, eyeDx);
    const cos = Math.cos(eyeAngle);
    const sin = Math.sin(eyeAngle);
    // Top/bottom noktalarını göz eğimine göre rotasyonla düzelt
    const topDx = topMid.x - innerCorner.x;
    const topDy = topMid.y - innerCorner.y;
    const botDx = bottomMid.x - innerCorner.x;
    const botDy = bottomMid.y - innerCorner.y;
    // Rotated perpendicular component (göz eğimine dik)
    const topPerp = -topDx * sin + topDy * cos;
    const botPerp = -botDx * sin + botDy * cos;
    const irisPerp = -irisDx * sin + irisDy * cos;
    const eyeHeight = Math.abs(botPerp - topPerp);
    let relY = 0.5;
    if (eyeHeight > 0.001) relY = (irisPerp - topPerp) / (botPerp - topPerp);
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    return { x: clamp(rawRelX, -0.15, 1.15), y: clamp(relY, -0.1, 1.1) };
  }

  /** İris merkezi: 5 iris noktasının centroid'i (tek landmark yerine — daha hassas göz bebeği konumu) */
  private getIrisCenter(
    landmarks: FaceLandmark[],
    eyeIndices: typeof LEFT_EYE_INDICES
  ): { x: number; y: number } {
    const irisPoints = (eyeIndices.iris as number[])
      .filter((i) => i < landmarks.length)
      .map((i) => landmarks[i]);
    if (irisPoints.length >= 2) {
      return {
        x: irisPoints.reduce((s, p) => s + p.x, 0) / irisPoints.length,
        y: irisPoints.reduce((s, p) => s + p.y, 0) / irisPoints.length,
      };
    }
    if (landmarks.length > eyeIndices.center) {
      const center = landmarks[eyeIndices.center];
      return { x: center.x, y: center.y };
    }
    const points = eyeIndices.upper
      .filter((i) => i < landmarks.length)
      .map((i) => landmarks[i]);
    if (points.length === 0) return { x: 0.5, y: 0.5 };
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }

  private getEyeWidth(
    landmarks: FaceLandmark[],
    eyeIndices: typeof LEFT_EYE_INDICES
  ): number {
    const inner = landmarks[eyeIndices.innerCorner];
    const outer = landmarks[eyeIndices.outerCorner];
    if (!inner || !outer) return 0;
    return Math.sqrt((outer.x - inner.x) ** 2 + (outer.y - inner.y) ** 2);
  }

  private calculatePupilRadius(landmarks: FaceLandmark[]): number {
    if (landmarks.length <= 472) return 0.01;

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

  /**
   * Tek bir göz için EAR (Eye Aspect Ratio) hesapla.
   */
  private calculateSingleEAR(
    landmarks: FaceLandmark[],
    eyeIndices: typeof LEFT_EYE_INDICES
  ): number {
    const p1 = landmarks[eyeIndices.earP1];
    const p2 = landmarks[eyeIndices.earP2];
    const p3 = landmarks[eyeIndices.earP3];
    const p4 = landmarks[eyeIndices.earP4];
    const p5 = landmarks[eyeIndices.earP5];
    const p6 = landmarks[eyeIndices.earP6];

    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.3;

    const vertDist1 = Math.sqrt((p2.x - p6.x) ** 2 + (p2.y - p6.y) ** 2);
    const vertDist2 = Math.sqrt((p3.x - p5.x) ** 2 + (p3.y - p5.y) ** 2);
    const horizDist = Math.sqrt((p1.x - p4.x) ** 2 + (p1.y - p4.y) ** 2);

    if (horizDist < 0.001) return 0;

    return (vertDist1 + vertDist2) / (2.0 * horizDist);
  }

  /**
   * Head pose estimation - 3D landmark'ları kullanarak daha doğru yaw/pitch/roll.
   * MediaPipe FaceMesh z-derinliği ile solvePnP benzeri geometrik hesaplama.
   * Referans: Brown University HeadPoseDirection + MediaPipe canonical face mesh.
   */
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

    // --- 3D geometri tabanlı yaw ---
    // Göz arası mesafe (2D) ve z-farkından yaw açısı hesapla
    const eyeDistX = rightEye.x - leftEye.x;
    const eyeDistY = rightEye.y - leftEye.y;
    const eyeDist2D = Math.sqrt(eyeDistX * eyeDistX + eyeDistY * eyeDistY);

    // Burun ucu ile göz merkezi arasındaki x-ofseti göz mesafesine normalize et
    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const noseOffsetX = noseTip.x - eyeMidX;

    // Z-derinliği varsa (MediaPipe bunu sağlar) daha iyi yaw
    let yaw: number;
    if (leftEye.z !== undefined && rightEye.z !== undefined) {
      const eyeZDiff = rightEye.z - leftEye.z;
      const yawZ = Math.atan2(eyeZDiff, eyeDist2D);
      const noseYaw = eyeDist2D > 0.001 ? noseOffsetX / eyeDist2D : 0;
      // Adaptive blend: iki yöntem tutarlıysa %50/%50, değilse burun güvenilir
      const diff = Math.abs(yawZ - noseYaw);
      if (diff < 0.2) {
        yaw = yawZ * 0.5 + noseYaw * 0.5;
      } else {
        yaw = noseYaw; // z-derinliği gürültülü, burun daha güvenilir
      }
    } else {
      yaw = eyeDist2D > 0.001 ? (noseOffsetX / eyeDist2D) : 0;
    }

    // --- 3D geometri tabanlı pitch ---
    const faceHeight = Math.sqrt(
      (forehead.x - chin.x) ** 2 + (forehead.y - chin.y) ** 2
    );
    let pitch: number;
    if (noseTip.z !== undefined && forehead.z !== undefined && chin.z !== undefined) {
      const faceMidZ = (forehead.z + chin.z) / 2;
      const noseZOffset = noseTip.z - faceMidZ;
      const noseYOffset = (noseTip.y - eyeMidY) / (faceHeight || 1);
      pitch = Math.atan2(noseZOffset, faceHeight || 0.1) * 0.5 + (noseYOffset - 0.33) * 0.5;
    } else {
      pitch = faceHeight > 0.001
        ? ((noseTip.y - eyeMidY) / faceHeight - 0.5) * 2
        : 0;
    }

    // --- Roll (değişiklik yok, atan2 zaten doğru) ---
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

  /**
   * Her şeyi tamamen kapat — kamera stream dahil.
   */
  destroy(): void {
    this.isRunning = false;
    this.onFeaturesCallback = null;

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.faceMesh = null;
    this.isModelReady = false;
    this.cameraInitialized = false;
    this.consecutiveErrors = 0;
    this.errorCooldownUntil = 0;

    if (this.zoomCanvas) {
      this.zoomCanvas.width = 0;
      this.zoomCanvas.height = 0;
      this.zoomCanvas = null;
    }

    logger.log("[FaceTracker] Tamamen kapatıldı");
  }

  getFPS(): number {
    return this.fps;
  }

  /** Son işlenen frame göz bölgesi zoom ile mi gönderildi (takip ekranında göstermek için). */
  getLastFrameUsedZoom(): boolean {
    return this.lastFrameUsedZoom;
  }

  getLastFeatures(): EyeFeatures | null {
    return this.lastFeatures;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  isReady(): boolean {
    return this.isModelReady && this.cameraInitialized;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Frame okumak için kullanılan video öğesini değiştir.
   * Göz bebeği hizalama ekranında gösterilen video ile aynı öğeyi kullanmak için çağrılır (tarayıcı throttling önlenir).
   */
  setVideoElement(el: HTMLVideoElement | null): void {
    this.videoElement = el;
  }

  /**
   * Kalibrasyon öncesi manuel göz bebeği hizalama sonrası offset (normalize 0-1).
   * Sol/sağ iris tespitine eklenecek: corrected = detected + offset.
   */
  setIrisOffset(left: { x: number; y: number }, right: { x: number; y: number }): void {
    this.irisOffsetLeft = { x: left.x, y: left.y };
    this.irisOffsetRight = { x: right.x, y: right.y };
  }

  clearIrisOffset(): void {
    this.irisOffsetLeft = { x: 0, y: 0 };
    this.irisOffsetRight = { x: 0, y: 0 };
  }
}
