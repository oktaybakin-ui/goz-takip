"use client";

import React, { useState, useEffect, useRef } from "react";
import StatusBadge from "./StatusBadge";
import { HeatmapGenerator } from "@/lib/heatmap";
import GazeReplay from "@/components/GazeReplay";
import type { GazePoint } from "@/lib/gazeModel";
import type { Fixation } from "@/lib/fixation";
import type { ImageResultRow, TestSessionWithParticipant } from "@/types/database";

interface SessionDetail {
  session: TestSessionWithParticipant;
  results: ImageResultRow[];
}

interface ParticipantDetailProps {
  sessionId: string;
}

export default function ParticipantDetail({ sessionId }: ParticipantDetailProps) {
  const [data, setData] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [viewTab, setViewTab] = useState<"heatmap" | "replay">("heatmap");
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapGenRef = useRef<HeatmapGenerator | null>(null);

  useEffect(() => {
    fetch(`/api/admin/sessions/${sessionId}`)
      .then((res) => res.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Gaze verilerinden heatmap oluştur
  useEffect(() => {
    if (!data) return;
    const currentResult = data.results[selectedImage];
    if (!currentResult || !heatmapCanvasRef.current) return;

    const gazePoints = (currentResult.gaze_points ?? []) as GazePoint[];
    const fixations = (currentResult.fixations ?? []) as Fixation[];
    const width = currentResult.image_width;
    const height = currentResult.image_height;

    if ((gazePoints.length === 0 && fixations.length === 0) || width <= 0 || height <= 0) {
      const ctx = heatmapCanvasRef.current.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, heatmapCanvasRef.current.width, heatmapCanvasRef.current.height);
      return;
    }

    if (!heatmapGenRef.current) {
      heatmapGenRef.current = new HeatmapGenerator();
    }

    heatmapGenRef.current.render(
      heatmapCanvasRef.current,
      gazePoints,
      fixations,
      width,
      height
    );
  }, [data, selectedImage]);

  if (loading) {
    return <div className="text-gray-400">Yükleniyor...</div>;
  }

  if (!data) {
    return <div className="text-red-400">Oturum bulunamadı.</div>;
  }

  const { session, results } = data;
  const currentResult = results[selectedImage];

  return (
    <div>
      {/* Session Header */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">
              {session.participants.full_name}
            </h2>
            <p className="text-gray-400 text-sm">
              {new Date(session.started_at).toLocaleDateString("tr-TR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <StatusBadge status={session.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <Stat label="Foto Sayısı" value={String(session.image_count)} />
          <Stat
            label="Kalibrasyon Hatası"
            value={session.calibration_error_px?.toFixed(1) + " px" || "-"}
          />
          <Stat
            label="Ekran"
            value={
              session.screen_width && session.screen_height
                ? `${session.screen_width}x${session.screen_height}`
                : "-"
            }
          />
          <Stat
            label="Süre"
            value={
              session.completed_at
                ? formatDuration(
                    new Date(session.completed_at).getTime() -
                      new Date(session.started_at).getTime()
                  )
                : "-"
            }
          />
        </div>

        {/* Webcam Kaydı */}
        {session.recording_url && (
          <div className="mt-4">
            <h3 className="text-white font-semibold mb-2 text-sm">Webcam Kaydı</h3>
            <video
              src={session.recording_url}
              controls
              className="w-full max-w-md rounded-lg border border-gray-700"
              style={{ maxHeight: 300 }}
            />
          </div>
        )}
      </div>

      {results.length === 0 ? (
        <div className="text-gray-500 text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
          Bu oturum için sonuç verisi yok.
        </div>
      ) : (
        <>
          {/* Image Tabs */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            {results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setSelectedImage(i)}
                className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
                  selectedImage === i
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                Foto {i + 1}
              </button>
            ))}
          </div>

          {/* Result Detail */}
          {currentResult && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Image with overlay */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
                {/* Heatmap / Replay sekme seçici */}
                <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                  <button
                    onClick={() => setViewTab("heatmap")}
                    className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                      viewTab === "heatmap"
                        ? "bg-blue-600 text-white shadow"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    Heatmap
                  </button>
                  <button
                    onClick={() => setViewTab("replay")}
                    className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                      viewTab === "replay"
                        ? "bg-blue-600 text-white shadow"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    Gaze Replay
                  </button>
                </div>

                {viewTab === "heatmap" && (
                  <div className="relative">
                    <img
                      src={currentResult.image_url}
                      alt={`Foto ${selectedImage + 1}`}
                      className="w-full rounded-lg"
                    />
                    {/* Heatmap overlay — gaze verilerinden client-side render */}
                    <canvas
                      ref={heatmapCanvasRef}
                      className="absolute inset-0 w-full h-full rounded-lg object-contain"
                      style={{ opacity: 0.6 }}
                    />
                    {/* Fixation points */}
                    <svg
                      className="absolute inset-0 w-full h-full"
                      viewBox={`0 0 ${currentResult.image_width} ${currentResult.image_height}`}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      {(currentResult.fixations as Array<{ x: number; y: number; duration: number }>).map(
                        (f, fi) => (
                          <circle
                            key={fi}
                            cx={f.x}
                            cy={f.y}
                            r={Math.max(8, Math.min(30, f.duration / 20))}
                            fill="rgba(59, 130, 246, 0.4)"
                            stroke="rgba(59, 130, 246, 0.8)"
                            strokeWidth="2"
                          />
                        )
                      )}
                    </svg>
                  </div>
                )}

                {viewTab === "replay" && (
                  <GazeReplay
                    gazePoints={(currentResult.gaze_points ?? []) as GazePoint[]}
                    fixations={(currentResult.fixations ?? []) as Fixation[]}
                    width={currentResult.image_width}
                    height={currentResult.image_height}
                    imageUrl={currentResult.image_url}
                  />
                )}

                <p className="text-gray-500 text-xs">
                  {currentResult.image_width}x{currentResult.image_height} px
                </p>
              </div>

              {/* Metrics */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-white font-semibold mb-3">Metrikler</h3>
                {currentResult.metrics ? (
                  <div className="space-y-2">
                    <MetricRow label="Fixation Sayısı" value={String((currentResult.metrics as Record<string, unknown>).fixationCount ?? "-")} />
                    <MetricRow label="Ort. Fixation Süresi" value={formatMs((currentResult.metrics as Record<string, unknown>).averageFixationDuration as number)} />
                    <MetricRow label="Toplam Fixation Süresi" value={formatMs((currentResult.metrics as Record<string, unknown>).totalFixationDuration as number)} />
                    <MetricRow label="Toplam Görüntüleme" value={formatMs((currentResult.metrics as Record<string, unknown>).totalViewTime as number)} />
                    <MetricRow label="İlk Fixation Süresi" value={formatMs((currentResult.metrics as Record<string, unknown>).timeToFirstFixation as number)} />
                  </div>
                ) : (
                  <p className="text-gray-500">Metrik verisi yok.</p>
                )}

                <h3 className="text-white font-semibold mb-3 mt-6">Veriler</h3>
                <div className="space-y-2">
                  <MetricRow label="Gaze Points" value={String(currentResult.gaze_points?.length ?? 0)} />
                  <MetricRow label="Fixations" value={String(currentResult.fixations?.length ?? 0)} />
                  <MetricRow label="Saccades" value={String(currentResult.saccades?.length ?? 0)} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-white font-medium">{value}</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

function formatMs(ms: number | undefined | null): string {
  if (ms == null || isNaN(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}dk ${sec}sn` : `${sec}sn`;
}
