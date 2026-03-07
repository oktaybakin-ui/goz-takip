"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import NextImage from "next/image";
import { GazeModel, GazePoint, EyeFeatures } from "@/lib/gazeModel";
import { FaceTracker } from "@/lib/faceTracker";
import { FixationDetector, Fixation, FixationMetrics } from "@/lib/fixation";
import { HeatmapGenerator } from "@/lib/heatmap";
import { WebGLHeatmapRenderer } from "@/lib/webglHeatmap";
import { MultiModelEnsemble } from "@/lib/multiModelEnsemble";
import { AutoRecalibration } from "@/lib/autoRecalibration";
import { BlinkDetector } from "@/lib/blinkDetector";
import { isMobileDevice } from "@/lib/deviceDetect";
import { GlassesDetector } from "@/lib/glassesDetector";
import { logger } from "@/lib/logger";
import { useLang } from "@/contexts/LangContext";
import Calibration from "./Calibration";
import PupilAlignStep from "./PupilAlignStep";
import HeatmapCanvas from "./HeatmapCanvas";
import ResultsPanel from "./ResultsPanel";

import type { ResultPerImage } from "@/types/results";
import { IMAGE_DURATION_MS, GAZE_UI_THROTTLE_MS } from "@/constants";

export type { ResultPerImage };

interface EyeTrackerProps {
  imageUrls: string[];
  onReset?: () => void;
}

type AppPhase = "loading" | "camera_init" | "pupil_align" | "calibration" | "tracking" | "results";

/** object-contain ile görüntü içeriğinin ekrandaki dikdörtgeni (letterbox/pillarbox). */
function getContentRect(
  imageRect: DOMRect,
  displayWidth: number,
  displayHeight: number,
  naturalWidth?: number,
  naturalHeight?: number
): { contentLeft: number; contentTop: number; contentW: number; contentH: number } | null {
  if (imageRect.width === 0 || imageRect.height === 0) return null;
  const nw = naturalWidth ?? displayWidth;
  const nh = naturalHeight ?? displayHeight;
  const scale = Math.min(imageRect.width / nw, imageRect.height / nh);
  const contentW = nw * scale;
  const contentH = nh * scale;
  const offsetX = (imageRect.width - contentW) / 2;
  const offsetY = (imageRect.height - contentH) / 2;
  return {
    contentLeft: imageRect.left + offsetX,
    contentTop: imageRect.top + offsetY,
    contentW,
    contentH,
  };
}

/**
 * Ekran koordinatlarını görüntü (canvas) koordinatlarına dönüştür.
 *
 * object-contain kullanıldığında görüntü container içinde letterbox/pillarbox
 * olabilir. Gerçek içerik dikdörtgeni (content rect) hesaplanarak hassas eşleme yapılır.
 */
function screenToImageCoords(
  screenX: number,
  screenY: number,
  imageRect: DOMRect,
  displayWidth: number,
  displayHeight: number,
  naturalWidth?: number,
  naturalHeight?: number
): { x: number; y: number } | null {
  const content = getContentRect(imageRect, displayWidth, displayHeight, naturalWidth, naturalHeight);
  if (!content) return null;
  const { contentLeft, contentTop, contentW, contentH } = content;

  const relX = (screenX - contentLeft) / contentW;
  const relY = (screenY - contentTop) / contentH;

  // Piksel koordinatlarına dönüştür, ardından sınırla
  const rawX = relX * displayWidth;
  const rawY = relY * displayHeight;

  const x = Math.max(0, Math.min(displayWidth, rawX));
  const y = Math.max(0, Math.min(displayHeight, rawY));
  return { x, y };
}

/**
 * Export için Savitzky-Golay benzeri yumuşatma: 5 noktalı pencere (Sorun #25).
 * 3 noktalı basit ortalama yerine 5 noktalı ağırlıklı ortalama — daha az faz kayması.
 * Ağırlıklar: [-3, 12, 17, 12, -3] / 35 (SG 2. derece, 5 nokta katsayıları)
 */
function smoothGazePointsForExport<T extends { x: number; y: number; timestamp: number; confidence: number }>(
  points: T[]
): { x: number; y: number; timestamp_ms: number; confidence: number; dt_ms: number }[] {
  if (points.length === 0) return [];
  // SG katsayıları (normalize)
  const sgWeights = [-3, 12, 17, 12, -3];
  const sgSum = 35;
  const halfWin = 2;
  return points.map((p, i) => {
    let x = p.x;
    let y = p.y;
    // Kenar noktalarında pencere daraltılır
    if (i >= halfWin && i < points.length - halfWin) {
      let sx = 0, sy = 0;
      for (let k = -halfWin; k <= halfWin; k++) {
        const w = sgWeights[k + halfWin];
        sx += points[i + k].x * w;
        sy += points[i + k].y * w;
      }
      x = sx / sgSum;
      y = sy / sgSum;
    }
    const dt_ms = i === 0 ? 0 : Math.round(p.timestamp - points[i - 1].timestamp);
    return {
      x: Math.round(x),
      y: Math.round(y),
      timestamp_ms: Math.round(p.timestamp),
      confidence: Math.round(p.confidence * 100) / 100,
      dt_ms,
    };
  });
}

