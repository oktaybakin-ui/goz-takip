"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/registerSW";

export function PWARegister() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return null;
}
