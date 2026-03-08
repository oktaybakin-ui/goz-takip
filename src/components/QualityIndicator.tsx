"use client";

import React, { useState, useEffect, useRef } from "react";
import type { FaceTracker } from "@/lib/faceTracker";
import type { GlassesDetector } from "@/lib/glassesDetector";

interface QualityIndicatorProps {
  faceTracker: FaceTracker;
  isTracking: boolean;
  glassesDetector: GlassesDetector;
  onGlassesDetected: (msg: string | null) => void;
}

export default function QualityIndicator({
  faceTracker,
  isTracking,
  glassesDetector,
  onGlassesDetected,
}: QualityIndicatorProps) {
  const [quality, setQuality] = useState({ confidence: 0, fps: 0, status: "...", color: "gray" as string });
  const historyRef = useRef<number[]>([]);
  const glassesNotifiedRef = useRef(false);

  useEffect(() => {
    if (!isTracking) return;
    const interval = setInterval(() => {
      const features = faceTracker.getLastFeatures();
      const fps = faceTracker.getFPS();
      const conf = features?.confidence ?? 0;

      historyRef.current.push(conf);
      if (historyRef.current.length > 10) historyRef.current.shift();
      const avgConf = historyRef.current.reduce((a, b) => a + b, 0) / historyRef.current.length;

      let status: string;
      let color: string;
      if (avgConf >= 0.7) { status = "Mukemmel"; color = "green"; }
      else if (avgConf >= 0.4) { status = "Iyi"; color = "blue"; }
      else if (avgConf >= 0.2) { status = "Dusuk"; color = "yellow"; }
      else { status = "Cok Dusuk"; color = "red"; }

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
