import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, calibrationErrorPx, screenWidth, screenHeight, imageCount } = body;

    const validStatuses = ["in_progress", "calibration_failed", "completed", "abandoned"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const update: Record<string, unknown> = { status };
    if (calibrationErrorPx !== undefined) update.calibration_error_px = calibrationErrorPx;
    if (screenWidth !== undefined) update.screen_width = screenWidth;
    if (screenHeight !== undefined) update.screen_height = screenHeight;
    if (imageCount !== undefined) update.image_count = imageCount;
    if (status === "completed" || status === "abandoned") {
      update.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("test_sessions")
      .update(update)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
