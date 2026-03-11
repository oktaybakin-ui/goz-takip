"use client";

import React, { useState, FormEvent } from "react";
import { useLang } from "@/contexts/LangContext";
import { validateTC } from "@/lib/tcValidation";
import DemoPreview from "@/components/DemoPreview";

interface RegistrationFormProps {
  onRegistered: (data: { participantId: string; sessionId: string }) => void;
}

export default function RegistrationForm({ onRegistered }: RegistrationFormProps) {
  const { lang, setLang, t } = useLang();
  const [fullName, setFullName] = useState("");
  const [tc, setTc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setError(t.fullNameLabel + " gerekli.");
      return;
    }

    const trimmedTC = tc.replace(/\s/g, "");
    if (!validateTC(trimmedTC)) {
      setError(t.tcEntryInvalid);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/participants/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: trimmedName, tc: trimmedTC }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || t.registrationError);
        return;
      }

      onRegistered(data);
    } catch {
      setError(t.registrationError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 p-4 gap-4">
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <span className="text-gray-500 text-sm">TR</span>
        <button
          type="button"
          onClick={() => setLang(lang === "tr" ? "en" : "tr")}
          className="px-2 py-1 rounded bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 min-h-[44px] min-w-[44px] touch-manipulation"
          aria-label={lang === "tr" ? "Switch to English" : "Türkçe'ye geç"}
        >
          {lang === "tr" ? "EN" : "TR"}
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm border border-gray-800 shadow-xl"
      >
        <h1 className="text-2xl font-bold text-white mb-2 text-center">{t.appTitle}</h1>
        <p className="text-gray-500 text-sm mb-6 text-center">{t.tcEntryExplanation}</p>

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg px-4 py-2 mb-4 text-red-300 text-sm text-center">
            {error}
          </div>
        )}

        <label className="block mb-4">
          <span className="text-gray-400 text-sm">{t.fullNameLabel}</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t.fullNamePlaceholder}
            className="mt-1 w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
            required
            autoFocus
          />
        </label>

        <label className="block mb-6">
          <span className="text-gray-400 text-sm">{t.tcEntryTitle}</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={11}
            value={tc}
            onChange={(e) => setTc(e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder={t.tcEntryPlaceholder}
            className="mt-1 w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white tracking-widest text-center focus:outline-none focus:border-blue-500"
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {loading ? "..." : t.tcEntrySubmit}
        </button>

        <p className="text-gray-600 text-xs mt-4 text-center">{t.privacyNote}</p>
      </form>

      {/* Demo/açıklama görseli */}
      <DemoPreview />
    </div>
  );
}
