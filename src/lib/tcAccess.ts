/**
 * TC ile giriş: her TC sadece 1 kez bakabilsin, admin TC sınırsız.
 * Veriler tarayıcıda localStorage'da tutulur.
 */

const STORAGE_KEY_USED = "eye-tracking-used-tc";
const MAX_STORED = 5000; // Eski kayıtları taşmada silmek için

function getAdminTC(): string | null {
  if (typeof window === "undefined") return null;
  return process.env.NEXT_PUBLIC_ADMIN_TC ?? null;
}

export function isAdminTC(tc: string): boolean {
  const admin = getAdminTC();
  if (!admin) return false;
  return tc.replace(/\s/g, "") === admin.replace(/\s/g, "");
}

function getUsedTCs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USED);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function setUsedTCs(tcs: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = tcs.slice(-MAX_STORED);
    localStorage.setItem(STORAGE_KEY_USED, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

/** Bu TC ile daha önce bakıldı mı? (Admin hariç) */
export function hasAlreadyUsed(tc: string): boolean {
  const normalized = tc.replace(/\s/g, "");
  const used = getUsedTCs();
  return used.includes(normalized);
}

/** TC giriş yapabilir mi? Admin sınırsız; diğerleri sadece ilk kez. */
export function canAccessWithTC(tc: string): { allowed: boolean; reason?: string } {
  const normalized = tc.replace(/\s/g, "");
  if (isAdminTC(normalized)) return { allowed: true };
  if (hasAlreadyUsed(normalized)) {
    return { allowed: false, reason: "already_used" };
  }
  return { allowed: true };
}

/** Girişi kaydet (bu TC ile baktı olarak işaretle). Admin için kaydetme. */
export function markTCAsUsed(tc: string): void {
  const normalized = tc.replace(/\s/g, "");
  if (isAdminTC(normalized)) return;
  const used = getUsedTCs();
  if (used.includes(normalized)) return;
  setUsedTCs([...used, normalized]);
}

/** Admin'in yüklediği fotoğraflar (data URL listesi) – diğer kullanıcılar bunlara bakar. */
const STORAGE_KEY_PHOTOS = "eye-tracking-current-photos";

export function saveCurrentPhotos(urls: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(urls));
  } catch {
    // quota veya hata
  }
}

export function loadCurrentPhotos(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PHOTOS);
    if (!raw) return null;
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr;
  } catch {
    return null;
  }
}
