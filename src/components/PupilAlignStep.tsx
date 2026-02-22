"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { FaceTracker } from "@/lib/faceTracker";
import { useLang } from "@/contexts/LangContext";

interface PupilAlignStepProps {
  faceTracker: FaceTracker;
  /** Parent'tan verilirse FaceTracker bu videodan frame alır (tek video = tarayıcı throttling olmaz) */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onSkip: () => void;
  onDone: (offsetLeft: { x: number; y: number }, offsetRight: { x: number; y: number }) => void;
}

const DOT_RADIUS = 12;
const HIT_RADIUS = 24;

export default function PupilAlignStep({ faceTracker, videoRef: parentVideoRef, onSkip, onDone }: PupilAlignStepProps) {
  const { t } = useLang();
  const containerRef = useRef<HTMLDivElement>(null);
  const ownVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = parentVideoRef ?? ownVideoRef;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoSize, setVideoSize] = useState({ w: 640, h: 480 });
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [waitingFrames, setWaitingFrames] = useState(0);
  const leftCorrectedRef = useRef<{ x: number; y: number } | null>(null);
  const rightCorrectedRef = useRef<{ x: number; y: number } | null>(null);

  // Stream'i videoya bağla; parent videoRef varsa FaceTracker'ı da bu videoya geçir (tek video = yüz tespiti çalışır)
  useEffect(() => {
    const stream = faceTracker.getStream();
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
      if (parentVideoRef) faceTracker.setVideoElement(video);
      const onResize = () => {
        if (video.videoWidth && video.videoHeight) {
          setVideoSize({ w: video.videoWidth, h: video.videoHeight });
        }
      };
      video.addEventListener("loadedmetadata", onResize);
      if (video.videoWidth) onResize();
      return () => {
        video.removeEventListener("loadedmetadata", onResize);
        if (parentVideoRef) faceTracker.setVideoElement(null);
      };
    }
  }, [faceTracker, parentVideoRef]);

  // Overlay çizimi (tespit edilen veya kullanıcı düzeltmesi)
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = video.videoWidth || videoSize.w;
    const h = video.videoHeight || videoSize.h;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    const features = faceTracker.getLastFeatures();

    if (!features || features.confidence <= 0) {
      setFaceDetected(false);
      setWaitingFrames(prev => prev + 1);

      // Yüz bulunamıyor mesajı çiz
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "bold 18px sans-serif";
      ctx.fillStyle = "rgba(255, 200, 50, 0.9)";
      ctx.textAlign = "center";
      ctx.fillText("Yüz tespit edilemiyor...", w / 2, h / 2 - 10);
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "rgba(200, 200, 200, 0.8)";
      ctx.fillText("Yüzünüzü kameraya gösterin", w / 2, h / 2 + 15);
      return;
    }

    setFaceDetected(true);
    setWaitingFrames(0);

    const leftX = features.leftIrisX * w;
    const leftY = features.leftIrisY * h;
    const rightX = features.rightIrisX * w;
    const rightY = features.rightIrisY * h;

    const lx = leftCorrectedRef.current ? leftCorrectedRef.current.x : leftX;
    const ly = leftCorrectedRef.current ? leftCorrectedRef.current.y : leftY;
    const rx = rightCorrectedRef.current ? rightCorrectedRef.current.x : rightX;
    const ry = rightCorrectedRef.current ? rightCorrectedRef.current.y : rightY;

    const drawDot = (x: number, y: number, color: string) => {
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    // Görüntüde sol = kullanıcının sağ gözü, sağ = kullanıcının sol gözü (kamera perspektifi).
    // Kullanıcıya göre: "Sağ göz = yeşil, sol göz = mavi" — sol iris (ekranda sağda) mavi, sağ iris (ekranda solda) yeşil.
    drawDot(lx, ly, "rgba(59, 130, 246, 0.9)");
    drawDot(rx, ry, "rgba(34, 197, 94, 0.9)");
  }, [faceTracker, videoSize]);

  useEffect(() => {
    let raf: number;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  const getEventPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const hitTest = (px: number, py: number, cx: number, cy: number) => {
    return Math.hypot(px - cx, py - cy) <= HIT_RADIUS;
  };

  const onPointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const pos = getEventPos(e);
      if (!pos) return;
      const features = faceTracker.getLastFeatures();
      if (!features) return;
      const w = videoSize.w;
      const h = videoSize.h;
      const lx = (leftCorrectedRef.current?.x ?? features.leftIrisX * w);
      const ly = (leftCorrectedRef.current?.y ?? features.leftIrisY * h);
      const rx = (rightCorrectedRef.current?.x ?? features.rightIrisX * w);
      const ry = (rightCorrectedRef.current?.y ?? features.rightIrisY * h);
      if (hitTest(pos.x, pos.y, lx, ly)) setDragging("left");
      else if (hitTest(pos.x, pos.y, rx, ry)) setDragging("right");
    },
    [faceTracker, videoSize]
  );

  const onPointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const pos = getEventPos(e);
      if (!pos || !dragging) return;
      if (dragging === "left") leftCorrectedRef.current = { x: pos.x, y: pos.y };
      else rightCorrectedRef.current = { x: pos.x, y: pos.y };
    },
    [dragging]
  );

  const onPointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleDone = useCallback(() => {
    const features = faceTracker.getLastFeatures();
    const w = videoSize.w;
    const h = videoSize.h;
    if (!features || w === 0 || h === 0) {
      onDone({ x: 0, y: 0 }, { x: 0, y: 0 });
      return;
    }
    const dlx = features.leftIrisX;
    const dly = features.leftIrisY;
    const drx = features.rightIrisX;
    const dry = features.rightIrisY;
    const leftOffset = leftCorrectedRef.current
      ? { x: leftCorrectedRef.current.x / w - dlx, y: leftCorrectedRef.current.y / h - dly }
      : { x: 0, y: 0 };
    const rightOffset = rightCorrectedRef.current
      ? { x: rightCorrectedRef.current.x / w - drx, y: rightCorrectedRef.current.y / h - dry }
      : { x: 0, y: 0 };
    onDone(leftOffset, rightOffset);
  }, [faceTracker, videoSize, onDone]);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl p-6 max-w-2xl w-full border border-gray-700 shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-2">{t.pupilAlignTitle}</h2>
        <p className="text-gray-400 text-sm mb-4">{t.pupilAlignDesc}</p>

        <div
          ref={containerRef}
          className="relative rounded-xl overflow-hidden bg-black mx-auto"
          style={{ maxWidth: videoSize.w, maxHeight: videoSize.h }}
        >
          <video
            ref={videoRef}
            className="w-full h-auto max-h-[50vh] object-contain transform scale-x-[-1]"
            playsInline
            muted
            autoPlay
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-auto transform scale-x-[-1]"
            style={{ maxHeight: "50vh" }}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerUp}
            onTouchStart={onPointerDown}
            onTouchMove={onPointerMove}
            onTouchEnd={onPointerUp}
          />
        </div>

        {!faceDetected && waitingFrames > 90 && (
          <div className="mt-3 bg-yellow-900/30 border border-yellow-600/50 rounded-lg px-4 py-2 text-yellow-300 text-sm text-center">
            Göz takip modeli yükleniyor veya yüz tespit edilemiyor. Kameranızın açık olduğundan ve yüzünüzün görünür olduğundan emin olun. Gözlük kullanıyorsanız ışığın camda yansımadığından, yüzünüzün yeterince aydınlık olduğundan emin olun.
          </div>
        )}
        {faceDetected && (
          <p className="mt-2 text-green-400 text-xs text-center">✓ Yüz tespit edildi — noktaları sürükleyerek göz bebeklerinize hizalayın</p>
        )}
        {!faceDetected && waitingFrames <= 90 && (
          <p className="mt-2 text-gray-500 text-xs text-center animate-pulse">Göz takip modeli başlatılıyor...</p>
        )}
        <p className="text-gray-500 text-xs mt-1 text-center">{t.pupilAlignHint}</p>

        <div className="flex gap-3 justify-center mt-6">
          <button
            type="button"
            onClick={onSkip}
            className="px-6 py-3 bg-gray-700 text-gray-300 rounded-xl hover:bg-gray-600 transition focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
          >
            {t.pupilAlignSkip}
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-gray-950 focus:outline-none"
          >
            {t.pupilAlignDone}
          </button>
        </div>
      </div>
    </div>
  );
}
