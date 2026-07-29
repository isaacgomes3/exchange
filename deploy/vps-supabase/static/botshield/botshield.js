/**
 * BotShield core — auth + storage local dos bots.
 * Isolado do shell app/admin (host botshield.*).
 */
(function (global) {
  // Mesma anon key do v2 (Kong same-origin no subdomínio)
  const ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s";
  const STORAGE_KEY = "sb-botshield-auth-token";
  const BOTS_KEY = "botshield.bots.v1";

  function hostOk() {
    const h = String(location.hostname || "").toLowerCase();
    return (
      h === "botshield.arbishield.app" ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      h.endsWith(".local")
    );
  }

  function client() {
    if (!global.supabase) throw new Error("supabase-js ausente");
    return global.supabase.createClient(location.origin, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: STORAGE_KEY,
      },
    });
  }

  async function requireUser(sb) {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const session = data?.session;
    if (!session?.user) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = "/auth.html?next=" + next;
      return null;
    }
    return session.user;
  }

  function money(cents) {
    return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function initials(name, email) {
    const s = String(name || email || "?").trim();
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  }

  function seedBots() {
    return [
      {
        id: "b1",
        name: "lay 3x3",
        description: "entrada contra o placar 3x3",
        tags: ["Punter", "Lay", "Placar Exato 3-3"],
        active: false,
        wins: 1,
        losses: 0,
        pnlCents: 625,
        roi: 1,
        flatRoi: 0,
        winRate: 100,
        integrations: 1,
      },
      {
        id: "b2",
        name: "lay goleada",
        description: "entrada contra goleada do favorito",
        tags: ["Trader", "Lay", "Goleada"],
        active: false,
        wins: 2,
        losses: 1,
        pnlCents: 1480,
        roi: 2,
        flatRoi: 1,
        winRate: 67,
        integrations: 1,
      },
    ];
  }

  function loadBots() {
    try {
      const raw = localStorage.getItem(BOTS_KEY);
      if (!raw) {
        const seed = seedBots();
        localStorage.setItem(BOTS_KEY, JSON.stringify(seed));
        return seed;
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : seedBots();
    } catch {
      return seedBots();
    }
  }

  function saveBots(list) {
    localStorage.setItem(BOTS_KEY, JSON.stringify(list || []));
  }

  function upsertBot(bot) {
    const list = loadBots();
    const i = list.findIndex((b) => b.id === bot.id);
    if (i >= 0) list[i] = bot;
    else list.unshift(bot);
    saveBots(list);
    return list;
  }

  function removeBot(id) {
    const list = loadBots().filter((b) => b.id !== id);
    saveBots(list);
    return list;
  }

  function toggleBot(id, active) {
    const list = loadBots().map((b) =>
      b.id === id ? { ...b, active: !!active } : b
    );
    saveBots(list);
    return list;
  }

  global.BotShield = {
    hostOk,
    client,
    requireUser,
    money,
    initials,
    loadBots,
    saveBots,
    upsertBot,
    removeBot,
    toggleBot,
    ANON,
  };
})(window);
