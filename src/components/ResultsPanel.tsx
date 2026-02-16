"use client";

import React, { useRef, useEffect, useState } from "react";
import { FixationMetrics, Fixation } from "@/lib/fixation";
import { GazePoint } from "@/lib/gazeModel";
import HeatmapCanvas from "./HeatmapCanvas";

interface ResultsPanelProps {
  metrics: FixationMetrics;
  gazePoints: GazePoint[];
  calibrationError: number;
  imageUrl: string;
  imageDimensions: { width: number; height: number };
  onExportJSON: () => void;
  onExportHeatmap: () => void;
  onReset: () => void;
  onRecalibrate: () => void;
}

export default function ResultsPanel({
  metrics,
  gazePoints,
  calibrationError,
  imageUrl,
  imageDimensions,
  onExportJSON,
  onExportHeatmap,
  onReset,
  onRecalibrate,
}: ResultsPanelProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "fixations" | "clusters" | "heatmap">("overview");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Fixation haritası çiz
  useEffect(() => {
    if (!canvasRef.current || activeTab !== "fixations") return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Saccade çizgileri
    for (const saccade of metrics.saccades) {
      ctx.strokeStyle = "rgba(100, 100, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(saccade.startX, saccade.startY);
      ctx.lineTo(saccade.endX, saccade.endY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Fixation noktaları (sıralı)
    const sortedFixations = [...metrics.allFixations].sort(
      (a, b) => a.startTime - b.startTime
    );

    sortedFixations.forEach((fix, i) => {
      const radius = Math.min(25, Math.max(8, fix.duration / 40));

      // Fixation dairesi
      ctx.beginPath();
      ctx.arc(fix.x, fix.y, radius, 0, Math.PI * 2);

      // İlk 3 fixation farklı renk
      if (i === 0) {
        ctx.fillStyle = "rgba(255, 50, 50, 0.4)";
        ctx.strokeStyle = "rgba(255, 50, 50, 0.9)";
      } else if (i < 3) {
        ctx.fillStyle = "rgba(255, 150, 0, 0.4)";
        ctx.strokeStyle = "rgba(255, 150, 0, 0.9)";
      } else {
        ctx.fillStyle = "rgba(0, 150, 255, 0.3)";
        ctx.strokeStyle = "rgba(0, 150, 255, 0.7)";
      }

      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();

      // Sıra numarası
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${i + 1}`, fix.x, fix.y);

      // Süre
      ctx.font = "9px sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillText(`${Math.round(fix.duration)}ms`, fix.x, fix.y + radius + 10);
    });
  }, [metrics, activeTab, imageDimensions]);

  // ROI cluster çiz
  const clusterCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!clusterCanvasRef.current || activeTab !== "clusters") return;

    const canvas = clusterCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const colors = [
      "rgba(255, 50, 50, 0.3)",
      "rgba(50, 255, 50, 0.3)",
      "rgba(50, 50, 255, 0.3)",
      "rgba(255, 255, 50, 0.3)",
      "rgba(255, 50, 255, 0.3)",
    ];

    metrics.roiClusters.forEach((cluster, i) => {
      const color = colors[i % colors.length];
      const borderColor = color.replace("0.3", "0.8");

      // Cluster bölgesi
      ctx.beginPath();
      ctx.arc(cluster.centerX, cluster.centerY, cluster.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Etiket
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.fillText(
        `ROI ${cluster.id + 1}`,
        cluster.centerX,
        cluster.centerY - cluster.radius - 8
      );
      ctx.font = "10px sans-serif";
      ctx.fillText(
        `${Math.round(cluster.totalDuration)}ms`,
        cluster.centerX,
        cluster.centerY
      );
    });
  }, [metrics, activeTab, imageDimensions]);

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Sol: Görüntü + Overlay */}
      <div className="flex-1">
        <div
          className="relative border-2 border-gray-700 rounded-lg overflow-hidden shadow-2xl bg-black"
          style={{
            width: imageDimensions.width,
            height: imageDimensions.height,
          }}
        >
          <img
            src={imageUrl}
            alt="Analiz görüntüsü"
            className="absolute inset-0 w-full h-full object-contain"
          />

          {/* Fixation overlay */}
          {activeTab === "fixations" && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 z-10"
              style={{
                width: imageDimensions.width,
                height: imageDimensions.height,
              }}
            />
          )}

          {/* Cluster overlay */}
          {activeTab === "clusters" && (
            <canvas
              ref={clusterCanvasRef}
              className="absolute inset-0 z-10"
              style={{
                width: imageDimensions.width,
                height: imageDimensions.height,
              }}
            />
          )}

          {/* Heatmap overlay */}
          {activeTab === "heatmap" && (
            <HeatmapCanvas
              gazePoints={gazePoints}
              fixations={metrics.allFixations}
              width={imageDimensions.width}
              height={imageDimensions.height}
              opacity={0.65}
            />
          )}
        </div>

        {/* Tab seçici */}
        <div className="flex gap-2 mt-4">
          {(
            [
              { key: "overview", label: "📊 Özet" },
              { key: "fixations", label: "👁️ Fixation" },
              { key: "clusters", label: "🎯 ROI" },
              { key: "heatmap", label: "🔥 Heatmap" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                activeTab === tab.key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sağ: Metrik paneli */}
      <div className="w-full lg:w-96 space-y-4">
        {/* Başlık */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h2 className="text-xl font-bold text-white mb-1">📊 Analiz Sonuçları</h2>
          <p className="text-gray-500 text-sm">
            Kalibrasyon hatası: {Math.round(calibrationError)} px
          </p>
        </div>

        {/* Temel metrikler */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="İlk Bakış Süresi"
            value={formatMs(metrics.timeToFirstFixation)}
            icon="⏱️"
            highlight
          />
          <MetricCard
            label="Toplam Süre"
            value={formatMs(metrics.totalViewTime)}
            icon="⏳"
          />
          <MetricCard
            label="Fixation Sayısı"
            value={`${metrics.fixationCount}`}
            icon="👁️"
          />
          <MetricCard
            label="Ort. Fixation"
            value={formatMs(metrics.averageFixationDuration)}
            icon="📏"
          />
        </div>

        {/* İlk fixation */}
        {metrics.firstFixation && (
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">
              🎯 İlk Bakış Noktası
            </h3>
            <p className="text-white">
              x: {Math.round(metrics.firstFixation.x)}, y:{" "}
              {Math.round(metrics.firstFixation.y)}
            </p>
            <p className="text-gray-500 text-sm">
              Süre: {formatMs(metrics.firstFixation.duration)}
            </p>
          </div>
        )}

        {/* İlk 3 fixation */}
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            👁️ İlk 3 Fixation
          </h3>
          <div className="space-y-2">
            {metrics.firstThreeFixations.map((fix, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2"
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    i === 0
                      ? "bg-red-500 text-white"
                      : i === 1
                      ? "bg-orange-500 text-white"
                      : "bg-yellow-500 text-black"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1">
                  <span className="text-gray-300 text-sm">
                    ({Math.round(fix.x)}, {Math.round(fix.y)})
                  </span>
                </div>
                <span className="text-gray-500 text-sm">
                  {formatMs(fix.duration)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* En uzun fixation */}
        {metrics.longestFixation && (
          <div className="bg-gray-900 rounded-xl p-4 border border-orange-800">
            <h3 className="text-sm font-semibold text-orange-400 mb-2">
              🔥 En Uzun Bakış
            </h3>
            <p className="text-white text-lg font-bold">
              {formatMs(metrics.longestFixation.duration)}
            </p>
            <p className="text-gray-500 text-sm">
              Konum: ({Math.round(metrics.longestFixation.x)},{" "}
              {Math.round(metrics.longestFixation.y)})
            </p>
          </div>
        )}

        {/* ROI Cluster özeti */}
        {metrics.roiClusters.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <h3 className="text-sm font-semibold text-gray-400 mb-3">
              🎯 İlgi Alanları (ROI)
            </h3>
            <div className="space-y-2">
              {metrics.roiClusters.slice(0, 5).map((cluster, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                >
                  <span className="text-gray-300 text-sm">ROI {cluster.id + 1}</span>
                  <div className="text-right">
                    <span className="text-white text-sm font-medium">
                      {formatMs(cluster.totalDuration)}
                    </span>
                    <span className="text-gray-500 text-xs ml-2">
                      ({cluster.fixationCount} fix)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Aksiyon butonları */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onExportJSON}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition"
          >
            📥 JSON Dışa Aktar
          </button>
          <button
            onClick={onExportHeatmap}
            className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 transition"
          >
            🖼️ Heatmap PNG İndir
          </button>
          <div className="flex gap-2">
            <button
              onClick={onRecalibrate}
              className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition text-sm"
            >
              🔄 Tekrar Kalibre Et
            </button>
            <button
              onClick={onReset}
              className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition text-sm"
            >
              🆕 Yeni Görüntü
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Metrik kartı bileşeni
function MetricCard({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-3 border ${
        highlight
          ? "bg-blue-900/30 border-blue-700"
          : "bg-gray-900 border-gray-800"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-gray-500 text-xs">{label}</span>
      </div>
      <p className={`text-lg font-bold ${highlight ? "text-blue-300" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
