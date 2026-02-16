"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  CalibrationManager,
  CalibrationState,
  CalibrationPoint,
  checkStability,
} from "@/lib/calibration";
import { EyeFeatures, GazeModel } from "@/lib/gazeModel";
import { FaceTracker } from "@/lib/faceTracker";

interface CalibrationProps {
  model: GazeModel;
  faceTracker: FaceTracker;
  containerWidth: number;
  containerHeight: number;
  onComplete: (meanError: number) => void;
  onCancel: () => void;
}

export default function Calibration({
  model,
  faceTracker,
  containerWidth,
  containerHeight,
  onComplete,
  onCancel,
}: CalibrationProps) {
  const [state, setState] = useState<CalibrationState | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [sampleProgress, setSampleProgress] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<CalibrationPoint | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<number[]>([]);

  const managerRef = useRef<CalibrationManager | null>(null);
  const samplingRef = useRef(false);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevFeaturesRef = useRef<EyeFeatures | null>(null);
  const animFrameRef = useRef<number>(0);

  // Manager oluştur
  useEffect(() => {
    const manager = new CalibrationManager(model);
    manager.setStateChangeCallback((newState) => {
      setState({ ...newState });
    });
    managerRef.current = manager;

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [model]);

  // Kalibrasyonu başlat
  const startCalibration = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    manager.startCalibration(containerWidth, containerHeight);
  }, [containerWidth, containerHeight]);

  // Talimat ekranından geç
  const beginCalibration = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    manager.beginCalibrationPhase();
    startPointCollection();
  }, []);

  // Nokta veri toplama başlat
  const startPointCollection = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const point = manager.getCurrentPoint();
    if (!point) return;
    setCurrentPoint(point);
    setSampleProgress(0);
    samplingRef.current = false;

    // Geri sayım başlat
    let count = 3;
    setCountdown(count);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(() => {
      count--;
      setCountdown(count);

      if (count <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        // Veri toplama başla
        samplingRef.current = true;
        startSampling();
      }
    }, 1000);
  }, []);

  // Veri toplama döngüsü
  const startSampling = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const sampleLoop = () => {
      if (!samplingRef.current || !manager) return;

      const features = faceTracker.getLastFeatures();
      if (!features) {
        animFrameRef.current = requestAnimationFrame(sampleLoop);
        return;
      }

      // Stabilite kontrolü
      const stability = checkStability(features, prevFeaturesRef.current);
      prevFeaturesRef.current = features;

      if (!stability.faceVisible || !stability.eyesOpen) {
        setWarning(stability.message);
        animFrameRef.current = requestAnimationFrame(sampleLoop);
        return;
      }

      if (!stability.headStable) {
        setWarning(stability.message);
        animFrameRef.current = requestAnimationFrame(sampleLoop);
        return;
      }

      setWarning(null);

      // Örnek ekle
      const isComplete = manager.addSample(features);
      const managerState = manager.getState();
      setSampleProgress(managerState.progress);

      if (isComplete) {
        // Bu nokta tamamlandı
        samplingRef.current = false;

        // Sonraki noktaya geç
        const hasMore = manager.nextPoint();
        if (hasMore) {
          startPointCollection();
        } else {
          // Kalibrasyon bitti - doğrulama aşamasına geçildi
          startValidation();
        }
        return;
      }

      animFrameRef.current = requestAnimationFrame(sampleLoop);
    };

    animFrameRef.current = requestAnimationFrame(sampleLoop);
  }, [faceTracker]);

  // Doğrulama başlat
  const startValidation = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    setValidationErrors([]);
    startValidationPoint();
  }, []);

  // Doğrulama noktası toplama
  const startValidationPoint = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const point = manager.getCurrentValidationPoint();
    if (!point) return;
    setCurrentPoint(point);
    setSampleProgress(0);

    let count = 3;
    setCountdown(count);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(() => {
      count--;
      setCountdown(count);

      if (count <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        collectValidationSamples();
      }
    }, 1000);
  }, []);

  // Doğrulama örnekleri topla
  const collectValidationSamples = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    const errors: number[] = [];
    let sampleCount = 0;
    const targetSamples = 30;

    const validationLoop = () => {
      if (sampleCount >= targetSamples) {
        // Bu noktanın ortalama hatasını kaydet
        const avgError = errors.reduce((s, e) => s + e, 0) / errors.length;
        setValidationErrors((prev) => [...prev, avgError]);

        // Sonraki doğrulama noktası
        const hasMore = manager.nextValidationPoint();
        if (hasMore) {
          startValidationPoint();
        } else {
          // Tüm doğrulama tamamlandı
          const allErrors = [...validationErrors, avgError];
          const meanError =
            allErrors.reduce((s, e) => s + e, 0) / allErrors.length;
          manager.completeValidation(meanError);
        }
        return;
      }

      const features = faceTracker.getLastFeatures();
      if (features && features.confidence > 0.3) {
        const result = manager.addValidationSample(features);
        if (result) {
          errors.push(result.error);
          sampleCount++;
          setSampleProgress((sampleCount / targetSamples) * 100);
        }
      }

      animFrameRef.current = requestAnimationFrame(validationLoop);
    };

    animFrameRef.current = requestAnimationFrame(validationLoop);
  }, [faceTracker, validationErrors]);

  // Tamamla veya tekrar et
  const handleComplete = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    const meanError = manager.getState().meanError || 0;
    onComplete(meanError);
  }, [onComplete]);

  const handleRetry = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    manager.reset();
    setValidationErrors([]);
    setWarning(null);
    startCalibration();
  }, [startCalibration]);

  // İlk yükleme
  useEffect(() => {
    startCalibration();
  }, [startCalibration]);

  // RENDER
  if (!state) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center">
      {/* Talimat ekranı */}
      {state.phase === "instructions" && (
        <div className="bg-gray-900 rounded-2xl p-8 max-w-lg mx-auto text-center shadow-2xl border border-gray-700">
          <div className="text-5xl mb-6">👁️</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Kalibrasyon Başlıyor
          </h2>
          <div className="text-gray-300 space-y-3 mb-8 text-left">
            <p className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">●</span>
              Başını mümkün olduğunca sabit tut.
            </p>
            <p className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">●</span>
              Ekranda beliren noktaya sadece gözlerinle bak.
            </p>
            <p className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">●</span>
              Her nokta için 1 saniye boyunca bakmanı isteyeceğiz.
            </p>
            <p className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">●</span>
              Gözünü noktadan ayırırsan kalibrasyon uzayabilir.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
            >
              İptal
            </button>
            <button
              onClick={beginCalibration}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition shadow-lg"
            >
              Başla
            </button>
          </div>
        </div>
      )}

      {/* Kalibrasyon / Doğrulama noktası gösterimi */}
      {(state.phase === "calibrating" || state.phase === "validating") && currentPoint && (
        <div className="absolute inset-0">
          {/* Kalibrasyon noktası */}
          <div
            className="absolute transform -translate-x-1/2 -translate-y-1/2 z-50"
            style={{
              left: currentPoint.x,
              top: currentPoint.y,
            }}
          >
            {/* Dış halka */}
            <div
              className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-all duration-300 ${
                countdown > 0
                  ? "border-yellow-400 scale-110"
                  : "border-green-400 scale-100"
              }`}
            >
              {/* İç nokta */}
              <div
                className={`w-4 h-4 rounded-full transition-all duration-300 ${
                  countdown > 0 ? "bg-yellow-400" : "bg-green-400"
                }`}
              />
            </div>

            {/* Geri sayım */}
            {countdown > 0 && (
              <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 text-3xl font-bold text-yellow-400">
                {countdown}
              </div>
            )}
          </div>

          {/* Bilgi paneli */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-gray-900/90 rounded-xl px-8 py-4 text-center max-w-md backdrop-blur">
            <p className="text-white text-lg font-semibold mb-1">
              {state.phase === "validating"
                ? "Doğrulama - Bu noktaya bak 👁️"
                : "Şimdi bu noktaya bak 👁️"}
            </p>
            <p className="text-gray-400 text-sm mb-3">
              Başını sabit tut. Sadece gözlerin hareket etsin.
            </p>

            {/* Progress bar */}
            {countdown <= 0 && (
              <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-100"
                  style={{ width: `${sampleProgress}%` }}
                />
              </div>
            )}

            {/* Nokta ilerleme */}
            <p className="text-gray-500 text-xs">
              {state.phase === "calibrating"
                ? `Nokta ${state.currentPointIndex + 1} / ${state.totalPoints}`
                : `Doğrulama ${state.currentPointIndex + 1} / 5`}
            </p>

            {/* Uyarı */}
            {warning && (
              <div className="mt-3 bg-red-900/50 border border-red-500 rounded-lg px-4 py-2 text-red-300 text-sm">
                ⚠️ {warning}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Kalibrasyon tamamlandı */}
      {state.phase === "complete" && (
        <div className="bg-gray-900 rounded-2xl p-8 max-w-lg mx-auto text-center shadow-2xl border border-gray-700">
          <div className="text-5xl mb-6">✅</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Kalibrasyon Tamamlandı
          </h2>
          <div className="bg-gray-800 rounded-xl p-4 mb-6">
            <p className="text-gray-400 text-sm">Ortalama Hata</p>
            <p
              className={`text-3xl font-bold ${
                (state.meanError || 0) <= 60
                  ? "text-green-400"
                  : (state.meanError || 0) <= 80
                  ? "text-yellow-400"
                  : "text-red-400"
              }`}
            >
              {Math.round(state.meanError || 0)} px
            </p>
          </div>

          {(state.meanError || 0) > 80 && (
            <p className="text-yellow-400 text-sm mb-4">
              ⚠️ Doğruluk düşük. Tekrar kalibrasyon önerilir.
            </p>
          )}

          <div className="flex gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
            >
              Tekrar Kalibre Et
            </button>
            <button
              onClick={handleComplete}
              className="px-8 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition shadow-lg"
            >
              Devam Et
            </button>
          </div>
        </div>
      )}

      {/* Kalibrasyon başarısız */}
      {state.phase === "failed" && (
        <div className="bg-gray-900 rounded-2xl p-8 max-w-lg mx-auto text-center shadow-2xl border border-red-700">
          <div className="text-5xl mb-6">❌</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Kalibrasyon Başarısız
          </h2>
          <p className="text-gray-400 mb-6">{state.subMessage}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
            >
              İptal
            </button>
            <button
              onClick={handleRetry}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition shadow-lg"
            >
              Tekrar Dene
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
