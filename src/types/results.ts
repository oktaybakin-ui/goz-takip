import type { GazePoint } from "@/lib/gazeModel";
import type { Fixation, FixationMetrics } from "@/lib/fixation";

export interface ResultPerImage {
  imageUrl: string;
  gazePoints: GazePoint[];
  fixations: Fixation[];
  metrics: FixationMetrics | null;
  imageDimensions: { width: number; height: number };
}
