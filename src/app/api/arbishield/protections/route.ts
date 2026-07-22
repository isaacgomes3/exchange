import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createProtection,
  type BalanceType,
} from "@/lib/arbishield/create-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url =
    process.env.ARBISHIELD_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key =
    process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin não configurado");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function userFromBearer(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const url =
    process.env.ARBISHIELD_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${m[1]}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(m[1]);
  if (error || !data.user) return null;
  return data.user;
}

/**
 * POST /api/arbishield/protections
 * Body: { matchId, marketId?, amountCents, odd, balanceType?, marketType?, side?, metadata? }
 */
export async function POST(request: Request) {
  const user = await userFromBearer(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Não autorizado" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido" },
      { status: 400 }
    );
  }

  try {
    const admin = adminClient();
    const result = await createProtection(admin, {
      userId: user.id,
      matchId: String(body.matchId || ""),
      marketId: body.marketId ? String(body.marketId) : null,
      amountCents: Number(body.amountCents),
      odd: Number(body.odd),
      balanceType: (body.balanceType as BalanceType) || "REAL",
      marketType:
        body.marketType === "BACK" || body.marketType === "LAY"
          ? body.marketType
          : undefined,
      side: body.side ? String(body.side) : "home",
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : {},
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as Error & { status?: number }).status || 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
