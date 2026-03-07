import { NextResponse } from "next/server";
import { getAdminTokenFromCookie, verifyAdminToken } from "./admin-auth";

export async function requireAdmin(): Promise<NextResponse | null> {
  const token = await getAdminTokenFromCookie();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const valid = await verifyAdminToken(token);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function hashTC(tc: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(tc.replace(/\s/g, ""));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function validateTCServer(tc: string): boolean {
  const s = tc.replace(/\s/g, "");
  if (!/^\d{11}$/.test(s)) return false;
  if (s[0] === "0") return false;
  const d = s.split("").map(Number);
  const d10 = (d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7]);
  if (((d10 % 10) + 10) % 10 !== d[9]) return false;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  if (d11 !== d[10]) return false;
  return true;
}
