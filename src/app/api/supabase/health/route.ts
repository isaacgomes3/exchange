import { NextResponse } from "next/server";
import {
  getSupabaseUrl,
  isSupabaseConfigured,
  isSupabasePersistenceEnabled,
} from "@/lib/supabase/config";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        message:
          "Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY",
      },
      { status: 503 }
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        persistence: false,
        message: "Cliente Supabase indisponível",
      },
      { status: 503 }
    );
  }

  const { error: profilesError } = await supabase
    .from("profiles")
    .select("id")
    .limit(1);

  const { error: matchesError } = await supabase
    .from("matches")
    .select("id")
    .limit(1);

  const tableError = profilesError || matchesError;

  if (tableError) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        persistence: isSupabasePersistenceEnabled(),
        url: getSupabaseUrl(),
        message: "Conectou, mas tabelas ArbiShield ainda não existem na VPS.",
        error: tableError.message,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    persistence: isSupabasePersistenceEnabled(),
    url: getSupabaseUrl(),
    message: "Supabase ArbiShield conectado",
  });
}
