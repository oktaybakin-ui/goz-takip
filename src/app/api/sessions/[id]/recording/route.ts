import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const formData = await request.formData();
    const file = formData.get("video") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No video file" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const ext = file.type.includes("webm") ? "webm" : "mp4";
    const storagePath = `recordings/${id}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("test-images")
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("Recording upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("test-images")
      .getPublicUrl(storagePath);

    const recordingUrl = urlData?.publicUrl || null;

    // Update session with recording URL
    await supabase
      .from("test_sessions")
      .update({ recording_url: recordingUrl })
      .eq("id", id);

    return NextResponse.json({ success: true, recordingUrl });
  } catch (err) {
    console.error("Recording upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
