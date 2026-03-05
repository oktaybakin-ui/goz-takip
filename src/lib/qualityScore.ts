import type { GazePoint } from "./gazeModel";

export interface QualityMetrics {
  gazeOnScreenPercent: number;
  samplingRateHz: number;
  dataIntegrityPercent: number;
  overallScore: number;
  grade: "A" | "B" | "C" | "D";
  gradeLabel: string;
  gradeColor: string;
}

export function computeQualityMetrics(
  gazePoints: GazePoint[],
  imageDimensions: { width: number; height: number },
  expectedDurationMs: number
): QualityMetrics {
  if (gazePoints.length < 2) {
    return {
      gazeOnScreenPercent: 0,
      samplingRateHz: 0,
      dataIntegrityPercent: 0,
      overallScore: 0,
      grade: "D",
      gradeLabel: "Yetersiz",
      gradeColor: "text-red-400",
    };
  }

  const w = imageDimensions.width;
  const h = imageDimensions.height;
  const margin = 0.05;

  let onScreenCount = 0;
  for (const p of gazePoints) {
    if (
      p.x >= -w * margin &&
      p.x <= w * (1 + margin) &&
      p.y >= -h * margin &&
      p.y <= h * (1 + margin)
    ) {
      onScreenCount++;
    }
  }
  const gazeOnScreenPercent = (onScreenCount / gazePoints.length) * 100;

  const firstTs = gazePoints[0].timestamp;
  const lastTs = gazePoints[gazePoints.length - 1].timestamp;
  const durationSec = (lastTs - firstTs) / 1000;
  const samplingRateHz = durationSec > 0 ? gazePoints.length / durationSec : 0;

  let validCount = 0;
  for (const p of gazePoints) {
    if (p.confidence > 0.4) validCount++;
  }
  const dataIntegrityPercent = (validCount / gazePoints.length) * 100;

  const actualDuration = lastTs - firstTs;
  const durationRatio = expectedDurationMs > 0
    ? Math.min(1, actualDuration / expectedDurationMs)
    : 1;

  const screenScore = Math.min(100, gazeOnScreenPercent);
  const rateScore = Math.min(100, (samplingRateHz / 25) * 100);
  const integrityScore = Math.min(100, dataIntegrityPercent);
  const durationScore = durationRatio * 100;

  const overallScore = Math.round(
    screenScore * 0.35 +
    rateScore * 0.20 +
    integrityScore * 0.30 +
    durationScore * 0.15
  );

  let grade: QualityMetrics["grade"];
  let gradeLabel: string;
  let gradeColor: string;

  if (overallScore >= 80) {
    grade = "A";
    gradeLabel = "Mükemmel";
    gradeColor = "text-green-400";
  } else if (overallScore >= 60) {
    grade = "B";
    gradeLabel = "İyi";
    gradeColor = "text-blue-400";
  } else if (overallScore >= 40) {
    grade = "C";
    gradeLabel = "Orta";
    gradeColor = "text-yellow-400";
  } else {
    grade = "D";
    gradeLabel = "Düşük";
    gradeColor = "text-red-400";
  }

  return {
    gazeOnScreenPercent: Math.round(gazeOnScreenPercent * 10) / 10,
    samplingRateHz: Math.round(samplingRateHz * 10) / 10,
    dataIntegrityPercent: Math.round(dataIntegrityPercent * 10) / 10,
    overallScore,
    grade,
    gradeLabel,
    gradeColor,
  };
}

