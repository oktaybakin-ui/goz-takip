"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { Lang, translations, getStoredLang, setStoredLang } from "@/lib/i18n";

const LangContext = createContext<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: typeof translations.tr;
} | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("tr");

  useEffect(() => {
    setLangState(getStoredLang());
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setStoredLang(l);
  }, []);

  const value = useMemo(() => ({
    lang,
    setLang,
    t: translations[lang],
  }), [lang, setLang]);

  return (
    <LangContext.Provider value={value}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) {
    if (process.env.NODE_ENV === "development") {
      console.warn("useLang() called outside LangProvider — returning defaults");
    }
    return { lang: "tr" as Lang, setLang: () => {}, t: translations.tr };
  }
  return ctx;
}
