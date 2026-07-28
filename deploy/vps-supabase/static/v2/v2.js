/**
 * Cliente Supabase same-origin (anon key pública).
 */
(function (global) {
  var ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s";

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
    return res.data.user;
  }

  async function requireAdmin(supa, user) {
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

  global.ArbiV2 = {
    client: client,
    money: money,
    requireUser: requireUser,
    requireAdmin: requireAdmin,
    searchFootballTeams: searchFootballTeams,
    resolveFootballTeamLogo: resolveFootballTeamLogo,
  };
})(window);
