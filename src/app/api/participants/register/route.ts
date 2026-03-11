import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { hashTC, validateTCServer } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Sınırsız deneme yapabilecek TC hash'leri (test amaçlı)
const UNLIMITED_TC_HASHES = new Set<string>();
// Başlangıçta hash'leri hesapla
const UNLIMITED_TCS = ["11654859098"];
const initUnlimitedHashes = async () => {
  for (const tc of UNLIMITED_TCS) {
    const hash = await hashTC(tc);
    UNLIMITED_TC_HASHES.add(hash);
  }
};
const _initPromise = initUnlimitedHashes();

export async function POST(request: NextRequest) {
  try {
    const { fullName, tc } = await request.json();

    if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
      return NextResponse.json({ error: "Geçerli bir ad soyad girin." }, { status: 400 });
    }

    if (!tc || !validateTCServer(tc)) {
      return NextResponse.json({ error: "Geçerli bir TC Kimlik No girin." }, { status: 400 });
    }

    const tcHash = await hashTC(tc);

    // Check if participant already exists
    const { data: existing } = await supabase
      .from("participants")
      .select("id")
      .eq("tc_hash", tcHash)
      .single();

    if (existing) {
      // Sınırsız TC'ler için completed kontrolünü atla
      await _initPromise;
      const isUnlimited = UNLIMITED_TC_HASHES.has(tcHash);

      if (!isUnlimited) {
        // Check if they have a completed session
        const { data: activeSessions } = await supabase
          .from("test_sessions")
          .select("id, status")
          .eq("participant_id", existing.id)
          .in("status", ["completed"]);

        if (activeSessions && activeSessions.length > 0) {
          return NextResponse.json(
            { error: "Bu TC ile daha önce test yapılmıştır." },
            { status: 409 }
          );
        }
      }

      // Create new session for existing participant
      const { data: session, error: sessionError } = await supabase
        .from("test_sessions")
        .insert({
          participant_id: existing.id,
          user_agent: request.headers.get("user-agent") || null,
        })
        .select()
        .single();

      if (sessionError) {
        return NextResponse.json({ error: sessionError.message }, { status: 500 });
      }

      return NextResponse.json({
        participantId: existing.id,
        sessionId: session.id,
      });
    }

    // Create new participant
    const { data: participant, error: participantError } = await supabase
      .from("participants")
      .insert({
        full_name: fullName.trim(),
        tc_hash: tcHash,
      })
      .select()
      .single();

    if (participantError) {
      return NextResponse.json({ error: participantError.message }, { status: 500 });
    }

    // Create session
    const { data: session, error: sessionError } = await supabase
      .from("test_sessions")
      .insert({
        participant_id: participant.id,
        user_agent: request.headers.get("user-agent") || null,
      })
      .select()
      .single();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    return NextResponse.json({
      participantId: participant.id,
      sessionId: session.id,
    });
  } catch (err) {
    console.error("[register] Error:", err);
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
}
