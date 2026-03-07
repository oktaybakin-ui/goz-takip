import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";

  let query = supabase
    .from("test_sessions")
    .select("*, participants!inner(id, full_name)")
    .order("started_at", { ascending: false });

  if (search) {
    query = query.ilike("participants.full_name", `%${search}%`);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (from) {
    query = query.gte("started_at", from);
  }

  if (to) {
    query = query.lte("started_at", to + "T23:59:59.999Z");
  }

  const { data, error } = await query.limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
