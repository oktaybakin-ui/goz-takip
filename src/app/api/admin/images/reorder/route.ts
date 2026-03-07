import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/api-helpers";

export async function PATCH(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const { orderedIds } = (await request.json()) as { orderedIds: string[] };

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json({ error: "orderedIds required" }, { status: 400 });
    }

    // Update each image's display_order
    const updates = orderedIds.map((id, index) =>
      supabase
        .from("test_images")
        .update({ display_order: index })
        .eq("id", id)
    );

    await Promise.all(updates);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
