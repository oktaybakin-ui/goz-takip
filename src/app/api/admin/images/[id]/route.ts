import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** PUT — Kırpılmış görseli mevcut görselin yerine yükle */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Get current record
    const { data: image } = await supabase
      .from("test_images")
      .select("storage_path")
      .eq("id", id)
      .single();

    if (!image) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Delete old file from storage
    await supabase.storage.from("test-images").remove([image.storage_path]);

    // Upload new cropped file
    const ext = "jpg";
    const storagePath = `images/${Date.now()}_${Math.random().toString(36).slice(2)}_cropped.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("test-images")
      .upload(storagePath, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from("test-images")
      .getPublicUrl(storagePath);

    // Update DB record
    const { data: updated, error: updateError } = await supabase
      .from("test_images")
      .update({
        image_url: urlData.publicUrl,
        storage_path: storagePath,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Crop upload failed" }, { status: 500 });
  }
}

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
