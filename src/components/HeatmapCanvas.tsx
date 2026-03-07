"use client";

import React, { useRef, useEffect, useState } from "react";
import { GazePoint } from "@/lib/gazeModel";
import { Fixation } from "@/lib/fixation";
import { HeatmapGenerator } from "@/lib/heatmap";
import { WebGLHeatmapRenderer } from "@/lib/webglHeatmap";

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
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);

  // Renderer refs — lazy init
  const canvas2dRef = useRef<HeatmapGenerator>(null as unknown as HeatmapGenerator);
  if (!canvas2dRef.current) canvas2dRef.current = new HeatmapGenerator();

  const webglRef = useRef<WebGLHeatmapRenderer | null>(null);
  const [useWebGL, setUseWebGL] = useState(() => WebGLHeatmapRenderer.isSupported());

  // WebGL renderer'ı lazy init
  useEffect(() => {
    if (useWebGL && !webglRef.current) {
      webglRef.current = new WebGLHeatmapRenderer();
    }
  }, [useWebGL]);

  useEffect(() => {
    if (gazePoints.length === 0 && fixations.length === 0) return;

    let cancelled = false;

    // WebGL tercih et
    if (useWebGL && webglRef.current && webglCanvasRef.current) {
      try {
        webglRef.current.render(webglCanvasRef.current, gazePoints, fixations, width, height);
        return;
      } catch {
        // WebGL başarısız → Canvas 2D fallback'a geç
        setUseWebGL(false);
      }
    }

    // Canvas 2D fallback
    if (!canvasRef.current) return;
    canvas2dRef.current
      .renderAsync(canvasRef.current, gazePoints, fixations, width, height)
      .catch(() => {
        if (!cancelled && canvasRef.current) {
          canvas2dRef.current.render(canvasRef.current, gazePoints, fixations, width, height);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gazePoints, fixations, width, height, useWebGL]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      canvas2dRef.current?.destroy();
      webglRef.current?.destroy();
    };
  }, []);

  // WebGL kullanılıyorsa ayrı canvas, değilse 2D canvas
  if (useWebGL) {
    return (
      <canvas
        ref={webglCanvasRef}
        className="absolute inset-0 z-20 pointer-events-none"
        style={{ width, height, opacity }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-20 pointer-events-none"
      style={{ width, height, opacity }}
    />
  );
}
