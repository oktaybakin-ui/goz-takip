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

/**
 * WebGL render sonrası canvas'ta gerçekten piksel var mı kontrol et.
 * Sessiz WebGL hatalarını yakalar (driver/framebuffer sorunları).
 */
function isCanvasEmpty(canvas: HTMLCanvasElement): boolean {
  try {
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return true;

    // Ortadan küçük bir bölge oku
    const sampleSize = Math.min(4, canvas.width, canvas.height);
    const sx = Math.max(0, Math.floor(canvas.width / 2) - sampleSize / 2);
    const sy = Math.max(0, Math.floor(canvas.height / 2) - sampleSize / 2);
    const pixels = new Uint8Array(sampleSize * sampleSize * 4);
    gl.readPixels(sx, sy, sampleSize, sampleSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] > 0) return false;
    }

    // Merkez boş — köşeleri de dene
    const corners = [
      [0, 0],
      [Math.max(0, canvas.width - sampleSize), 0],
      [0, Math.max(0, canvas.height - sampleSize)],
      [Math.max(0, canvas.width - sampleSize), Math.max(0, canvas.height - sampleSize)],
    ];
    for (const [cx, cy] of corners) {
      const cpx = new Uint8Array(sampleSize * sampleSize * 4);
      gl.readPixels(cx, cy, sampleSize, sampleSize, gl.RGBA, gl.UNSIGNED_BYTE, cpx);
      for (let i = 0; i < cpx.length; i++) {
        if (cpx[i] > 0) return false;
      }
    }

    return true;
  } catch {
    return true; // Hata → boş say → 2D'ye düş
  }
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
    if (width <= 0 || height <= 0) return;

    let cancelled = false;

    // WebGL dene
    if (useWebGL && webglRef.current && webglCanvasRef.current) {
      try {
        webglRef.current.render(webglCanvasRef.current, gazePoints, fixations, width, height);

        // Doğrulama: WebGL gerçekten piksel üretti mi?
        if (!isCanvasEmpty(webglCanvasRef.current)) {
          return; // Başarılı
        }
        // Boş çıktı — sessiz WebGL hatası, 2D'ye düş
        console.warn("[HeatmapCanvas] WebGL render boş çıktı, Canvas 2D fallback");
      } catch {
        // Açık hata — 2D'ye düş
      }
      setUseWebGL(false);
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

  // Her iki canvas'ı da DOM'da tut — WebGL başarısız olursa 2D hemen kullanılabilir
  return (
    <>
      <canvas
        ref={webglCanvasRef}
        className="absolute inset-0 w-full h-full z-20 pointer-events-none"
        style={{ opacity, display: useWebGL ? "block" : "none" }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full z-20 pointer-events-none"
        style={{ opacity, display: useWebGL ? "none" : "block" }}
      />
    </>
  );
}
