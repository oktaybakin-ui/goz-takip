import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;

  // Get session with participant info
  const { data: session, error: sessionError } = await supabase
    .from("test_sessions")
    .select("*, participants!inner(id, full_name)")
    .eq("id", id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Get all image results for this session
  const { data: results, error: resultsError } = await supabase
    .from("image_results")
    .select("*")
    .eq("session_id", id)
    .order("image_index", { ascending: true });

  if (resultsError) {
    return NextResponse.json({ error: resultsError.message }, { status: 500 });
  }

  return NextResponse.json({ session, results: results ?? [] });
}
