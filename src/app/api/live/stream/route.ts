import { getLiveGames, startSimulator, subscribe } from "@/lib/exchange/store";

export const dynamic = "force-dynamic";

export async function GET() {
  startSimulator();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      send({
        type: "games",
        games: getLiveGames(),
        timestamp: new Date().toISOString(),
      });

      unsubscribe = subscribe(({ games, alert }) => {
        if (alert) {
          send({ type: "alert", alert, games, timestamp: new Date().toISOString() });
        } else {
          send({ type: "games", games, timestamp: new Date().toISOString() });
        }
      });

      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", timestamp: new Date().toISOString() });
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe?.();
      };

      (controller as { _cleanup?: () => void })._cleanup = cleanup;
    },
    cancel() {
      const ctrl = this as unknown as { _cleanup?: () => void };
      ctrl._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
