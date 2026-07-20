"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { V2AdminNav } from "@/components/v2/V2AdminNav";

type PreliveEvent = {
  id?: string | number;
  eventId?: string | number;
  name?: string;
  home?: string;
  away?: string;
  startsAt?: string;
  startTime?: string;
  competition?: string;
  league?: string;
};

export default function V2AdminJogosPage() {
  const router = useRouter();
  const [events, setEvents] = useState<PreliveEvent[]>([]);
  const [meta, setMeta] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/v2/auth");
        return;
      }

      const res = await fetch("/api/arbishield/prelive-events", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const list: PreliveEvent[] =
        json.events || json.items || json.data || [];
      setEvents(Array.isArray(list) ? list : []);
      setMeta(
        `${Array.isArray(list) ? list.length : 0} jogos · BetBra pré-live`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar jogos");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="v2-shell">
      <V2AdminNav />
      <h1>
        Próximos <span>jogos</span>
      </h1>
      <p className="v2-meta">{meta || "API BetBra via /api/arbishield/prelive-events"}</p>
      <div className="v2-actions" style={{ marginTop: 0, marginBottom: 18 }}>
        <button type="button" className="v2-btn v2-btn-primary" onClick={load}>
          Atualizar
        </button>
        <a href="/admin/matches" className="v2-btn v2-btn-ghost">
          Página VPS completa
        </a>
      </div>
      {error ? (
        <div className="v2-err show" style={{ display: "block" }}>
          {error}
        </div>
      ) : null}
      {loading ? <p className="v2-meta">Carregando…</p> : null}
      <div className="v2-list">
        {events.slice(0, 40).map((ev, i) => {
          const title =
            ev.name ||
            [ev.home, ev.away].filter(Boolean).join(" vs ") ||
            `Evento ${ev.id || ev.eventId || i}`;
          const when = ev.startsAt || ev.startTime || "";
          const league = ev.competition || ev.league || "";
          return (
            <article key={String(ev.id || ev.eventId || i)} className="v2-card">
              <strong>{league || "Evento"}</strong>
              <b style={{ fontSize: "1.05rem" }}>{title}</b>
              {when ? (
                <small style={{ color: "var(--v2-muted)", display: "block", marginTop: 8 }}>
                  {new Date(when).toLocaleString("pt-BR")}
                </small>
              ) : null}
            </article>
          );
        })}
        {!loading && events.length === 0 ? (
          <p className="v2-meta">Nenhum jogo na janela atual.</p>
        ) : null}
      </div>
    </div>
  );
}
