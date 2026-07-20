import { NextResponse } from "next/server";
import { puxarEAnalisarDesafio } from "@/lib/desafio";

export const dynamic = "force-dynamic";

/** POST /api/desafio/puxar — puxa jogos e roda a IA de análise */
export async function POST() {
  try {
    const result = await puxarEAnalisarDesafio();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao analisar Desafio";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
