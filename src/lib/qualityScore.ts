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
  fixations: { x: number; y: number; startTime: number; endTime: number; duration: number }[],
  photoIndex?: number
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
