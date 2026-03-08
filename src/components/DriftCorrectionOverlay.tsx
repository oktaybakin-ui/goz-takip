"use client";

import React, { useState, useEffect, useRef } from "react";
import type { GazeModel } from "@/lib/gazeModel";
import type { FaceTracker } from "@/lib/faceTracker";

interface DriftCorrectionOverlayProps {
  model: GazeModel;
  faceTracker: FaceTracker;
  onDone: () => void;
  photoNum: number;
  totalPhotos: number;
}

export default function DriftCorrectionOverlay({
  model,
  faceTracker,
  onDone,
  photoNum,
  totalPhotos,
}: DriftCorrectionOverlayProps) {
  const [progress, setProgress] = useState(0);
  const gazeCollectorRef = useRef<Array<{ px: number; py: number }>>([]);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(performance.now());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const DURATION = 2000;
  const centerX = typeof window !== "undefined" ? window.innerWidth / 2 : 960;
  const centerY = typeof window !== "undefined" ? window.innerHeight / 2 : 540;

  useEffect(() => {
    startTimeRef.current = performance.now();
    gazeCollectorRef.current = [];

    const loop = () => {
      const elapsed = performance.now() - startTimeRef.current;
      setProgress(Math.min(1, elapsed / DURATION));

      const features = faceTracker.getLastFeatures();
      if (features && features.confidence > 0.2) {
        const pred = model.predict(features);
        if (pred) {
          gazeCollectorRef.current.push({ px: pred.x, py: pred.y });
        }
      }

      if (elapsed >= DURATION) {
        const samples = gazeCollectorRef.current;
        if (samples.length >= 5) {
          const avgX = samples.reduce((s, p) => s + p.px, 0) / samples.length;
          const avgY = samples.reduce((s, p) => s + p.py, 0) / samples.length;
          const driftX = centerX - avgX;
          const driftY = centerY - avgY;
          const maxDrift = Math.min(window.innerWidth, window.innerHeight) * 0.15;
          if (Math.abs(driftX) < maxDrift && Math.abs(driftY) < maxDrift) {
            model.applyDriftCorrection(centerX, centerY, avgX, avgY);
          }
        }
        onDoneRef.current();
        return;
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, faceTracker, centerX, centerY]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex items-center justify-center">
      <div className="relative">
        <div className="w-10 h-10 rounded-full border-2 border-white/60 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-white" />
        </div>
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
