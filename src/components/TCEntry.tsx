"use client";

import React, { useState, FormEvent } from "react";
import { useLang } from "@/contexts/LangContext";
import { validateTC } from "@/lib/tcValidation";
import { canAccessWithTC, markTCAsUsed } from "@/lib/tcAccess";

interface TCEntryProps {
  onSuccess: (tc: string) => void;
}

export default function TCEntry({ onSuccess }: TCEntryProps) {
  const { t } = useLang();
  const [tc, setTc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = tc.replace(/\s/g, "");
    if (!trimmed) {
      setError(t.tcEntryInvalid);
      return;
    }
    if (!validateTC(trimmed)) {
      setError(t.tcEntryInvalid);
      return;
    }
    const result = canAccessWithTC(trimmed);
    if (!result.allowed) {
      setError(result.reason === "already_used" ? t.tcEntryAlreadyUsed : t.tcEntryInvalid);
      return;
    }
    markTCAsUsed(trimmed);
    onSuccess(trimmed);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white text-center mb-2">
          👁️ {t.appTitle}
        </h1>
        <p className="text-gray-400 text-center text-sm mb-8">
          {t.tcEntryTitle}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9\s]*"
            maxLength={11}
            value={tc}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              setTc(v);
              setError(null);
            }}
            placeholder={t.tcEntryPlaceholder}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 outline-none text-center text-lg tracking-widest"
            aria-label={t.tcEntryPlaceholder}
          />
          {error && (
            <p className="text-red-400 text-sm text-center" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-gray-950 transition"
          >
            {t.tcEntrySubmit}
          </button>
        </form>
        <p className="text-gray-500 text-xs text-center mt-6">
          {t.tcEntryExplanation}
        </p>
      </div>
    </div>
  );
}
