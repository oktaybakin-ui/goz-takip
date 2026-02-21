"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";
import { useLang } from "@/contexts/LangContext";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLang();
  useEffect(() => {
    logger.error("Uygulama hatası:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="bg-gray-900 border border-red-900/50 rounded-2xl p-8 max-w-md text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold text-white mb-2">{t.errorTitle}</h1>
        <p className="text-gray-400 text-sm mb-6">
          {error.message || t.errorDefaultMessage}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition"
          >
            {t.tryAgain}
          </button>
          <button
            onClick={() => window.location.href = "/"}
            className="px-6 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition"
          >
            {t.goHome}
          </button>
        </div>
      </div>
    </div>
  );
}
