"use client";

import React, { useRef, useEffect } from "react";
import type { FaceTracker } from "@/lib/faceTracker";

interface CameraPreviewProps {
  faceTracker: FaceTracker;
}

export default function CameraPreview({ faceTracker }: CameraPreviewProps) {
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
