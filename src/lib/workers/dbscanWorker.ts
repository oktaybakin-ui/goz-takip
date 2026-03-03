/**
 * DBSCAN Clustering Web Worker
 *
 * Fiksasyon verilerinde ROI kümeleme yapar.
 * O(n^2) pairwise distance hesabı ana thread'den ayrılır.
 */

export interface FixationInput {
  x: number;
  y: number;
  startTime: number;
  endTime: number;
  duration: number;
  pointCount: number;
  avgConfidence: number;
}

export interface ClusterOutput {
  id: number;
  centerX: number;
  centerY: number;
  totalDuration: number;
  fixationCount: number;
  radius: number;
  pointIndices: number[];
}

export interface DBSCANWorkerInput {
  type: "cluster";
  fixations: FixationInput[];
  eps: number;
  minPts: number;
}

export interface DBSCANWorkerOutput {
  type: "clustered";
  clusters: ClusterOutput[];
}

export function dbscanWorkerFn() {
  function getNeighbors(
    fixations: FixationInput[],
    index: number,
    eps: number
  ): number[] {
    const fix = fixations[index];
    const neighbors: number[] = [];
    for (let j = 0; j < fixations.length; j++) {
      if (j === index) continue;
      const other = fixations[j];
      const dist = Math.sqrt(
        (fix.x - other.x) ** 2 + (fix.y - other.y) ** 2
      );
      if (dist <= eps) neighbors.push(j);
    }
    return neighbors;
  }

  function expandCluster(
    fixations: FixationInput[],
    pointIndex: number,
    neighbors: number[],
    visited: Set<number>,
    clustered: Set<number>,
    eps: number,
    minPts: number
  ): number[] {
    const cluster = [pointIndex];
    clustered.add(pointIndex);
    const queue = [...neighbors];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (!visited.has(current)) {
        visited.add(current);
        const currentNeighbors = getNeighbors(fixations, current, eps);
        if (currentNeighbors.length >= minPts) {
          queue.push(...currentNeighbors.filter((n) => !visited.has(n)));
        }
      }
      if (!clustered.has(current)) {
        cluster.push(current);
        clustered.add(current);
      }
    }
    return cluster;
  }

  self.onmessage = (e: MessageEvent) => {
    const msg = e.data as DBSCANWorkerInput;
    if (msg.type !== "cluster") return;

    const { fixations, eps, minPts } = msg;

    if (fixations.length === 0) {
      (self as any).postMessage({ type: "clustered", clusters: [] });
      return;
    }

    const visited = new Set<number>();
    const clustered = new Set<number>();
    const clusters: ClusterOutput[] = [];

    for (let i = 0; i < fixations.length; i++) {
      if (visited.has(i)) continue;
      visited.add(i);

      const neighbors = getNeighbors(fixations, i, eps);
      if (neighbors.length >= minPts) {
        const clusterIndices = expandCluster(
          fixations,
          i,
          neighbors,
          visited,
          clustered,
          eps,
          minPts
        );

        if (clusterIndices.length > 0) {
          const cFixations = clusterIndices.map((idx) => fixations[idx]);
          const centerX =
            cFixations.reduce((s, f) => s + f.x, 0) / cFixations.length;
          const centerY =
            cFixations.reduce((s, f) => s + f.y, 0) / cFixations.length;

          let maxRadius = 0;
          for (const f of cFixations) {
            const dist = Math.sqrt(
              (f.x - centerX) ** 2 + (f.y - centerY) ** 2
            );
            maxRadius = Math.max(maxRadius, dist);
          }

          clusters.push({
            id: clusters.length,
            centerX,
            centerY,
            totalDuration: cFixations.reduce((s, f) => s + f.duration, 0),
            fixationCount: cFixations.length,
            radius: maxRadius + eps / 2,
            pointIndices: clusterIndices,
          });
        }
      }
    }

    clusters.sort((a, b) => b.totalDuration - a.totalDuration);

    (self as any).postMessage({ type: "clustered", clusters });
  };
}
