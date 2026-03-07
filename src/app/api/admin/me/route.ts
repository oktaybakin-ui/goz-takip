import { NextResponse } from "next/server";
import { getAdminTokenFromCookie, verifyAdminToken } from "@/lib/admin-auth";

export async function GET() {
  const token = await getAdminTokenFromCookie();
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const valid = await verifyAdminToken(token);
  if (!valid) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true });
}
