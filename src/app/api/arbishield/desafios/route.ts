import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Lista desafios para /admin/desafios (substitui o antigo serverfn-shim). */
export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase não configurado no servidor" },
      { status: 503 }
    );
  }

  const { data, error } = await admin
    .from("desafios")
    .select("*, desafio_steps(*)")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
