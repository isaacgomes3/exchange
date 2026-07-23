/* Catálogo de mercados ArbiShield (autocomplete no lançamento de Desafio) */
(function (global) {
  const MARKET_GROUPS = [
    {
      label: "Total de Gols",
      options: [
        "Mais 0.5 gols na partida",
        "Mais 1.5 gols na partida",
        "Mais 2.5 gols na partida",
        "Mais 3.5 gols na partida",
        "Mais 4.5 gols na partida",
        "Mais 5.5 gols na partida",
        "Menos 0.5 gols na partida",
        "Menos 1.5 gols na partida",
        "Menos 2.5 gols na partida",
        "Menos 3.5 gols na partida",
        "Menos 4.5 gols na partida",
        "Menos 5.5 gols na partida",
      ],
    },
    {
      label: "Ambas Equipes Marcam",
      options: ["Ambas equipes marcam SIM", "Ambas equipes marcam NÃO"],
    },
    {
      label: "1° Tempo - Total de Gols",
      options: [
        "Mais 0.5 gols no primeiro tempo",
        "Mais 1.5 gols no primeiro tempo",
        "Mais 2.5 gols no primeiro tempo",
        "Menos 0.5 gols no primeiro tempo",
        "Menos 1.5 gols no primeiro tempo",
        "Menos 2.5 gols no primeiro tempo",
      ],
    },
    {
      label: "Resultado da Partida",
      options: [
        "Back Casa",
        "Back Empate",
        "Back Visitante",
        "Lay Casa",
        "Lay Empate",
        "Lay Visitante",
      ],
    },
    {
      label: "Resultado no 1° Tempo",
      options: [
        "Back Casa no primeiro tempo",
        "Back Empate no primeiro tempo",
        "Back Visitante no primeiro tempo",
        "Lay Casa no primeiro tempo",
        "Lay Empate no primeiro tempo",
        "Lay Visitante no primeiro tempo",
      ],
    },
    {
      label: "Total de Escanteios",
      options: [
        "Mais 5.5 escanteios",
        "Mais 6.5 escanteios",
        "Mais 7.5 escanteios",
        "Mais 8.5 escanteios",
        "Mais 9.5 escanteios",
        "Mais 10.5 escanteios",
        "Mais 11.5 escanteios",
        "Mais 12.5 escanteios",
        "Mais 13.5 escanteios",
        "Mais 14.5 escanteios",
        "Mais 15.5 escanteios",
        "Menos 6.5 escanteios",
        "Menos 7.5 escanteios",
        "Menos 8.5 escanteios",
        "Menos 9.5 escanteios",
        "Menos 10.5 escanteios",
        "Menos 11.5 escanteios",
        "Menos 12.5 escanteios",
        "Menos 13.5 escanteios",
        "Menos 14.5 escanteios",
        "Menos 15.5 escanteios",
      ],
    },
    {
      label: "1° Tempo - Total de Escanteios",
      options: [
        "Mais 1.5 escanteios no primeiro tempo",
        "Mais 2.5 escanteios no primeiro tempo",
        "Mais 3.5 escanteios no primeiro tempo",
        "Mais 4.5 escanteios no primeiro tempo",
        "Menos 1.5 escanteios no primeiro tempo",
        "Menos 2.5 escanteios no primeiro tempo",
        "Menos 3.5 escanteios no primeiro tempo",
        "Menos 4.5 escanteios no primeiro tempo",
      ],
    },
    {
      label: "Placar Exato - Lay",
      options: [
        "Lay 0x0",
        "Lay 1x0",
        "Lay 2x0",
        "Lay 0x1",
        "Lay 0x2",
        "Lay 1x1",
        "Lay 1x2",
        "Lay 2x1",
        "Lay 2x2",
        "Lay 3x0",
        "Lay 3x1",
        "Lay 3x2",
        "Lay 0x3",
        "Lay 1x3",
        "Lay 2x3",
        "Lay 3x3",
        "Lay Goleada Casa",
        "Lay Goleada Visitante",
      ],
    },
    {
      label: "Placar Exato - Back",
      options: [
        "Back 0x0",
        "Back 1x0",
        "Back 2x0",
        "Back 0x1",
        "Back 0x2",
        "Back 1x1",
        "Back 1x2",
        "Back 2x1",
        "Back 2x2",
        "Back Goleada Casa",
        "Back Goleada Visitante",
      ],
    },
    {
      label: "Total de Cartões",
      options: [
        "Mais 2.5 cartões na partida",
        "Mais 3.5 cartões na partida",
        "Mais 4.5 cartões na partida",
        "Mais 5.5 cartões na partida",
        "Mais 6.5 cartões na partida",
        "Menos 2.5 cartões na partida",
        "Menos 3.5 cartões na partida",
        "Menos 4.5 cartões na partida",
        "Menos 5.5 cartões na partida",
        "Menos 6.5 cartões na partida",
      ],
    },
    {
      label: "1° Tempo - Total de Cartões",
      options: [
        "Menos 1.5 cartões no primeiro tempo",
        "Menos 2.5 cartões no primeiro tempo",
        "Menos 3.5 cartões no primeiro tempo",
        "Menos 4.5 cartões no primeiro tempo",
      ],
    },
  ];

  function norm(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function flatOptions() {
    const out = [];
    for (const g of MARKET_GROUPS) {
      for (const name of g.options) {
        out.push({ name, group: g.label });
      }
    }
    return out;
  }

  const ALL = flatOptions();

  function searchMarkets(query, limit) {
    const q = norm(query);
    const max = Math.max(1, Math.min(40, Number(limit) || 16));
    if (!q) {
      // No foco vazio: mostra totais de gols primeiro (uso mais comum no Desafio)
      const goals = ALL.filter((x) => x.group === "Total de Gols");
      const rest = ALL.filter((x) => x.group !== "Total de Gols");
      return goals.concat(rest).slice(0, max);
    }
    const scored = [];
    for (const item of ALL) {
      const n = norm(item.name);
      const g = norm(item.group);
      let score = 0;
      if (n === q) score = 100;
      else if (n.startsWith(q + " ")) score = 90;
      else if (n.startsWith(q)) score = 80;
      else if (n.includes(q)) score = 60;
      else if (g.includes(q)) score = 30;
      else {
        const tokens = q.split(/\s+/).filter(Boolean);
        if (tokens.length && tokens.every((t) => n.includes(t) || g.includes(t))) {
          score = 40;
        }
      }
      if (score <= 0) continue;
      // Prioriza gols na partida e linha 2.5 (padrão do circuito)
      if (/\b2\.5\b/.test(n) && /gols/.test(n)) score += 12;
      else if (/gols na partida/.test(n)) score += 8;
      else if (item.group === "Total de Gols") score += 4;
      scored.push({ ...item, score });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt-BR"));
    return scored.slice(0, max).map(({ name, group }) => ({ name, group }));
  }

  /** Par oposto típico de desafio (Mais↔Menos, SIM↔NÃO, Back↔Lay). */
  function oppositeMarket(name) {
    const s = String(name || "").trim();
    if (!s) return "";
    if (/^Mais\b/i.test(s)) return s.replace(/^Mais\b/i, "Menos");
    if (/^Menos\b/i.test(s)) return s.replace(/^Menos\b/i, "Mais");
    if (/marcam SIM$/i.test(s)) return s.replace(/SIM$/i, "NÃO");
    if (/marcam NÃO$/i.test(s)) return s.replace(/NÃO$/i, "SIM");
    if (/^Back\b/i.test(s)) return s.replace(/^Back\b/i, "Lay");
    if (/^Lay\b/i.test(s)) return s.replace(/^Lay\b/i, "Back");
    return "";
  }

  global.ArbiMarketCatalog = {
    groups: MARKET_GROUPS,
    all: ALL,
    search: searchMarkets,
    opposite: oppositeMarket,
    normalize: norm,
  };
})(typeof window !== "undefined" ? window : globalThis);
