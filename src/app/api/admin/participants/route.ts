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
  const quality = searchParams.get("quality") || "";
  const minError = searchParams.get("minError") || "";
  const maxError = searchParams.get("maxError") || "";

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

  // Kalite filtresi: A(≤50), B(≤75), C(≤110), D(>110)
  if (quality === "A") {
    query = query.not("calibration_error_px", "is", null).lte("calibration_error_px", 50);
  } else if (quality === "B") {
    query = query.not("calibration_error_px", "is", null).gt("calibration_error_px", 50).lte("calibration_error_px", 75);
  } else if (quality === "C") {
    query = query.not("calibration_error_px", "is", null).gt("calibration_error_px", 75).lte("calibration_error_px", 110);
  } else if (quality === "D") {
    query = query.not("calibration_error_px", "is", null).gt("calibration_error_px", 110);
  }

  if (minError) {
    query = query.gte("calibration_error_px", parseFloat(minError));
  }
  if (maxError) {
    query = query.lte("calibration_error_px", parseFloat(maxError));
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
