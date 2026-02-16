"use client";

import React, { useRef, useEffect } from "react";
import { GazePoint } from "@/lib/gazeModel";
import { Fixation } from "@/lib/fixation";
import { HeatmapGenerator } from "@/lib/heatmap";

interface HeatmapCanvasProps {
  gazePoints: GazePoint[];
  fixations: Fixation[];
  width: number;
  height: number;
  opacity?: number;
}

export default function HeatmapCanvas({
  gazePoints,
  fixations,
  width,
  height,
  opacity = 0.6,
}: HeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const generatorRef = useRef<HeatmapGenerator>(new HeatmapGenerator());

  useEffect(() => {
    if (!canvasRef.current) return;
    if (gazePoints.length === 0 && fixations.length === 0) return;

    generatorRef.current.render(
      canvasRef.current,
      gazePoints,
      fixations,
      width,
      height
    );
  }, [gazePoints, fixations, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-20 pointer-events-none"
      style={{
        width,
        height,
        opacity,
      }}
    />
  );
}
