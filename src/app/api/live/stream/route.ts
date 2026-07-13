import {
  getBetBraStatus,
  getLiveGames,
  startBetBraPoller,
  subscribe,
} from "@/lib/exchange/store";

export const dynamic = "force-dynamic";

export async function GET() {
  startBetBraPoller();

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
        betbraStatus: getBetBraStatus(),
        timestamp: new Date().toISOString(),
      });

      unsubscribe = subscribe(({ games, alert, betbraStatus }) => {
        if (alert) {
          send({
            type: "alert",
            alert,
            games,
            betbraStatus,
            timestamp: new Date().toISOString(),
          });
        } else if (betbraStatus) {
          send({
            type: "status",
            games,
            betbraStatus,
            timestamp: new Date().toISOString(),
          });
        } else {
          send({
            type: "games",
            games,
            betbraStatus: getBetBraStatus(),
            timestamp: new Date().toISOString(),
          });
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
