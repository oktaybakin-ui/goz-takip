"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
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

  const setLang = (l: Lang) => {
    setLangState(l);
    setStoredLang(l);
  };

  return (
    <LangContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) return { lang: "tr" as Lang, setLang: () => {}, t: translations.tr };
  return ctx;
}
