import { NextResponse } from "next/server";
import {
  addRule,
  ensureSupabaseHydrated,
  getRules,
  updateRule,
} from "@/lib/exchange/store";
import type { AlertRule } from "@/types/exchange";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSupabaseHydrated();
  return NextResponse.json({ rules: getRules() });
}

export async function POST(request: Request) {
  await ensureSupabaseHydrated();
  const body = (await request.json()) as Omit<AlertRule, "id">;
  const rule = addRule(body);
  return NextResponse.json({ rule }, { status: 201 });
}

export async function PATCH(request: Request) {
  await ensureSupabaseHydrated();
  const body = (await request.json()) as { id: string } & Partial<AlertRule>;
  const { id, ...updates } = body;
  const rule = updateRule(id, updates);
  if (!rule) {
    return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
  }
  return NextResponse.json({ rule });
}
