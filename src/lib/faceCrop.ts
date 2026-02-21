/**
 * Fotoğrafta yüzü algılayıp ölü boşlukları kırpar – sadece yüz bölgesini bırakır.
 * MediaPipe Face Mesh ile tek kare yüz landmark'ı alınır, bbox hesaplanır, kırpılır.
 */

import type { MediaPipeFaceMesh, MediaPipeFaceMeshResults } from "@/types/mediapipe";

const MEDIAPIPE_SCRIPT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js";

function waitForMediaPipe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || window.FaceMesh) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src*="@mediapipe/face_mesh"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = MEDIAPIPE_SCRIPT;
      script.crossOrigin = "anonymous";
      script.async = true;
      script.onerror = () => reject(new Error("MediaPipe Face Mesh yüklenemedi."));
      document.head.appendChild(script);
    }
    let attempts = 0;
    const maxAttempts = 200;
    const check = () => {
      if (window.FaceMesh) {
        resolve();
        return;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        reject(new Error("MediaPipe Face Mesh zaman aşımı."));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

let faceMeshInstance: MediaPipeFaceMesh | null = null;

async function getFaceMesh(): Promise<MediaPipeFaceMesh> {
  if (faceMeshInstance) return faceMeshInstance;
  await waitForMediaPipe();
  const FaceMeshClass = window.FaceMesh;
  if (!FaceMeshClass) throw new Error("FaceMesh bulunamadı.");
  faceMeshInstance = new FaceMeshClass({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
  });
  faceMeshInstance.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return faceMeshInstance;
}

/**
 * Tek bir resimde yüz landmark'larını döndürür (normalize 0–1).
 */
function detectFaceInImage(
  img: HTMLImageElement
): Promise<MediaPipeFaceMeshResults | null> {
  const timeoutMs = 12000;
  const work = new Promise<MediaPipeFaceMeshResults | null>(async (resolve) => {
    try {
      const faceMesh = await getFaceMesh();
      faceMesh.onResults((results: MediaPipeFaceMeshResults) => {
        resolve(results);
      });
      await faceMesh.send({ image: img });
    } catch {
      resolve(null);
    }
  });
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs)
  );
  return Promise.race([work, timeout]);
}

/**
 * Landmark listesinden yüz sınır kutusu (normalize 0–1) ve padding uygula.
 */
function getFaceBbox(
  landmarks: Array<{ x: number; y: number; z?: number }>,
  padding: number
): { x: number; y: number; w: number; h: number } | null {
  if (!landmarks.length) return null;
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  const padX = w * padding;
  const padY = h * padding;
  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  const bw = Math.min(1 - x, w + 2 * padX);
  const bh = Math.min(1 - y, h + 2 * padY);
  return { x, y, w: bw, h: bh };
}

/**
 * Resim URL'sini yükle, yüzü bul, ölü boşlukları kırp; sadece yüz bölgesini içeren data URL döner.
 * Yüz bulunamazsa orijinal URL döner.
 * @param imageUrl - data URL veya geçerli img src
 * @param padding - bbox etrafında ek alan (0.2 = %20)
 */
export async function cropImageToFace(
  imageUrl: string,
  padding: number = 0.25
): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Resim yüklenemedi"));
    img.src = imageUrl;
  });

  const results = await detectFaceInImage(img);
  const landmarks =
    results?.multiFaceLandmarks?.[0] ?? null;
  if (!landmarks?.length) return imageUrl;

  const bbox = getFaceBbox(landmarks, padding);
  if (!bbox) return imageUrl;

  const { width, height } = img;
  const sx = bbox.x * width;
  const sy = bbox.y * height;
  const sw = bbox.w * width;
  const sh = bbox.h * height;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  if (!ctx) return imageUrl;

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Birden fazla resim URL'sini sırayla yüze göre kırpar.
 */
export async function cropImagesToFace(
  imageUrls: string[],
  padding: number = 0.25,
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    onProgress?.(i, imageUrls.length);
    const cropped = await cropImageToFace(imageUrls[i], padding);
    out.push(cropped);
  }
  onProgress?.(imageUrls.length, imageUrls.length);
  return out;
}
