"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import ImageUploader from "@/components/ImageUploader";

const EyeTracker = dynamic(() => import("@/components/EyeTracker"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <div className="flex flex-col items-center">
        <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mb-4" />
        <p className="text-gray-400">Bileşenler yükleniyor...</p>
      </div>
    </div>
  ),
});

export default function HomePage() {
  const [imageUrls, setImageUrls] = useState<string[] | null>(null);

  const handleImagesSelected = (urls: string[]) => {
    setImageUrls(urls);
  };

  const handleReset = () => {
    setImageUrls(null);
  };

  if (imageUrls && imageUrls.length >= 1) {
    return <EyeTracker imageUrls={imageUrls} onReset={handleReset} />;
  }

  return <ImageUploader onImagesSelected={handleImagesSelected} />;
}
