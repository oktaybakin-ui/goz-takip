"use client";

import React, { useRef, useEffect, useState } from "react";
import { FixationMetrics, Fixation } from "@/lib/fixation";
import { GazePoint } from "@/lib/gazeModel";
import { clearCalibration, hasStoredCalibration } from "@/lib/calibrationStorage";
import { HeatmapGenerator } from "@/lib/heatmap";
import { useLang } from "@/contexts/LangContext";
import HeatmapCanvas from "./HeatmapCanvas";
import type { ResultPerImage } from "@/types/results";

interface ResultsPanelProps {
  resultsPerImage?: ResultPerImage[];
  metrics?: FixationMetrics;
  gazePoints?: GazePoint[];
  calibrationError: number;
  imageUrl?: string;
  imageDimensions?: { width: number; height: number };
  onExportJSON: () => void;
  onExportHeatmap: () => void;
  onReset?: () => void;
  onRecalibrate: () => void;
}

export default function ResultsPanel({
  resultsPerImage,
  metrics: metricsProp,
  gazePoints: gazePointsProp,
  calibrationError,
  imageUrl: imageUrlProp,
  imageDimensions: imageDimensionsProp,
  onExportJSON,
  onExportHeatmap,
  onReset,
  onRecalibrate,
}: ResultsPanelProps) {
  const isMulti = Boolean(resultsPerImage && resultsPerImage.length > 0);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"overview" | "fixations" | "clusters" | "heatmap">("overview");
  const [hasStored, setHasStored] = useState(false);
  const [exportingHeatmapIndex, setExportingHeatmapIndex] = useState<number | null>(null);
  const { t } = useLang();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapGeneratorRef = useRef<HeatmapGenerator>(new HeatmapGenerator());

  const metrics = isMulti ? (resultsPerImage![selectedPhotoIndex]?.metrics ?? null) : (metricsProp ?? null);
  const gazePoints = isMulti ? (resultsPerImage![selectedPhotoIndex]?.gazePoints ?? []) : (gazePointsProp ?? []);
  const imageUrl = isMulti ? resultsPerImage![selectedPhotoIndex]?.imageUrl : imageUrlProp;
  const imageDimensions = isMulti ? resultsPerImage![selectedPhotoIndex]?.imageDimensions : imageDimensionsProp;

  useEffect(() => {
    setHasStored(hasStoredCalibration());
  }, []);

  // Fixation haritası çiz
  useEffect(() => {
    if (!canvasRef.current || activeTab !== "fixations" || !metrics || !imageDimensions) return;

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

    const sortedFixations = [...metrics.allFixations].sort(
      (a, b) => a.startTime - b.startTime
    );

    // Scanpath: fixation'lar arası oklar (sıra 1→2→3...)
    for (let i = 0; i < sortedFixations.length - 1; i++) {
      const from = sortedFixations[i];
      const to = sortedFixations[i + 1];
      ctx.strokeStyle = "rgba(255, 200, 100, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const arrowLen = 10;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - ux * arrowLen - uy * 5, to.y - uy * arrowLen + ux * 5);
      ctx.lineTo(to.x - ux * arrowLen + uy * 5, to.y - uy * arrowLen - ux * 5);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 200, 100, 0.8)";
      ctx.fill();
      ctx.stroke();
    }

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
    if (!clusterCanvasRef.current || activeTab !== "clusters" || !imageDimensions || !metrics) return;

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

  const selectedFixations = isMulti && metrics ? metrics.allFixations : (metrics?.allFixations ?? []);
  const hasHeatmapData = gazePoints.length > 0 || selectedFixations.length > 0;

  const handleExportHeatmapForPhoto = (index: number) => {
    if (!resultsPerImage?.[index]) return;
    const result = resultsPerImage[index];
    const w = result.imageDimensions?.width ?? 0;
    const h = result.imageDimensions?.height ?? 0;
    if (w <= 0 || h <= 0) return;
    setExportingHeatmapIndex(index);
    const img = new Image();
    img.onload = () => {
      // Görüntü boyutlarını doğrula
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        setExportingHeatmapIndex(null);
        return;
      }
      const dataUrl = heatmapGeneratorRef.current.exportToPNG(
        result.gazePoints,
        result.fixations,
        img,
        w,
        h
      );
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `heatmap-foto-${index + 1}.png`;
      a.click();
      setExportingHeatmapIndex(null);
    };
    img.onerror = () => setExportingHeatmapIndex(null);
    img.src = result.imageUrl;
  };

  if (!imageUrl || !imageDimensions) {
    return (
      <div className="p-4 text-gray-400">{t.resultsLoading}</div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Sol: Görüntü + Overlay */}
      <div className="flex-1">
        {isMulti && (
          <div className="flex flex-wrap gap-2 mb-4">
            {resultsPerImage!.map((_, i) => (
              <button
                key={i}
                onClick={() => setSelectedPhotoIndex(i)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950 ${
                  selectedPhotoIndex === i
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300"
                }`}
              >
                <span className="w-5 h-5 rounded bg-black/30 flex items-center justify-center text-xs">{i + 1}</span>
                {t.photoLabel} {i + 1}
              </button>
            ))}
          </div>
        )}
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
            !hasHeatmapData ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-lg">
                <p className="text-gray-400 text-sm">Heatmap için bakış verisi yok.</p>
              </div>
            ) : (
              <HeatmapCanvas
                gazePoints={gazePoints}
                fixations={selectedFixations}
                width={imageDimensions.width}
                height={imageDimensions.height}
                opacity={0.65}
              />
            )
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
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h2 className="text-xl font-bold text-white mb-1">📊 Analiz Sonuçları</h2>
          {isMulti && resultsPerImage && <p className="text-blue-300 text-sm mb-1">Foto {selectedPhotoIndex + 1} / {resultsPerImage.length}</p>}
          <p className="text-gray-500 text-sm">
            Kalibrasyon hatası: {Math.round(calibrationError)} px
          </p>
        </div>

        {!metrics ? (
          <div className="bg-gray-800 rounded-xl p-4 text-gray-500 text-sm">
            {t.noDataForPhoto}
          </div>
        ) : (
          <>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="İlk Bakış Süresi"
            value={metrics.fixationCount > 0 ? formatMs(metrics.timeToFirstFixation) : "—"}
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
            value={metrics.fixationCount > 0 ? formatMs(metrics.averageFixationDuration) : "—"}
            icon="📏"
          />
        </div>

        {metrics.fixationCount === 0 && (
          <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-3 text-amber-200 text-sm">
            Takip süresi kısa veya fixation tespit edilemedi. Daha uzun süre takip edip tekrar deneyin.
          </div>
        )}

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
            {metrics.firstThreeFixations.length === 0 ? (
              <p className="text-gray-500 text-sm py-2">Henüz fixation yok.</p>
            ) : (
              metrics.firstThreeFixations.map((fix, i) => (
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
              ))
            )}
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
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            🎯 İlgi Alanları (ROI)
          </h3>
          {metrics.roiClusters.length === 0 ? (
            <p className="text-gray-500 text-sm py-2">
              {metrics.fixationCount > 0
                ? "Yeterli fixation yok veya ROI kümesi oluşmadı."
                : "Fixation olmadığı için ROI hesaplanamadı."}
            </p>
          ) : (
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
          )}
        </div>
          </>
        )}

        {/* Aksiyon butonları */}
        <div className="flex flex-col gap-2">
          {!isMulti && (
            <>
          <button
            onClick={onExportJSON}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition"
            aria-label="JSON dışa aktar"
          >
            📥 JSON Dışa Aktar
          </button>
          <button
            onClick={onExportHeatmap}
            className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 transition"
            aria-label="Heatmap PNG indir"
          >
            🖼️ Heatmap PNG İndir
          </button>
            </>
          )}
          {isMulti && (
            <>
            <button
              onClick={onExportJSON}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-gray-950"
              aria-label="JSON dışa aktar (tüm fotoğraflar)"
            >
              📥 JSON Dışa Aktar (tüm fotoğraflar)
            </button>
            <button
              onClick={() => handleExportHeatmapForPhoto(selectedPhotoIndex)}
              disabled={exportingHeatmapIndex !== null}
              className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-500 disabled:opacity-70 disabled:cursor-wait transition focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-gray-950"
              aria-label="Seçili foto heatmap indir"
            >
              {exportingHeatmapIndex === selectedPhotoIndex ? `⏳ ${t.exporting}` : `🖼️ ${t.heatmapDownload.replace("{n}", String(selectedPhotoIndex + 1))}`}
            </button>
            <button
              onClick={() => {
                resultsPerImage!.forEach((_, i) => {
                  setTimeout(() => handleExportHeatmapForPhoto(i), i * 500);
                });
              }}
              disabled={exportingHeatmapIndex !== null}
              className="w-full px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 disabled:opacity-50 transition text-sm focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950"
              aria-label={t.heatmapDownloadAll.replace("{n}", String(resultsPerImage?.length ?? 0))}
            >
              📥 {t.heatmapDownloadAll.replace("{n}", String(resultsPerImage?.length ?? 0))}
            </button>
            </>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                onClick={onRecalibrate}
                className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition text-sm"
                aria-label="Tekrar kalibre et"
              >
                🔄 Tekrar Kalibre Et
              </button>
              {onReset && (
                <button
                  onClick={onReset}
                  className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition text-sm"
                  aria-label="Yeni görüntü"
                >
                  🆕 Yeni Görüntü
                </button>
              )}
            </div>
            {hasStored && (
              <button
                type="button"
                onClick={() => {
                  clearCalibration();
                  setHasStored(false);
                }}
                className="text-gray-500 hover:text-gray-400 text-xs"
              >
                {t.clearStoredCalibration}
              </button>
            )}
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
