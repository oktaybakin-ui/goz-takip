"use client";

import React, { useState, useRef, useCallback } from "react";

interface ImageUploaderProps {
  onImageSelected: (imageUrl: string) => void;
}

export default function ImageUploader({ onImageSelected }: ImageUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        alert("Lütfen bir görüntü dosyası seçin (PNG, JPG, WEBP)");
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setPreview(dataUrl);
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleConfirm = useCallback(() => {
    if (preview) {
      onImageSelected(preview);
    }
  }, [preview, onImageSelected]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 p-6">
      {/* Başlık */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-3">
          👁️ Göz Takip Analizi
        </h1>
        <p className="text-gray-400 text-lg max-w-lg">
          Bir fotoğraf yükleyin, webcam ile bakış noktalarınızı analiz edelim.
          Heatmap, fixation analizi ve ROI clustering ile detaylı sonuçlar alın.
        </p>
      </div>

      {/* Yükleme alanı */}
      {!preview ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`
            w-full max-w-xl h-72 rounded-2xl border-2 border-dashed cursor-pointer
            flex flex-col items-center justify-center transition-all duration-300
            ${
              isDragOver
                ? "border-blue-400 bg-blue-500/10 scale-105"
                : "border-gray-600 bg-gray-900 hover:border-gray-400 hover:bg-gray-800/50"
            }
          `}
        >
          <div className="text-5xl mb-4">
            {isDragOver ? "📥" : "🖼️"}
          </div>
          <p className="text-gray-300 text-lg mb-2">
            {isDragOver
              ? "Bırakın..."
              : "Fotoğrafı buraya sürükleyin"}
          </p>
          <p className="text-gray-500 text-sm">
            veya tıklayarak dosya seçin
          </p>
          <p className="text-gray-600 text-xs mt-3">
            PNG, JPG, WEBP desteklenir
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleInputChange}
            className="hidden"
          />
        </div>
      ) : (
        /* Önizleme */
        <div className="flex flex-col items-center gap-6">
          <div className="relative rounded-2xl overflow-hidden border-2 border-gray-700 shadow-2xl max-w-2xl">
            <img
              src={preview}
              alt="Seçilen görüntü"
              className="max-w-full max-h-96 object-contain"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setPreview(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
            >
              Değiştir
            </button>
            <button
              onClick={handleConfirm}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-500 transition shadow-lg"
            >
              Analize Başla →
            </button>
          </div>
        </div>
      )}

      {/* Özellikler */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 max-w-4xl">
        <FeatureCard
          icon="🎯"
          title="9 Noktalı Kalibrasyon"
          description="Kamera pozisyonundan bağımsız, hassas göz takibi için zorunlu kalibrasyon sistemi."
        />
        <FeatureCard
          icon="🔥"
          title="Heatmap Analizi"
          description="Bakış yoğunluk haritası ile en çok dikkat çeken bölgeleri görselleştirin."
        />
        <FeatureCard
          icon="📊"
          title="Detaylı Metrikler"
          description="İlk bakış, fixation süresi, ROI clustering ve daha fazlası."
        />
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-white font-semibold mb-2">{title}</h3>
      <p className="text-gray-500 text-sm">{description}</p>
    </div>
  );
}
