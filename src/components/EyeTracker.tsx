"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { GazeModel, GazePoint, EyeFeatures } from "@/lib/gazeModel";
import { FaceTracker } from "@/lib/faceTracker";
import { FixationDetector, Fixation, FixationMetrics } from "@/lib/fixation";
import { HeatmapGenerator } from "@/lib/heatmap";
import Calibration from "./Calibration";
import HeatmapCanvas from "./HeatmapCanvas";
import ResultsPanel from "./ResultsPanel";

interface EyeTrackerProps {
  imageUrl: string;
  onReset: () => void;
}

type AppPhase = "loading" | "camera_init" | "calibration" | "tracking" | "results";

export default function EyeTracker({ imageUrl, onReset }: EyeTrackerProps) {
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [gazePoint, setGazePoint] = useState<GazePoint | null>(null);
  const [fixations, setFixations] = useState<Fixation[]>([]);
  const [metrics, setMetrics] = useState<FixationMetrics | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [trackingDuration, setTrackingDuration] = useState(0);
  const [calibrationError, setCalibrationError] = useState<number>(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const modelRef = useRef<GazeModel>(new GazeModel(0.01, 0.3));
  const faceTrackerRef = useRef<FaceTracker>(new FaceTracker());
  const fixationDetectorRef = useRef<FixationDetector>(new FixationDetector());
  const heatmapRef = useRef<HeatmapGenerator>(new HeatmapGenerator());
  const trackingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gazePointsRef = useRef<GazePoint[]>([]);

  // Görüntüyü yükle
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageLoaded(true);
      // Container boyutuna göre ölçekle
      const maxW = Math.min(window.innerWidth * 0.7, 900);
      const maxH = Math.min(window.innerHeight * 0.7, 700);
      const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      setImageDimensions({
        width: Math.round(img.naturalWidth * scale),
        height: Math.round(img.naturalHeight * scale),
      });
    };
    img.src = imageUrl;
    if (imageRef.current) {
      imageRef.current = img;
    }
  }, [imageUrl]);

  // Kamerayı başlat
  useEffect(() => {
    if (!imageLoaded) return;

    const initCamera = async () => {
      setPhase("camera_init");

      if (!videoRef.current) return;

      try {
        const success = await faceTrackerRef.current.initialize(videoRef.current);
        if (success) {
          // Face tracking başlat (kalibrasyon için)
          faceTrackerRef.current.startTracking(() => {
            // Kalibrasyon sırasında features otomatik güncellenir
          });
          setPhase("calibration");
        } else {
          setError("Kamera başlatılamadı. Lütfen kamera izinlerini kontrol edin.");
        }
      } catch (err) {
        setError("Kamera erişim hatası: " + (err as Error).message);
      }
    };

    initCamera();

    return () => {
      faceTrackerRef.current.destroy();
    };
  }, [imageLoaded]);

  // Kalibrasyon tamamlandı
  const handleCalibrationComplete = useCallback((meanError: number) => {
    setCalibrationError(meanError);
    setPhase("tracking");
  }, []);

  // Tracking başlat
  const startTracking = useCallback(() => {
    setIsTracking(true);
    setTrackingDuration(0);
    setFixations([]);
    gazePointsRef.current = [];

    fixationDetectorRef.current = new FixationDetector();
    fixationDetectorRef.current.startTracking();

    // Süre sayacı
    trackingTimerRef.current = setInterval(() => {
      setTrackingDuration((prev) => prev + 100);
    }, 100);

    // Gaze tracking döngüsü
    faceTrackerRef.current.stopTracking();
    faceTrackerRef.current.startTracking((features: EyeFeatures) => {
      if (!modelRef.current.isTrained()) return;

      // Blink filtresi
      if (features.confidence < 0.3 || features.eyeOpenness < 0.1) return;

      const point = modelRef.current.predict(features);
      if (!point) return;

      // Koordinatları görüntü sınırları içinde tut
      point.x = Math.max(0, Math.min(imageDimensions.width, point.x));
      point.y = Math.max(0, Math.min(imageDimensions.height, point.y));

      setGazePoint(point);
      gazePointsRef.current.push(point);

      // Fixation tespiti
      const fixation = fixationDetectorRef.current.addGazePoint(point);
      if (fixation) {
        setFixations((prev) => [...prev, fixation]);
      }

      // FPS güncelle
      setFps(faceTrackerRef.current.getFPS());
    });
  }, [imageDimensions]);

  // Tracking durdur
  const stopTracking = useCallback(() => {
    setIsTracking(false);

    if (trackingTimerRef.current) {
      clearInterval(trackingTimerRef.current);
    }

    fixationDetectorRef.current.stopTracking();
    faceTrackerRef.current.stopTracking();

    const results = fixationDetectorRef.current.getMetrics();
    setMetrics(results);
    setPhase("results");
  }, []);

  // Drift düzeltme
  const handleDriftCorrection = useCallback(() => {
    modelRef.current.resetSmoothing();
  }, []);

  // Canvas çizimi
  useEffect(() => {
    if (phase !== "tracking" || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;

    const draw = () => {
      if (phase !== "tracking") return;

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

        // Süre etiketi
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText(`${Math.round(fix.duration)}ms`, fix.x, fix.y - radius - 4);
      }

      requestAnimationFrame(draw);
    };

    draw();
  }, [phase, gazePoint, fixations, isTracking, imageDimensions]);

  // Sonuçları dışa aktar
  const exportResults = useCallback(() => {
    if (!metrics) return;

    const exportData = {
      calibration: {
        method: "poly2_ridge",
        mean_error_px: Math.round(calibrationError),
        validated: true,
      },
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
  }, [metrics, calibrationError]);

  // Heatmap dışa aktar
  const exportHeatmap = useCallback(() => {
    if (!imageRef.current) return;

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
  }, [imageDimensions]);

  // Formatla
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
        width={640}
        height={480}
        playsInline
        muted
      />

      {/* Hata mesajı */}
      {error && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-900/90 border border-red-500 rounded-lg px-6 py-3 text-red-200 z-50">
          ⚠️ {error}
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
          <p className="text-gray-400">Kamera başlatılıyor...</p>
          <p className="text-gray-600 text-sm mt-2">
            Lütfen kamera erişim iznini onaylayın
          </p>
        </div>
      )}

      {/* Kalibrasyon */}
      {phase === "calibration" && (
        <Calibration
          model={modelRef.current}
          faceTracker={faceTrackerRef.current}
          containerWidth={imageDimensions.width}
          containerHeight={imageDimensions.height}
          onComplete={handleCalibrationComplete}
          onCancel={onReset}
        />
      )}

      {/* Tracking */}
      {phase === "tracking" && (
        <div className="flex flex-col items-center gap-4">
          {/* Üst bilgi barı */}
          <div className="flex items-center gap-4 bg-gray-900 rounded-xl px-6 py-3 shadow-lg">
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
            <span className="text-gray-400 text-sm">
              Süre: {formatTime(trackingDuration)}
            </span>
            <div className="text-gray-500">|</div>
            <span className="text-gray-400 text-sm">
              Fixation: {fixations.length}
            </span>
          </div>

          {/* Görüntü + Overlay */}
          <div
            ref={containerRef}
            className="relative border-2 border-gray-700 rounded-lg overflow-hidden shadow-2xl"
            style={{
              width: imageDimensions.width,
              height: imageDimensions.height,
            }}
          >
            {/* Base image */}
            <img
              ref={imageRef as any}
              src={imageUrl}
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
                className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition shadow-lg flex items-center gap-2"
              >
                <span>▶</span> Takibi Başlat
              </button>
            ) : (
              <button
                onClick={stopTracking}
                className="px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-500 transition shadow-lg flex items-center gap-2"
              >
                <span>⏹</span> Takibi Durdur
              </button>
            )}

            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`px-4 py-3 rounded-lg transition ${
                showHeatmap
                  ? "bg-orange-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              🔥 Heatmap
            </button>

            <button
              onClick={handleDriftCorrection}
              className="px-4 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
              title="Drift düzeltme"
            >
              🎯 Drift Düzelt
            </button>

            <button
              onClick={onReset}
              className="px-4 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
            >
              🔄 Yeni Görüntü
            </button>
          </div>
        </div>
      )}

      {/* Sonuçlar */}
      {phase === "results" && metrics && (
        <ResultsPanel
          metrics={metrics}
          gazePoints={gazePointsRef.current}
          calibrationError={calibrationError}
          imageUrl={imageUrl}
          imageDimensions={imageDimensions}
          onExportJSON={exportResults}
          onExportHeatmap={exportHeatmap}
          onReset={onReset}
          onRecalibrate={() => setPhase("calibration")}
        />
      )}

      {/* Kamera önizleme (küçük) */}
      {(phase === "tracking" || phase === "calibration") && (
        <div className="fixed bottom-4 right-4 w-40 h-30 rounded-lg overflow-hidden border-2 border-gray-600 shadow-lg bg-black z-40">
          <video
            ref={(el) => {
              if (el && videoRef.current) {
                el.srcObject = videoRef.current.srcObject;
                el.play().catch(() => {});
              }
            }}
            className="w-full h-full object-cover transform scale-x-[-1]"
            playsInline
            muted
          />
          <div className="absolute top-1 left-1 bg-black/60 rounded px-1 text-xs text-green-400">
            CAM
          </div>
        </div>
      )}
    </div>
  );
}
