"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { TestImageRow } from "@/types/database";

export default function ImageManager() {
  const [images, setImages] = useState<TestImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/images");
      if (res.ok) {
        setImages(await res.json());
      }
    } catch {
      setError("Görseller yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handleUpload = async (files: FileList) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setUploading(true);
    setError(null);
    setUploadProgress({ current: 0, total: imageFiles.length });

    let errorCount = 0;
    for (let i = 0; i < imageFiles.length; i++) {
      setUploadProgress({ current: i + 1, total: imageFiles.length });
      const form = new FormData();
      form.append("file", imageFiles[i]);

      try {
        const res = await fetch("/api/admin/images", { method: "POST", body: form });
        if (!res.ok) {
          errorCount++;
          const data = await res.json();
          setError(data.error || `Yükleme hatası (${imageFiles[i].name})`);
        }
      } catch {
        errorCount++;
        setError(`Yükleme başarısız: ${imageFiles[i].name}`);
      }
    }

    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });
    fetchImages();

    if (errorCount === 0 && imageFiles.length > 1) {
      setError(null);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Bu görseli silmek istediğinize emin misiniz?")) return;

    try {
      const res = await fetch(`/api/admin/images/${id}`, { method: "DELETE" });
      if (res.ok) {
        setImages((prev) => prev.filter((img) => img.id !== id));
      }
    } catch {
      setError("Silme başarısız.");
    }
  };

  const moveImage = async (index: number, direction: -1 | 1) => {
    const newImages = [...images];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newImages.length) return;

    [newImages[index], newImages[targetIndex]] = [newImages[targetIndex], newImages[index]];
    setImages(newImages);

    try {
      await fetch("/api/admin/images/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: newImages.map((img) => img.id) }),
      });
    } catch {
      fetchImages();
    }
  };

  if (loading) {
    return <div className="text-gray-400">Yükleniyor...</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-xl font-bold text-white">Test Görselleri</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {uploading
            ? `Yükleniyor (${uploadProgress.current}/${uploadProgress.total})...`
            : "Görsel Ekle"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files) handleUpload(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {uploading && (
        <div className="w-full max-w-md mb-4">
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{
                width: `${uploadProgress.total ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-gray-500 text-xs mt-1">
            {uploadProgress.current} / {uploadProgress.total} görsel yükleniyor...
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg px-4 py-2 mb-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`rounded-xl border-2 border-dashed p-6 mb-6 transition-all ${
          isDragOver
            ? "border-blue-400 bg-blue-500/10"
            : "border-gray-700 bg-gray-900/30"
        }`}
      >
        {images.length === 0 && !isDragOver ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-2">Henüz görsel yüklenmedi.</p>
            <p className="text-gray-600 text-sm">
              Görselleri buraya sürükleyin veya yukarıdaki butonla seçin.
            </p>
          </div>
        ) : isDragOver ? (
          <div className="text-center py-8">
            <p className="text-blue-400 text-lg">Bırakın...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {images.map((img, i) => (
              <div
                key={img.id}
                className="relative group bg-gray-900 rounded-xl border border-gray-800 overflow-hidden"
              >
                <img
                  src={img.image_url}
                  alt={img.original_filename || `Görsel ${i + 1}`}
                  className="w-full aspect-square object-cover"
                />
                <div className="absolute top-1 left-1 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
                  {i + 1}
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition">
                  <div className="flex gap-1">
                    <button
                      onClick={() => moveImage(i, -1)}
                      disabled={i === 0}
                      className="w-7 h-7 rounded bg-gray-700 text-white text-xs hover:bg-gray-600 disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => moveImage(i, 1)}
                      disabled={i === images.length - 1}
                      className="w-7 h-7 rounded bg-gray-700 text-white text-xs hover:bg-gray-600 disabled:opacity-30"
                    >
                      →
                    </button>
                  </div>
                  <button
                    onClick={() => handleDelete(img.id)}
                    className="w-7 h-7 rounded bg-red-600 text-white text-xs hover:bg-red-500"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-gray-500 text-sm">
        Toplam {images.length} görsel. Kullanıcılar teste başladığında bu görselleri sırayla görecek.
      </p>
    </div>
  );
}
