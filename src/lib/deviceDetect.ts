/**
 * Mobil cihaz algılama yardımcı fonksiyonu.
 * userAgent ve ekran boyutuna bakarak mobil cihaz tespiti yapar.
 */

let _isMobile: boolean | null = null;

export function isMobileDevice(): boolean {
  if (_isMobile !== null) return _isMobile;

  if (typeof window === "undefined" || typeof navigator === "undefined") {
    _isMobile = false;
    return false;
  }

  const ua = navigator.userAgent || "";
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const smallScreen = window.screen.width <= 768 || window.screen.height <= 768;
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  _isMobile = mobileUA || (smallScreen && hasTouch);
  return _isMobile;
}
