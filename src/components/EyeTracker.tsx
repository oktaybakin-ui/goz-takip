"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { GazeModel, GazePoint, EyeFeatures } from "@/lib/gazeModel";
import { FaceTracker } from "@/lib/faceTracker";
import { FixationDetector, Fixation, FixationMetrics } from "@/lib/fixation";
import { HeatmapGenerator } from "@/lib/heatmap";
import { logger } from "@/lib/logger";
import { useLang } from "@/contexts/LangContext";
import Calibration from "./Calibration";
import PupilAlignStep from "./PupilAlignStep";
import HeatmapCanvas from "./HeatmapCanvas";
import ResultsPanel from "./ResultsPanel";

const IMAGE_DURATION_MS = 20_000; // Her fotoğraf 20 saniye, otomatik geçiş

import type { ResultPerImage } from "@/types/results";

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

/** Export için yumuşak geçiş: 3 noktalı hareketli ortalama (x,y). */
function smoothGazePointsForExport<T extends { x: number; y: number; timestamp: number; confidence: number }>(
  points: T[]
): { x: number; y: number; timestamp_ms: number; confidence: number; dt_ms: number }[] {
  if (points.length === 0) return [];
  const w = 0.25; // önceki/sonraki ağırlık
  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const x = i === 0 ? p.x : i === points.length - 1 ? p.x : w * prev.x + (1 - 2 * w) * p.x + w * next.x;
    const y = i === 0 ? p.y : i === points.length - 1 ? p.y : w * prev.y + (1 - 2 * w) * p.y + w * next.y;
    const dt_ms = i === 0 ? 0 : Math.round(p.timestamp - prev.timestamp);
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
  const transitionPhotoNumRef = useRef(0);
  const [resizeWarning, setResizeWarning] = useState(false);
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

  const modelRef = useRef<GazeModel>(null as unknown as GazeModel);
  if (!modelRef.current) modelRef.current = new GazeModel(0.03);
  const faceTrackerRef = useRef<FaceTracker>(null as unknown as FaceTracker);
  if (!faceTrackerRef.current) faceTrackerRef.current = new FaceTracker();
  const fixationDetectorRef = useRef<FixationDetector>(null as unknown as FixationDetector);
  if (!fixationDetectorRef.current) fixationDetectorRef.current = new FixationDetector();
  const heatmapRef = useRef<HeatmapGenerator>(null as unknown as HeatmapGenerator);
  if (!heatmapRef.current) heatmapRef.current = new HeatmapGenerator();
  const trackingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gazePointsRef = useRef<GazePoint[]>([]);
  const drawAnimRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);
  const lastRawScreenPointRef = useRef<{ x: number; y: number } | null>(null);
  const showTransitionOverlayRef = useRef(false);
  const lastFeatureTimestampRef = useRef(0);
  const GAZE_UI_THROTTLE_MS = 80;

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

  // Tüm görüntüleri önceden yükle (data URL'ler büyük olabilir - ref'te tut, cleanup'ta temizle)
  const preloadImagesRef = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    const imgs = imageUrls.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });
    preloadImagesRef.current = imgs;
    return () => {
      imgs.forEach((img) => { img.src = ""; });
      preloadImagesRef.current = [];
    };
  }, [imageUrls]);

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
      const maxW = Math.min(window.innerWidth * 0.92, 1400);
      const maxH = Math.min(window.innerHeight * 0.82, 950);
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

    trackingTimerRef.current = setInterval(() => {
      setTrackingDuration((prev) => prev + 100);
    }, 100);

    transitionPhotoNumRef.current = idx + 1;
    setFixations([]);
    setMetrics(null);
    setTrackingDuration(0);
    setShowTransitionOverlay(true);
    setCurrentImageIndex(idx + 1);

    // Flag'i en son sıfırla (requestAnimationFrame ile bir sonraki frame'e ertele)
    requestAnimationFrame(() => {
      advancingRef.current = false;
    });
  }, [isMultiImage, isTracking, trackingDuration, currentImageIndex, imageUrls, imageDimensions]);

  // Geçiş overlay ref'ini state ile senkronize et (tracking callback state okuyamaz)
  useEffect(() => {
    showTransitionOverlayRef.current = showTransitionOverlay;
  }, [showTransitionOverlay]);

  // Geçiş overlay'ini 1.2 saniye sonra kapat
  useEffect(() => {
    if (!showTransitionOverlay) return;
    const t = setTimeout(() => setShowTransitionOverlay(false), 1200);
    return () => clearTimeout(t);
  }, [showTransitionOverlay]);

  // Kalibrasyon tamamlandı (bias CalibrationManager içinde modele uygulandı)
  const handleCalibrationComplete = useCallback((meanError: number) => {
    setCalibrationError(meanError);
    setPhase("tracking");
    // Kalibrasyon yapılan ekran boyutunu kaydet
    calibratedScreenSize.current = { w: window.innerWidth, h: window.innerHeight };
    setResizeWarning(false);
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

  // Görüntünün ekrandaki gerçek pozisyonunu al
  const getImageRect = useCallback((): DOMRect | null => {
    if (!imageContainerRef.current) return null;
    return imageContainerRef.current.getBoundingClientRect();
  }, []);

  // Tracking başlat
  const startTracking = useCallback(() => {
    // Görüntü boyutları henüz yüklenmediyse tracking başlatma
    if (imageDimensions.width <= 0 || imageDimensions.height <= 0 || !imageLoaded) {
      logger.warn("[Tracking] Görüntü henüz yüklenmedi, tracking erteleniyor");
      return;
    }
    setIsTracking(true);
    setTrackingDuration(0);
    setFixations([]);
    gazePointsRef.current = [];

    fixationDetectorRef.current = new FixationDetector();
    fixationDetectorRef.current.startTracking();

    if (trackingTimerRef.current) clearInterval(trackingTimerRef.current);
    trackingTimerRef.current = setInterval(() => {
      setTrackingDuration((prev) => prev + 100);
    }, 100);

    // Gaze tracking - mevcut tracking'i durdurup yeni callback ile başlat
    faceTrackerRef.current.stopTracking();

    let debugCounter = 0;
    const debugInterval = 60; // Her 60 frame'de bir log

    faceTrackerRef.current.startTracking((features: EyeFeatures) => {
      debugCounter++;
      const shouldLog = debugCounter % debugInterval === 1;

      // Geçiş overlay aktifken veri toplama (kirlilik önleme)
      if (showTransitionOverlayRef.current) return;

      if (!modelRef.current.isTrained()) {
        if (shouldLog) logger.warn("[Tracking] Model eğitilmemiş!");
        return;
      }

      // Aynı kameradan gelen tekrarlı frame'leri atla (30fps kamera, 60fps rAF)
      const featureTimestamp = performance.now();
      if (featureTimestamp - lastFeatureTimestampRef.current < 15) return;
      lastFeatureTimestampRef.current = featureTimestamp;

      if (features.confidence < 0.15 || features.eyeOpenness < 0.02) {
        if (shouldLog) logger.log("[Tracking] Düşük confidence/eyeOpenness:", features.confidence.toFixed(2), features.eyeOpenness.toFixed(3));
        return;
      }

      // Model ekran koordinatlarında tahmin yapar
      let screenPoint = modelRef.current.predict(features);
      if (!screenPoint) {
        if (shouldLog) logger.log("[Tracking] Model predict null döndü (outlier?)");
        return;
      }

      lastRawScreenPointRef.current = { x: screenPoint.x, y: screenPoint.y };

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

            // %10'dan fazla dışarıdaysa tamamen reddet (kenar fiksasyon şişirmesini önle)
            if (overDist > diagSize * 0.10) {
              if (shouldLog) logger.log("[Tracking] İçerik dışı nokta reddedildi:", Math.round(overDist), "px dışarıda");
              return;
            }

            screenPoint.x = Math.max(left, Math.min(right, px));
            screenPoint.y = Math.max(top, Math.min(bottom, py));
            const penalty = Math.min(1, overDist / (diagSize * 0.10));
            screenPoint.confidence *= (1 - penalty * 0.8);
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
        if (gazePointsRef.current.length > 50_000) {
          gazePointsRef.current = gazePointsRef.current.slice(-40_000);
        }
        const fixation = fixationDetectorRef.current.addGazePoint(point);
        if (fixation) {
          setFixations((prev) => [...prev, fixation]);
        }
      }

      const now = performance.now();
      if (now - lastUiUpdateRef.current >= GAZE_UI_THROTTLE_MS) {
        lastUiUpdateRef.current = now;
        setGazePoint(point);
      }
    });
  }, [imageLoaded, getImageRect]);

  // Tracking durdur
  const stopTracking = useCallback(() => {
    setIsTracking(false);

    if (trackingTimerRef.current) {
      clearInterval(trackingTimerRef.current);
      trackingTimerRef.current = null;
    }

    fixationDetectorRef.current.stopTracking();
    faceTrackerRef.current.stopTracking();

    const results = fixationDetectorRef.current.getMetrics();
    setMetrics(results);
    setPhase("results");
  }, []);

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

    const draw = () => {
      if (!running) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Canlı gaze noktası
      if (gazePoint && isTracking) {
        // Gaze trail (son 10 nokta)
        const recentPoints = gazePointsRef.current.slice(-10);
        if (recentPoints.length > 1) {
          ctx.strokeStyle = "rgba(0, 150, 255, 0.3)";
          ctx.lineWidth = 2;
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
        const dataUrl = heatmapRef.current.exportToPNG(
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

    const dataUrl = heatmapRef.current.exportToPNG(
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
      {/* Gizli video elementi */}
      <video
        ref={videoRef}
        className="absolute opacity-0 pointer-events-none"
        style={{ position: "fixed", top: -9999, left: -9999 }}
        width={960}
        height={720}
        playsInline
        muted
        autoPlay
      />

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

      {/* İsteğe bağlı: göz bebeği hizalama (kalibrasyon öncesi) */}
      {phase === "pupil_align" && (
        <PupilAlignStep
          faceTracker={faceTrackerRef.current}
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
              {isMultiImage && (
                <span aria-live="polite" className="text-blue-300 text-sm font-medium">
                  Foto {currentImageIndex + 1}/{imageCount} · {Math.max(0, Math.ceil((IMAGE_DURATION_MS - trackingDuration) / 1000))} s kaldı
                </span>
              )}
              {resizeWarning && (
                <span className="text-amber-400 text-sm font-medium animate-pulse">
                  ⚠ Pencere boyutu değişti
                </span>
              )}
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
            className="relative border-2 border-gray-700 rounded-lg overflow-hidden shadow-2xl"
            style={{
              width: imageDimensions.width,
              height: imageDimensions.height,
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
            <img
              src={currentImageUrl}
              alt="Analiz görüntüsü"
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
