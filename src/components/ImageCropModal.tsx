"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";

interface ImageCropModalProps {
  imageUrl: string;
  onCrop: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

interface CropArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Canvas-based image crop modal.
 * Kullanıcı sürükleyerek kırpma alanı seçer, "Kırp" butonuyla uygular.
 */
export default function ImageCropModal({ imageUrl, onCrop, onCancel }: ImageCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<CropArea | null>(null);
  const [dragging, setDragging] = useState<"create" | "move" | "nw" | "ne" | "sw" | "se" | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const cropStart = useRef<CropArea>({ x: 0, y: 0, w: 0, h: 0 });

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      setLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Compute display size to fit within viewport
  useEffect(() => {
    if (!loaded) return;
    const maxW = Math.min(window.innerWidth - 80, 900);
    const maxH = Math.min(window.innerHeight - 240, 700);
    const scale = Math.min(maxW / imgSize.w, maxH / imgSize.h, 1);
    setDisplaySize({ w: Math.round(imgSize.w * scale), h: Math.round(imgSize.h * scale) });
  }, [loaded, imgSize]);

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;

    canvas.width = displaySize.w;
    canvas.height = displaySize.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw image
    ctx.drawImage(img, 0, 0, displaySize.w, displaySize.h);

    // Draw dark overlay outside crop
    if (crop) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      // Top
      ctx.fillRect(0, 0, displaySize.w, crop.y);
      // Bottom
      ctx.fillRect(0, crop.y + crop.h, displaySize.w, displaySize.h - crop.y - crop.h);
      // Left
      ctx.fillRect(0, crop.y, crop.x, crop.h);
      // Right
      ctx.fillRect(crop.x + crop.w, crop.y, displaySize.w - crop.x - crop.w, crop.h);

      // Crop border
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

      // Rule of thirds grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        const gx = crop.x + (crop.w * i) / 3;
        const gy = crop.y + (crop.h * i) / 3;
        ctx.beginPath();
        ctx.moveTo(gx, crop.y);
        ctx.lineTo(gx, crop.y + crop.h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(crop.x, gy);
        ctx.lineTo(crop.x + crop.w, gy);
        ctx.stroke();
      }

      // Corner handles
      const hs = 8;
      ctx.fillStyle = "#3b82f6";
      const corners = [
        [crop.x, crop.y],
        [crop.x + crop.w, crop.y],
        [crop.x, crop.y + crop.h],
        [crop.x + crop.w, crop.y + crop.h],
      ];
      corners.forEach(([cx, cy]) => {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      });

      // Dimensions text
      const scaleX = imgSize.w / displaySize.w;
      const scaleY = imgSize.h / displaySize.h;
      const realW = Math.round(crop.w * scaleX);
      const realH = Math.round(crop.h * scaleY);
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.textAlign = "center";
      ctx.fillText(`${realW} × ${realH}`, crop.x + crop.w / 2, crop.y - 8);
    }
  }, [loaded, displaySize, crop, imgSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    return {
      x: Math.max(0, Math.min(displaySize.w, clientX - rect.left)),
      y: Math.max(0, Math.min(displaySize.h, clientY - rect.top)),
    };
  };

  const getHandle = (px: number, py: number): "nw" | "ne" | "sw" | "se" | "move" | null => {
    if (!crop) return null;
    const tol = 14;
    const { x, y, w, h } = crop;
    if (Math.abs(px - x) < tol && Math.abs(py - y) < tol) return "nw";
    if (Math.abs(px - (x + w)) < tol && Math.abs(py - y) < tol) return "ne";
    if (Math.abs(px - x) < tol && Math.abs(py - (y + h)) < tol) return "sw";
    if (Math.abs(px - (x + w)) < tol && Math.abs(py - (y + h)) < tol) return "se";
    if (px >= x && px <= x + w && py >= y && py <= y + h) return "move";
    return null;
  };

  const handlePointerDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    const handle = getHandle(pos.x, pos.y);

    dragStart.current = pos;

    if (handle === "move" && crop) {
      setDragging("move");
      cropStart.current = { ...crop };
    } else if (handle && crop) {
      setDragging(handle);
      cropStart.current = { ...crop };
    } else {
      // New crop area
      setCrop({ x: pos.x, y: pos.y, w: 0, h: 0 });
      setDragging("create");
    }
  };

  const handlePointerMove = (e: React.MouseEvent) => {
    if (!dragging) {
      // Update cursor
      const pos = getCanvasPos(e);
      const handle = getHandle(pos.x, pos.y);
      const canvas = canvasRef.current;
      if (canvas) {
        if (handle === "nw" || handle === "se") canvas.style.cursor = "nwse-resize";
        else if (handle === "ne" || handle === "sw") canvas.style.cursor = "nesw-resize";
        else if (handle === "move") canvas.style.cursor = "move";
        else canvas.style.cursor = "crosshair";
      }
      return;
    }

    const pos = getCanvasPos(e);
    const dx = pos.x - dragStart.current.x;
    const dy = pos.y - dragStart.current.y;
    const cs = cropStart.current;

    if (dragging === "create") {
      const x = Math.min(dragStart.current.x, pos.x);
      const y = Math.min(dragStart.current.y, pos.y);
      const w = Math.abs(pos.x - dragStart.current.x);
      const h = Math.abs(pos.y - dragStart.current.y);
      setCrop({ x, y, w, h });
    } else if (dragging === "move") {
      let nx = cs.x + dx;
      let ny = cs.y + dy;
      nx = Math.max(0, Math.min(displaySize.w - cs.w, nx));
      ny = Math.max(0, Math.min(displaySize.h - cs.h, ny));
      setCrop({ x: nx, y: ny, w: cs.w, h: cs.h });
    } else if (dragging === "se") {
      const w = Math.max(20, Math.min(displaySize.w - cs.x, cs.w + dx));
      const h = Math.max(20, Math.min(displaySize.h - cs.y, cs.h + dy));
      setCrop({ x: cs.x, y: cs.y, w, h });
    } else if (dragging === "nw") {
      const nx = Math.max(0, Math.min(cs.x + cs.w - 20, cs.x + dx));
      const ny = Math.max(0, Math.min(cs.y + cs.h - 20, cs.y + dy));
      setCrop({ x: nx, y: ny, w: cs.x + cs.w - nx, h: cs.y + cs.h - ny });
    } else if (dragging === "ne") {
      const ny = Math.max(0, Math.min(cs.y + cs.h - 20, cs.y + dy));
      const w = Math.max(20, Math.min(displaySize.w - cs.x, cs.w + dx));
      setCrop({ x: cs.x, y: ny, w, h: cs.y + cs.h - ny });
    } else if (dragging === "sw") {
      const nx = Math.max(0, Math.min(cs.x + cs.w - 20, cs.x + dx));
      const h = Math.max(20, Math.min(displaySize.h - cs.y, cs.h + dy));
      setCrop({ x: nx, y: cs.y, w: cs.x + cs.w - nx, h });
    }
  };

  const handlePointerUp = () => {
    setDragging(null);
  };

  const handleApplyCrop = () => {
    if (!crop || !imgRef.current || crop.w < 10 || crop.h < 10) return;

    const scaleX = imgSize.w / displaySize.w;
    const scaleY = imgSize.h / displaySize.h;
    const sx = Math.round(crop.x * scaleX);
    const sy = Math.round(crop.y * scaleY);
    const sw = Math.round(crop.w * scaleX);
    const sh = Math.round(crop.h * scaleY);

    const offscreen = document.createElement("canvas");
    offscreen.width = sw;
    offscreen.height = sh;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, sw, sh);
    offscreen.toBlob(
      (blob) => {
        if (blob) onCrop(blob);
      },
      "image/jpeg",
      0.92
    );
  };

  const handleResetCrop = () => {
    setCrop(null);
  };

  if (!loaded) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 flex flex-col items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl max-w-[960px] w-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h3 className="text-white font-semibold text-lg">Görsel Kırpma</h3>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600 flex items-center justify-center transition"
          >
            ×
          </button>
        </div>

        {/* Canvas */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          <canvas
            ref={canvasRef}
            width={displaySize.w}
            height={displaySize.h}
            style={{ width: displaySize.w, height: displaySize.h, cursor: "crosshair", touchAction: "none" }}
            className="rounded-lg"
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
          />
        </div>

        {/* Info */}
        <p className="text-gray-500 text-xs text-center px-4 pb-2">
          {crop && crop.w > 10 && crop.h > 10
            ? "Köşelerden boyutlandırın, ortadan taşıyın. Hazır olunca \"Kırp\" tuşuna basın."
            : "Kırpmak istediğiniz alanı fare ile seçin."}
        </p>

        {/* Actions */}
        <div className="flex gap-3 justify-center px-5 py-4 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 bg-gray-700 text-gray-300 rounded-xl hover:bg-gray-600 transition text-sm"
          >
            İptal
          </button>
          {crop && crop.w > 10 && (
            <button
              onClick={handleResetCrop}
              className="px-5 py-2.5 bg-gray-700 text-gray-300 rounded-xl hover:bg-gray-600 transition text-sm"
            >
              Sıfırla
            </button>
          )}
          <button
            onClick={handleApplyCrop}
            disabled={!crop || crop.w < 10 || crop.h < 10}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm"
          >
            Kırp ve Uygula
          </button>
        </div>
      </div>
    </div>
  );
}
