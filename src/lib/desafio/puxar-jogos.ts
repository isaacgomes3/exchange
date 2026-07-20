import type { JogoDesafio } from "./types";

const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/123";
const JANELA_MS = 24 * 60 * 60 * 1000;

type SportsDbEvent = {
  idEvent?: string;
  strLeague?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strTimestamp?: string;
  strStatus?: string;
  strPostponed?: string;
};

type SportsDbDayResponse = {
  events?: SportsDbEvent[] | null;
};

function diaUTC(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

function pickOdd(seed: number): number {
  const faixa = [1.62, 1.65, 1.68, 1.7, 1.72, 1.75, 1.78, 1.85, 1.92, 1.55];
  return faixa[seed % faixa.length];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Gera perfil de gols/odds estável a partir do id do evento (sem API de odds). */
function enriquecer(evento: SportsDbEvent, inicioEm: string): JogoDesafio | null {
  const id = evento.idEvent;
  const casa = evento.strHomeTeam?.trim();
  const fora = evento.strAwayTeam?.trim();
  if (!id || !casa || !fora) return null;

  const seed = hashSeed(id);
  const ataque = 0.8 + (seed % 13) / 10;
  const defesa = 0.7 + ((seed >> 3) % 11) / 10;
  const mediaCasa = round1(ataque);
  const mediaFora = round1(0.7 + ((seed >> 5) % 12) / 10);
  const sofridosCasa = round1(defesa);
  const sofridosFora = round1(0.6 + ((seed >> 7) % 12) / 10);
  const esperados = (mediaCasa + mediaFora + sofridosCasa + sofridosFora) / 2;
  const selecao: JogoDesafio["selecao"] = esperados >= 2.45 ? "Over 2.5" : "Under 2.5";
  const bttsPct = Math.min(78, Math.max(28, Math.round(30 + esperados * 12 + (seed % 9))));
  const odd = pickOdd(seed);
  const surebetSpread = round1(0.3 + (seed % 20) / 10);

  return {
    id: `tsdb-${id}`,
    liga: evento.strLeague?.trim() || "Futebol",
    casa,
    fora,
    inicioEm,
    mercado: "Over/Under 2.5",
    selecao,
    odd,
    bookmaker: "BetBra",
    mediaGolsCasa: mediaCasa,
    mediaGolsFora: mediaFora,
    mediaGolsSofridosCasa: sofridosCasa,
    mediaGolsSofridosFora: sofridosFora,
    bttsPct,
    surebetSpread,
  };
}

async function buscarDia(date: string): Promise<SportsDbEvent[]> {
  const url = `${SPORTSDB_BASE}/eventsday.php?d=${date}&s=Soccer`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`TheSportsDB ${res.status}`);
  const data = (await res.json()) as SportsDbDayResponse;
  return data.events ?? [];
}

function dentroDasProximas24h(inicioMs: number, agora: number): boolean {
  return inicioMs > agora && inicioMs <= agora + JANELA_MS;
}

/**
 * Puxa jogos de futebol das próximas 24h (TheSportsDB).
 * Odds/perfil Over-Under são enriquecidos localmente para a análise do Desafio.
 */
export async function puxarJogosDesafio(): Promise<JogoDesafio[]> {
  const agora = Date.now();
  let eventos: SportsDbEvent[] = [];

  try {
    const [hoje, amanha] = await Promise.all([buscarDia(diaUTC(0)), buscarDia(diaUTC(1))]);
    eventos = [...hoje, ...amanha];
  } catch (err) {
    console.error("[desafio] falha ao buscar fixtures 24h:", err);
    return jogosFallback24h(agora);
  }

  const jogos: JogoDesafio[] = [];
  const vistos = new Set<string>();

  for (const ev of eventos) {
    if (ev.strPostponed === "yes") continue;
    if (ev.strStatus && !["NS", "Not Started", "Scheduled", ""].includes(ev.strStatus)) continue;
    if (!ev.strTimestamp) continue;

    const inicioMs = new Date(ev.strTimestamp.endsWith("Z") ? ev.strTimestamp : `${ev.strTimestamp}Z`).getTime();
    if (!Number.isFinite(inicioMs) || !dentroDasProximas24h(inicioMs, agora)) continue;

    const jogo = enriquecer(ev, new Date(inicioMs).toISOString());
    if (!jogo || vistos.has(jogo.id)) continue;
    vistos.add(jogo.id);
    jogos.push(jogo);
  }

  jogos.sort((a, b) => new Date(a.inicioEm).getTime() - new Date(b.inicioEm).getTime());

  // TheSportsDB free pode vir escasso — completa a grade das próximas 24h
  if (jogos.length < 8) {
    const extras = jogosFallback24h(agora).filter(
      (j) => !jogos.some((g) => g.casa === j.casa && g.fora === j.fora)
    );
    return [...jogos, ...extras]
      .sort((a, b) => new Date(a.inicioEm).getTime() - new Date(b.inicioEm).getTime())
      .slice(0, 20);
  }

  return jogos.slice(0, 40);
}

/** Fallback se a API externa falhar ou não houver jogos. */
function jogosFallback24h(agora: number): JogoDesafio[] {
  const emHoras = (h: number) => new Date(agora + h * 3_600_000).toISOString();
  const base: Array<Omit<JogoDesafio, "inicioEm"> & { emHoras: number }> = [
    {
      emHoras: 0.3,
      id: "fb-1001",
      liga: "Brasil - Série B",
      casa: "Sport Recife",
      fora: "Criciúma",
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.72,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.6,
      mediaGolsFora: 1.3,
      mediaGolsSofridosCasa: 1.1,
      mediaGolsSofridosFora: 1.4,
      bttsPct: 58,
      surebetSpread: 1.8,
    },
    {
      emHoras: 0.45,
      id: "fb-1002",
      liga: "Argentina - Primera",
      casa: "Racing",
      fora: "Lanús",
      mercado: "Over/Under 2.5",
      selecao: "Under 2.5",
      odd: 1.65,
      bookmaker: "BetBra",
      mediaGolsCasa: 0.9,
      mediaGolsFora: 0.8,
      mediaGolsSofridosCasa: 0.7,
      mediaGolsSofridosFora: 0.9,
      bttsPct: 34,
      surebetSpread: 2.1,
    },
    {
      emHoras: 3,
      id: "fb-1003",
      liga: "Portugal - Liga 2",
      casa: "Feirense",
      fora: "Mafra",
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.78,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.8,
      mediaGolsFora: 1.5,
      mediaGolsSofridosCasa: 1.3,
      mediaGolsSofridosFora: 1.6,
      bttsPct: 62,
      surebetSpread: 1.5,
    },
    {
      emHoras: 8,
      id: "fb-1004",
      liga: "Brasil - Série A",
      casa: "Flamengo",
      fora: "Palmeiras",
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.7,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.9,
      mediaGolsFora: 1.4,
      mediaGolsSofridosCasa: 0.9,
      mediaGolsSofridosFora: 1.2,
      bttsPct: 55,
      surebetSpread: 1.2,
    },
    {
      emHoras: 14,
      id: "fb-1005",
      liga: "México - Liga MX",
      casa: "América",
      fora: "Monterrey",
      mercado: "Over/Under 2.5",
      selecao: "Under 2.5",
      odd: 1.68,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.1,
      mediaGolsFora: 1.0,
      mediaGolsSofridosCasa: 0.8,
      mediaGolsSofridosFora: 1.0,
      bttsPct: 42,
      surebetSpread: 0.9,
    },
    {
      emHoras: 20,
      id: "fb-1006",
      liga: "EUA - MLS",
      casa: "Inter Miami",
      fora: "LAFC",
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.74,
      bookmaker: "BetBra",
      mediaGolsCasa: 2.0,
      mediaGolsFora: 1.6,
      mediaGolsSofridosCasa: 1.4,
      mediaGolsSofridosFora: 1.5,
      bttsPct: 64,
      surebetSpread: 1.6,
    },
    {
      emHoras: 5,
      id: "fb-1007",
      liga: "Suécia - Allsvenskan",
      casa: "Malmö FF",
      fora: "AIK",
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.76,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.7,
      mediaGolsFora: 1.2,
      mediaGolsSofridosCasa: 1.0,
      mediaGolsSofridosFora: 1.3,
      bttsPct: 52,
      surebetSpread: 1.1,
    },
    {
      emHoras: 11,
      id: "fb-1008",
      liga: "Inglaterra - Championship",
      casa: "Leeds",
      fora: "Norwich",
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.69,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.8,
      mediaGolsFora: 1.4,
      mediaGolsSofridosCasa: 1.1,
      mediaGolsSofridosFora: 1.5,
      bttsPct: 57,
      surebetSpread: 1.4,
    },
    {
      emHoras: 17,
      id: "fb-1009",
      liga: "Colômbia - Primera A",
      casa: "Millonarios",
      fora: "Nacional",
      mercado: "Over/Under 2.5",
      selecao: "Under 2.5",
      odd: 1.66,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.0,
      mediaGolsFora: 0.9,
      mediaGolsSofridosCasa: 0.8,
      mediaGolsSofridosFora: 1.0,
      bttsPct: 38,
      surebetSpread: 1.0,
    },
    {
      emHoras: 22,
      id: "fb-1010",
      liga: "Chile - Primera",
      casa: "Colo-Colo",
      fora: "Universidad de Chile",
      mercado: "Over/Under 2.5",
      selecao: "Over 2.5",
      odd: 1.73,
      bookmaker: "BetBra",
      mediaGolsCasa: 1.6,
      mediaGolsFora: 1.3,
      mediaGolsSofridosCasa: 1.2,
      mediaGolsSofridosFora: 1.4,
      bttsPct: 59,
      surebetSpread: 1.3,
    },
  ];

  return base.map(({ emHoras: h, ...jogo }) => ({
    ...jogo,
    inicioEm: emHoras(h),
  }));
}
