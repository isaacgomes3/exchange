import { NextResponse } from "next/server";
import { acknowledgeAlert, getAlerts } from "@/lib/exchange/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const alerts = getAlerts();
  const unacknowledged = alerts.filter((a) => !a.acknowledged).length;
  return NextResponse.json({ alerts, unacknowledged });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const { id, action } = body as { id: string; action: string };

  if (action === "acknowledge") {
    const success = acknowledgeAlert(id);
    if (!success) {
      return NextResponse.json({ error: "Alerta não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
