"use client";

import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import RegistrationForm from "@/components/RegistrationForm";
import TestComplete from "@/components/TestComplete";
import { useLang } from "@/contexts/LangContext";

import type { ResultPerImage } from "@/types/results";

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

type AppStep = "registration" | "loading_images" | "tracking" | "saving" | "complete";

interface TestImage {
  id: string;
  image_url: string;
  display_order: number;
}

export default function HomePage() {
  const { t } = useLang();
  const [step, setStep] = useState<AppStep>("registration");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [testImages, setTestImages] = useState<TestImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleRegistered = useCallback(
    async (data: { participantId: string; sessionId: string }) => {
      setSessionId(data.sessionId);
      setStep("loading_images");

      try {
        const res = await fetch("/api/test/images");
        if (!res.ok) throw new Error("Failed to fetch images");
        const images: TestImage[] = await res.json();

        if (images.length === 0) {
          setError(t.noTestImages);
          setStep("registration");
          return;
        }

        setTestImages(images);
        setStep("tracking");
      } catch {
        setError(t.registrationError);
        setStep("registration");
      }
    },
    [t]
  );

  const handleTrackingComplete = useCallback(
    async (results: ResultPerImage[], calibrationErrorPx: number) => {
      if (!sessionId) return;
      setStep("saving");

      try {
        const payload = {
          results: results.map((r, i) => ({
            imageIndex: i,
            imageUrl: r.imageUrl,
            testImageId: testImages[i]?.id || null,
            imageWidth: r.imageDimensions.width,
            imageHeight: r.imageDimensions.height,
            gazePoints: r.gazePoints,
            fixations: r.fixations,
            saccades: r.saccades || [],
            metrics: r.metrics || null,
          })),
          calibrationErrorPx,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        };

        await fetch(`/api/sessions/${sessionId}/results`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        // Still mark complete even if save fails - data was already captured
      }

      setStep("complete");
    },
    [sessionId, testImages]
  );

  // sendBeacon for abandoned sessions
  useEffect(() => {
    if (!sessionId || step === "complete") return;

    const handleBeforeUnload = () => {
      if (step === "tracking" || step === "saving") {
        navigator.sendBeacon(
          `/api/sessions/${sessionId}/status`,
          new Blob(
            [JSON.stringify({ status: "abandoned" })],
            { type: "application/json" }
          )
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sessionId, step]);

  if (step === "complete") {
    return <TestComplete />;
  }

  if (step === "loading_images" || step === "saving") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="flex flex-col items-center">
          <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mb-4" />
          <p className="text-gray-400">
            {step === "saving" ? "Sonuçlar kaydediliyor..." : t.loading}
          </p>
        </div>
      </div>
    );
  }

  if (step === "tracking" && testImages.length > 0) {
    return (
      <EyeTracker
        imageUrls={testImages.map((img) => img.image_url)}
        sessionId={sessionId || undefined}
        onTrackingComplete={handleTrackingComplete}
      />
    );
  }

  return (
    <>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500 rounded-lg px-6 py-3 text-red-300 text-sm shadow-xl">
          {error}
        </div>
      )}
      <RegistrationForm onRegistered={handleRegistered} />
    </>
  );
}
