import { NextResponse } from "next/server";
import { runConnectivityTest } from "@/lib/betbra/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await runConnectivityTest();
  return NextResponse.json(result, { status: result.allOk ? 200 : 503 });
}
