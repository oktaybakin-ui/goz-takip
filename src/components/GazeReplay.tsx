"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { GazePoint } from "@/lib/gazeModel";
import type { Fixation } from "@/lib/fixation";

function lowerBound(arr: GazePoint[], ts: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].timestamp < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr: GazePoint[], ts: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].timestamp <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface GazeReplayProps {
  gazePoints: GazePoint[];
  fixations: Fixation[];
  width: number;
  height: number;
  imageUrl: string;
}

export default function GazeReplay({ gazePoints, fixations, width, height, imageUrl }: GazeReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const lastProgressUpdateRef = useRef(0);

  const totalDuration = gazePoints.length > 1
    ? gazePoints[gazePoints.length - 1].timestamp - gazePoints[0].timestamp
    : 0;

  const draw = useCallback((currentTimeMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const baseTs = gazePoints[0]?.timestamp ?? 0;
    const cutoff = baseTs + currentTimeMs;

    const trailLength = 500;
    const trailStart = cutoff - trailLength;
    const startIdx = lowerBound(gazePoints, trailStart);
    const endIdx = upperBound(gazePoints, cutoff);
    const trailPoints = gazePoints.slice(startIdx, endIdx);

    if (trailPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
      for (let i = 1; i < trailPoints.length; i++) {
        ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
      }
      ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const visibleFixations = fixations.filter((f) => f.startTime <= cutoff && f.endTime >= trailStart);
    for (const fix of visibleFixations) {
      const alpha = fix.endTime <= cutoff ? 0.25 : 0.5;
      const r = Math.min(20, Math.max(6, fix.duration / 50));
      ctx.beginPath();
      ctx.arc(fix.x, fix.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(59, 130, 246, ${alpha + 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const current = trailPoints[trailPoints.length - 1];
    if (current) {
      ctx.beginPath();
      ctx.arc(current.x, current.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(239, 68, 68, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [gazePoints, fixations, width, height]);

  const animate = useCallback(() => {
    if (!playing) return;

    const now = performance.now();
    const elapsed = (now - startTimeRef.current) * speed + pauseOffsetRef.current;
    const pct = Math.min(1, elapsed / totalDuration);
    if (now - lastProgressUpdateRef.current > 100) {
      lastProgressUpdateRef.current = now;
      setProgress(pct);
    }
    draw(elapsed);

    if (pct >= 1) {
      setPlaying(false);
      pauseOffsetRef.current = 0;
      return;
    }

    animRef.current = requestAnimationFrame(animate);
  }, [playing, speed, totalDuration, draw]);

  useEffect(() => {
    if (playing) {
      startTimeRef.current = performance.now();
      animRef.current = requestAnimationFrame(animate);
    }
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing, animate]);

  const handlePlayPause = () => {
    if (playing) {
      pauseOffsetRef.current += (performance.now() - startTimeRef.current) * speed;
      setPlaying(false);
    } else {
      if (progress >= 1) {
        pauseOffsetRef.current = 0;
        setProgress(0);
      }
      setPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setProgress(val);
    pauseOffsetRef.current = val * totalDuration;
    draw(val * totalDuration);
    if (playing) {
      startTimeRef.current = performance.now();
    }
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return `${s}.${tenths}s`;
  };

  if (gazePoints.length < 2) {
    return <div className="text-gray-500 text-sm p-4">Replay için yeterli veri yok.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="relative rounded-lg overflow-hidden bg-black" style={{ width, height }}>
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="absolute inset-0 z-10"
          style={{ width, height }}
        />
      </div>

      <div className="flex items-center gap-3 bg-gray-900 rounded-xl px-4 py-3 border border-gray-800">
        <button
          onClick={handlePlayPause}
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition touch-manipulation"
        >
          {playing ? "⏸" : "▶"}
        </button>

        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={handleSeek}
          className="flex-1 h-2 accent-blue-500"
          aria-label="Seek"
        />

        <span className="text-gray-400 text-xs whitespace-nowrap min-w-[4rem] text-right">
          {formatTime(progress * totalDuration)} / {formatTime(totalDuration)}
        </span>

        <select
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="bg-gray-800 text-gray-300 text-xs rounded px-2 py-1 border border-gray-700"
          aria-label="Playback speed"
        >
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>
      </div>
    </div>
  );
}