export function exportCSV(
  gazePoints: GazePoint[],
  fixations: { x: number; y: number; startTime: number; endTime: number; duration: number }[]
): string {
  const lines: string[] = [];

  lines.push("## GAZE POINTS");
  lines.push("timestamp_ms,x,y,confidence");
  for (const p of gazePoints) {
    lines.push(`${Math.round(p.timestamp)},${Math.round(p.x)},${Math.round(p.y)},${p.confidence.toFixed(2)}`);
  }

  lines.push("");
  lines.push("## FIXATIONS");
  lines.push("fixation_id,x,y,start_ms,end_ms,duration_ms");
  fixations.forEach((f, i) => {
    lines.push(`${i + 1},${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.startTime)},${Math.round(f.endTime)},${Math.round(f.duration)}`);
  });

  return lines.join("\n");
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Gelişmiş Export Fonksiyonları ───────────────────────────────────────────

export interface SessionMetadata {
  date: string;
  calibrationErrorPx: number;
  screenWidth: number;
  screenHeight: number;
  cameraResolution?: string;
  samplingRateHz: number;
  durationMs: number;
}

export interface ExportFixation {
  x: number;
  y: number;
  startTime: number;
  endTime: number;
  duration: number;
  pointCount?: number;
  avgConfidence?: number;
}

export interface ExportSaccade {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  endTime: number;
  velocity: number;
  amplitude?: number;
  peakVelocity?: number;
  direction?: number;
}

export interface ExportBlink {
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Tobii-uyumlu TSV export.
 * Sütunlar: timestamp, x, y, confidence, event_type, fixation_id, duration
 */
export function exportTSV(
  gazePoints: GazePoint[],
  fixations: ExportFixation[],
  saccades: ExportSaccade[] = [],
  blinks: ExportBlink[] = []
): string {
  const lines: string[] = [];
  lines.push("timestamp\tx\ty\tconfidence\tevent_type\tfixation_id\tduration");

  // Build event lookup maps for efficient tagging
  const fixationMap = new Map<number, { id: number; type: string; duration: number }>();
  fixations.forEach((f, i) => {
    // Tag gaze points within each fixation's time range
    for (const p of gazePoints) {
      if (p.timestamp >= f.startTime && p.timestamp <= f.endTime) {
        fixationMap.set(Math.round(p.timestamp), { id: i + 1, type: "fixation", duration: f.duration });
      }
    }
  });

  const blinkTimes = new Set<number>();
  for (const b of blinks) {
    for (const p of gazePoints) {
      if (p.timestamp >= b.startTime && p.timestamp <= b.endTime) {
        blinkTimes.add(Math.round(p.timestamp));
      }
    }
  }

  const saccadeTimes = new Set<number>();
  for (const s of saccades) {
    for (const p of gazePoints) {
      if (p.timestamp >= s.startTime && p.timestamp <= s.endTime) {
        saccadeTimes.add(Math.round(p.timestamp));
      }
    }
  }

  for (const p of gazePoints) {
    const ts = Math.round(p.timestamp);
    const fixInfo = fixationMap.get(ts);
    let eventType = "unclassified";
    let fixId = "";
    let duration = "";

    if (blinkTimes.has(ts)) {
      eventType = "blink";
    } else if (fixInfo) {
      eventType = "fixation";
      fixId = String(fixInfo.id);
      duration = String(Math.round(fixInfo.duration));
    } else if (saccadeTimes.has(ts)) {
      eventType = "saccade";
    }

    lines.push(`${ts}\t${Math.round(p.x)}\t${Math.round(p.y)}\t${p.confidence.toFixed(2)}\t${eventType}\t${fixId}\t${duration}`);
  }

  return lines.join("\n");
}

/**
 * Zengin JSON export — session metadata, fixation/saccade/blink listeleri, quality metrics.
 */
export function exportResearchJSON(
  gazePoints: GazePoint[],
  fixations: ExportFixation[],
  saccades: ExportSaccade[] = [],
  blinks: ExportBlink[] = [],
  metadata: SessionMetadata,
  qualityMetrics?: QualityMetrics
): string {
  return JSON.stringify({
    session: {
      date: metadata.date,
      calibration_error_px: metadata.calibrationErrorPx,
      screen: {
        width: metadata.screenWidth,
        height: metadata.screenHeight,
      },
      camera_resolution: metadata.cameraResolution || "unknown",
      sampling_rate_hz: metadata.samplingRateHz,
      duration_ms: metadata.durationMs,
    },
    quality: qualityMetrics ? {
      overall_score: qualityMetrics.overallScore,
      grade: qualityMetrics.grade,
      gaze_on_screen_pct: qualityMetrics.gazeOnScreenPercent,
      sampling_rate_hz: qualityMetrics.samplingRateHz,
      data_integrity_pct: qualityMetrics.dataIntegrityPercent,
    } : null,
    data: {
      gaze_points: gazePoints.map((p) => ({
        t: Math.round(p.timestamp),
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        c: Math.round(p.confidence * 100) / 100,
      })),
      fixations: fixations.map((f, i) => ({
        id: i + 1,
        x: Math.round(f.x),
        y: Math.round(f.y),
        start_ms: Math.round(f.startTime),
        end_ms: Math.round(f.endTime),
        duration_ms: Math.round(f.duration),
        point_count: f.pointCount ?? 0,
        avg_confidence: f.avgConfidence ? Math.round(f.avgConfidence * 100) / 100 : 0,
      })),
      saccades: saccades.map((s) => ({
        start: { x: Math.round(s.startX), y: Math.round(s.startY) },
        end: { x: Math.round(s.endX), y: Math.round(s.endY) },
        start_ms: Math.round(s.startTime),
        end_ms: Math.round(s.endTime),
        velocity: Math.round(s.velocity),
        amplitude: s.amplitude ? Math.round(s.amplitude) : undefined,
        peak_velocity: s.peakVelocity ? Math.round(s.peakVelocity) : undefined,
        direction_rad: s.direction ? Math.round(s.direction * 1000) / 1000 : undefined,
      })),
      blinks: blinks.map((b) => ({
        start_ms: Math.round(b.startTime),
        end_ms: Math.round(b.endTime),
        duration_ms: Math.round(b.duration),
      })),
    },
    counts: {
      gaze_points: gazePoints.length,
      fixations: fixations.length,
      saccades: saccades.length,
      blinks: blinks.length,
    },
  }, null, 2);
}

/** TSV dosyası indir */
export function downloadTSV(content: string, filename: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/tab-separated-values;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
