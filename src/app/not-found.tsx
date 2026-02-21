"use client";

import Link from "next/link";
import { useLang } from "@/contexts/LangContext";

export default function NotFound() {
  const { t } = useLang();
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-md text-center">
        <p className="text-6xl mb-4">👁️</p>
        <h1 className="text-xl font-bold text-white mb-2">{t.pageNotFound}</h1>
        <p className="text-gray-400 text-sm mb-6">
          {t.pageNotFoundDesc}
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-500 transition"
        >
          {t.backToHome}
        </Link>
      </div>
    </div>
  );
}
