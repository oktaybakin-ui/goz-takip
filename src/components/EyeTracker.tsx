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
  const [fps, setFps] = useState(0);
  const [eyeZoomActive, setEyeZoomActive] = useState(false);
  const [gazePoint, setGazePoint] = useState<GazePoint | null>(null);
  const [fixations, setFixations] = useState<Fixation[]>([]);
  const [metrics, setMetrics] = useState<FixationMetrics | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showRawScreenGaze, setShowRawScreenGaze] = useState(false);
  const [rawScreenGaze, setRawScreenGaze] = useState<{ x: number; y: number } | null>(null);
  const [flipGazeX, setFlipGazeX] = useState(false);
  const [flipGazeY, setFlipGazeY] = useState(false);
  const [userOffset, setUserOffset] = useState<{ x: number; y: number } | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [trackingDuration, setTrackingDuration] = useState(0);
  const [calibrationError, setCalibrationError] = useState<number>(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [imageNaturalDimensions, setImageNaturalDimensions] = useState({ width: 0, height: 0 });
  const [cameraStatus, setCameraStatus] = useState<string>("Bekleniyor...");
  const [resultsPerImage, setResultsPerImage] = useState<ResultPerImage[]>([]);
  const [showTransitionOverlay, setShowTransitionOverlay] = useState(false);
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

  const modelRef = useRef<GazeModel>(new GazeModel(0.03, 0.4));
  const faceTrackerRef = useRef<FaceTracker>(new FaceTracker());
  const fixationDetectorRef = useRef<FixationDetector>(new FixationDetector());
  const heatmapRef = useRef<HeatmapGenerator>(new HeatmapGenerator());
  const trackingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gazePointsRef = useRef<GazePoint[]>([]);
  const drawAnimRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);
  const lastRawScreenPointRef = useRef<{ x: number; y: number } | null>(null);
  const lookHereOffsetsRef = useRef<{ x: number; y: number }[]>([]);
  const GAZE_UI_THROTTLE_MS = 80;

  const LOOK_HERE_MAX = 7; // Son 7 tıklama medyanı = daha kararlı offset
  const OFFSET_CAP_PX = 1500;

  function medianOffset(arr: { x: number; y: number }[]): { x: number; y: number } {
    if (arr.length === 0) return { x: 0, y: 0 };
    if (arr.length === 1) return arr[0];
    const xs = [...arr].map((o) => o.x).sort((a, b) => a - b);
    const ys = [...arr].map((o) => o.y).sort((a, b) => a - b);
    const m = arr.length >> 1;
    const x = arr.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
    const y = arr.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2;
    return { x, y };
  }

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

  // Tüm görüntüleri önceden yükle
  useEffect(() => {
    imageUrls.forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  }, [imageUrls]);

  // Görüntüyü yükle (mevcut indekse göre)
  useEffect(() => {
    setImageLoaded(false);
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
      setImageNaturalDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      // Fotoğraf büyük görünsün: ekranın büyük kısmını kullan, küçük kırpılmış foto da büyütülebilsin
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
      setError("Görüntü yüklenemedi.");
    };
    img.src = currentImageUrl;
  }, [currentImageUrl, currentImageIndex, isMultiImage]);

  // Kamerayı başlat
  useEffect(() => {
    if (!imageLoaded) return;

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

        setCameraStatus("FaceMesh modeli yükleniyor...");
        faceTrackerRef.current.startTracking(() => {});

        setCameraStatus("Hazır!");
        setPhase("pupil_align");
      } catch (err) {
        if (!mounted) return;
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
      faceTrackerRef.current.destroy();
    };
  }, [imageLoaded]);

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

    // State güncellemelerini toplu yap
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

      if (!modelRef.current.isTrained()) {
        if (shouldLog) logger.warn("[Tracking] Model eğitilmemiş!");
        return;
      }

      // Odaklanma: sadece yüz/iris net göründüğünde nokta kabul et (takip kalitesi artar)
      if (features.confidence < 0.3 || features.eyeOpenness < 0.05) {
        if (shouldLog) logger.log("[Tracking] Düşük confidence/eyeOpenness:", features.confidence.toFixed(2), features.eyeOpenness.toFixed(3));
        return;
      }

      // Model ekran koordinatlarında tahmin yapar
      let screenPoint = modelRef.current.predict(features);
      if (!screenPoint) {
        if (shouldLog) logger.log("[Tracking] Model predict null döndü (outlier?)");
        return;
      }

      // Kullanıcı ayarı: tahmin eksenlerini ters çevir (kamera/ayna farkı için)
      const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
      const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
      if (flipGazeX) screenPoint = { ...screenPoint, x: vw - screenPoint.x };
      if (flipGazeY) screenPoint = { ...screenPoint, y: vh - screenPoint.y };

      lastRawScreenPointRef.current = { x: screenPoint.x, y: screenPoint.y };
      if (userOffset) {
        // "Buraya bakıyorum" sonrası solda kalma düzeltmesi: noktayı hafif sağa kaydır
        const USER_OFFSET_BIAS_PX = 22;
        screenPoint = {
          ...screenPoint,
          x: screenPoint.x + userOffset.x + USER_OFFSET_BIAS_PX,
          y: screenPoint.y + userOffset.y,
        };
      }

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
            screenPoint.x = Math.max(left, Math.min(right, px));
            screenPoint.y = Math.max(top, Math.min(bottom, py));
            // İçerik dışına çıkış mesafesine göre confidence düşür
            const diagSize = Math.sqrt(content.contentW ** 2 + content.contentH ** 2);
            const overDist = Math.sqrt(overX ** 2 + overY ** 2);
            const penalty = Math.min(1, overDist / (diagSize * 0.15));
            screenPoint.confidence *= (1 - penalty * 0.7);
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
      if (edgeDist > 0) {
        // Kenar yakınında confidence düşür (BOUNDARY_MARGIN içindeyse)
        if (edgeDist < BOUNDARY_MARGIN) {
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
        setRawScreenGaze({ x: screenPoint.x, y: screenPoint.y });
        setFps(faceTrackerRef.current.getFPS());
        setEyeZoomActive(faceTrackerRef.current.getLastFrameUsedZoom());
      }
    });
  }, [imageLoaded, getImageRect, flipGazeX, flipGazeY, userOffset]);

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

  // Drift düzeltme
  const handleDriftCorrection = useCallback(() => {
    modelRef.current.resetSmoothing();
  }, []);

  // "Burada bakıyorum": son 5 tıklamanın medyanı, ±1500 px sınırı
  const handleLookHereOffset = useCallback(() => {
    const rect = getImageRect();
    const raw = lastRawScreenPointRef.current;
    if (!rect || !raw) return;
    const content = getContentRect(
      rect,
      imageDimensions.width,
      imageDimensions.height,
      imageNaturalDimensions.width || imageDimensions.width,
      imageNaturalDimensions.height || imageDimensions.height
    );
    if (!content) return;
    const targetX = content.contentLeft + content.contentW / 2;
    const targetY = content.contentTop + content.contentH / 2;
    let ox = targetX - raw.x;
    let oy = targetY - raw.y;
    ox = Math.max(-OFFSET_CAP_PX, Math.min(OFFSET_CAP_PX, ox));
    oy = Math.max(-OFFSET_CAP_PX, Math.min(OFFSET_CAP_PX, oy));
    const arr = lookHereOffsetsRef.current;
    arr.push({ x: ox, y: oy });
    if (arr.length > LOOK_HERE_MAX) arr.shift();
    setUserOffset(medianOffset(arr));
  }, [getImageRect, imageDimensions, imageNaturalDimensions]);

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

      // Ortada hedef nokta: "Burada bakıyorum" için bakılacak yer
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.fill();

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
        user_offset_applied: userOffset ? { x: Math.round(userOffset.x), y: Math.round(userOffset.y) } : null,
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
      user_offset_applied: userOffset ? { x: Math.round(userOffset.x), y: Math.round(userOffset.y) } : null,
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
  }, [metrics, calibrationError, resultsPerImage, userOffset]);

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
          {/* Üst bilgi barı */}
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
              <div className="text-gray-500">|</div>
              <span className="text-gray-400 text-sm">{fps} FPS</span>
              <div className="text-gray-500">|</div>
              <span
                className="text-gray-400 text-sm"
                title="Göz bölgesi yakınlaştırma (iris hassasiyeti). Açık: kamera 640px+ ve yüz algılandı."
              >
                Göz zoom: {eyeZoomActive ? "açık" : "kapalı"}
              </span>
              <div className="text-gray-500">|</div>
              <span className="text-gray-400 text-sm">
                Süre: {formatTime(trackingDuration)}
              </span>
              {resizeWarning && (
                <>
                  <div className="text-gray-500">|</div>
                  <span className="text-amber-400 text-sm font-medium animate-pulse">
                    ⚠ Pencere boyutu değişti – tekrar kalibrasyon önerilir
                  </span>
                </>
              )}
              {isMultiImage && (
                <>
                  <div className="text-gray-500">|</div>
                  <span aria-live="polite" className="text-blue-300 text-sm font-medium">
                    Foto {currentImageIndex + 1}/{imageCount} · {Math.max(0, Math.ceil((IMAGE_DURATION_MS - trackingDuration) / 1000))} s kaldı
                  </span>
                </>
              )}
              <div className="text-gray-500">|</div>
              <span className="text-gray-400 text-sm">
                Fixation: {fixations.length}
              </span>
              <span className="text-gray-500 text-xs ml-auto">Space: başlat/durdur · H: heatmap</span>
            </div>
            {isMultiImage && isTracking && (
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${Math.min(100, (trackingDuration / IMAGE_DURATION_MS) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* Ham ekran noktası (viewport): modelin tahmin ettiği yer — takip yanlışsa önce bunu kontrol et */}
          {showRawScreenGaze && rawScreenGaze && isTracking && (
            <div
              className="fixed inset-0 pointer-events-none z-[100]"
              aria-hidden
            >
              <div
                className="absolute w-6 h-6 rounded-full border-2 border-red-500 bg-red-500/50"
                style={{
                  left: rawScreenGaze.x,
                  top: rawScreenGaze.y,
                  transform: "translate(-50%, -50%)",
                }}
              />
              <div
                className="absolute text-red-400 text-xs whitespace-nowrap bg-black/70 px-1 rounded"
                style={{
                  left: rawScreenGaze.x + 16,
                  top: rawScreenGaze.y,
                  transform: "translateY(-50%)",
                }}
              >
                ekran: {Math.round(rawScreenGaze.x)}, {Math.round(rawScreenGaze.y)}
              </div>
            </div>
          )}

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
                  <p className="text-lg font-medium">{t.photoComplete.replace("{n}", String(currentImageIndex + 1)).replace("{total}", String(imageCount))}</p>
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

          {/* Kontrol butonları */}
          <div className="flex gap-3">
            {!isTracking ? (
              <button
                onClick={startTracking}
                className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-500 transition shadow-lg flex items-center gap-2 focus:ring-2 focus:ring-green-400 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
                aria-label="Takibi başlat (Space)"
              >
                <span>▶</span> Takibi Başlat
              </button>
            ) : (
              <button
                onClick={stopTracking}
                className="px-6 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-500 transition shadow-lg flex items-center gap-2 focus:ring-2 focus:ring-red-400 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
                aria-label="Takibi durdur (Space)"
              >
                <span>⏹</span> Takibi Durdur
              </button>
            )}

            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              aria-label="Heatmap aç/kapa (H)"
              className={`px-4 py-3 rounded-xl transition focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none ${
                showHeatmap
                  ? "bg-orange-600 text-white focus:ring-orange-400"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600 focus:ring-gray-500"
              }`}
            >
              🔥 Heatmap
            </button>

            <button
              onClick={() => setShowRawScreenGaze((v) => !v)}
              className={`px-4 py-3 rounded-xl transition focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none ${
                showRawScreenGaze ? "bg-amber-600 text-white focus:ring-amber-400" : "bg-gray-700 text-gray-300 hover:bg-gray-600 focus:ring-gray-500"
              }`}
              title="Modelin ekranda tahmin ettiği ham noktayı göster"
            >
              📍 Ham nokta
            </button>
            <button
              onClick={() => setFlipGazeX((v) => !v)}
              className={`px-3 py-3 rounded-xl text-sm transition focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none ${
                flipGazeX ? "bg-amber-600 text-white focus:ring-amber-400" : "bg-gray-700 text-gray-300 hover:bg-gray-600 focus:ring-gray-500"
              }`}
              title="Tahmin X eksenini ters çevir (nokta yanlış yatayda ise dene)"
            >
              X ters
            </button>
            <button
              onClick={() => setFlipGazeY((v) => !v)}
              className={`px-3 py-3 rounded-xl text-sm transition focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none ${
                flipGazeY ? "bg-amber-600 text-white focus:ring-amber-400" : "bg-gray-700 text-gray-300 hover:bg-gray-600 focus:ring-gray-500"
              }`}
              title="Tahmin Y eksenini ters çevir (nokta yanlış dikeyde ise dene)"
            >
              Y ters
            </button>
            <button
              onClick={handleLookHereOffset}
              className="px-4 py-3 bg-emerald-700 text-white rounded-xl hover:bg-emerald-600 transition focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
              title={t.lookHereThenClick}
            >
              👁️ Burada bakıyorum
            </button>
            <button
              onClick={() => {
                setUserOffset(null);
                lookHereOffsetsRef.current = [];
              }}
              className="px-3 py-3 bg-gray-700 text-gray-300 rounded-xl hover:bg-gray-600 transition text-sm focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
              title="Ortala düzeltmesini kaldır"
            >
              Offset sıfırla
            </button>
            <button
              onClick={handleDriftCorrection}
              className="px-4 py-3 bg-gray-700 text-gray-300 rounded-xl hover:bg-gray-600 transition focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
              title="Drift düzeltme"
            >
              🎯 Drift Düzelt
            </button>

            {onReset && (
              <button
                onClick={onReset}
                className="px-4 py-3 bg-gray-700 text-gray-300 rounded-xl hover:bg-gray-600 transition focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
              >
                🔄 Yeni Görüntü
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
        <div className="fixed bottom-4 right-4 w-40 h-30 rounded-lg overflow-hidden border-2 border-gray-600 shadow-lg bg-black z-40">
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
