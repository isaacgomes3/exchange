/**
 * Cliente Supabase same-origin (anon key pública).
 */
(function (global) {
  var ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s";

  var BLOCKED_EMAILS = {
    "jefferson@arbishield.com": 1,
    "jefferson@arbishield": 1,
    "jeffersonboulevard@gmail.com": 1,
    "jeffersojeffersonboulevard@gmail.com": 1,
  };

  /** Só estes e-mails veem o menu/páginas Financeiro no admin */
  var FINANCE_ADMIN_EMAILS = {
    "isaacgomes3@gmail.com": 1,
    "financeiro@arbishield.com": 1,
  };

  var FINANCE_PAGE_IDS = {
    transactions: 1,
    saques: 1,
    "manual-deposits": 1,
    "depositos-desafio": 1,
    refunds: 1,
    treasury: 1,
    "partners-distribution": 1,
    expenses: 1,
  };

  function isBlockedEmail(email) {
    email = String(email || "")
      .trim()
      .toLowerCase();
    if (global.ArbiIsBlockedEmail) return !!global.ArbiIsBlockedEmail(email);
    return !!(email && BLOCKED_EMAILS[email]);
  }

  function canAccessFinance(email) {
    email = String(email || "")
      .trim()
      .toLowerCase();
    if (!email) return false;
    if (global.ArbiCanAccessFinance) return !!global.ArbiCanAccessFinance(email);
    return !!FINANCE_ADMIN_EMAILS[email];
  }

  function isFinancePageId(id) {
    return !!FINANCE_PAGE_IDS[String(id || "")];
  }

  function client() {
    if (!global.supabase) throw new Error("supabase-js não carregou");
    return global.supabase.createClient(global.location.origin, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "sb-arbishield-auth-token",
      },
    });
  }

  function money(cents) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format((cents || 0) / 100);
  }

  async function requireUser(supa) {
    var res = await supa.auth.getUser();
    if (res.error || !res.data.user) {
      location.replace("/auth.html");
      return null;
    }
    if (isBlockedEmail(res.data.user.email)) {
      try {
        await supa.auth.signOut();
      } catch (e) {}
      location.replace("/auth.html?blocked=1");
      return null;
    }
    return res.data.user;
  }

  async function requireAdmin(supa, user) {
    if (!user || isBlockedEmail(user.email)) return false;
    var profile = await supa
      .from("profiles")
      .select("is_super_admin")
      .eq("id", user.id)
      .maybeSingle();
    var roles = await supa
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    var ok =
      !!(profile.data && profile.data.is_super_admin) ||
      (roles.data || []).some(function (r) {
        return r.role === "admin" || r.role === "master_admin";
      });
    return ok;
  }

  async function requireFinanceAdmin(supa, user) {
    if (!(await requireAdmin(supa, user))) return false;
    return canAccessFinance(user && user.email);
  }

  async function searchFootballTeams(query) {
    var q = String(query || "").trim();
    if (q.length < 2) return [];

    // 1) API interna (quando nginx/prelive estiverem ok)
    try {
      var res = await fetch(
        "/api/arbishield/football-teams?q=" + encodeURIComponent(q),
        { cache: "no-store" }
      );
      var ct = String(res.headers.get("content-type") || "");
      if (res.ok && ct.indexOf("json") >= 0) {
        var data = await res.json();
        if (data && data.ok !== false && Array.isArray(data.teams) && data.teams.length) {
          return data.teams;
        }
      }
    } catch (e) {
      /* fallback abaixo */
    }

    // 2) Fallback aberto (TheSportsDB — CORS *)
    try {
      var res2 = await fetch(
        "https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=" +
          encodeURIComponent(q),
        { cache: "no-store" }
      );
      if (!res2.ok) return [];
      var raw = await res2.json();
      var rows = Array.isArray(raw && raw.teams) ? raw.teams : [];
      return rows
        .filter(function (t) {
          return String(t.strSport || "").toLowerCase() === "soccer";
        })
        .map(function (t) {
          var logo = String(t.strBadge || t.strLogo || "").trim() || null;
          return {
            id: "tsdb:" + (t.idTeam || t.strTeam || q),
            name: String(t.strTeam || "").trim(),
            shortName: String(t.strTeamShort || "").trim() || null,
            country: String(t.strCountry || "").trim() || null,
            league: String(t.strLeague || "").trim() || null,
            logo: logo || "",
            logoPng: logo,
            logoSvg: null,
            source: "thesportsdb",
          };
        })
        .filter(function (t) {
          return t.name && t.logo;
        })
        .slice(0, 20);
    } catch (e2) {
      return [];
    }
  }

  global.ArbiV2 = {
    client: client,
    money: money,
    requireUser: requireUser,
    requireAdmin: requireAdmin,
    requireFinanceAdmin: requireFinanceAdmin,
    canAccessFinance: canAccessFinance,
    isFinancePageId: isFinancePageId,
    isBlockedEmail: isBlockedEmail,
    searchFootballTeams: searchFootballTeams,
  };
})(window);
