import type { GazePoint } from "@/lib/gazeModel";
import type { Fixation, Saccade, FixationMetrics } from "@/lib/fixation";
import type { BlinkEvent, BlinkMetrics } from "@/lib/blinkDetector";
import type { ScanpathMetrics } from "@/lib/scanpath";
import type { AttentionMetrics } from "@/lib/attentionAnalysis";
import type { AOIResult, TransitionMatrix } from "@/lib/aoiAnalysis";
import type { BenchmarkResult } from "@/lib/benchmark";

export interface ResultPerImage {
  imageUrl: string;
  gazePoints: GazePoint[];
  fixations: Fixation[];
  saccades?: Saccade[];
  metrics: FixationMetrics | null;
  imageDimensions: { width: number; height: number };
  blinkEvents?: BlinkEvent[];
  blinkMetrics?: BlinkMetrics;
  scanpathMetrics?: ScanpathMetrics;
  attentionMetrics?: AttentionMetrics;
  aoiResults?: AOIResult[];
  aoiTransitionMatrix?: TransitionMatrix;
}

export interface SessionResult {
  resultsPerImage: ResultPerImage[];
  benchmarkResult?: BenchmarkResult;
  calibrationErrorPx: number;
  sessionDate: string;
  screenWidth: number;
  screenHeight: number;
}
