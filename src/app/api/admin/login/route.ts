import { NextRequest, NextResponse } from "next/server";
import { createAdminToken, setAdminCookie } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    if (username !== adminUsername || password !== adminPassword) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = await createAdminToken();
    await setAdminCookie(token);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
