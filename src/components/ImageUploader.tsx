"use client";

import React, { useState, useRef, useCallback } from "react";
import { useLang } from "@/contexts/LangContext";
import { cropImagesToFace } from "@/lib/faceCrop";

const MIN_IMAGE_COUNT = 1;
const MAX_IMAGE_COUNT = 10;

interface ImageUploaderProps {
  onImagesSelected: (imageUrls: string[]) => void;
}

export default function ImageUploader({ onImagesSelected }: ImageUploaderProps) {
  const { lang, setLang, t } = useLang();
  const [previews, setPreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [croppingProgress, setCroppingProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith("image/")) imageFiles.push(file);
      }

      if (imageFiles.length === 0) {
        alert(t.selectImageFiles);
        return;
      }

      const toLoad = imageFiles.slice(0, MAX_IMAGE_COUNT);
      const newUrls: string[] = new Array(toLoad.length);
      let loaded = 0;

      setIsUploading(true);
      setUploadProgress(0);

      toLoad.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const data = e.target?.result as string;
          if (data) newUrls[index] = data;
          loaded++;
          const progress = Math.round((loaded / toLoad.length) * 100);
          setUploadProgress(progress);
          if (loaded === toLoad.length) {
            const combined = newUrls.filter(Boolean);
            if (combined.length > 0) {
              setPreviews(combined.slice(0, MAX_IMAGE_COUNT));
            } else {
              alert(t.selectImageFiles);
            }
            setIsUploading(false);
          }
        };
        reader.onerror = () => {
          loaded++;
          if (loaded === toLoad.length) {
            const combined = newUrls.filter(Boolean);
            if (combined.length > 0) {
              setPreviews(combined.slice(0, MAX_IMAGE_COUNT));
            } else {
              alert(t.selectImageFiles);
            }
            setIsUploading(false);
          }
        };
        reader.readAsDataURL(file);
      });
    },
    [t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files ?? null);
      e.target.value = "";
    },
    [handleFiles]
  );

  const removePreview = useCallback((index: number) => {
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (previews.length < MIN_IMAGE_COUNT || previews.length > MAX_IMAGE_COUNT) return;
    setIsCropping(true);
    setCroppingProgress({ current: 0, total: previews.length });
    try {
      const cropped = await cropImagesToFace(
        previews,
        0.25,
        (done, total) => setCroppingProgress({ current: done, total })
      );
      onImagesSelected(cropped);
    } catch {
      onImagesSelected(previews);
    } finally {
      setIsCropping(false);
    }
  }, [previews, onImagesSelected]);

  const handleStartWithoutCrop = useCallback(() => {
    if (previews.length < MIN_IMAGE_COUNT || previews.length > MAX_IMAGE_COUNT) return;
    onImagesSelected(previews);
  }, [previews, onImagesSelected]);

  const canStart = previews.length >= MIN_IMAGE_COUNT && previews.length <= MAX_IMAGE_COUNT;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 p-6">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <span className="text-gray-500 text-sm">TR</span>
        <button
          type="button"
          onClick={() => setLang(lang === "tr" ? "en" : "tr")}
          className="px-2 py-1 rounded bg-gray-800 text-gray-300 text-sm hover:bg-gray-700"
          aria-label={lang === "tr" ? "Switch to English" : "Türkçe'ye geç"}
        >
          {lang === "tr" ? "EN" : "TR"}
        </button>
      </div>
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-3">
          👁️ {t.appTitle}
        </h1>
        <p className="text-gray-400 text-lg max-w-lg">
          {t.upload10Subtitle}
        </p>
        <p className="text-gray-500 text-sm mt-2 max-w-lg">
          🔒 {t.privacyNote}
        </p>
      </div>

      {previews.length === 0 ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`w-full max-w-2xl rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-200 ${
            isDragOver
              ? "border-blue-400 bg-blue-500/10 scale-[1.02]"
              : "border-gray-600 bg-gray-900 hover:border-gray-500 hover:bg-gray-800/50"
          }`}
          style={{ minHeight: "18rem" }}
        >
          <div className="text-5xl mb-4 pt-8">{isDragOver ? "📥" : "🖼️"}</div>
          <p className="text-gray-300 text-lg mb-2">
            {isDragOver ? t.dropHere : t.upload10Hint}
          </p>
          <p className="text-gray-500 text-sm mb-4">
            {t.required10}
          </p>
          <label className="cursor-pointer inline-block px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleInputChange}
              className="hidden"
            />
            {t.selectImages}
          </label>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 w-full max-w-4xl">
          {isUploading && (
            <div className="w-full max-w-xs">
              <p className="text-gray-400 text-sm mb-2">
                {t.loading} {uploadProgress}%
              </p>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
          <p className="text-gray-400">
            {t.photosLabel} {previews.length} / {MAX_IMAGE_COUNT}
          </p>
          <div className="flex flex-wrap gap-3 w-full justify-center">
            <button
              type="button"
              onClick={handleStartWithoutCrop}
              disabled={!canStart || isUploading}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg"
            >
              {t.startAnalysis10}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canStart || isUploading || isCropping}
              className="px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-medium hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {t.cropThenStart}
            </button>
          </div>
          <div className="grid grid-cols-5 gap-3 w-full">
            {previews.map((url, i) => (
              <div key={i} className="relative group rounded-xl overflow-hidden border-2 border-gray-700 bg-gray-900">
                <img src={url} alt={`Foto ${i + 1}`} className="w-full aspect-square object-cover" />
                <span className="absolute top-1 left-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removePreview(i)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600/90 text-white text-sm opacity-0 group-hover:opacity-100 transition"
                  aria-label={t.remove}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-3 flex-wrap justify-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600"
            >
              {t.addMore}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleInputChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleStartWithoutCrop}
              disabled={!canStart || isUploading}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg"
            >
              {t.startAnalysis10}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canStart || isUploading || isCropping}
              className="px-6 py-3 bg-gray-700 text-gray-300 rounded-xl font-medium hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {t.cropThenStart}
            </button>
          </div>

          {isCropping && (
            <div className="fixed inset-0 bg-gray-950/95 flex flex-col items-center justify-center gap-4 z-50">
              <p className="text-white text-lg">{t.croppingFaces}</p>
              <p className="text-gray-400 text-sm">
                {t.croppingProgress
                  .replace("{n}", String(croppingProgress.current))
                  .replace("{total}", String(croppingProgress.total))}
              </p>
              <div className="w-64 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      croppingProgress.total
                        ? (croppingProgress.current / croppingProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 max-w-4xl">
        <FeatureCard
          icon="25 + 5"
          title="Kalibrasyon"
          description="25 nokta kalibrasyon + 5 doğrulama ile hassas göz takibi."
        />
        <FeatureCard
          icon="🔥"
          title="Foto Başına Heatmap"
          description="Her fotoğraf için ayrı bakış ısı haritası."
        />
        <FeatureCard
          icon="⏱️"
          title="20 saniye / foto"
          description="Her foto 20 saniye gösterilir, otomatik geçiş."
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
      <div className="text-2xl mb-3">{icon}</div>
      <h3 className="text-white font-semibold mb-2">{title}</h3>
      <p className="text-gray-500 text-sm">{description}</p>
    </div>
  );
}
