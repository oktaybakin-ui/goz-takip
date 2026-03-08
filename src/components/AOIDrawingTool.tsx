"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import NextImage from "next/image";
import { AOIAnalyzer, AOIRegion, AOIResult, TransitionMatrix } from "@/lib/aoiAnalysis";
import type { GazePoint } from "@/lib/gazeModel";
import type { Fixation } from "@/lib/fixation";

interface AOIDrawingToolProps {
  gazePoints: GazePoint[];
  fixations: Fixation[];
  width: number;
  height: number;
  imageUrl: string;
}

interface DrawingRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const REGION_COLORS = [
  { fill: "rgba(239, 68, 68, 0.15)", stroke: "#ef4444", text: "#fca5a5" },
  { fill: "rgba(59, 130, 246, 0.15)", stroke: "#3b82f6", text: "#93c5fd" },
  { fill: "rgba(34, 197, 94, 0.15)", stroke: "#22c55e", text: "#86efac" },
  { fill: "rgba(250, 204, 21, 0.15)", stroke: "#facc15", text: "#fde68a" },
  { fill: "rgba(168, 85, 247, 0.15)", stroke: "#a855f7", text: "#c4b5fd" },
  { fill: "rgba(236, 72, 153, 0.15)", stroke: "#ec4899", text: "#f9a8d4" },
  { fill: "rgba(20, 184, 166, 0.15)", stroke: "#14b8a6", text: "#5eead4" },
  { fill: "rgba(251, 146, 60, 0.15)", stroke: "#fb923c", text: "#fdba74" },
];

