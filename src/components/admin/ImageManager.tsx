"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { TestImageRow } from "@/types/database";

export default function ImageManager() {
  const [images, setImages] = useState<TestImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setUploading(true);
    setError(null);

    for (let i = 0; i < files.length; i++) {
      const form = new FormData();
      form.append("file", files[i]);

      try {
        const res = await fetch("/api/admin/images", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Yükleme hatası");
        }
      } catch {
        setError("Yükleme başarısız.");
      }
    }

    setUploading(false);
    fetchImages();
  };

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
      fetchImages(); // Revert on error
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
          {uploading ? "Yükleniyor..." : "Görsel Ekle"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => e.target.files && handleUpload(e.target.files)}
          className="hidden"
        />
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg px-4 py-2 mb-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {images.length === 0 ? (
        <div className="text-gray-500 text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
          Henüz görsel yüklenmedi. Yukarıdaki butonla görsel ekleyin.
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

      <p className="text-gray-500 text-sm mt-4">
        Toplam {images.length} görsel. Kullanıcılar teste başladığında bu görselleri sırayla görecek.
      </p>
    </div>
  );
}
