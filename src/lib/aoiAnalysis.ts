/**
 * AOI (Area of Interest) Analiz Modülü
 *
 * Tanımlanan dikdörtgen bölgeler üzerinde bakış analizi:
 * - Dwell time (toplam bakış süresi)
 * - Entry count (bölgeye giriş sayısı)
 * - First fixation time (ilk bakış zamanı)
 * - AOI-to-AOI geçiş matrisi
 */

import type { GazePoint } from "./gazeModel";
import type { Fixation } from "./fixation";

export interface AOIRegion {
  id: string;
  name: string;
  x: number;      // Sol üst köşe x
  y: number;      // Sol üst köşe y
  width: number;
  height: number;
}

export interface AOIResult {
  regionId: string;
  regionName: string;
  dwellTimeMs: number;       // Toplam bakış süresi
  dwellTimePercent: number;  // Toplam süreye oranı (%)
  entryCount: number;        // Bölgeye giriş sayısı
  firstFixationTimeMs: number; // İlk fixation'ın zamanı (tracking başlangıcından)
  firstFixationId: number;   // İlk fixation'ın sıra numarası
  fixationCount: number;     // Bölgedeki fixation sayısı
  avgFixationDurationMs: number; // Ortalama fixation süresi
  gazePointCount: number;    // Bölgedeki gaze point sayısı
}

export interface TransitionMatrix {
  regionIds: string[];
  matrix: number[][]; // matrix[from][to] = geçiş sayısı
}

export class AOIAnalyzer {
  private regions: AOIRegion[] = [];

  /** Yeni AOI bölgesi ekle */
  addRegion(region: AOIRegion): void {
    // Aynı id ile bölge varsa güncelle
    const idx = this.regions.findIndex((r) => r.id === region.id);
    if (idx >= 0) {
      this.regions[idx] = region;
    } else {
      this.regions.push(region);
    }
  }

  /** Bölge sil */
  removeRegion(id: string): void {
    this.regions = this.regions.filter((r) => r.id !== id);
  }

  /** Tüm bölgeleri temizle */
  clearRegions(): void {
    this.regions = [];
  }

  /** Kayıtlı bölgeleri döner */
  getRegions(): AOIRegion[] {
    return [...this.regions];
  }

  /** Bir noktanın hangi bölgede olduğunu bul (ilk eşleşen) */
  private findRegion(x: number, y: number): AOIRegion | null {
    for (const r of this.regions) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return r;
      }
    }
    return null;
  }

  /**
   * Fixation ve gaze point verileriyle AOI analizi yap.
   * @returns Her bölge için analiz sonuçları
   */
  analyze(
    fixations: Fixation[],
    gazePoints: GazePoint[],
    trackingStartTime?: number
  ): AOIResult[] {
    if (this.regions.length === 0) return [];

    const startTime = trackingStartTime ?? (gazePoints.length > 0 ? gazePoints[0].timestamp : 0);
    const totalDuration = gazePoints.length >= 2
      ? gazePoints[gazePoints.length - 1].timestamp - gazePoints[0].timestamp
      : 1;

    const results: AOIResult[] = [];

    for (const region of this.regions) {
      // Fixation analizi
      let dwellTime = 0;
      let firstFixTime = Infinity;
      let firstFixId = -1;
      let fixCount = 0;
      let totalFixDuration = 0;

      for (let i = 0; i < fixations.length; i++) {
        const f = fixations[i];
        if (this.isInRegion(f.x, f.y, region)) {
          fixCount++;
          dwellTime += f.duration;
          totalFixDuration += f.duration;
          const fixTime = f.startTime - startTime;
          if (fixTime < firstFixTime) {
            firstFixTime = fixTime;
            firstFixId = i;
          }
        }
      }

      // Gaze point sayısı
      let gazeCount = 0;
      for (const p of gazePoints) {
        if (this.isInRegion(p.x, p.y, region)) {
          gazeCount++;
        }
      }

      // Entry count: bölge dışından bölge içine geçiş sayısı
      let entryCount = 0;
      let wasInRegion = false;
      for (const p of gazePoints) {
        const isIn = this.isInRegion(p.x, p.y, region);
        if (isIn && !wasInRegion) {
          entryCount++;
        }
        wasInRegion = isIn;
      }

      results.push({
        regionId: region.id,
        regionName: region.name,
        dwellTimeMs: dwellTime,
        dwellTimePercent: totalDuration > 0 ? (dwellTime / totalDuration) * 100 : 0,
        entryCount,
        firstFixationTimeMs: firstFixTime === Infinity ? -1 : firstFixTime,
        firstFixationId: firstFixId,
        fixationCount: fixCount,
        avgFixationDurationMs: fixCount > 0 ? totalFixDuration / fixCount : 0,
        gazePointCount: gazeCount,
      });
    }

    return results;
  }

  /**
   * AOI-to-AOI geçiş matrisi hesapla.
   * Ardışık fixation'ların hangi bölgelerde olduğuna bakarak geçişleri sayar.
   */
  getTransitionMatrix(fixations: Fixation[]): TransitionMatrix {
    const regionIds = this.regions.map((r) => r.id);
    const n = regionIds.length;
    const idxMap = new Map<string, number>();
    regionIds.forEach((id, i) => idxMap.set(id, i));

    // n×n sıfır matrisi
    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    let prevRegionIdx = -1;
    for (const f of fixations) {
      const region = this.findRegion(f.x, f.y);
      if (!region) {
        prevRegionIdx = -1;
        continue;
      }

      const currentIdx = idxMap.get(region.id);
      if (currentIdx === undefined) {
        prevRegionIdx = -1;
        continue;
      }

      if (prevRegionIdx >= 0 && prevRegionIdx !== currentIdx) {
        matrix[prevRegionIdx][currentIdx]++;
      }
      prevRegionIdx = currentIdx;
    }

    return { regionIds, matrix };
  }

  private isInRegion(x: number, y: number, region: AOIRegion): boolean {
    return x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height;
  }
}