export default function AOIDrawingTool({ gazePoints, fixations, width, height, imageUrl }: AOIDrawingToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [regions, setRegions] = useState<AOIRegion[]>([]);
  const [drawing, setDrawing] = useState<DrawingRect | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [results, setResults] = useState<AOIResult[]>([]);
  const [transitionMatrix, setTransitionMatrix] = useState<TransitionMatrix | null>(null);
  const analyzerRef = useRef(new AOIAnalyzer());
  const regionCountRef = useRef(0);

  // Canvas üzerindeki koordinatları hesapla (CSS scale hesabı)
  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, [width, height]);

  // Bölgeleri canvas'a çiz
  const drawRegions = useCallback((currentDrawing?: DrawingRect) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Mevcut bölgeleri çiz
    regions.forEach((region, i) => {
      const color = REGION_COLORS[i % REGION_COLORS.length];
      ctx.fillStyle = color.fill;
      ctx.fillRect(region.x, region.y, region.width, region.height);
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(region.x, region.y, region.width, region.height);
      ctx.setLineDash([]);

      // İsim etiketi
      ctx.font = "bold 12px system-ui";
      ctx.fillStyle = color.text;
      const labelY = region.y > 18 ? region.y - 5 : region.y + 15;
      ctx.fillText(region.name, region.x + 4, labelY);
    });

    // Aktif çizim
    if (currentDrawing) {
      const x = Math.min(currentDrawing.startX, currentDrawing.endX);
      const y = Math.min(currentDrawing.startY, currentDrawing.endY);
      const w = Math.abs(currentDrawing.endX - currentDrawing.startX);
      const h = Math.abs(currentDrawing.endY - currentDrawing.startY);

      ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }, [regions, width, height]);

  useEffect(() => {
    drawRegions();
  }, [drawRegions]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    setDrawing({ startX: x, startY: y, endX: x, endY: y });
  }, [getCanvasCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const { x, y } = getCanvasCoords(e);
    const updated = { ...drawing, endX: x, endY: y };
    setDrawing(updated);
    drawRegions(updated);
  }, [drawing, getCanvasCoords, drawRegions]);

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;

    const x = Math.min(drawing.startX, drawing.endX);
    const y = Math.min(drawing.startY, drawing.endY);
    const w = Math.abs(drawing.endX - drawing.startX);
    const h = Math.abs(drawing.endY - drawing.startY);

    // Çok küçük alanları yoksay (yanlışlıkla tıklama)
    if (w < 10 || h < 10) {
      setDrawing(null);
      drawRegions();
      return;
    }

    regionCountRef.current++;
    const id = `aoi-${Date.now()}`;
    const defaultName = `Bölge ${regionCountRef.current}`;

    const newRegion: AOIRegion = { id, name: defaultName, x, y, width: w, height: h };
    setRegions((prev) => [...prev, newRegion]);
    setDrawing(null);
    setEditingId(id);
    setEditName(defaultName);
  }, [drawing, drawRegions]);

  const handleRename = useCallback((id: string, name: string) => {
    setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
    setEditingId(null);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id));
    setResults([]);
    setTransitionMatrix(null);
  }, []);

  // Analiz çalıştır
  const runAnalysis = useCallback(() => {
    const analyzer = analyzerRef.current;
    analyzer.clearRegions();
    regions.forEach((r) => analyzer.addRegion(r));
    const aoiResults = analyzer.analyze(fixations, gazePoints);
    setResults(aoiResults);
    setTransitionMatrix(analyzer.getTransitionMatrix(fixations));
  }, [regions, fixations, gazePoints]);

  // Bölgeler değiştiğinde otomatik analiz yap
  useEffect(() => {
    if (regions.length > 0) {
      runAnalysis();
    } else {
      setResults([]);
      setTransitionMatrix(null);
    }
  }, [regions, runAnalysis]);

  const formatMs = (ms: number) => {
    if (ms < 0) return "-";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };

  return (
    <div className="space-y-4">
      {/* Çizim alanı */}
      <div className="relative rounded-xl overflow-hidden border border-gray-800 bg-black w-full"
        style={{ maxWidth: width, aspectRatio: `${width} / ${height}` }}
        ref={containerRef}
      >
        <NextImage src={imageUrl} alt="" fill unoptimized className="absolute inset-0 w-full h-full object-contain" />
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="absolute inset-0 w-full h-full z-10 cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { if (drawing) { setDrawing(null); drawRegions(); } }}
        />
      </div>

      {/* Talimat */}
      {regions.length === 0 && (
        <p className="text-gray-500 text-sm text-center">
          Analiz etmek istediginiz alanlari fare ile dikdortgen cizerek isaretleyin.
        </p>
      )}

      {/* Bölge listesi */}
      {regions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {regions.map((region, i) => {
            const color = REGION_COLORS[i % REGION_COLORS.length];
            return (
              <div
                key={region.id}
                className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-1.5 border border-gray-800"
              >
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color.stroke }} />
                {editingId === region.id ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRename(region.id, editName)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRename(region.id, editName); }}
                    autoFocus
                    className="bg-gray-800 text-white text-sm rounded px-2 py-0.5 w-24 border border-gray-600 focus:outline-none focus:border-blue-500"
                  />
                ) : (
                  <span
                    className="text-gray-300 text-sm cursor-pointer hover:text-white"
                    onClick={() => { setEditingId(region.id); setEditName(region.name); }}
                  >
                    {region.name}
                  </span>
                )}
                <button
                  onClick={() => handleDelete(region.id)}
                  className="text-gray-600 hover:text-red-400 text-xs ml-1"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            onClick={() => { setRegions([]); regionCountRef.current = 0; }}
            className="text-gray-600 hover:text-gray-400 text-xs px-2 py-1"
          >
            Tümünü Temizle
          </button>
        </div>
      )}

      {/* Sonuç tablosu */}
      {results.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left py-2.5 px-3">Bölge</th>
                  <th className="text-right py-2.5 px-3">Süre</th>
                  <th className="text-right py-2.5 px-3">%</th>
                  <th className="text-right py-2.5 px-3">Giriş</th>
                  <th className="text-right py-2.5 px-3">Fixation</th>
                  <th className="text-right py-2.5 px-3">İlk Bakış</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const color = REGION_COLORS[i % REGION_COLORS.length];
                  return (
                    <tr key={r.regionId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2 px-3 flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color.stroke }} />
                        <span className="text-gray-300">{r.regionName}</span>
                      </td>
                      <td className="py-2 px-3 text-right text-white font-medium">{formatMs(r.dwellTimeMs)}</td>
                      <td className="py-2 px-3 text-right text-gray-400">{r.dwellTimePercent.toFixed(1)}</td>
                      <td className="py-2 px-3 text-right text-gray-400">{r.entryCount}</td>
                      <td className="py-2 px-3 text-right text-gray-400">{r.fixationCount}</td>
                      <td className="py-2 px-3 text-right text-gray-400">{formatMs(r.firstFixationTimeMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Geçiş matrisi */}
      {transitionMatrix && transitionMatrix.regionIds.length > 1 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Geçiş Matrisi</h4>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-gray-500"></th>
                  {transitionMatrix.regionIds.map((id) => {
                    const region = regions.find((r) => r.id === id);
                    return <th key={id} className="px-2 py-1 text-gray-400 text-center">{region?.name ?? id}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {transitionMatrix.matrix.map((row, fromIdx) => {
                  const fromRegion = regions.find((r) => r.id === transitionMatrix.regionIds[fromIdx]);
                  return (
                    <tr key={fromIdx}>
                      <td className="px-2 py-1 text-gray-400 font-medium">{fromRegion?.name ?? transitionMatrix.regionIds[fromIdx]}</td>
                      {row.map((count, toIdx) => (
                        <td
                          key={toIdx}
                          className={`px-2 py-1 text-center ${fromIdx === toIdx ? "text-gray-700" : count > 0 ? "text-white font-medium" : "text-gray-600"}`}
                        >
                          {fromIdx === toIdx ? "-" : count}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
