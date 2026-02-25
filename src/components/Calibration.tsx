"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  CalibrationManager,
  CalibrationState,
  CalibrationPoint,
  checkStability,
} from "@/lib/calibration";
import { saveCalibration, loadCalibration } from "@/lib/calibrationStorage";
import { EyeFeatures, GazeModel } from "@/lib/gazeModel";
import { FaceTracker } from "@/lib/faceTracker";
import { logger } from "@/lib/logger";
import { useLang } from "@/contexts/LangContext";

interface CalibrationProps {
  model: GazeModel;
  faceTracker: FaceTracker;
  onComplete: (meanError: number, samples?: any[]) => void;
  onCancel?: () => void;
}

export default function Calibration({
  model,
  faceTracker,
  onComplete,
  onCancel,
}: CalibrationProps) {
  const [state, setState] = useState<CalibrationState | null>(null);
  const [countdown, setCountdown] = useState(2);
  const [sampleProgress, setSampleProgress] = useState(0);
  const [currentPoint, setCurrentPoint] = useState<CalibrationPoint | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const managerRef = useRef<CalibrationManager | null>(null);
  const samplingRef = useRef(false);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevFeaturesRef = useRef<EyeFeatures | null>(null);
  const animFrameRef = useRef<number>(0);
  const validationErrorsRef = useRef<number[]>([]);
  const validationBiasesRef = useRef<{ biasX: number; biasY: number; relX: number; relY: number }[]>([]);
  const affinePointsRef = useRef<{ predX: number; predY: number; trueX: number; trueY: number }[]>([]);
  const validationPointRef = useRef<{ relX: number; relY: number } | null>(null);
  const phaseRef = useRef<string>("idle");
  const [storedInfo, setStoredInfo] = useState<ReturnType<typeof loadCalibration>>(null);
  const { t } = useLang();

  // Cleanup: unmount olduğunda tüm zamanlayıcı ve frame'leri temizle
  useEffect(() => {
    return () => {
      samplingRef.current = false;
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    };
  }, []);

  const startCalibrationSamplingRef = useRef<(manager: CalibrationManager) => void>(() => {});
  const startValidationSamplingRef = useRef<(manager: CalibrationManager) => void>(() => {});

  // Veri toplama başlat (bir kalibrasyon noktası için)
  const startPointCollection = useCallback((manager: CalibrationManager, isValidation: boolean) => {
    const point = isValidation
      ? manager.getCurrentValidationPoint()
      : manager.getCurrentPoint();
    if (!point) {
      logger.warn("[Calibration] Nokta bulunamadı");
      return;
    }

    setCurrentPoint(point);
    setSampleProgress(0);
    samplingRef.current = false;

    let count = 0;  // Geri sayım yok - anında başla
    setCountdown(count);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(() => {
      count--;
      setCountdown(count);

      if (count <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        samplingRef.current = true;

        if (isValidation) {
          startValidationSamplingRef.current(manager);
        } else {
          startCalibrationSamplingRef.current(manager);
        }
      }
    }, 1000);
  }, []);

  const startCalibrationSampling = useCallback((manager: CalibrationManager) => {
    const pointStartTime = Date.now();
    const POINT_TIMEOUT_MS = 8000;  // 12s → 8s

    const advanceToNext = () => {
      samplingRef.current = false;
      const hasMore = manager.nextPoint();
      if (hasMore) {
        startPointCollection(manager, false);
      } else {
        logger.log("[Calibration] Kalibrasyon tamamlandı, doğrulama başlıyor");
        phaseRef.current = "validating";
        validationErrorsRef.current = [];
        validationBiasesRef.current = [];
        affinePointsRef.current = [];
        startPointCollection(manager, true);
      }
    };

    const sampleLoop = () => {
      if (!samplingRef.current) return;

      // Nokta başına zaman aşımı — takılmayı önle
      if (Date.now() - pointStartTime > POINT_TIMEOUT_MS) {
        logger.warn("[Calibration] Nokta zaman aşımı, sonrakine geçiliyor");
        advanceToNext();
        return;
      }

      const features = faceTracker.getLastFeatures();
      if (!features) {
        animFrameRef.current = requestAnimationFrame(sampleLoop);
        return;
      }

      const stability = checkStability(features, prevFeaturesRef.current);
      prevFeaturesRef.current = features;

      if (!stability.faceVisible || !stability.eyesOpen || !stability.headStable) {
        setWarning(stability.message);
        animFrameRef.current = requestAnimationFrame(sampleLoop);
        return;
      }

      setWarning(null);

      const isComplete = manager.addSample(features);
      const managerState = manager.getState();
      setSampleProgress(managerState.progress);

      if (isComplete) {
        advanceToNext();
        return;
      }

      animFrameRef.current = requestAnimationFrame(sampleLoop);
    };

    animFrameRef.current = requestAnimationFrame(sampleLoop);
  }, [faceTracker, startPointCollection]);

  startCalibrationSamplingRef.current = startCalibrationSampling;

  const startValidationSampling = useCallback((manager: CalibrationManager) => {
    const errors: number[] = [];
    const predSums: { predX: number; predY: number; count: number } = { predX: 0, predY: 0, count: 0 };
    let sampleCount = 0;
    const targetSamples = 40;
    let settleCount = 0;
    const fps = faceTracker.getFPS() || 30;
    const settleFrames = Math.round(fps * 1.5);
    const validationStartTime = Date.now();
    const VALIDATION_TIMEOUT_MS = 12000;

    const finishValidationPoint = () => {
      const avgError = errors.length > 0
        ? errors.reduce((s, e) => s + e, 0) / errors.length
        : 999;
      validationErrorsRef.current.push(avgError);

      // Afin düzeltme için her doğrulama noktasının ortalama tahmini ve gerçek pozisyonu
      const valPt = manager.getCurrentValidationPoint();
      if (valPt && predSums.count > 0) {
        affinePointsRef.current.push({
          predX: predSums.predX / predSums.count,
          predY: predSums.predY / predSums.count,
          trueX: valPt.x,
          trueY: valPt.y,
        });
      }

      const hasMore = manager.nextValidationPoint();
      if (hasMore) {
        validationPointRef.current = manager.getCurrentValidationPoint()
          ? { relX: manager.getCurrentValidationPoint()!.relX, relY: manager.getCurrentValidationPoint()!.relY }
          : null;
        startPointCollection(manager, true);
      } else {
        const allErrors = validationErrorsRef.current;
        const meanError = allErrors.length > 0
          ? allErrors.reduce((s, e) => s + e, 0) / allErrors.length
          : 999;

        logger.log("[Calibration] Doğrulama tamamlandı, ortalama hata:", Math.round(meanError), "px,", affinePointsRef.current.length, "afin nokta");
        manager.completeValidation(meanError, undefined, undefined, affinePointsRef.current);
      }
    };

    const validationLoop = () => {
      if (settleCount < settleFrames) {
        settleCount++;
        animFrameRef.current = requestAnimationFrame(validationLoop);
        return;
      }

      if (Date.now() - validationStartTime > VALIDATION_TIMEOUT_MS) {
        finishValidationPoint();
        return;
      }

      if (sampleCount >= targetSamples) {
        finishValidationPoint();
        return;
      }

      const features = faceTracker.getLastFeatures();
      if (features && features.confidence > 0.35) {
        const result = manager.addValidationSample(features);
        if (result) {
          errors.push(result.error);
          const pt = validationPointRef.current ?? { relX: 0.5, relY: 0.5 };
          validationBiasesRef.current.push({
            biasX: result.biasX,
            biasY: result.biasY,
            relX: pt.relX,
            relY: pt.relY,
          });
          // Afin hesabı için tahmin koordinatlarını biriktir
          const valPoint = manager.getCurrentValidationPoint();
          if (valPoint) {
            predSums.predX += valPoint.x - result.biasX;
            predSums.predY += valPoint.y - result.biasY;
            predSums.count++;
          }
          sampleCount++;
          setSampleProgress((sampleCount / targetSamples) * 100);
        }
      }

      animFrameRef.current = requestAnimationFrame(validationLoop);
    };

    validationPointRef.current = manager.getCurrentValidationPoint()
      ? { relX: manager.getCurrentValidationPoint()!.relX, relY: manager.getCurrentValidationPoint()!.relY }
      : null;
    animFrameRef.current = requestAnimationFrame(validationLoop);
  }, [faceTracker, startPointCollection]);

  startValidationSamplingRef.current = startValidationSampling;

  // Manager oluştur ve kalibrasyonu başlat
  useEffect(() => {
    const manager = new CalibrationManager(model);
    // FPS bilgisini kamera FPS'inden al
    const cameraFPS = faceTracker.getFPS();
    if (cameraFPS > 0) {
      manager.setFPS(cameraFPS);
    }
    manager.setStateChangeCallback((newState) => {
      setState({ ...newState });
      phaseRef.current = newState.phase;
    });
    managerRef.current = manager;
    setStoredInfo(loadCalibration());

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    manager.startCalibration(screenW, screenH);
  }, [model, faceTracker]);

  // Talimat ekranından kalibrasyon başlat
  const beginCalibration = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    logger.log("[Calibration] Kalibrasyon faz başlatılıyor");
    manager.beginCalibrationPhase();
    phaseRef.current = "calibrating";
    startPointCollection(manager, false);
  }, [startPointCollection]);

  const handleComplete = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    const state = manager.getState();
    const meanError = state.meanError || 0;
    
    // Kalibrasyon sample'larını gönder (ensemble için)
    const samples = state.samples || [];
    onComplete(meanError, samples);
  }, [onComplete]);

  const handleLoadStored = useCallback(() => {
    const stored = loadCalibration();
    if (!stored) return;
    try {
      model.importModel(stored.modelJson);
      onComplete(stored.meanErrorPx, []);
    } catch {
      setStoredInfo(null);
    }
  }, [model, onComplete]);

  const handleSaveCalibration = useCallback(() => {
    try {
      const json = model.exportModel();
      const meanError = state?.meanError ?? 0;
      saveCalibration(json, meanError);
      setStoredInfo(loadCalibration());
    } catch {
      // ignore
    }
  }, [model, state?.meanError]);

  // Tekrar et
  const handleRetry = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    manager.reset();
    validationErrorsRef.current = [];
    setWarning(null);
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    manager.startCalibration(screenW, screenH);
  }, []);

  // RENDER
  if (!state) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex items-center justify-center">
      {/* Talimat ekranı — temiz, profesyonel */}
      {state.phase === "instructions" && (
        <div className="bg-gray-900 rounded-2xl p-8 max-w-md mx-auto text-center shadow-2xl border border-gray-700">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-blue-500/10 border-2 border-blue-500/30 flex items-center justify-center">
            <span className="text-4xl">👁️</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            Kalibrasyon
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            Yaklaşık 30 saniye sürer. Ekrana bakmanız yeterli.
          </p>

          <div className="text-gray-300 space-y-2 mb-8 text-left text-sm">
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-4 py-2.5">
              <span className="text-blue-400 text-lg">1</span>
              <span>Başını sabit tut</span>
            </div>
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-4 py-2.5">
              <span className="text-blue-400 text-lg">2</span>
              <span>Beliren noktaya sadece gözlerinle bak</span>
            </div>
            <div className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-4 py-2.5">
              <span className="text-blue-400 text-lg">3</span>
              <span>Nokta kaybolana kadar bekle</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={beginCalibration}
              className="w-full px-8 py-3.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition shadow-lg text-base"
            >
              Kalibrasyonu Başlat
            </button>
            {storedInfo && (
              <button
                onClick={handleLoadStored}
                className="w-full px-6 py-2.5 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 transition text-sm"
              >
                Kayıtlı kalibrasyonu kullan (~{Math.round(storedInfo.meanErrorPx)} px)
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="text-gray-500 hover:text-gray-400 text-sm mt-1 transition"
              >
                Geri Dön
              </button>
            )}
          </div>
        </div>
      )}

      {/* Kalibrasyon / Doğrulama noktası gösterimi */}
      {(state.phase === "calibrating" || state.phase === "validating") && currentPoint && (
        <div className="fixed inset-0">
          {/* Kalibrasyon noktası */}
          <div
            className="absolute transform -translate-x-1/2 -translate-y-1/2 z-50"
            style={{
              left: currentPoint.x,
              top: currentPoint.y,
            }}
          >
            {/* Shrink animasyonu: büyükten küçüğe daralır → göz tam merkeze odaklanır */}
            {/* Geri sayım sırasında: büyük halka, veri toplama sırasında: küçük nokta */}
            <div
              className="rounded-full border-4 flex items-center justify-center"
              style={{
                // Geri sayımda büyük (64px), veri toplamada küçük (24px) → göz tam hedefe
                width: countdown > 0 ? 64 : 24,
                height: countdown > 0 ? 64 : 24,
                borderColor: countdown > 0 ? '#facc15' : '#4ade80',
                transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              {/* İç nokta - her zaman küçük ve net */}
              <div
                className="rounded-full"
                style={{
                  width: countdown > 0 ? 12 : 8,
                  height: countdown > 0 ? 12 : 8,
                  backgroundColor: countdown > 0 ? '#facc15' : '#4ade80',
                  transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </div>

            {/* Pulsing halo efekti - dikkat çekici */}
            {countdown > 0 && (
              <div
                className="absolute inset-0 -m-4 rounded-full border-2 border-yellow-400/30 animate-ping"
                style={{ animationDuration: '1.5s' }}
              />
            )}

            {/* Geri sayım */}
            {countdown > 0 && (
              <div className="absolute -bottom-10 left-1/2 transform -translate-x-1/2 text-2xl font-bold text-yellow-400">
                {countdown}
              </div>
            )}

            {/* Veri toplama progress ring */}
            {countdown <= 0 && sampleProgress > 0 && (
              <svg
                className="absolute -inset-2"
                width="40"
                height="40"
                viewBox="0 0 40 40"
                style={{ transform: 'rotate(-90deg)' }}
              >
                <circle
                  cx="20" cy="20" r="16"
                  fill="none"
                  stroke="rgba(74, 222, 128, 0.3)"
                  strokeWidth="3"
                />
                <circle
                  cx="20" cy="20" r="16"
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth="3"
                  strokeDasharray={`${2 * Math.PI * 16}`}
                  strokeDashoffset={`${2 * Math.PI * 16 * (1 - sampleProgress / 100)}`}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.1s' }}
                />
              </svg>
            )}
          </div>

          {/* Bilgi paneli */}
          <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-gray-900/90 rounded-xl px-8 py-4 text-center max-w-md backdrop-blur z-40">
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
            
            {/* Validation atla butonu */}
            {state.phase === "validating" && (
              <button
                onClick={() => {
                  // Validation'ı atla ve direkt complete'e geç (varsayılan hata: 75px)
                  managerRef.current?.completeValidation(75);
                }}
                className="mt-3 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition"
              >
                Doğrulamayı Atla →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Kalibrasyon tamamlandı — RealEye benzeri kalite derecelendirme */}
      {state.phase === "complete" && (() => {
        const err = state.meanError || 0;
        const grade = err <= 50 ? "A" : err <= 75 ? "B" : err <= 110 ? "C" : "D";
        const gradeLabel = err <= 50 ? "Mükemmel" : err <= 75 ? "İyi" : err <= 110 ? "Kabul Edilebilir" : "Düşük";
        const gradeColor = err <= 50 ? "text-green-400" : err <= 75 ? "text-blue-400" : err <= 110 ? "text-yellow-400" : "text-red-400";
        const gradeBg = err <= 50 ? "bg-green-500/10 border-green-500/30" : err <= 75 ? "bg-blue-500/10 border-blue-500/30" : err <= 110 ? "bg-yellow-500/10 border-yellow-500/30" : "bg-red-500/10 border-red-500/30";

        return (
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md mx-auto text-center shadow-2xl border border-gray-700">
            {/* Kalite rozeti */}
            <div className={`inline-flex items-center justify-center w-24 h-24 rounded-full border-4 mb-6 ${gradeBg}`}>
              <span className={`text-5xl font-black ${gradeColor}`}>{grade}</span>
            </div>

            <h2 className="text-2xl font-bold text-white mb-1">
              {t.calibrationComplete}
            </h2>
            <p className={`text-lg font-semibold mb-4 ${gradeColor}`}>{gradeLabel}</p>

            {/* Doğruluk barı */}
            <div className="bg-gray-800 rounded-xl p-4 mb-5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-400 text-sm">Doğruluk</span>
                <span className={`text-sm font-bold ${gradeColor}`}>~{Math.round(err)} px</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${
                    err <= 50 ? "bg-green-500" : err <= 75 ? "bg-blue-500" : err <= 110 ? "bg-yellow-500" : "bg-red-500"
                  }`}
                  style={{ width: `${Math.max(5, Math.min(100, 100 - (err / 2)))}%` }}
                />
              </div>
              <p className="text-gray-500 text-xs mt-2">
                {err <= 75
                  ? "Kalibrasyon başarılı, analiz için hazır."
                  : err <= 110
                  ? "Kabul edilebilir doğruluk. Daha iyi sonuç için tekrar deneyebilirsiniz."
                  : "Düşük doğruluk. İsterseniz tekrar kalibre edebilir veya devam edebilirsiniz."}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  handleSaveCalibration();
                  handleComplete();
                }}
                className="w-full px-8 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-500 transition shadow-lg text-base"
              >
                Analize Başla
              </button>

              <button
                onClick={handleRetry}
                className="w-full px-6 py-3 rounded-xl font-semibold transition bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm"
              >
                Tekrar Kalibre Et
              </button>
            </div>
          </div>
        );
      })()}

      {/* Kalibrasyon başarısız */}
      {state.phase === "failed" && (
        <div className="bg-gray-900 rounded-2xl p-8 max-w-lg mx-auto text-center shadow-2xl border border-red-700">
          <div className="text-5xl mb-6">❌</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Kalibrasyon Başarısız
          </h2>
          <p className="text-gray-400 mb-6">{state.subMessage}</p>
          <div className="flex gap-3 justify-center">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
              >
                İptal
              </button>
            )}
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
