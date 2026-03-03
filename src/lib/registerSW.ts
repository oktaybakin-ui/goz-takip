/**
 * Service Worker kayıt ve güncelleme yönetimi.
 * Layout'tan bir kez çağrılır.
 */

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      // Güncelleme kontrolü
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (
            newWorker.state === "activated" &&
            navigator.serviceWorker.controller
          ) {
            // Yeni versiyon aktif — kullanıcıya bildir (opsiyonel)
            console.log("[SW] Yeni versiyon yüklendi.");
          }
        });
      });
    } catch (err) {
      console.error("[SW] Kayıt başarısız:", err);
    }
  });
}
