import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("test_images")
    .select("id, image_url, display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
