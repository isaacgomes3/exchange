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

  /** Sandbox/teste: /sandbox/ no domínio prod, porta 8090, ou host teste.* */
  function isTesteEnv() {
    var loc = global.location || {};
    var h = String(loc.hostname || "").toLowerCase();
    var p = String(loc.port || "");
    var path = String(loc.pathname || "");
    if (path.indexOf("/sandbox/") === 0) return true;
    if (p === "8090" || p === "8091") return true;
    if (h === "teste.arbishield.app" || h.indexOf("teste.") === 0) return true;
    return false;
  }

  function ensureTesteBanner() {
    if (!isTesteEnv()) return;
    if (typeof document === "undefined") return;
    if (document.getElementById("arbishield-teste-banner")) return;
    var b = document.createElement("div");
    b.id = "arbishield-teste-banner";
    b.setAttribute("role", "status");
    b.style.cssText =
      "position:sticky;top:0;z-index:99999;background:#7c2d12;color:#ffedd5;" +
      "text-align:center;padding:8px 12px;font:700 12px/1.4 ui-sans-serif,system-ui,sans-serif;" +
      "letter-spacing:0.04em";
    var origin = String((global.location && global.location.origin) || "localhost:8090");
    b.textContent =
      "AMBIENTE DE TESTE (" +
      origin +
      ") — não é produção. Banco pode ser o mesmo: cuidado com settle/pagamentos.";
    var mount = document.body || document.documentElement;
    if (mount) mount.prepend(b);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureTesteBanner);
    } else {
      ensureTesteBanner();
    }
  }

  function client() {
    if (!global.supabase) throw new Error("supabase-js não carregou");
    return global.supabase.createClient(global.location.origin, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Sessão separada no teste para não misturar login com produção no mesmo browser
        storageKey: isTesteEnv()
          ? "sb-arbishield-teste-auth-token"
          : "sb-arbishield-auth-token",
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

  function mapTsdbTeams(rows, q) {
    return (Array.isArray(rows) ? rows : [])
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
      });
  }

  function rankTeamMatch(team, q) {
    var name = String(team.name || "").toLowerCase();
    var ql = String(q || "").toLowerCase();
    var score = 100;
    if (name === ql) score = 0;
    else if (name.indexOf(ql) === 0) score = 10;
    else if (name.indexOf(ql) >= 0) score = 20;
    // Preferir masculino / superliga quando o nome bate parcialmente
    var league = String(team.league || "").toLowerCase();
    if (/women|femin|a-liga|wsl/.test(league) || /\bQ\b/.test(team.name || "")) {
      score += 40;
    }
    return score;
  }

  async function searchFootballTeams(query) {
    var q = String(query || "").trim();
    if (q.length < 2) return [];

    async function fromApi(term) {
      try {
        var res = await fetch(
          "/api/arbishield/football-teams?q=" + encodeURIComponent(term),
          { cache: "no-store" }
        );
        var ct = String(res.headers.get("content-type") || "");
        if (res.ok && ct.indexOf("json") >= 0) {
          var data = await res.json();
          if (data && data.ok !== false && Array.isArray(data.teams) && data.teams.length) {
            return data.teams;
          }
        }
      } catch (e) {}
      return [];
    }

    async function fromTsdb(term) {
      try {
        var res2 = await fetch(
          "https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=" +
            encodeURIComponent(term),
          { cache: "no-store" }
        );
        if (!res2.ok) return [];
        var raw = await res2.json();
        return mapTsdbTeams(raw && raw.teams, term);
      } catch (e2) {
        return [];
      }
    }

    // Variantes: "Odense" também tenta "Odense BK" (API às vezes só devolve Odense Q)
    var variants = [q];
    if (q.indexOf(" ") < 0) {
      variants.push(q + " BK");
      variants.push(q + " FC");
      variants.push(q + " United");
    }

    var seen = {};
    var all = [];
    for (var i = 0; i < variants.length; i++) {
      var term = variants[i];
      var batch = await fromApi(term);
      if (!batch.length) batch = await fromTsdb(term);
      for (var j = 0; j < batch.length; j++) {
        var t = batch[j];
        var key = String(t.name || "").toLowerCase();
        if (!key || seen[key]) continue;
        seen[key] = 1;
        all.push(t);
      }
    }

    all.sort(function (a, b) {
      return rankTeamMatch(a, q) - rankTeamMatch(b, q);
    });
    return all.slice(0, 20);
  }

  async function resolveFootballTeamLogo(teamName) {
    var name = String(teamName || "").trim();
    if (name.length < 2) return "";
    var teams = await searchFootballTeams(name);
    if (!teams.length) return "";
    var exact = teams.find(function (t) {
      return String(t.name || "").toLowerCase() === name.toLowerCase();
    });
    return (exact && exact.logo) || (teams[0] && teams[0].logo) || "";
  }

  var IMPERSONATE_KEY = "impersonated_user_id";
  var IMPERSONATE_NAME_KEY = "impersonated_user_name";

  function getImpersonation() {
    try {
      var id = sessionStorage.getItem(IMPERSONATE_KEY);
      if (!id) return null;
      return {
        id: id,
        name: sessionStorage.getItem(IMPERSONATE_NAME_KEY) || "",
      };
    } catch (e) {
      return null;
    }
  }

  function getEffectiveUserId(authUser) {
    var imp = getImpersonation();
    if (imp && imp.id) return imp.id;
    return authUser && authUser.id ? authUser.id : null;
  }

  function setImpersonation(userId, opts) {
    opts = opts || {};
    if (!userId) {
      clearImpersonation({ redirect: opts.redirect || "/admin-users.html" });
      return;
    }
    try {
      sessionStorage.setItem(IMPERSONATE_KEY, String(userId));
      if (opts.name) sessionStorage.setItem(IMPERSONATE_NAME_KEY, String(opts.name));
      else sessionStorage.removeItem(IMPERSONATE_NAME_KEY);
    } catch (e) {}
    var dest = opts.redirect || "/app-carteira.html";
    location.href = dest;
  }

  function clearImpersonation(opts) {
    opts = opts || {};
    try {
      sessionStorage.removeItem(IMPERSONATE_KEY);
      sessionStorage.removeItem(IMPERSONATE_NAME_KEY);
    } catch (e) {}
    if (opts.redirect) location.href = opts.redirect;
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
    isTesteEnv: isTesteEnv,
    searchFootballTeams: searchFootballTeams,
    resolveFootballTeamLogo: resolveFootballTeamLogo,
    getImpersonation: getImpersonation,
    getEffectiveUserId: getEffectiveUserId,
    setImpersonation: setImpersonation,
    clearImpersonation: clearImpersonation,
  };
})(window);
