"use client";

import { useState, useTransition } from "react";
import type { AnaliseDesafio, DesafioPullResult, JogoDesafio } from "@/lib/desafio/types";
import styles from "./DesafioPanel.module.css";

function minutosAte(inicioEm: string): number {
  return Math.round((new Date(inicioEm).getTime() - Date.now()) / 60_000);
}

function minutosLabel(inicioEm: string): string {
  const m = minutosAte(inicioEm);
  if (m <= 0) return "ao vivo / iniciado";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}min`;
}

function horarioLabel(inicioEm: string): string {
  return new Date(inicioEm).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function VereditoBadge({ veredito }: { veredito: AnaliseDesafio["veredito"] }) {
  return <span className={`${styles.badge} ${styles[veredito]}`}>{veredito}</span>;
}

function JogoRow({
  jogo,
  analise,
}: {
  jogo: JogoDesafio;
  analise?: AnaliseDesafio;
}) {
  const podeLancar = analise?.podeLancar ?? false;

  return (
    <article className={`${styles.row} ${podeLancar ? styles.ready : ""}`}>
      <div className={styles.match}>
        <p className={styles.liga}>{jogo.liga}</p>
        <h3>
          {jogo.casa} <span>x</span> {jogo.fora}
        </h3>
        <p className={styles.metaJogo}>
          {jogo.selecao} · {jogo.odd.toFixed(2)} · {horarioLabel(jogo.inicioEm)} · em{" "}
          {minutosLabel(jogo.inicioEm)}
        </p>
        {analise && (
          <p className={podeLancar ? styles.launchReady : styles.launchWait}>
            {podeLancar
              ? "Pronto para lançar (≤30 min)"
              : `Lista 24h · libera em ~${analise.minutosParaLiberar} min`}
          </p>
        )}
      </div>

      {analise ? (
        <div className={styles.analise}>
          <div className={styles.analiseTop}>
            <VereditoBadge veredito={analise.veredito} />
            <strong>{analise.confianca}%</strong>
            <span className={styles.fonte}>{analise.fonte}</span>
          </div>
          <p className={styles.tese}>{analise.tese}</p>
          <ul className={styles.riscos}>
            {analise.riscos.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className={styles.criterios}>
            <span data-ok={analise.encaixaCriterios.mercado}>Mercado</span>
            <span data-ok={analise.encaixaCriterios.faixaOdd}>Odd 1.60–1.80</span>
            <span data-ok={analise.podeLancar}>Lançar ≤30 min</span>
          </div>
        </div>
      ) : (
        <p className={styles.aguardando}>Aguardando análise…</p>
      )}
    </article>
  );
}

export function DesafioPanel() {
  const [data, setData] = useState<DesafioPullResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function puxar() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/desafio/puxar", { method: "POST" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Falha ao puxar jogos");
        setData(json as DesafioPullResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro desconhecido");
      }
    });
  }

  const jogosOrdenados = data
    ? [...data.jogos].sort((a, b) => {
        const aa = data.analises.find((x) => x.jogoId === a.id);
        const bb = data.analises.find((x) => x.jogoId === b.id);
        const ar = aa?.podeLancar ? 0 : 1;
        const br = bb?.podeLancar ? 0 : 1;
        if (ar !== br) return ar - br;
        return minutosAte(a.inicioEm) - minutosAte(b.inicioEm);
      })
    : [];

  const liberados = data?.analises.filter((a) => a.podeLancar).length ?? 0;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            SUGESTÃO DE <span>DESAFIO</span>
          </h1>
          <p className={styles.subtitle}>
            LISTA 24H · LANÇAMENTO SÓ NOS ÚLTIMOS 30 MIN · OVER/UNDER 2.5 · BETBRA 1.60–1.80
          </p>
        </div>
        <button className={styles.cta} onClick={puxar} disabled={pending} type="button">
          {pending ? "Analisando…" : "Puxar 24h + IA"}
        </button>
      </header>

      <p className={styles.vpsNote}>
        Mostra jogos das próximas 24h · período máximo para lançar: 30 min antes do kickoff
      </p>

      {error && <p className={styles.error}>{error}</p>}

      {!data && !pending && (
        <p className={styles.empty}>
          Clique em <strong>Puxar 24h + IA</strong> para listar as partidas das próximas 24
          horas. Só as que estiverem a ≤30 min do início ficam liberadas para lançar.
        </p>
      )}

      {pending && <p className={styles.empty}>Puxando jogos e rodando análise…</p>}

      {data && (
        <div className={styles.list}>
          <p className={styles.stamp}>
            {data.jogos.length} na lista (24h) · {liberados} liberado(s) para lançar ·{" "}
            {new Date(data.analisadoEm).toLocaleString("pt-BR")}
          </p>
          {jogosOrdenados.map((jogo) => (
            <JogoRow
              key={jogo.id}
              jogo={jogo}
              analise={data.analises.find((a) => a.jogoId === jogo.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
