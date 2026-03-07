"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { GazeModel, GazePoint, EyeFeatures } from "@/lib/gazeModel";
import { FaceTracker } from "@/lib/faceTracker";

interface GazePreviewProps {
  model: GazeModel;
  faceTracker: FaceTracker;
  onConfirm: () => void;
  onRetry: () => void;
}

const PREVIEW_TARGETS = [
  { x: 0.15, y: 0.15, label: "Sol Ust" },
  { x: 0.85, y: 0.15, label: "Sag Ust" },
  { x: 0.50, y: 0.50, label: "Merkez" },
  { x: 0.15, y: 0.85, label: "Sol Alt" },
  { x: 0.85, y: 0.85, label: "Sag Alt" },
  { x: 0.50, y: 0.25, label: "Ust Orta" },
];

/**
 * Kalibrasyon sonrasi canli gaze onizleme.
 * Kullanici 6 noktaya bakiyor, ekranda bakis noktasi canli gosteriliyor.
 * Boylece kalibrasyon kalitesini gozuyle gorebiliyor.
 */
export default function GazePreview({ model, faceTracker, onConfirm, onRetry }: GazePreviewProps) {
  const [gazePos, setGazePos] = useState<{ x: number; y: number } | null>(null);
  const [activeTarget, setActiveTarget] = useState(0);
  const [errors, setErrors] = useState<number[]>([]);
  const animRef = useRef<number>(0);
  const screenW = typeof window !== "undefined" ? window.innerWidth : 1920;
  const screenH = typeof window !== "undefined" ? window.innerHeight : 1080;

  const gazeLoop = useCallback(() => {
    const features = faceTracker.getLastFeatures();
    if (features && features.confidence > 0.15) {
      const prediction = model.predict(features);
      if (prediction) {
        setGazePos({ x: prediction.x, y: prediction.y });

        // Aktif hedefe olan hatayi hesapla
        const target = PREVIEW_TARGETS[activeTarget];
        if (target) {
          const tx = target.x * screenW;
          const ty = target.y * screenH;
          const dist = Math.sqrt((prediction.x - tx) ** 2 + (prediction.y - ty) ** 2);
          // Stabil bakis → hata kaydet (kucuk hareket)
          if (dist < screenW * 0.3) {
            setErrors(prev => {
              const newErrors = [...prev];
              if (newErrors.length <= activeTarget) {
                newErrors.push(dist);
              } else {
                // EMA ile guncelle
                newErrors[activeTarget] = newErrors[activeTarget] * 0.7 + dist * 0.3;
              }
              return newErrors;
            });
          }
        }
      }
    }
    animRef.current = requestAnimationFrame(gazeLoop);
  }, [faceTracker, model, activeTarget, screenW, screenH]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(gazeLoop);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [gazeLoop]);

  // Her 3 saniyede sonraki hedefe gec
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveTarget(prev => {
        if (prev >= PREVIEW_TARGETS.length - 1) return prev;
        return prev + 1;
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const avgError = errors.length > 0
    ? Math.round(errors.reduce((s, e) => s + e, 0) / errors.length)
    : 0;

  const allDone = activeTarget >= PREVIEW_TARGETS.length - 1 && errors.length >= PREVIEW_TARGETS.length;
  const quality = avgError <= 50 ? "Mukemmel" : avgError <= 80 ? "Iyi" : avgError <= 120 ? "Kabul Edilebilir" : "Dusuk";
  const qualityColor = avgError <= 50 ? "text-green-400" : avgError <= 80 ? "text-blue-400" : avgError <= 120 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="fixed inset-0 z-50 bg-gray-950">
      {/* Hedef noktalar */}
      {PREVIEW_TARGETS.map((target, i) => {
        const isActive = i === activeTarget;
        const isPast = i < activeTarget;
        return (
          <div
            key={i}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300"
            style={{
              left: target.x * screenW,
              top: target.y * screenH,
              opacity: isActive ? 1 : isPast ? 0.3 : 0.15,
            }}
          >
            <div
              className={`rounded-full border-2 flex items-center justify-center transition-all ${
                isActive ? "border-yellow-400 w-12 h-12" : "border-gray-600 w-6 h-6"
              }`}
            >
              <div
                className={`rounded-full ${
                  isActive ? "bg-yellow-400 w-4 h-4" : isPast ? "bg-green-500 w-3 h-3" : "bg-gray-600 w-2 h-2"
                }`}
              />
            </div>
            {isActive && (
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-yellow-400 text-xs font-semibold whitespace-nowrap">
                Buraya bak
              </div>
            )}
          </div>
        );
      })}

      {/* Canli gaze noktasi */}
      {gazePos && (
        <div
          className="absolute w-5 h-5 rounded-full bg-red-500/70 border-2 border-red-300 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all duration-75"
          style={{ left: gazePos.x, top: gazePos.y }}
        />
      )}

      {/* Bilgi paneli */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900/95 rounded-xl px-8 py-5 text-center max-w-md backdrop-blur border border-gray-700">
        <p className="text-white text-lg font-semibold mb-1">
          Kalibrasyon Onizleme
        </p>
        <p className="text-gray-400 text-sm mb-3">
          Sari noktaya bak — kirmizi nokta bakisini gosteriyor.
        </p>

        {/* Progress */}
        <div className="flex gap-1 justify-center mb-3">
          {PREVIEW_TARGETS.map((_, i) => (
            <div
              key={i}
              className={`w-8 h-1.5 rounded-full ${
                i < activeTarget ? "bg-green-500" : i === activeTarget ? "bg-yellow-400" : "bg-gray-700"
              }`}
            />
          ))}
        </div>

        {errors.length > 0 && (
          <p className={`text-sm font-semibold mb-3 ${qualityColor}`}>
            Ortalama sapma: ~{avgError}px — {quality}
          </p>
        )}

        {allDone && (
          <div className="flex gap-3 mt-2">
            <button
              onClick={onRetry}
              className="flex-1 px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition"
            >
              Tekrar Kalibre Et
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition"
            >
              Devam Et
            </button>
          </div>
        )}

        {!allDone && (
          <p className="text-gray-500 text-xs">
            Nokta {activeTarget + 1} / {PREVIEW_TARGETS.length}
          </p>
        )}
      </div>
    </div>
  );
}