export default function EyeTracker({ imageUrls, onReset }: EyeTrackerProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [gazePoint, setGazePoint] = useState<GazePoint | null>(null);
  const [fixations, setFixations] = useState<Fixation[]>([]);
  const [metrics, setMetrics] = useState<FixationMetrics | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [trackingDuration, setTrackingDuration] = useState(0);
  const [calibrationError, setCalibrationError] = useState<number>(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [imageNaturalDimensions, setImageNaturalDimensions] = useState({ width: 0, height: 0 });
  const [cameraStatus, setCameraStatus] = useState<string>("Bekleniyor...");
  const [resultsPerImage, setResultsPerImage] = useState<ResultPerImage[]>([]);
  const [showTransitionOverlay, setShowTransitionOverlay] = useState(false);
  const [showDriftCorrection, setShowDriftCorrection] = useState(false);
  const transitionPhotoNumRef = useRef(0);
  const [resizeWarning, setResizeWarning] = useState(false);
  const [glassesWarning, setGlassesWarning] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const calibratedScreenSize = useRef<{ w: number; h: number } | null>(null);
  const { t } = useLang();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const imageDimsRef = useRef(imageDimensions);
  imageDimsRef.current = imageDimensions;
  const imageNatDimsRef = useRef(imageNaturalDimensions);
  imageNatDimsRef.current = imageNaturalDimensions;

  // Sorun #28: Multi-model entegrasyon öncelik sırası:
  // 1. Ensemble (birden fazla model ağırlıklı ortalaması) — en iyi doğruluk
  // 2. Ensemble başarısız olursa → tekli GazeModel fallback
  // 3. AutoRecalibration: fixation ve click verisiyle modeli sürekli ince ayar yapar
  const modelRef = useRef<GazeModel>(null as unknown as GazeModel);
  if (!modelRef.current) modelRef.current = new GazeModel(0.005);
  const ensembleRef = useRef<MultiModelEnsemble>(null as unknown as MultiModelEnsemble);
  if (!ensembleRef.current) ensembleRef.current = new MultiModelEnsemble();
  const autoRecalRef = useRef<AutoRecalibration>(null as unknown as AutoRecalibration);
  if (!autoRecalRef.current) autoRecalRef.current = new AutoRecalibration();
  const useEnsemble = useRef(true);
  const faceTrackerRef = useRef<FaceTracker>(null as unknown as FaceTracker);
  if (!faceTrackerRef.current) faceTrackerRef.current = new FaceTracker();
  const fixationDetectorRef = useRef<FixationDetector>(null as unknown as FixationDetector);
  if (!fixationDetectorRef.current) fixationDetectorRef.current = new FixationDetector();
  const blinkDetectorRef = useRef<BlinkDetector>(null as unknown as BlinkDetector);
  // Mobilde EAR değerleri daha düşük → blink threshold'u düşür, consecutive frame'i artır
  if (!blinkDetectorRef.current) blinkDetectorRef.current = new BlinkDetector(
    isMobileDevice() ? 0.14 : 0.20,  // Mobilde gözler daha küçük görünüyor
    isMobileDevice() ? 4 : 3,         // Mobilde daha fazla frame gerekli (false positive azalt)
    isMobileDevice() ? 1 : 2          // Mobilde daha kısa post-blink rejection
  );
  const heatmapRef = useRef<HeatmapGenerator>(null as unknown as HeatmapGenerator);
  if (!heatmapRef.current) heatmapRef.current = new HeatmapGenerator();
  const webglHeatmapRef = useRef<WebGLHeatmapRenderer | null>(null);
  if (!webglHeatmapRef.current && typeof window !== "undefined" && WebGLHeatmapRenderer.isSupported()) {
    webglHeatmapRef.current = new WebGLHeatmapRenderer();
  }
  const glassesDetectorRef = useRef<GlassesDetector>(null as unknown as GlassesDetector);
  if (!glassesDetectorRef.current) glassesDetectorRef.current = new GlassesDetector();
  const trackingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoRecalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gazePointsRef = useRef<GazePoint[]>([]);
  const drawAnimRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);
  const showTransitionOverlayRef = useRef(false);
  const processingTimeRef = useRef(0);
  const lastFeatureTimestampRef = useRef(0);

  const imageCount = imageUrls.length;
  const isMultiImage = imageCount > 1;
  const currentImageUrl = imageUrls[currentImageIndex] ?? imageUrls[0];

  const gazePointsByImageRef = useRef<GazePoint[][]>([]);
  const fixationsByImageRef = useRef<Fixation[][]>([]);
  const metricsByImageRef = useRef<(FixationMetrics | null)[]>([]);
  const dimensionsByImageRef = useRef<Array<{ width: number; height: number }>>([]);
  const advancingRef = useRef(false);

  useEffect(() => {
    if (gazePointsByImageRef.current.length !== imageCount) {
      gazePointsByImageRef.current = Array.from({ length: imageCount }, () => []);
      fixationsByImageRef.current = Array.from({ length: imageCount }, () => []);
      metricsByImageRef.current = Array(imageCount).fill(null);
      dimensionsByImageRef.current = Array.from({ length: imageCount }, () => ({ width: 0, height: 0 }));
    }
  }, [imageCount]);

  // Sorun #26: Lazy preload — ilk 3 görüntüyü hemen, geri kalanını tracking başladığında yükle
  const preloadImagesRef = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    const maxEagerPreload = 3; // İlk 3 hemen, geri kalanı lazy
    const imgs = imageUrls.map((url, i) => {
      const img = new Image();
      if (i < maxEagerPreload) {
        img.src = url;
      }
      return img;
    });
    preloadImagesRef.current = imgs;
    return () => {
      imgs.forEach((img) => { img.src = ""; });
      preloadImagesRef.current = [];
    };
  }, [imageUrls]);

  // Tracking başladığında kalan görüntüleri lazy yükle
  useEffect(() => {
    if (phase === "tracking") {
      preloadImagesRef.current.forEach((img, i) => {
        if (i >= 3 && !img.src) {
          img.src = imageUrls[i];
        }
      });
    }
  }, [phase, imageUrls]);

  // Görüntüyü yükle (mevcut indekse göre)
  useEffect(() => {
    let cancelled = false;
    setImageLoaded(false);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      setImageLoaded(true);
      setImageNaturalDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      const maxW = window.innerWidth * 0.95;
      const maxH = window.innerHeight * 0.85;
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
      const dims = {
        width: Math.round(img.naturalWidth * scale),
        height: Math.round(img.naturalHeight * scale),
      };
      setImageDimensions(dims);
      if (isMultiImage && currentImageIndex < dimensionsByImageRef.current.length) {
        dimensionsByImageRef.current[currentImageIndex] = dims;
      }
    };
    img.onerror = () => {
      if (cancelled) return;
      setError("Görüntü yüklenemedi.");
    };
    img.src = currentImageUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [currentImageUrl, currentImageIndex, isMultiImage]);

  const cameraInitializedRef = useRef(false);

  // Kamerayı başlat — yalnızca ilk görüntü yüklendiğinde bir kez çalışır
  useEffect(() => {
    if (!imageLoaded || cameraInitializedRef.current) return;

    let mounted = true;

    const initCamera = async () => {
      setPhase("camera_init");
      setCameraStatus("Kamera izni isteniyor...");

      if (!videoRef.current) {
        setError("Video elementi bulunamadı.");
        return;
      }

      try {
        setCameraStatus("Kamera başlatılıyor...");
        await faceTrackerRef.current.initialize(videoRef.current);

        if (!mounted) return;

        cameraInitializedRef.current = true;

        setCameraStatus("FaceMesh modeli yükleniyor...");
        faceTrackerRef.current.startTracking(() => {});

        setCameraStatus("Hazır!");
        setPhase("pupil_align");
      } catch (err) {
        if (!mounted) return;
        // Başarısız başlatma durumunda kamera stream'ini temizle
        try { faceTrackerRef.current.destroy(); } catch { /* ignore */ }
        cameraInitializedRef.current = false;

        const msg = (err as Error).message;
        if (msg.includes("MediaPipe") || msg.includes("yüklenemedi")) {
          setError("Göz takip modeli yüklenemedi. İnternet bağlantınızı kontrol edin ve sayfayı yenileyin.");
        } else if (msg.includes("Permission") || msg.includes("NotAllowedError") || msg.includes("izin")) {
          setError("Kamera erişimi reddedildi. Tarayıcı ayarlarından kamera iznini verin.");
        } else if (msg.includes("NotFoundError") || msg.includes("devices")) {
          setError("Kamera bulunamadı. Bağlı bir webcam olduğundan emin olun.");
        } else {
          setError("Kamera hatası: " + msg);
        }
      }
    };

    initCamera();

    return () => {
      mounted = false;
    };
  }, [imageLoaded]);

  // Kamera temizliği — component unmount olduğunda
  useEffect(() => {
    const tracker = faceTrackerRef.current;
    return () => {
      tracker.destroy();
      cameraInitializedRef.current = false;
    };
  }, []);

  // pupil_align'dan sonra calibration/tracking'de gizli videoyu tekrar FaceTracker'a bağla
  useEffect(() => {
    if ((phase === "calibration" || phase === "tracking") && videoRef.current && faceTrackerRef.current.getStream()) {
      const v = videoRef.current;
      const stream = faceTrackerRef.current.getStream()!;
      v.srcObject = stream;

      // Mobilde video element yeniden oluşturulduğunda metadata yüklenmesi zaman alır
      // Video hazır olana kadar bekle, sonra FaceTracker'a bağla
      const connectWhenReady = () => {
        if (v.readyState >= 2) {
          faceTrackerRef.current.setVideoElement(v);
          logger.log("[EyeTracker] Video reconnected, readyState:", v.readyState,
            "size:", v.videoWidth, "x", v.videoHeight);
        } else {
          v.addEventListener("loadeddata", () => {
            faceTrackerRef.current.setVideoElement(v);
            logger.log("[EyeTracker] Video loadeddata, size:", v.videoWidth, "x", v.videoHeight);
          }, { once: true });
        }
      };

      v.play()
        .then(connectWhenReady)
        .catch(() => {
          // Autoplay blocked — try again after user interaction
          connectWhenReady();
        });
    }
  }, [phase]);

  // 20 saniye dolunca sonraki fotoğrafa geç (çoklu foto modu)
  useEffect(() => {
    if (!isMultiImage || !isTracking || trackingDuration < IMAGE_DURATION_MS || advancingRef.current) return;

    advancingRef.current = true;
    const idx = currentImageIndex;
    fixationDetectorRef.current.stopTracking();
    gazePointsByImageRef.current[idx] = [...gazePointsRef.current];
    fixationsByImageRef.current[idx] = fixationDetectorRef.current.getFixations();
    metricsByImageRef.current[idx] = fixationDetectorRef.current.getMetrics();
    dimensionsByImageRef.current[idx] = imageDimensions;

    if (trackingTimerRef.current) {
      clearInterval(trackingTimerRef.current);
      trackingTimerRef.current = null;
    }

    if (idx + 1 >= imageUrls.length) {
      faceTrackerRef.current.stopTracking();
      setIsTracking(false);
      advancingRef.current = false;
      const results: ResultPerImage[] = imageUrls.map((url, i) => ({
        imageUrl: url,
        gazePoints: gazePointsByImageRef.current[i] ?? [],
        fixations: fixationsByImageRef.current[i] ?? [],
        metrics: metricsByImageRef.current[i] ?? null,
        imageDimensions: dimensionsByImageRef.current[i] ?? { width: 0, height: 0 },
      }));
      setResultsPerImage(results);
      setPhase("results");
      return;
    }

    // Önce mutable ref'leri güncelle (state güncellemelerinden önce)
    gazePointsRef.current = [];
    fixationDetectorRef.current = new FixationDetector();
    fixationDetectorRef.current.startTracking();
    blinkDetectorRef.current = new BlinkDetector(
      isMobileDevice() ? 0.14 : 0.20,
      isMobileDevice() ? 4 : 3,
      isMobileDevice() ? 1 : 2
    );
    blinkDetectorRef.current.start();

    transitionPhotoNumRef.current = idx + 1;
    setFixations([]);
    setMetrics(null);
    // Süreyi ÖNCE sıfırla, sonra interval başlat (race condition önlenir)
    setTrackingDuration(0);
    setShowDriftCorrection(true);
    setCurrentImageIndex(idx + 1);

    // Interval'i state sıfırlandıktan sonra başlat
    trackingTimerRef.current = setInterval(() => {
      setTrackingDuration((prev) => prev + 100);
    }, 100);

    // Flag'i en son sıfırla (requestAnimationFrame ile bir sonraki frame'e ertele)
    requestAnimationFrame(() => {
      advancingRef.current = false;
    });
  }, [isMultiImage, isTracking, trackingDuration, currentImageIndex, imageUrls, imageDimensions]);

  // Geçiş overlay ref'ini state ile senkronize et (tracking callback state okuyamaz)
  useEffect(() => {
    showTransitionOverlayRef.current = showTransitionOverlay || showDriftCorrection;
  }, [showTransitionOverlay, showDriftCorrection]);

  // Geçiş overlay'ini 1.2 saniye sonra kapat
  useEffect(() => {
    if (!showTransitionOverlay) return;
    const t = setTimeout(() => setShowTransitionOverlay(false), 1200);
    return () => clearTimeout(t);
  }, [showTransitionOverlay]);

  // Kalibrasyon tamamlandı (bias CalibrationManager içinde modele uygulandı)
  const handleCalibrationComplete = useCallback((meanError: number, samples?: any[]) => {
    setCalibrationError(meanError);
    setPhase("tracking");

    // Kalibrasyon yapılan ekran boyutunu kaydet
    calibratedScreenSize.current = { w: window.innerWidth, h: window.innerHeight };
    setResizeWarning(false);

    // Ensemble eğitimini async başlat — UI donmasını önler
    if (samples && samples.length > 0 && ensembleRef.current) {
      const ensemble = ensembleRef.current;
      logger.log("[EyeTracker] Training ensemble with", samples.length, "samples");
      ensemble.trainAsync(samples).catch((err) => {
        logger.warn("[EyeTracker] Ensemble async training failed, trying sync:", err);
        try { ensemble.train(samples); } catch { /* ignore */ }
      });
    }
  }, []);

  // Pencere boyutu değiştiğinde kalibrasyon uyarısı
  useEffect(() => {
    if (!calibratedScreenSize.current) return;
    const handleResize = () => {
      if (!calibratedScreenSize.current) return;
      const dw = Math.abs(window.innerWidth - calibratedScreenSize.current.w);
      const dh = Math.abs(window.innerHeight - calibratedScreenSize.current.h);
      // %5'ten fazla değişiklik varsa uyar
      if (dw > calibratedScreenSize.current.w * 0.05 || dh > calibratedScreenSize.current.h * 0.05) {
        setResizeWarning(true);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [phase]);

  // Fullscreen API
  const requestFullscreen = useCallback(async () => {
    try {
      const elem = containerRef.current ?? document.documentElement;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if ((elem as any).webkitRequestFullscreen) {
        await (elem as any).webkitRequestFullscreen();
      }
    } catch { /* kullanıcı reddedebilir */ }
  }, []);

  const exitFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    } catch { /* ignore */ }
  }, []);

  // Fullscreen state dinle
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  // Ekran yönü kilidi (calibration + tracking fazlarında)
  useEffect(() => {
    if (phase !== "calibration" && phase !== "tracking") return;
    let locked = false;
    const lockOrientation = async () => {
      try {
        const orient = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
        if (orient?.lock) {
          await orient.lock("any");
          locked = true;
        }
      } catch { /* desteklenmiyor veya fullscreen gerekli */ }
    };
    lockOrientation();
    return () => {
      if (locked) {
        try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
      }
    };
  }, [phase]);

  // ResizeObserver ile responsive canvas boyutlandırma
  useEffect(() => {
    if (!imageContainerRef.current || !imageRef.current || phase !== "tracking") return;
    const observer = new ResizeObserver(() => {
      const img = imageRef.current;
      if (!img) return;
      const maxW = window.innerWidth * 0.95;
      const maxH = window.innerHeight * 0.85;
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
      const newDims = {
        width: Math.round(img.naturalWidth * scale),
        height: Math.round(img.naturalHeight * scale),
      };
      setImageDimensions(newDims);
    });
    observer.observe(imageContainerRef.current);
    return () => observer.disconnect();
  }, [phase, imageLoaded]);

  // Görüntünün ekrandaki gerçek pozisyonunu al
  const getImageRect = useCallback((): DOMRect | null => {
    if (!imageContainerRef.current) return null;
    return imageContainerRef.current.getBoundingClientRect();
  }, []);

  // Tracking başlat
  const startTracking = useCallback(() => {
    // Görüntü boyutları henüz yüklenmediyse tracking başlatma
    if (imageDimensions.width <= 0 || imageDimensions.height <= 0 || !imageLoaded) {
      return;
    }
    setIsTracking(true);
    setTrackingDuration(0);
    setFixations([]);
    gazePointsRef.current = [];

    fixationDetectorRef.current = new FixationDetector();
    fixationDetectorRef.current.startTracking();
    blinkDetectorRef.current = new BlinkDetector(
      isMobileDevice() ? 0.14 : 0.20,
      isMobileDevice() ? 4 : 3,
      isMobileDevice() ? 1 : 2
    );
    blinkDetectorRef.current.start();

    if (trackingTimerRef.current) clearInterval(trackingTimerRef.current);
    trackingTimerRef.current = setInterval(() => {
      setTrackingDuration((prev) => prev + 100);
    }, 100);
    
    // Auto-recalibration timer (her 30 saniyede bir kontrol)
    if (autoRecalRef.current && !autoRecalTimerRef.current) {
      autoRecalTimerRef.current = setInterval(() => {
        if (autoRecalRef.current && modelRef.current) {
          // Auto-recalibration'ı idle callback ile yap
          if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
              const updated = autoRecalRef.current.updateModel(modelRef.current);
              if (updated) {
                logger.log("[EyeTracker] Model auto-recalibrated");
              }
            }, { timeout: 2000 });
          } else {
            setTimeout(() => {
              const updated = autoRecalRef.current.updateModel(modelRef.current);
              if (updated) {
                logger.log("[EyeTracker] Model auto-recalibrated");
              }
            }, 100);
          }
        }
      }, 60000);
    }

    // Gaze tracking - mevcut tracking'i durdurup yeni callback ile başlat
    faceTrackerRef.current.stopTracking();

    let debugCounter = 0;
    const debugInterval = 300; // Her 300 frame'de bir log (daha az console spam)
    const mobile = isMobileDevice();

    faceTrackerRef.current.startTracking((features: EyeFeatures) => {
      debugCounter++;
      const shouldLog = debugCounter % debugInterval === 1;

      // Geçiş overlay aktifken veri toplama (kirlilik önleme)
      if (showTransitionOverlayRef.current) return;

      if (!modelRef.current.isTrained()) {
        if (shouldLog) logger.warn("[Tracking] Model eğitilmemiş!");
        return;
      }

      // Adaptive frame throttling — mobilde daha toleranslı (kamera/GPU yavaş)
      const featureTimestamp = performance.now();
      const frameTime = featureTimestamp - lastFeatureTimestampRef.current;

      const targetFrameTime = mobile
        ? (processingTimeRef.current > 25 ? 66 : 50) // Mobil: 15-20fps yeterli
        : (processingTimeRef.current > 15 ? 40 : 33); // Desktop: 25-30fps
      if (frameTime < targetFrameTime) return;

      lastFeatureTimestampRef.current = featureTimestamp;
      const processStart = performance.now();

      // Mobilde kamera kalitesi düşük → confidence ve eyeOpenness eşiklerini gevşet
      const minConfidence = mobile ? 0.05 : 0.15;
      const minEyeOpenness = mobile ? 0.01 : 0.02;
      if (features.confidence < minConfidence || features.eyeOpenness < minEyeOpenness) {
        if (shouldLog) logger.log("[Tracking] Düşük confidence/eyeOpenness:", features.confidence.toFixed(2), features.eyeOpenness.toFixed(3));
        return;
      }

      // BlinkDetector ile göz kırpma kontrolü
      const isBlinking = blinkDetectorRef.current.update(
        features.leftEAR, features.rightEAR, featureTimestamp
      );
      features.isBlinking = isBlinking;
      if (isBlinking) {
        if (shouldLog) logger.log("[Tracking] Blink detected, skipping frame");
        return;
      }

      // Model tahminini al (ensemble veya single)
      let screenPoint: GazePoint | null = null;

      try {
        if (useEnsemble.current && ensembleRef.current) {
          screenPoint = ensembleRef.current.predict(features) as GazePoint;
        }
      } catch (e) {
        // Ensemble başarısız olursa single model'e düş
        if (shouldLog) logger.warn("[Tracking] Ensemble predict hatası, single model kullanılıyor:", e);
        useEnsemble.current = false;
      }

      if (!screenPoint) {
        screenPoint = modelRef.current.predict(features);
      }

      if (!screenPoint) {
        if (shouldLog) logger.log("[Tracking] Model predict null döndü (outlier?)");
        return;
      }
      
      // Processing time tracking
      processingTimeRef.current = performance.now() - processStart;

      const dims = imageDimsRef.current;
      const natDims = imageNatDimsRef.current;

      const imageRectForClamp = getImageRect();
      if (imageRectForClamp) {
        const content = getContentRect(
          imageRectForClamp,
          dims.width,
          dims.height,
          natDims.width || dims.width,
          natDims.height || dims.height
        );
        if (content) {
          const left = content.contentLeft;
          const top = content.contentTop;
          const right = content.contentLeft + content.contentW;
          const bottom = content.contentTop + content.contentH;
          const px = screenPoint.x;
          const py = screenPoint.y;
          const overX = px < left ? left - px : px > right ? px - right : 0;
          const overY = py < top ? top - py : py > bottom ? py - bottom : 0;

          if (overX > 0 || overY > 0) {
            const diagSize = Math.sqrt(content.contentW ** 2 + content.contentH ** 2);
            const overDist = Math.sqrt(overX ** 2 + overY ** 2);

            // Mobilde kalibrasyon hatası yüksek → daha toleranslı sınır
            const boundaryTolerance = mobile ? 0.35 : 0.15;
            if (overDist > diagSize * boundaryTolerance) {
              if (shouldLog) logger.log("[Tracking] İçerik dışı nokta reddedildi:", Math.round(overDist), "px dışarıda");
              return;
            }

            screenPoint.x = Math.max(left, Math.min(right, px));
            screenPoint.y = Math.max(top, Math.min(bottom, py));
            const penalty = Math.min(1, overDist / (diagSize * boundaryTolerance));
            screenPoint.confidence *= (1 - penalty * 0.6);
          }
        }
      }

      if (shouldLog) {
        logger.log("[Tracking] Screen predict:", Math.round(screenPoint.x), Math.round(screenPoint.y),
          "| RelIris L:", features.leftIrisRelX.toFixed(3), features.leftIrisRelY.toFixed(3),
          "| Conf:", features.confidence.toFixed(2));
      }

      // Ekran koordinatlarını görüntü koordinatlarına dönüştür
      const imageRect = getImageRect();
      if (!imageRect) {
        if (shouldLog) logger.warn("[Tracking] imageRect null!");
        return;
      }

      const natW = natDims.width || dims.width;
      const natH = natDims.height || dims.height;
      const imagePoint = screenToImageCoords(
        screenPoint.x,
        screenPoint.y,
        imageRect,
        dims.width,
        dims.height,
        natW,
        natH
      );

      if (!imagePoint) {
        if (shouldLog) logger.log("[Tracking] Görüntü dışı:", Math.round(screenPoint.x), Math.round(screenPoint.y),
          "| ImageRect:", Math.round(imageRect.left), Math.round(imageRect.top), Math.round(imageRect.width), Math.round(imageRect.height));
        return;
      }

      const point: GazePoint = {
        x: imagePoint.x,
        y: imagePoint.y,
        timestamp: screenPoint.timestamp,
        confidence: screenPoint.confidence,
      };

      const BOUNDARY_MARGIN = 30;
      const edgeDistX = Math.min(point.x, dims.width - point.x);
      const edgeDistY = Math.min(point.y, dims.height - point.y);
      const edgeDist = Math.min(edgeDistX, edgeDistY);
      // Kenar yakınında confidence düşür; tüm noktaları kaydet (takılmama için)
      if (edgeDist >= 0 && dims.width > 0 && dims.height > 0) {
        if (edgeDist < BOUNDARY_MARGIN && edgeDist > 0) {
          point.confidence *= (edgeDist / BOUNDARY_MARGIN);
        }
        gazePointsRef.current.push(point);
        // Daha agresif memory management
        if (gazePointsRef.current.length > 20_000) {
          gazePointsRef.current = gazePointsRef.current.slice(-15_000);
        }
        const fixation = fixationDetectorRef.current.addGazePoint(point);
        if (fixation) {
          setFixations((prev) => [...prev, fixation]);
          
          // Auto-recalibration için fixation kaydet
          if (autoRecalRef.current) {
            autoRecalRef.current.registerFixation(fixation, features);
          }
        }
      }

      const now = performance.now();
      if (now - lastUiUpdateRef.current >= GAZE_UI_THROTTLE_MS) {
        lastUiUpdateRef.current = now;
        setGazePoint(point);
      }
    });
  }, [imageLoaded, imageDimensions.width, imageDimensions.height, getImageRect]);

  // Kalibrasyon tamamlandığında otomatik olarak takibi başlat
  useEffect(() => {
    if (phase === "tracking" && !isTracking && imageLoaded && imageDimensions.width > 0) {
      startTracking();
    }
  }, [phase, isTracking, imageLoaded, imageDimensions, startTracking]);

  // Tracking durdur
  const stopTracking = useCallback(() => {
    setIsTracking(false);

    if (trackingTimerRef.current) {
      clearInterval(trackingTimerRef.current);
      trackingTimerRef.current = null;
    }

    if (autoRecalTimerRef.current) {
      clearInterval(autoRecalTimerRef.current);
      autoRecalTimerRef.current = null;
    }

    fixationDetectorRef.current.stopTracking();
    faceTrackerRef.current.stopTracking();

    const currentMetrics = fixationDetectorRef.current.getMetrics();
    setMetrics(currentMetrics);

    // Çoklu fotoğraf modunda: mevcut fotoğrafın verisini kaydet ve TÜM sonuçları birleştir
    if (isMultiImage) {
      const idx = currentImageIndex;
      gazePointsByImageRef.current[idx] = [...gazePointsRef.current];
      fixationsByImageRef.current[idx] = fixationDetectorRef.current.getFixations();
      metricsByImageRef.current[idx] = currentMetrics;
      dimensionsByImageRef.current[idx] = imageDimensions;

      const results: ResultPerImage[] = imageUrls.map((url, i) => ({
        imageUrl: url,
        gazePoints: gazePointsByImageRef.current[i] ?? [],
        fixations: fixationsByImageRef.current[i] ?? [],
        metrics: metricsByImageRef.current[i] ?? null,
        imageDimensions: dimensionsByImageRef.current[i] ?? { width: 0, height: 0 },
      }));
      // Verisi olan sonuçları göster
      const nonEmpty = results.filter(r => r.gazePoints.length > 0 || r.metrics !== null);
      if (nonEmpty.length > 0) {
        setResultsPerImage(nonEmpty);
      }
    }

    setPhase("results");
  }, [isMultiImage, currentImageIndex, imageUrls, imageDimensions]);

  // Klavye kısayolları (takip ekranında)
  useEffect(() => {
    if (phase !== "tracking") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (isTracking) stopTracking();
        else startTracking();
      } else if (e.code === "KeyH") {
        e.preventDefault();
        setShowHeatmap((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    // Cleanup: her zaman listener'ı kaldır (phase ne olursa olsun)
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [phase, isTracking, startTracking, stopTracking]);

  // Canvas çizimi
  useEffect(() => {
    if (phase !== "tracking" || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;

    let running = true;

    let frameSkip = 0;
    const draw = () => {
      if (!running) return;
      
      // Skip frames for smoother animation
      frameSkip = (frameSkip + 1) % 2;
      if (frameSkip === 0 && isTracking) {
        drawAnimRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Canlı gaze noktası
      if (gazePoint && isTracking) {
        // Gaze trail - daha basit (son 5 nokta)
        const recentPoints = gazePointsRef.current.slice(-5);
        if (recentPoints.length > 1) {
          ctx.strokeStyle = "rgba(0, 150, 255, 0.2)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(recentPoints[0].x, recentPoints[0].y);
          for (let i = 1; i < recentPoints.length; i++) {
            ctx.lineTo(recentPoints[i].x, recentPoints[i].y);
          }
          ctx.stroke();
        }

        // Gaze noktası
        ctx.beginPath();
        ctx.arc(gazePoint.x, gazePoint.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 150, 255, 0.6)";
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 150, 255, 0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // İç nokta
        ctx.beginPath();
        ctx.arc(gazePoint.x, gazePoint.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();
      }

      // Fixation noktaları
      for (const fix of fixations) {
        const radius = Math.min(20, Math.max(6, fix.duration / 50));

        ctx.beginPath();
        ctx.arc(fix.x, fix.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 100, 0, 0.3)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 100, 0, 0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "10px sans-serif";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(fix.duration)}ms`, fix.x, fix.y - radius - 4);
      }

      drawAnimRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      running = false;
      if (drawAnimRef.current) {
        cancelAnimationFrame(drawAnimRef.current);
      }
    };
  }, [phase, gazePoint, fixations, isTracking, imageDimensions]);

  // Sonuçları dışa aktar (ham gaze + fixation + ROI). Çoklu fotoğrafta tüm görseller tek JSON'da.
  const exportResults = useCallback(() => {
    const calibrationBlock = {
      method: "poly2_ridge_cubic",
      mean_error_px: Math.round(calibrationError),
      validated: true,
    };

    if (resultsPerImage.length > 0) {
      const exportData = {
        calibration: calibrationBlock,
        image_count: resultsPerImage.length,
        images: resultsPerImage.map((r, idx) => {
          const m = r.metrics;
          const rawPoints = (r.gazePoints ?? []) as { x: number; y: number; timestamp: number; confidence: number }[];
          const gaze_points = smoothGazePointsForExport(rawPoints);
          return {
            image_index: idx,
            image_dimensions: r.imageDimensions,
            gaze_points,
            gaze_point_count: gaze_points.length,
            first_fixation: m?.firstFixation
              ? {
                  x: Math.round(m.firstFixation.x),
                  y: Math.round(m.firstFixation.y),
                  time_ms: Math.round(m.timeToFirstFixation),
                }
              : null,
            fixations: (m?.allFixations ?? []).map((f) => ({
              x: Math.round(f.x),
              y: Math.round(f.y),
              duration_ms: Math.round(f.duration),
              start_ms: Math.round(f.startTime),
              point_count: f.pointCount,
              avg_confidence: Math.round(f.avgConfidence * 100) / 100,
            })),
            total_view_time_ms: m ? Math.round(m.totalViewTime) : 0,
            fixation_count: m?.fixationCount ?? 0,
            avg_fixation_duration_ms: m ? Math.round(m.averageFixationDuration) : 0,
            roi_clusters: (m?.roiClusters ?? []).map((c) => ({
              id: c.id,
              center_x: Math.round(c.centerX),
              center_y: Math.round(c.centerY),
              total_duration_ms: Math.round(c.totalDuration),
              fixation_count: c.fixationCount,
              radius: Math.round(c.radius),
            })),
          };
        }),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "eye-tracking-results.json";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (!metrics) return;
    const gazePoints = gazePointsRef.current;
    const gaze_points = smoothGazePointsForExport(gazePoints);
    const exportData = {
      calibration: calibrationBlock,
      gaze_points,
      gaze_point_count: gaze_points.length,
      first_fixation: metrics.firstFixation
        ? {
            x: Math.round(metrics.firstFixation.x),
            y: Math.round(metrics.firstFixation.y),
            time_ms: Math.round(metrics.timeToFirstFixation),
          }
        : null,
      fixations: metrics.allFixations.map((f) => ({
        x: Math.round(f.x),
        y: Math.round(f.y),
        duration_ms: Math.round(f.duration),
        start_ms: Math.round(f.startTime),
        point_count: f.pointCount,
        avg_confidence: Math.round(f.avgConfidence * 100) / 100,
      })),
      total_view_time_ms: Math.round(metrics.totalViewTime),
      fixation_count: metrics.fixationCount,
      avg_fixation_duration_ms: Math.round(metrics.averageFixationDuration),
      roi_clusters: metrics.roiClusters.map((c) => ({
        id: c.id,
        center_x: Math.round(c.centerX),
        center_y: Math.round(c.centerY),
        total_duration_ms: Math.round(c.totalDuration),
        fixation_count: c.fixationCount,
        radius: Math.round(c.radius),
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "eye-tracking-results.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [metrics, calibrationError, resultsPerImage]);

  // Heatmap dışa aktar
  const exportHeatmap = useCallback(() => {
    if (resultsPerImage.length > 0 && currentImageIndex < resultsPerImage.length) {
      const result = resultsPerImage[currentImageIndex];
      if (!result?.gazePoints?.length) {
        logger.warn("[Export] No gaze data for selected image");
        return;
      }
      const img = new Image();
      img.onload = () => {
        const renderer = webglHeatmapRef.current ?? heatmapRef.current;
        const dataUrl = renderer.exportToPNG(
          result.gazePoints,
          result.fixations || [],
          img,
          result.imageDimensions.width,
          result.imageDimensions.height
        );
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `heatmap-${currentImageIndex + 1}.png`;
        a.click();
      };
      img.src = result.imageUrl;
      return;
    }

    if (!imageRef.current) {
      logger.warn("[Export] imageRef null");
      return;
    }
    if (imageDimensions.width <= 0 || imageDimensions.height <= 0) return;

    const gazePoints = fixationDetectorRef.current.getGazePoints();
    const allFixations = fixationDetectorRef.current.getFixations();

    const renderer = webglHeatmapRef.current ?? heatmapRef.current;
    const dataUrl = renderer.exportToPNG(
      gazePoints,
      allFixations,
      imageRef.current,
      imageDimensions.width,
      imageDimensions.height
    );

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "heatmap.png";
    a.click();
  }, [imageDimensions, resultsPerImage, currentImageIndex]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return `${seconds}.${tenths}s`;
  };

  return (
    <div className="relative flex flex-col items-center w-full min-h-screen bg-gray-950 p-4">
      {/* Gizli video: pupil_align dışında kullanılır; pupil_align'da video PupilAlignStep içinde gösteriliyor (tek video) */}
      {phase !== "pupil_align" && (
        <video
          ref={videoRef}
          className="absolute opacity-0 pointer-events-none"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 64,
            height: 48,
            zIndex: -1,
          }}
          width={960}
          height={720}
          playsInline
          muted
          autoPlay
        />
      )}

      {/* Hata mesajı */}
      {error && (
        <div role="alert" className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-900/90 border border-red-500 rounded-xl px-6 py-4 text-red-200 z-50 max-w-lg text-center shadow-xl">
          <p className="font-medium">⚠️ {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 px-4 py-2 bg-red-700 rounded-lg text-sm font-medium hover:bg-red-600 focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:outline-none"
          >
            {t.reloadPage}
          </button>
        </div>
      )}

      {/* Yükleniyor */}
      {phase === "loading" && (
        <div className="flex flex-col items-center justify-center h-screen">
          <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mb-4" />
          <p className="text-gray-400">Görüntü yükleniyor...</p>
        </div>
      )}

      {/* Kamera başlatılıyor */}
      {phase === "camera_init" && (
        <div className="flex flex-col items-center justify-center h-screen">
          <div className="animate-pulse w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mb-4">
            <span className="text-3xl">📷</span>
          </div>
          <p className="text-gray-400">{cameraStatus}</p>
          <p className="text-gray-600 text-sm mt-2">
            Lütfen kamera erişim iznini onaylayın
          </p>
          <div className="mt-4 w-48 bg-gray-800 rounded-full h-1">
            <div className="bg-blue-500 h-1 rounded-full animate-pulse" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {/* İsteğe bağlı: göz bebeği hizalama — tek video kullanılıyor (FaceTracker bu videodan frame alır, yüz tespiti çalışır) */}
      {phase === "pupil_align" && (
        <PupilAlignStep
          faceTracker={faceTrackerRef.current}
          videoRef={videoRef}
          onSkip={() => setPhase("calibration")}
          onDone={(left, right) => {
            faceTrackerRef.current.setIrisOffset(left, right);
            setPhase("calibration");
          }}
        />
      )}

      {/* Kalibrasyon - artık tam ekran, containerWidth/Height yok */}
      {phase === "calibration" && (
        <Calibration
          model={modelRef.current}
          faceTracker={faceTrackerRef.current}
          onComplete={handleCalibrationComplete}
          onCancel={onReset}
        />
      )}

      {/* Tracking */}
      {phase === "tracking" && (
        <div className="flex flex-col items-center gap-4">
          {/* Üst bilgi barı — kullanıcıya sadece gerekli bilgi */}
          <div className="w-full max-w-4xl flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-4 bg-gray-900 rounded-xl px-6 py-3 shadow-lg">
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isTracking ? "bg-green-400 animate-pulse" : "bg-gray-500"
                  }`}
                />
                <span className="text-gray-300 text-sm">
                  {isTracking ? "Takip Ediliyor" : "Hazır"}
                </span>
              </div>
              <span className="text-gray-400 text-sm">
                {formatTime(trackingDuration)}
              </span>
              <span className="text-gray-600 text-xs">
                {faceTrackerRef.current.getFPS()} FPS
                {faceTrackerRef.current.getLastFrameUsedZoom() ? " | Zoom" : ""}
                {" | "}{gazePointsRef.current.length} pt
                {faceTrackerRef.current.getLastFeatures()?.confidence !== undefined
                  ? ` | C:${(faceTrackerRef.current.getLastFeatures()!.confidence * 100).toFixed(0)}%`
                  : ""}
              </span>
              {isMultiImage && (
                <span aria-live="polite" className="text-blue-300 text-sm font-medium">
                  Foto {currentImageIndex + 1}/{imageCount} · {Math.max(0, Math.ceil((IMAGE_DURATION_MS - trackingDuration) / 1000))} s kaldı
                </span>
              )}
              {resizeWarning && (
                <span className="text-amber-400 text-sm font-medium animate-pulse">
                  Pencere boyutu degisti
                </span>
              )}
              {glassesWarning && (
                <span className="text-amber-300 text-xs" title={glassesWarning}>
                  Gozluk algilandi
                </span>
              )}
              <button
                onClick={isFullscreen ? exitFullscreen : requestFullscreen}
                className="ml-auto text-gray-400 hover:text-white text-sm px-3 py-1 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors min-h-[44px] min-w-[44px]"
                aria-label={isFullscreen ? "Tam ekrandan cik" : "Tam ekran"}
              >
                {isFullscreen ? "Kucult" : "Tam Ekran"}
              </button>
            </div>
            {isMultiImage && isTracking && (
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden" role="progressbar" aria-valuenow={Math.min(100, Math.round((trackingDuration / IMAGE_DURATION_MS) * 100))} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${Math.min(100, (trackingDuration / IMAGE_DURATION_MS) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* Görüntü + Overlay */}
          <div
            ref={imageContainerRef}
            className={`relative border-2 border-gray-700 rounded-lg overflow-hidden shadow-2xl${isTracking ? " tracking-area" : ""}`}
            style={{
              width: imageDimensions.width,
              height: imageDimensions.height,
            }}
            onClick={(e) => {
              if (isTracking && autoRecalRef.current) {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                autoRecalRef.current.registerClick(x, y);
              }
            }}
          >
            {/* Geçiş overlay */}
            {showTransitionOverlay && isMultiImage && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="text-center text-white px-6 py-4 rounded-xl bg-gray-900/90 border border-gray-700">
                  <p className="text-lg font-medium">{t.photoComplete.replace("{n}", String(transitionPhotoNumRef.current)).replace("{total}", String(imageCount))}</p>
                  <p className="text-gray-300 text-sm mt-1">{t.nextPhoto}</p>
                </div>
              </div>
            )}
            {/* Base image */}
            <NextImage
              src={currentImageUrl}
              alt="Analiz goruntusu"
              fill
              unoptimized
              className="absolute inset-0 w-full h-full object-contain"
            />

            {/* Gaze overlay canvas */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 z-10"
              style={{
                width: imageDimensions.width,
                height: imageDimensions.height,
              }}
            />

            {/* Heatmap overlay */}
            {showHeatmap && (
              <HeatmapCanvas
                gazePoints={gazePointsRef.current}
                fixations={fixations}
                width={imageDimensions.width}
                height={imageDimensions.height}
              />
            )}
          </div>

          {/* Sadece Takibi Başlat / Durdur — kullanıcıya gelişmiş kontroller gösterilmez */}
          <div className="flex flex-wrap gap-2 sm:gap-3 touch-manipulation">
            {!isTracking ? (
              <button
                onClick={startTracking}
                className="min-h-[44px] min-w-[44px] px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-500 transition shadow-lg flex items-center gap-2 focus:ring-2 focus:ring-green-400 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
                aria-label="Takibi başlat"
              >
                <span>▶</span> Takibi Başlat
              </button>
            ) : (
              <button
                onClick={stopTracking}
                className="min-h-[44px] min-w-[44px] px-6 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-500 transition shadow-lg flex items-center gap-2 focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
                aria-label="Takibi durdur"
              >
                <span>⏹</span> Takibi Durdur
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sonuçlar - çoklu fotoğraf: her biri için ayrı heatmap */}
      {phase === "results" && resultsPerImage.length > 0 && (
        <ResultsPanel
          resultsPerImage={resultsPerImage}
          calibrationError={calibrationError}
          onExportJSON={exportResults}
          onExportHeatmap={exportHeatmap}
          onReset={onReset}
          onRecalibrate={() => setPhase("calibration")}
        />
      )}
      {/* Tek görüntü sonuçları (geriye dönük uyum - artık 10 foto kullanılıyor) */}
      {phase === "results" && resultsPerImage.length === 0 && metrics && (
        <ResultsPanel
          metrics={metrics}
          gazePoints={gazePointsRef.current}
          calibrationError={calibrationError}
          imageUrl={currentImageUrl}
          imageDimensions={imageDimensions}
          onExportJSON={exportResults}
          onExportHeatmap={exportHeatmap}
          onReset={onReset}
          onRecalibrate={() => setPhase("calibration")}
        />
      )}

      {/* Drift düzeltme overlay (multi-image geçişlerinde) */}
      {showDriftCorrection && isMultiImage && (
        <DriftCorrectionOverlay
          model={modelRef.current}
          faceTracker={faceTrackerRef.current}
          photoNum={transitionPhotoNumRef.current + 1}
          totalPhotos={imageCount}
          onDone={() => {
            setShowDriftCorrection(false);
            setShowTransitionOverlay(true);
          }}
        />
      )}

      {/* Gerçek zamanlı kalite göstergesi + gözlük tespiti */}
      {phase === "tracking" && (
        <QualityIndicator
          faceTracker={faceTrackerRef.current}
          isTracking={isTracking}
          glassesDetector={glassesDetectorRef.current}
          onGlassesDetected={setGlassesWarning}
        />
      )}

      {/* Kamera önizleme */}
      {(phase === "tracking" || phase === "calibration") && (
        <div className="fixed bottom-4 right-4 w-24 h-[4.5rem] sm:w-40 sm:h-[7.5rem] rounded-lg overflow-hidden border-2 border-gray-600 shadow-lg bg-black z-40">
          <CameraPreview faceTracker={faceTrackerRef.current} />
          <div className="absolute top-1 left-1 bg-black/60 rounded px-1 text-xs text-green-400">
            CAM
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Gerçek zamanlı kalite göstergesi — tracking sırasında güven seviyesini gösterir.
 * Renk kodları: yeşil=mükemmel, mavi=iyi, sarı=düşük, kırmızı=çok düşük
 */
function QualityIndicator({
  faceTracker,
  isTracking,
  glassesDetector,
  onGlassesDetected,
}: {
  faceTracker: FaceTracker;
  isTracking: boolean;
  glassesDetector: GlassesDetector;
  onGlassesDetected: (msg: string | null) => void;
}) {
  const [quality, setQuality] = useState({ confidence: 0, fps: 0, status: "...", color: "gray" as string });
  const historyRef = useRef<number[]>([]);
  const glassesNotifiedRef = useRef(false);

  useEffect(() => {
    if (!isTracking) return;
    const interval = setInterval(() => {
      const features = faceTracker.getLastFeatures();
      const fps = faceTracker.getFPS();
      const conf = features?.confidence ?? 0;

      // Son 10 ölçümün ortalaması (anlık sıçramaları yumuşat)
      historyRef.current.push(conf);
      if (historyRef.current.length > 10) historyRef.current.shift();
      const avgConf = historyRef.current.reduce((a, b) => a + b, 0) / historyRef.current.length;

      let status: string;
      let color: string;
      if (avgConf >= 0.7) { status = "Mukemmel"; color = "green"; }
      else if (avgConf >= 0.4) { status = "Iyi"; color = "blue"; }
      else if (avgConf >= 0.2) { status = "Dusuk"; color = "yellow"; }
      else { status = "Cok Dusuk"; color = "red"; }

      // Gözlük tespiti (landmarks üzerinden)
      const landmarks = faceTracker.getLastLandmarks();
      if (landmarks && landmarks.length > 0) {
        const detection = glassesDetector.update(landmarks);
        if (detection.detected && !glassesNotifiedRef.current) {
          glassesNotifiedRef.current = true;
          onGlassesDetected(detection.message);
        }
      }

      setQuality({ confidence: avgConf, fps, status, color });
    }, 500);
    return () => clearInterval(interval);
  }, [faceTracker, isTracking, glassesDetector, onGlassesDetected]);

  if (!isTracking) return null;

  const colorClasses: Record<string, { bg: string; text: string }> = {
    green: { bg: "bg-green-500", text: "text-green-400" },
    blue: { bg: "bg-blue-500", text: "text-blue-400" },
    yellow: { bg: "bg-yellow-500", text: "text-yellow-400" },
    red: { bg: "bg-red-500", text: "text-red-400" },
    gray: { bg: "bg-gray-500", text: "text-gray-400" },
  };

  const c = colorClasses[quality.color] ?? colorClasses.gray;

  return (
    <div className="fixed top-4 right-4 z-40 bg-gray-900/90 backdrop-blur rounded-lg px-3 py-2 border border-gray-700 min-w-[110px]">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-2.5 h-2.5 rounded-full ${c.bg} ${quality.color === "red" ? "animate-pulse" : ""}`} />
        <span className={`text-xs font-semibold ${c.text}`}>{quality.status}</span>
      </div>
      <div className="text-[10px] text-gray-500">
        Guven: {Math.round(quality.confidence * 100)}%
      </div>
      {quality.color === "red" && (
        <p className="text-[10px] text-red-400 mt-1">Yuzunuzu kameraya yaklastirin</p>
      )}
      {quality.color === "yellow" && (
        <p className="text-[10px] text-yellow-400 mt-1">Basinizi sabit tutun</p>
      )}
    </div>
  );
}

/**
 * Drift düzeltme noktası — görüntüler arası geçişte ekran merkezine bakış doğrulama.
 * 2 saniye boyunca merkez noktaya bakılır, toplanan gaze verisi ile model micro-correction yapar.
 */
function DriftCorrectionOverlay({
  model,
  faceTracker,
  onDone,
  photoNum,
  totalPhotos,
}: {
  model: GazeModel;
  faceTracker: FaceTracker;
  onDone: () => void;
  photoNum: number;
  totalPhotos: number;
}) {
  const [progress, setProgress] = useState(0);
  const gazeCollectorRef = useRef<Array<{ px: number; py: number }>>([]);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(performance.now());
  const DURATION = 2000; // 2 saniye
  const centerX = typeof window !== "undefined" ? window.innerWidth / 2 : 960;
  const centerY = typeof window !== "undefined" ? window.innerHeight / 2 : 540;

  useEffect(() => {
    startTimeRef.current = performance.now();
    gazeCollectorRef.current = [];

    const loop = () => {
      const elapsed = performance.now() - startTimeRef.current;
      setProgress(Math.min(1, elapsed / DURATION));

      // Gaze toplanması
      const features = faceTracker.getLastFeatures();
      if (features && features.confidence > 0.2) {
        const pred = model.predict(features);
        if (pred) {
          gazeCollectorRef.current.push({ px: pred.x, py: pred.y });
        }
      }

      if (elapsed >= DURATION) {
        // Toplanan verilerle drift hesapla
        const samples = gazeCollectorRef.current;
        if (samples.length >= 5) {
          const avgX = samples.reduce((s, p) => s + p.px, 0) / samples.length;
          const avgY = samples.reduce((s, p) => s + p.py, 0) / samples.length;
          const driftX = centerX - avgX;
          const driftY = centerY - avgY;
          // Sadece makul drift ise düzelt (çok büyük drift hatalı veri demek)
          const maxDrift = Math.min(window.innerWidth, window.innerHeight) * 0.15;
          if (Math.abs(driftX) < maxDrift && Math.abs(driftY) < maxDrift) {
            model.applyDriftCorrection(centerX, centerY, avgX, avgY);
          }
        }
        onDone();
        return;
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [model, faceTracker, onDone, centerX, centerY]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex items-center justify-center">
      {/* Merkez nokta */}
      <div className="relative">
        <div className="w-10 h-10 rounded-full border-2 border-white/60 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-white" />
        </div>
        {/* Dairesel progress */}
        <svg className="absolute -inset-2 w-14 h-14" viewBox="0 0 56 56">
          <circle
            cx="28" cy="28" r="24"
            fill="none"
            stroke="rgba(59,130,246,0.3)"
            strokeWidth="3"
          />
          <circle
            cx="28" cy="28" r="24"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${progress * 150.8} 150.8`}
            transform="rotate(-90 28 28)"
          />
        </svg>
      </div>
      <div className="absolute bottom-20 text-center">
        <p className="text-white text-sm font-medium">Merkeze bakin</p>
        <p className="text-gray-500 text-xs mt-1">
          Foto {photoNum}/{totalPhotos} — Drift duzeltme
        </p>
      </div>
    </div>
  );
}

// Kamera önizleme bileşeni
function CameraPreview({ faceTracker }: { faceTracker: FaceTracker }) {
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = previewRef.current;
    const stream = faceTracker.getStream();
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    return () => {
      if (video) video.srcObject = null;
    };
  }, [faceTracker]);

  return (
    <video
      ref={previewRef}
      className="w-full h-full object-cover transform scale-x-[-1]"
      playsInline
      muted
      autoPlay
    />
  );
}
