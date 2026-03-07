import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/api-helpers";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;

  // Get storage path before deleting
  const { data: image } = await supabase
    .from("test_images")
    .select("storage_path")
    .eq("id", id)
    .single();

  if (!image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Soft delete (set inactive)
  const { error } = await supabase
    .from("test_images")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also remove from storage
  await supabase.storage.from("test-images").remove([image.storage_path]);

  return NextResponse.json({ success: true });
}
