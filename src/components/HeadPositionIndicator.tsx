"use client";

import React, { useState, useEffect, useRef } from "react";
import { FaceTracker } from "@/lib/faceTracker";

interface HeadPositionIndicatorProps {
  faceTracker: FaceTracker;
}

type PositionStatus = "good" | "warning" | "bad";

interface HeadState {
  status: PositionStatus;
  message: string;
  yaw: number;
  pitch: number;
}

function getHeadState(yaw: number, pitch: number, faceScale: number, confidence: number): HeadState {
  if (confidence < 0.1) {
    return { status: "bad", message: "Yüz algılanamıyor", yaw: 0, pitch: 0 };
  }
  if (faceScale < 0.06) {
    return { status: "bad", message: "Kameraya yaklaş", yaw, pitch };
  }

  const absYaw = Math.abs(yaw);
  const absPitch = Math.abs(pitch);

  if (absYaw > 0.35 || absPitch > 0.35) {
    const dir = absYaw > absPitch
      ? (yaw > 0 ? "Sola dön" : "Sağa dön")
      : (pitch > 0 ? "Başı kaldır" : "Başı indir");
    return { status: "bad", message: dir, yaw, pitch };
  }
  if (absYaw > 0.18 || absPitch > 0.18) {
    return { status: "warning", message: "Hafif döndü", yaw, pitch };
  }
  return { status: "good", message: "İyi pozisyon", yaw, pitch };
}

const statusColors: Record<PositionStatus, string> = {
  good: "#4ade80",
  warning: "#facc15",
  bad: "#ef4444",
};

export default function HeadPositionIndicator({ faceTracker }: HeadPositionIndicatorProps) {
  const [headState, setHeadState] = useState<HeadState>({ status: "good", message: "İyi pozisyon", yaw: 0, pitch: 0 });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const features = faceTracker.getLastFeatures();
      if (!features) {
        setHeadState({ status: "bad", message: "Yüz algılanamıyor", yaw: 0, pitch: 0 });
        return;
      }
      setHeadState(getHeadState(features.yaw, features.pitch, features.faceScale, features.confidence));
    }, 250); // 4Hz

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [faceTracker]);

  const color = statusColors[headState.status];
  // Baş siluetini yaw/pitch'e göre hafif döndür (görsel geri bildirim)
  const rotateY = Math.round(headState.yaw * 25);
  const rotateX = Math.round(-headState.pitch * 20);

  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2.5 bg-gray-900/90 backdrop-blur rounded-xl px-3 py-2 border border-gray-700 shadow-lg select-none">
      {/* Baş silueti SVG */}
      <div
        style={{
          transform: `perspective(100px) rotateY(${rotateY}deg) rotateX(${rotateX}deg)`,
          transition: "transform 0.25s ease-out",
        }}
      >
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          {/* Baş (oval) */}
          <ellipse cx="14" cy="11" rx="7" ry="8.5" stroke={color} strokeWidth="1.8" fill="none" />
          {/* Boyun */}
          <path d="M10 18.5 Q10 22 8 24 L20 24 Q18 22 18 18.5" stroke={color} strokeWidth="1.5" fill="none" />
          {/* Gözler */}
          <circle cx="11" cy="10" r="1.2" fill={color} />
          <circle cx="17" cy="10" r="1.2" fill={color} />
        </svg>
      </div>

      {/* Durum mesajı */}
      <div className="flex flex-col">
        <span className="text-xs font-medium" style={{ color }}>{headState.message}</span>
        <div className="flex gap-1 mt-0.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor:
                  headState.status === "good" ? color
                  : headState.status === "warning" && i < 2 ? color
                  : headState.status === "bad" && i < 1 ? color
                  : "#374151",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
