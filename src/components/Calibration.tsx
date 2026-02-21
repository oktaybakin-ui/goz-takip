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
  onComplete: (meanError: number) => void;
  onCancel?: () => void;
}

export default function Calibration({
  model,
  faceTracker,
  onComplete,
  onCancel,
}: CalibrationProps) {
  const [state, setState] = useState<CalibrationState | null>(null);
  const [countdown, setCountdown] = useState(3);
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

    // Geri sayım (2 saniye - daha hızlı kalibrasyon)
    let count = 2;
    setCountdown(count);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(() => {
      count--;
      setCountdown(count);

      if (count <= 0) {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        samplingRef.current = true;

        if (isValidation) {
          startValidationSampling(manager);
        } else {
          startCalibrationSampling(manager);
        }
      }
    }, 1000);
  }, [faceTracker]);

  // Kalibrasyon veri toplama döngüsü
  const startCalibrationSampling = useCallback((manager: CalibrationManager) => {
    const sampleLoop = () => {
      if (!samplingRef.current) return;

      const features = faceTracker.getLastFeatures();
      if (!features) {
        animFrameRef.current = requestAnimationFrame(sampleLoop);
        return;
      }

      // Stabilite kontrolü
      const stability = checkStability(features, prevFeaturesRef.current);
      prevFeaturesRef.current = features;

      if (!stability.faceVisible || !stability.eyesOpen || !stability.headStable) {
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
        samplingRef.current = false;

        // Sonraki noktaya geç
        const hasMore = manager.nextPoint();
        if (hasMore) {
          startPointCollection(manager, false);
        } else {
          // Kalibrasyon bitti → doğrulama başlat
          logger.log("[Calibration] Kalibrasyon tamamlandı, doğrulama başlıyor");
          phaseRef.current = "validating";
          validationErrorsRef.current = [];
          validationBiasesRef.current = [];
          startPointCollection(manager, true);
        }
        return;
      }

      animFrameRef.current = requestAnimationFrame(sampleLoop);
    };

    animFrameRef.current = requestAnimationFrame(sampleLoop);
  }, [faceTracker, startPointCollection]);

  // Doğrulama veri toplama döngüsü – hata + sapma (bias) toplanır; bias merkez ağırlıklı hesaplanır (araştırma: ekran merkezi daha güvenilir)
  const startValidationSampling = useCallback((manager: CalibrationManager) => {
    const errors: number[] = [];
    let sampleCount = 0;
    const targetSamples = 60;
    let settleCount = 0;
    const fps = faceTracker.getFPS() || 30;
    const settleFrames = Math.round(fps * 1.5);

    const validationLoop = () => {
      // Settle time: ilk N frame'i atla
      if (settleCount < settleFrames) {
        settleCount++;
        animFrameRef.current = requestAnimationFrame(validationLoop);
        return;
      }

      if (sampleCount >= targetSamples) {
        const avgError = errors.length > 0
          ? errors.reduce((s, e) => s + e, 0) / errors.length
          : 999;
        validationErrorsRef.current.push(avgError);

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
          const biasSamples = validationBiasesRef.current;
          let meanBiasX = 0;
          let meanBiasY = 0;
          if (biasSamples.length > 0) {
            let sumW = 0;
            let sumWx = 0;
            let sumWy = 0;
            for (const s of biasSamples) {
              const dist = Math.sqrt((s.relX - 0.5) ** 2 + (s.relY - 0.5) ** 2);
              const w = 1 / (1 + dist);
              sumW += w;
              sumWx += s.biasX * w;
              sumWy += s.biasY * w;
            }
            meanBiasX = sumW > 0 ? sumWx / sumW : 0;
            meanBiasY = sumW > 0 ? sumWy / sumW : 0;
          }
          logger.log("[Calibration] Doğrulama tamamlandı, ortalama hata:", Math.round(meanError), "px, merkez-ağırlıklı bias:", Math.round(meanBiasX), ",", Math.round(meanBiasY));
          manager.completeValidation(meanError, meanBiasX, meanBiasY);
        }
        return;
      }

      const features = faceTracker.getLastFeatures();
      if (features && features.confidence > 0.5) {
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
  }, [model]);

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
    const meanError = manager.getState().meanError || 0;
    onComplete(meanError);
  }, [onComplete]);

  const handleLoadStored = useCallback(() => {
    const stored = loadCalibration();
    if (!stored) return;
    try {
      model.importModel(stored.modelJson);
      onComplete(stored.meanErrorPx);
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
              Noktalar ekranın her tarafında görünecek.
            </p>
            <p className="flex items-start gap-2">
              <span className="text-blue-400 mt-1">●</span>
              Gözünü noktadan ayırırsan kalibrasyon uzayabilir.
            </p>
          </div>
          <div className="flex flex-col gap-3 items-center">
            {storedInfo && (
              <button
                onClick={handleLoadStored}
                className="w-full px-6 py-3 bg-green-700/80 text-white rounded-lg hover:bg-green-600 transition text-sm"
                aria-label="Kayıtlı kalibrasyonu kullan"
              >
                📂 Kayıtlı kalibrasyonu kullan (~{Math.round(storedInfo.meanErrorPx)} px, {new Date(storedInfo.savedAt).toLocaleDateString("tr-TR")})
              </button>
            )}
            <div className="flex gap-3 justify-center">
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
                  aria-label="İptal"
                >
                  İptal
                </button>
              )}
              <button
                onClick={beginCalibration}
                className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition shadow-lg"
                aria-label="Yeni kalibrasyon başlat"
              >
                Yeni kalibrasyon (25 nokta)
              </button>
            </div>
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
          </div>
        </div>
      )}

      {/* Kalibrasyon tamamlandı — 3 kademeli doğrulama geri bildirimi (araştırma: kullanıcıya net sonuç) */}
      {state.phase === "complete" && (
        <div className="bg-gray-900 rounded-2xl p-8 max-w-lg mx-auto text-center shadow-2xl border border-gray-700">
          <div className="text-5xl mb-6">✅</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            {t.calibrationComplete}
          </h2>
          <div className="bg-gray-800 rounded-xl p-4 mb-4">
            <p className="text-gray-400 text-sm">Ortalama Hata (doğrulama)</p>
            <p
              className={`text-3xl font-bold ${
                (state.meanError || 0) <= 50
                  ? "text-green-400"
                  : (state.meanError || 0) <= 85
                  ? "text-yellow-400"
                  : "text-red-400"
              }`}
            >
              {Math.round(state.meanError || 0)} px
            </p>
            {/* Per-point hata dağılımı */}
            {validationErrorsRef.current.length > 0 && (
              <div className="mt-3 grid grid-cols-5 gap-1">
                {["Merkez", "Sol Üst", "Sağ Üst", "Sol Alt", "Sağ Alt"].map((label, i) => {
                  const err = validationErrorsRef.current[i];
                  if (err === undefined) return null;
                  const color = err <= 50 ? "text-green-400" : err <= 85 ? "text-yellow-400" : "text-red-400";
                  return (
                    <div key={i} className="text-center">
                      <p className="text-gray-500 text-[10px]">{label}</p>
                      <p className={`text-xs font-semibold ${color}`}>{Math.round(err)}px</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p
            className={`text-sm mb-4 ${
              (state.meanError || 0) <= 50
                ? "text-green-400"
                : (state.meanError || 0) <= 75
                ? "text-yellow-400"
                : "text-red-400"
            }`}
          >
            {(state.meanError || 0) <= 50
              ? t.calibrationValidationGood
              : (state.meanError || 0) <= 75
              ? t.calibrationValidationFair
              : t.calibrationValidationPoor}
          </p>

          {(state.meanError || 0) > 75 && (
            <div className="mb-6 p-4 bg-red-900/40 border border-red-500/60 rounded-xl">
              <p className="text-red-300 text-sm font-medium">{t.calibrationQualityLow}</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleSaveCalibration}
              className="w-full px-6 py-2 bg-amber-700/80 text-white rounded-lg hover:bg-amber-600 transition text-sm"
              aria-label="Kalibrasyonu cihaza kaydet"
            >
              💾 Kalibrasyonu kaydet (sonraki sefer atla)
            </button>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              {(state.meanError || 0) > 75 ? (
                <button
                  onClick={handleRetry}
                  className="px-8 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition shadow-lg w-full sm:w-auto"
                  aria-label="Tekrar kalibre et"
                >
                  🔄 Tekrar Kalibre Et
                </button>
              ) : (
                <>
                  <button
                    onClick={handleRetry}
                    className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
                    aria-label="Tekrar kalibre et"
                  >
                    Tekrar Kalibre Et
                  </button>
                  <button
                    onClick={handleComplete}
                    className="px-8 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition shadow-lg"
                    aria-label="Devam et"
                  >
                    {t.continue}
                  </button>
                </>
              )}
            </div>
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
