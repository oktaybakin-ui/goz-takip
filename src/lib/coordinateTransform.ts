/**
 * Koordinat dönüşüm yardımcıları.
 * object-contain layout ile ekran/görüntü koordinat eşlemesi.
 */

/** object-contain ile görüntü içeriğinin ekrandaki dikdörtgeni (letterbox/pillarbox). */
export function getContentRect(
  imageRect: DOMRect,
  displayWidth: number,
  displayHeight: number,
  naturalWidth?: number,
  naturalHeight?: number
): { contentLeft: number; contentTop: number; contentW: number; contentH: number } | null {
  if (imageRect.width === 0 || imageRect.height === 0) return null;
  const nw = naturalWidth ?? displayWidth;
  const nh = naturalHeight ?? displayHeight;
  const scale = Math.min(imageRect.width / nw, imageRect.height / nh);
  const contentW = nw * scale;
  const contentH = nh * scale;
  const offsetX = (imageRect.width - contentW) / 2;
  const offsetY = (imageRect.height - contentH) / 2;
  return {
    contentLeft: imageRect.left + offsetX,
    contentTop: imageRect.top + offsetY,
    contentW,
    contentH,
  };
}

/**
 * Ekran koordinatlarını görüntü (canvas) koordinatlarına dönüştür.
 *
 * object-contain kullanıldığında görüntü container içinde letterbox/pillarbox
 * olabilir. Gerçek içerik dikdörtgeni (content rect) hesaplanarak hassas eşleme yapılır.
 */
export function screenToImageCoords(
  screenX: number,
  screenY: number,
  imageRect: DOMRect,
  displayWidth: number,
  displayHeight: number,
  naturalWidth?: number,
  naturalHeight?: number
): { x: number; y: number } | null {
  const content = getContentRect(imageRect, displayWidth, displayHeight, naturalWidth, naturalHeight);
  if (!content) return null;
  const { contentLeft, contentTop, contentW, contentH } = content;

  const relX = (screenX - contentLeft) / contentW;
  const relY = (screenY - contentTop) / contentH;

  const rawX = relX * displayWidth;
  const rawY = relY * displayHeight;

  const tolX = displayWidth * 0.5;
  const tolY = displayHeight * 0.5;
  if (rawX < -tolX || rawX > displayWidth + tolX || rawY < -tolY || rawY > displayHeight + tolY) {
    return null;
  }

  const x = Math.max(0, Math.min(displayWidth, rawX));
  const y = Math.max(0, Math.min(displayHeight, rawY));
  return { x, y };
}

/**
 * Export için Savitzky-Golay benzeri yumuşatma: 5 noktalı pencere.
 * Ağırlıklar: [-3, 12, 17, 12, -3] / 35 (SG 2. derece, 5 nokta katsayıları)
 */
export function smoothGazePointsForExport<T extends { x: number; y: number; timestamp: number; confidence: number }>(
  points: T[]
): { x: number; y: number; timestamp_ms: number; confidence: number; dt_ms: number }[] {
  if (points.length === 0) return [];
  const sgWeights = [-3, 12, 17, 12, -3];
  const sgSum = 35;
  const halfWin = 2;
  return points.map((p, i) => {
    let x = p.x;
    let y = p.y;
    if (i >= halfWin && i < points.length - halfWin) {
      let sx = 0, sy = 0;
      for (let k = -halfWin; k <= halfWin; k++) {
        const w = sgWeights[k + halfWin];
        sx += points[i + k].x * w;
        sy += points[i + k].y * w;
      }
      x = sx / sgSum;
      y = sy / sgSum;
    }
    const dt_ms = i === 0 ? 0 : Math.round(p.timestamp - points[i - 1].timestamp);
    return {
      x: Math.round(x),
      y: Math.round(y),
      timestamp_ms: Math.round(p.timestamp),
      confidence: Math.round(p.confidence * 100) / 100,
      dt_ms,
    };
  });
}
