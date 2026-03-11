import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { hashTC, validateTCServer } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

// Sınırsız deneme yapabilecek TC hash'leri (admin)
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

// Normal kullanıcılar için maksimum deneme hakkı
const MAX_ATTEMPTS = 3;

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
      // Admin TC'ler sınırsız deneme hakkına sahip
      await _initPromise;
      const isUnlimited = UNLIMITED_TC_HASHES.has(tcHash);

      if (!isUnlimited) {
        // Tüm oturumları say (tamamlanmış + devam eden + terk edilmiş)
        const { data: allSessions, error: countError } = await supabase
          .from("test_sessions")
          .select("id, status")
          .eq("participant_id", existing.id);

        if (countError) {
          return NextResponse.json({ error: countError.message }, { status: 500 });
        }

        const sessionCount = allSessions?.length || 0;
        if (sessionCount >= MAX_ATTEMPTS) {
          return NextResponse.json(
            { error: `Deneme hakkınız dolmuştur (${MAX_ATTEMPTS}/${MAX_ATTEMPTS}). Daha fazla test yapamazsınız.` },
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

      // Kalan hak bilgisi
      const { count: newCount } = await supabase
        .from("test_sessions")
        .select("id", { count: "exact", head: true })
        .eq("participant_id", existing.id);

      return NextResponse.json({
        participantId: existing.id,
        sessionId: session.id,
        attemptsUsed: newCount || 1,
        maxAttempts: isUnlimited ? -1 : MAX_ATTEMPTS,
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
      attemptsUsed: 1,
      maxAttempts: MAX_ATTEMPTS,
    });
  } catch (err) {
    console.error("[register] Error:", err);
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
}
