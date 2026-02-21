/**
 * TC Kimlik No doğrulama (11 rakam, T.C. algoritmasına uygun).
 */
export function validateTC(tc: string): boolean {
  const s = tc.replace(/\s/g, "");
  if (!/^\d{11}$/.test(s)) return false;
  if (s[0] === "0") return false;

  const d = s.split("").map(Number);
  const d10 = (d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7]);
  if (d10 % 10 !== d[9]) return false;
  const d11 = (d.slice(0, 10).reduce((a, b) => a + b, 0)) % 10;
  if (d11 !== d[10]) return false;
  return true;
}
