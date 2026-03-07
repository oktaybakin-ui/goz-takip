"use client";

import React from "react";
import { useLang } from "@/contexts/LangContext";

export default function TestComplete() {
  const { t } = useLang();

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950 p-4">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-md border border-gray-800 shadow-xl text-center">
        <div className="text-5xl mb-4">✓</div>
        <h1 className="text-2xl font-bold text-white mb-3">{t.testCompleteTitle}</h1>
        <p className="text-gray-400">{t.testCompleteMessage}</p>
      </div>
    </div>
  );
}
