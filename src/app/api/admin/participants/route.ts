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

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { participantId } = await request.json();

    if (!participantId) {
      return NextResponse.json({ error: "participantId required" }, { status: 400 });
    }

    // CASCADE siler: participant → test_sessions → image_results
    const { error } = await supabase
      .from("participants")
      .delete()
      .eq("id", participantId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
