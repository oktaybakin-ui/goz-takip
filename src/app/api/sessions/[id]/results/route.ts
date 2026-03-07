import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { results, calibrationErrorPx, screenWidth, screenHeight } = await request.json();

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: "No results provided" }, { status: 400 });
    }

    // Insert image results
    const rows = results.map((r: {
      imageIndex: number;
      imageUrl: string;
      testImageId?: string;
      imageWidth: number;
      imageHeight: number;
      gazePoints: unknown[];
      fixations: unknown[];
      saccades?: unknown[];
      metrics?: Record<string, unknown>;
      heatmapDataUrl?: string;
    }) => ({
      session_id: id,
      test_image_id: r.testImageId || null,
      image_index: r.imageIndex,
      image_url: r.imageUrl,
      image_width: r.imageWidth,
      image_height: r.imageHeight,
      gaze_points: r.gazePoints,
      fixations: r.fixations,
      saccades: r.saccades || [],
      metrics: r.metrics || null,
      heatmap_data_url: r.heatmapDataUrl || null,
    }));

    const { error: insertError } = await supabase
      .from("image_results")
      .insert(rows);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Update session as completed
    const { error: updateError } = await supabase
      .from("test_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        calibration_error_px: calibrationErrorPx,
        screen_width: screenWidth,
        screen_height: screenHeight,
        image_count: results.length,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
