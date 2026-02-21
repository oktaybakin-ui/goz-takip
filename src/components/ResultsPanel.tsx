"use client";

import React, { useRef, useEffect, useState, useMemo } from "react";
import { FixationMetrics, Fixation } from "@/lib/fixation";
import { GazePoint } from "@/lib/gazeModel";
import { clearCalibration, hasStoredCalibration } from "@/lib/calibrationStorage";
import { HeatmapGenerator } from "@/lib/heatmap";
import { computeQualityMetrics, QualityMetrics, exportCSV, downloadCSV } from "@/lib/qualityScore";
import { useLang } from "@/contexts/LangContext";
import HeatmapCanvas from "./HeatmapCanvas";
import GazeReplay from "./GazeReplay";
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

const IMAGE_DURATION_MS = 20_000;

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
  const [activeTab, setActiveTab] = useState<"heatmap" | "fixations" | "replay" | "clusters">("heatmap");
  const [hasStored, setHasStored] = useState(false);
  const [exportingHeatmapIndex, setExportingHeatmapIndex] = useState<number | null>(null);
  const { t } = useLang();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heatmapGeneratorRef = useRef<HeatmapGenerator>(new HeatmapGenerator());

  const metrics = isMulti ? (resultsPerImage![selectedPhotoIndex]?.metrics ?? null) : (metricsProp ?? null);
  const gazePoints = isMulti ? (resultsPerImage![selectedPhotoIndex]?.gazePoints ?? []) : (gazePointsProp ?? []);
  const imageUrl = isMulti ? resultsPerImage![selectedPhotoIndex]?.imageUrl : imageUrlProp;
  const imageDimensions = isMulti ? resultsPerImage![selectedPhotoIndex]?.imageDimensions : imageDimensionsProp;

  const quality = useMemo<QualityMetrics | null>(() => {
    if (!imageDimensions || gazePoints.length < 2) return null;
    return computeQualityMetrics(gazePoints, imageDimensions, IMAGE_DURATION_MS);
  }, [gazePoints, imageDimensions]);

  useEffect(() => {
    setHasStored(hasStoredCalibration());
  }, []);

  useEffect(() => {
    if (!canvasRef.current || activeTab !== "fixations" || !metrics || !imageDimensions) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sortedFixations = [...metrics.allFixations].sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < sortedFixations.length - 1; i++) {
      const from = sortedFixations[i];
      const to = sortedFixations[i + 1];
      ctx.strokeStyle = "rgba(255, 200, 100, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - ux * 8 - uy * 4, to.y - uy * 8 + ux * 4);
      ctx.lineTo(to.x - ux * 8 + uy * 4, to.y - uy * 8 - ux * 4);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 200, 100, 0.7)";
      ctx.fill();
    }

    sortedFixations.forEach((fix, i) => {
      const radius = Math.min(22, Math.max(7, fix.duration / 45));

      ctx.beginPath();
      ctx.arc(fix.x, fix.y, radius, 0, Math.PI * 2);

      if (i === 0) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.4)";
        ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      } else if (i < 3) {
        ctx.fillStyle = "rgba(251, 146, 60, 0.4)";
        ctx.strokeStyle = "rgba(251, 146, 60, 0.9)";
      } else {
        ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
        ctx.strokeStyle = "rgba(59, 130, 246, 0.7)";
      }

      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = "bold 10px system-ui";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${i + 1}`, fix.x, fix.y);
    });
  }, [metrics, activeTab, imageDimensions]);

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
      "rgba(239, 68, 68, 0.25)",
      "rgba(34, 197, 94, 0.25)",
      "rgba(59, 130, 246, 0.25)",
      "rgba(250, 204, 21, 0.25)",
      "rgba(168, 85, 247, 0.25)",
    ];

    metrics.roiClusters.forEach((cluster, i) => {
      const color = colors[i % colors.length];
      const borderColor = color.replace("0.25", "0.7");

      ctx.beginPath();
      ctx.arc(cluster.centerX, cluster.centerY, cluster.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "bold 11px system-ui";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.fillText(`ROI ${cluster.id + 1}`, cluster.centerX, cluster.centerY - cluster.radius - 6);
    });
  }, [metrics, activeTab, imageDimensions]);

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };

  const selectedFixations = metrics?.allFixations ?? [];
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
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        setExportingHeatmapIndex(null);
        return;
      }
      const dataUrl = heatmapGeneratorRef.current.exportToPNG(
        result.gazePoints, result.fixations, img, w, h
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

  const handleCSVExport = () => {
    if (isMulti && resultsPerImage) {
      resultsPerImage.forEach((r, i) => {
        const csv = exportCSV(r.gazePoints, r.fixations, i);
        downloadCSV(csv, `goz-takip-foto-${i + 1}.csv`);
      });
    } else {
      const csv = exportCSV(gazePoints, metrics?.allFixations ?? []);
      downloadCSV(csv, "goz-takip-veriler.csv");
    }
  };

  if (!imageUrl || !imageDimensions) {
    return <div className="p-4 text-gray-400">{t.resultsLoading}</div>;
  }

  const tabs = [
    { key: "heatmap" as const, label: "Heatmap" },
    { key: "fixations" as const, label: "Fixation Plot" },
    { key: "replay" as const, label: "Gaze Replay" },
    { key: "clusters" as const, label: "ROI" },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto p-4 space-y-6">
      {/* Üst başlık + kalite */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analiz Sonuçları</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isMulti ? `${resultsPerImage!.length} fotoğraf analiz edildi` : "Analiz tamamlandı"}
          </p>
        </div>

        {quality && (
          <div className="flex items-center gap-3 bg-gray-900 rounded-xl px-5 py-3 border border-gray-800">
            <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${
              quality.grade === "A" ? "border-green-500 bg-green-500/10"
              : quality.grade === "B" ? "border-blue-500 bg-blue-500/10"
              : quality.grade === "C" ? "border-yellow-500 bg-yellow-500/10"
              : "border-red-500 bg-red-500/10"
            }`}>
              <span className={`text-2xl font-black ${quality.gradeColor}`}>{quality.grade}</span>
            </div>
            <div>
              <p className={`text-sm font-semibold ${quality.gradeColor}`}>Veri Kalitesi: {quality.gradeLabel}</p>
              <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                <span>Ekranda: %{quality.gazeOnScreenPercent}</span>
                <span>{quality.samplingRateHz} Hz</span>
                <span>Bütünlük: %{quality.dataIntegrityPercent}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Foto seçici */}
      {isMulti && (
        <div className="flex flex-wrap gap-2">
          {resultsPerImage!.map((_, i) => (
            <button
              key={i}
              onClick={() => setSelectedPhotoIndex(i)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                selectedPhotoIndex === i
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              Foto {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Ana içerik: Görsel + Metrikler */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sol: Görüntü + Sekmeler */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Tab seçici */}
          <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  activeTab === tab.key
                    ? "bg-blue-600 text-white shadow"
                    : "text-gray-400 hover:text-gray-300 hover:bg-gray-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Replay sekmesi */}
          {activeTab === "replay" && (
            <GazeReplay
              gazePoints={gazePoints}
              fixations={selectedFixations}
              width={imageDimensions.width}
              height={imageDimensions.height}
              imageUrl={imageUrl}
            />
          )}

          {/* Diğer sekmeler: görsel + overlay */}
          {activeTab !== "replay" && (
            <div
              className="relative rounded-xl overflow-hidden border border-gray-800 bg-black"
              style={{ width: imageDimensions.width, height: imageDimensions.height, maxWidth: "100%" }}
            >
              <img src={imageUrl} alt="Analiz" className="absolute inset-0 w-full h-full object-contain" />

              {activeTab === "fixations" && (
                <canvas ref={canvasRef} className="absolute inset-0 z-10" style={{ width: imageDimensions.width, height: imageDimensions.height }} />
              )}

              {activeTab === "clusters" && (
                <canvas ref={clusterCanvasRef} className="absolute inset-0 z-10" style={{ width: imageDimensions.width, height: imageDimensions.height }} />
              )}

              {activeTab === "heatmap" && (
                !hasHeatmapData ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
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
          )}
        </div>

        {/* Sağ: Metrikler */}
        <div className="w-full lg:w-80 space-y-4">
          {!metrics ? (
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-gray-500 text-sm">
              {t.noDataForPhoto}
            </div>
          ) : (
            <>
              {/* Ana metrikler */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
                <MetricRow label="Fixation Sayısı" value={`${metrics.fixationCount}`} />
                <MetricRow
                  label="İlk Bakış Süresi (TTFF)"
                  value={metrics.fixationCount > 0 ? formatMs(metrics.timeToFirstFixation) : "—"}
                  highlight
                />
                <MetricRow label="Ort. Fixation Süresi" value={metrics.fixationCount > 0 ? formatMs(metrics.averageFixationDuration) : "—"} />
                <MetricRow label="Toplam Fixation Süresi" value={formatMs(metrics.totalFixationDuration)} />
                <MetricRow label="Toplam Görüntüleme" value={formatMs(metrics.totalViewTime)} />
                {metrics.longestFixation && (
                  <MetricRow label="En Uzun Fixation" value={formatMs(metrics.longestFixation.duration)} />
                )}
                <MetricRow label="Saccade Sayısı" value={`${metrics.saccades.length}`} />
                <MetricRow label="ROI Bölgesi" value={`${metrics.roiClusters.length}`} />
              </div>

              {/* İlk 3 fixation */}
              {metrics.firstThreeFixations.length > 0 && (
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">İlk Bakış Sırası</h3>
                  <div className="space-y-2">
                    {metrics.firstThreeFixations.map((fix, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          i === 0 ? "bg-red-500 text-white" : i === 1 ? "bg-orange-500 text-white" : "bg-yellow-500 text-black"
                        }`}>
                          {i + 1}
                        </span>
                        <span className="text-gray-300 text-sm flex-1">
                          ({Math.round(fix.x)}, {Math.round(fix.y)})
                        </span>
                        <span className="text-gray-500 text-xs">{formatMs(fix.duration)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ROI özeti */}
              {metrics.roiClusters.length > 0 && (
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">İlgi Alanları (ROI)</h3>
                  <div className="space-y-1.5">
                    {metrics.roiClusters.slice(0, 5).map((cluster, i) => (
                      <div key={i} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                        <span className="text-gray-300 text-sm">ROI {cluster.id + 1}</span>
                        <div className="text-right">
                          <span className="text-white text-sm font-medium">{formatMs(cluster.totalDuration)}</span>
                          <span className="text-gray-500 text-xs ml-2">{cluster.fixationCount} fix</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Kalibrasyon bilgisi */}
          <div className="bg-gray-900 rounded-xl px-4 py-3 border border-gray-800">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-xs">Kalibrasyon doğruluğu</span>
              <span className={`text-xs font-semibold ${
                calibrationError <= 50 ? "text-green-400" : calibrationError <= 75 ? "text-blue-400" : calibrationError <= 110 ? "text-yellow-400" : "text-red-400"
              }`}>~{Math.round(calibrationError)} px</span>
            </div>
          </div>

          {/* Export butonları */}
          <div className="space-y-2">
            <button
              onClick={handleCSVExport}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-500 transition"
            >
              CSV Dışa Aktar
            </button>
            <button
              onClick={onExportJSON}
              className="w-full px-4 py-2.5 bg-gray-800 text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-700 transition"
            >
              JSON Dışa Aktar
            </button>

            {isMulti ? (
              <>
                <button
                  onClick={() => handleExportHeatmapForPhoto(selectedPhotoIndex)}
                  disabled={exportingHeatmapIndex !== null}
                  className="w-full px-4 py-2.5 bg-gray-800 text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition"
                >
                  {exportingHeatmapIndex === selectedPhotoIndex ? "Dışa aktarılıyor..." : `Heatmap PNG (Foto ${selectedPhotoIndex + 1})`}
                </button>
                <button
                  onClick={() => resultsPerImage!.forEach((_, i) => setTimeout(() => handleExportHeatmapForPhoto(i), i * 500))}
                  disabled={exportingHeatmapIndex !== null}
                  className="w-full px-4 py-2 bg-gray-800 text-gray-400 rounded-xl text-xs hover:bg-gray-700 disabled:opacity-50 transition"
                >
                  Tüm Heatmap&apos;leri İndir ({resultsPerImage?.length})
                </button>
              </>
            ) : (
              <button
                onClick={onExportHeatmap}
                className="w-full px-4 py-2.5 bg-gray-800 text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-700 transition"
              >
                Heatmap PNG İndir
              </button>
            )}
          </div>

          {/* Aksiyon butonları */}
          <div className="flex gap-2">
            <button
              onClick={onRecalibrate}
              className="flex-1 px-3 py-2 bg-gray-800 text-gray-400 rounded-xl text-xs hover:bg-gray-700 transition"
            >
              Tekrar Kalibre Et
            </button>
            {onReset && (
              <button
                onClick={onReset}
                className="flex-1 px-3 py-2 bg-gray-800 text-gray-400 rounded-xl text-xs hover:bg-gray-700 transition"
              >
                Yeni Analiz
              </button>
            )}
          </div>

          {hasStored && (
            <button
              type="button"
              onClick={() => { clearCalibration(); setHasStored(false); }}
              className="text-gray-600 hover:text-gray-500 text-xs transition"
            >
              {t.clearStoredCalibration}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center px-4 py-2.5">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className={`text-sm font-semibold ${highlight ? "text-blue-400" : "text-white"}`}>{value}</span>
    </div>
  );
}
