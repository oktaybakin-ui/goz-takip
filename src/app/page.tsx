"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import ImageUploader from "@/components/ImageUploader";

// EyeTracker'ı client-side only olarak yükle (MediaPipe gerektiriyor)
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const handleImageSelected = (url: string) => {
    setImageUrl(url);
  };

  const handleReset = () => {
    setImageUrl(null);
  };

  if (imageUrl) {
    return <EyeTracker imageUrl={imageUrl} onReset={handleReset} />;
  }

  return <ImageUploader onImageSelected={handleImageSelected} />;
}
