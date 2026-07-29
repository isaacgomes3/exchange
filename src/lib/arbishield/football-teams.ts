export type FootballTeamResult = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
  league: string | null;
  logo: string;
  logoPng: string | null;
  logoSvg: string | null;
  source: "thesportsdb" | "football-data" | "merged";
};

type SportsDbTeam = {
  idTeam?: string;
  strTeam?: string;
  strTeamShort?: string;
  strTeamAlternate?: string;
  strSport?: string;
  strCountry?: string;
  strLeague?: string;
  strBadge?: string;
  strLogo?: string;
};

type FootballDataTeam = {
  id?: number;
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
  area?: { name?: string };
  venue?: string;
};

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function crestUrls(crest: string | null | undefined): {
  logo: string;
  logoPng: string | null;
  logoSvg: string | null;
} {
  const raw = String(crest || "").trim();
  if (!raw) {
    return { logo: "", logoPng: null, logoSvg: null };
  }
  if (raw.endsWith(".svg")) {
    return {
      logo: raw,
      logoSvg: raw,
      logoPng: raw.replace(/\.svg$/i, ".png"),
    };
  }
  if (raw.endsWith(".png")) {
    const svg = raw.replace(/\.png$/i, ".svg");
    return { logo: svg, logoSvg: svg, logoPng: raw };
  }
  return { logo: raw, logoPng: raw, logoSvg: null };
}

async function searchTheSportsDb(query: string): Promise<FootballTeamResult[]> {
  const url =
    "https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`TheSportsDB ${res.status}`);
  }
  const data = (await res.json()) as { teams?: SportsDbTeam[] | null };
  const teams = Array.isArray(data.teams) ? data.teams : [];
  return teams
    .filter((t) => String(t.strSport || "").toLowerCase() === "soccer")
    .map((t) => {
      const logoPng = String(t.strBadge || t.strLogo || "").trim() || null;
      return {
        id: `tsdb:${t.idTeam || normalizeName(t.strTeam || query)}`,
        name: String(t.strTeam || "").trim(),
        shortName: String(t.strTeamShort || "").trim() || null,
        country: String(t.strCountry || "").trim() || null,
        league: String(t.strLeague || "").trim() || null,
        logo: logoPng || "",
        logoPng,
        logoSvg: null,
        source: "thesportsdb" as const,
      };
    })
    .filter((t) => t.name && t.logo);
}

async function searchFootballData(
  query: string,
  token: string
): Promise<FootballTeamResult[]> {
  const url =
    "https://api.football-data.org/v4/teams?limit=25&name=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Auth-Token": token,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`football-data.org ${res.status}: ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as { teams?: FootballDataTeam[] };
  const teams = Array.isArray(data.teams) ? data.teams : [];
  return teams
    .map((t) => {
      const crests = crestUrls(t.crest);
      return {
        id: `fd:${t.id ?? normalizeName(t.name || query)}`,
        name: String(t.name || "").trim(),
        shortName: String(t.shortName || t.tla || "").trim() || null,
        country: String(t.area?.name || "").trim() || null,
        league: null,
        logo: crests.logo,
        logoPng: crests.logoPng,
        logoSvg: crests.logoSvg,
        source: "football-data" as const,
      };
    })
    .filter((t) => t.name && t.logo);
}

function mergeResults(
  primary: FootballTeamResult[],
  secondary: FootballTeamResult[]
): FootballTeamResult[] {
  const out: FootballTeamResult[] = [];
  const usedSecondary = new Set<string>();

  for (const a of primary) {
    const match = secondary.find(
      (b) => !usedSecondary.has(b.id) && namesMatch(a.name, b.name)
    );
    if (match) {
      usedSecondary.add(match.id);
      const logoSvg = match.logoSvg || a.logoSvg;
      const logoPng = a.logoPng || match.logoPng;
      out.push({
        id: a.id,
        name: a.name,
        shortName: a.shortName || match.shortName,
        country: a.country || match.country,
        league: a.league || match.league,
        logo: logoSvg || logoPng || a.logo || match.logo,
        logoPng,
        logoSvg,
        source: "merged",
      });
    } else {
      out.push(a);
    }
  }

  for (const b of secondary) {
    if (!usedSecondary.has(b.id)) out.push(b);
  }

  return out;
}

export async function searchFootballTeams(
  rawQuery: string
): Promise<{ teams: FootballTeamResult[]; providers: string[] }> {
  const query = String(rawQuery || "").trim();
  if (query.length < 2) {
    return { teams: [], providers: [] };
  }

  const providers: string[] = [];
  let sportsDb: FootballTeamResult[] = [];
  let footballData: FootballTeamResult[] = [];

  const sportsDbPromise = searchTheSportsDb(query)
    .then((rows) => {
      sportsDb = rows;
      providers.push("thesportsdb");
    })
    .catch((err) => {
      console.warn("[football-teams] thesportsdb", err);
    });

  const token =
    process.env.FOOTBALL_DATA_API_TOKEN ||
    process.env.FOOTBALL_DATA_API_KEY ||
    "";
  const footballDataPromise = token
    ? searchFootballData(query, token)
        .then((rows) => {
          footballData = rows;
          providers.push("football-data");
        })
        .catch((err) => {
          console.warn("[football-teams] football-data", err);
        })
    : Promise.resolve();

  await Promise.all([sportsDbPromise, footballDataPromise]);

  // Prefer football-data (SVG) when both exist; keep TheSportsDB coverage.
  const teams = mergeResults(
    footballData.length ? footballData : sportsDb,
    footballData.length ? sportsDb : []
  ).slice(0, 20);

  return { teams, providers };
}
