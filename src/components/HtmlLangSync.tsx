"use client";

import { useEffect } from "react";
import { useLang } from "@/contexts/LangContext";

/**
 * LangContext'teki dile göre <html lang="..."> değerini günceller (erişilebilirlik).
 */
export default function HtmlLangSync() {
  const { lang } = useLang();
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);
  return null;
}
