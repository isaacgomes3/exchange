import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getSupabaseUrl,
  isSupabaseConfigured,
  isSupabasePersistenceEnabled,
} from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        message:
          "Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local",
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

  const { error: rulesError } = await supabase
    .from("alert_rules")
    .select("id", { count: "exact", head: true });

  const { error: alertsError } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true });

  const tableError = rulesError || alertsError;

  if (tableError) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        persistence: isSupabasePersistenceEnabled(),
        url: getSupabaseUrl(),
        message:
          "Conectou, mas as tabelas ainda não existem. Rode a migration em supabase/migrations/.",
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
    message: "Supabase conectado e tabelas acessíveis",
  });
}
