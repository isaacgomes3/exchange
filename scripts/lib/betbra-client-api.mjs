/**
 * Cliente HTTP BetBra (sportsbook / client API).
 * Descoberta no bundle Angular: base https://betbra.bet.br/client/api/
 *   POST auth/login  → cookies de sessão + JWT em body.token
 *   GET  clients/balance → { balance }
 *
 * Precisa IP BR (VPS). Fora do BR o Cloudflare redireciona para countryblock.
 */

function envStr(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : String(v);
}

export function resolveBetbraClientApiBase() {
  return envStr(
    "BETBRA_CLIENT_API_BASE",
    "https://betbra.bet.br/client/api"
  ).replace(/\/$/, "");
}

function defaultHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9",
    Referer: envStr("BETBRA_REFERER", "https://betbra.bet.br/"),
    Origin: envStr("BETBRA_ORIGIN", "https://betbra.bet.br"),
    "User-Agent": envStr(
      "BETBRA_USER_AGENT",
      "Mozilla/5.0 (compatible; ArbiShieldBotShield/1.0)"
    ),
  };
}

/** Extrai cookies de Set-Cookie (Node fetch getSetCookie ou header concatenado). */
export function parseSetCookieHeaders(res) {
  const jar = {};
  let list = [];
  if (typeof res.headers.getSetCookie === "function") {
    list = res.headers.getSetCookie();
  } else {
    const raw = res.headers.get("set-cookie");
    if (raw) {
      // split grosseiro em múltiplos Set-Cookie
      list = String(raw).split(/,(?=\s*[^;=]+=)/);
    }
  }
  for (const line of list) {
    const first = String(line || "").split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

export function cookieHeaderFromJar(jar) {
  return Object.entries(jar || {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function mergeCookieJars(...jars) {
  const out = {};
  for (const j of jars) {
    if (!j || typeof j !== "object") continue;
    Object.assign(out, j);
  }
  return out;
}

async function readJson(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text?.slice(0, 300) };
  }
  return { data, text };
}

/**
 * Login BetBra com usuário/senha.
 * @returns {{ token, cookies, user, cashBalance, raw }}
 */
export async function betbraClientLogin({ login, password, latitude, longitude } = {}) {
  const user = String(login || "").trim();
  const pass = String(password || "");
  if (!user || !pass) {
    const err = new Error("Login e senha BetBra obrigatórios");
    err.status = 400;
    err.code = "BETBRA_CREDS_REQUIRED";
    throw err;
  }
  const base = resolveBetbraClientApiBase();
  const url = `${base}/auth/login`;
  const lat = latitude == null || latitude === "" ? null : Number(latitude);
  const lng = longitude == null || longitude === "" ? null : Number(longitude);
  const body = {
    login: user,
    password: pass,
    latitude: lat,
    longitude: lng,
    ipDto: {
      ip: envStr("BETBRA_LOGIN_IP", "0.0.0.0"),
      colo: envStr("BETBRA_LOGIN_COLO", "non"),
      loc: envStr("BETBRA_LOGIN_LOC", "br"),
      latitude: lat,
      longitude: lng,
    },
  };
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: defaultHeaders(),
      body: JSON.stringify(body),
      redirect: "manual",
    });
  } catch (e) {
    const err = new Error(
      `Falha de rede no login BetBra: ${e instanceof Error ? e.message : e}`
    );
    err.status = 502;
    err.code = "BETBRA_LOGIN_NETWORK";
    throw err;
  }
  const cookies = parseSetCookieHeaders(res);
  const { data, text } = await readJson(res);
  const loc = res.headers.get("location") || "";
  if (res.status >= 300 && res.status < 400 && /countryblock/i.test(loc)) {
    const err = new Error(
      "BetBra bloqueou por país (countryblock). Rode o login/saldo na VPS com IP BR."
    );
    err.status = 403;
    err.code = "BETBRA_COUNTRYBLOCK";
    err.details = { location: loc };
    throw err;
  }
  if (!res.ok) {
    const msg =
      (data && (data.errorMessage || data.message || data.error)) ||
      (typeof data === "string" ? data : null) ||
      text?.slice(0, 200) ||
      `Login BetBra HTTP ${res.status}`;
    const err = new Error(String(msg));
    err.status = res.status;
    err.code = "BETBRA_LOGIN_FAILED";
    err.details = data;
    throw err;
  }
  if (data?.validationRequired) {
    const err = new Error(
      "BetBra pediu validação de dispositivo. Faça login no site e aprove o dispositivo, depois tente de novo."
    );
    err.status = 403;
    err.code = "BETBRA_DEVICE_VALIDATION";
    err.details = data;
    throw err;
  }
  const token = String(data?.token || data?.accessToken || "").trim();
  const cashBalance =
    data?.cashBalance != null && data?.cashBalance !== ""
      ? Number(data.cashBalance)
      : null;
  return {
    ok: true,
    token: token || null,
    cookies,
    cookieHeader: cookieHeaderFromJar(cookies),
    user: {
      id: data?.id ?? null,
      login: data?.login ?? user,
      currency: data?.currency || "BRL",
      accountStatus: data?.accountStatus || null,
    },
    cashBalance: Number.isFinite(cashBalance) ? cashBalance : null,
    raw: data,
    url,
  };
}

/**
 * Saldo global da conta (clients/balance).
 * Aceita cookie jar do login e/ou JWT (alguns ambientes usam cookie SESSION).
 */
export async function betbraClientBalance({ cookies, cookieHeader, token } = {}) {
  const base = resolveBetbraClientApiBase();
  const url = `${base}/clients/balance`;
  const headers = {
    ...defaultHeaders(),
  };
  const jarHeader =
    cookieHeader ||
    cookieHeaderFromJar(cookies) ||
    "";
  if (jarHeader) headers.Cookie = jarHeader;
  // fallback: alguns backends aceitam Authorization com o JWT do login
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
    });
  } catch (e) {
    const err = new Error(
      `Falha de rede ao ler saldo BetBra: ${e instanceof Error ? e.message : e}`
    );
    err.status = 502;
    err.code = "BETBRA_BALANCE_NETWORK";
    throw err;
  }
  const loc = res.headers.get("location") || "";
  if (res.status >= 300 && res.status < 400 && /countryblock/i.test(loc)) {
    const err = new Error(
      "BetBra bloqueou por país (countryblock). Consulte o saldo na VPS com IP BR."
    );
    err.status = 403;
    err.code = "BETBRA_COUNTRYBLOCK";
    throw err;
  }
  const { data, text } = await readJson(res);
  if (!res.ok) {
    const msg =
      (data && (data.errorMessage || data.message || data.error)) ||
      text?.slice(0, 200) ||
      `Saldo BetBra HTTP ${res.status}`;
    const err = new Error(String(msg));
    err.status = res.status;
    err.code = "BETBRA_BALANCE_FAILED";
    err.details = data;
    throw err;
  }
  // resposta típica: { balance: 123.45 } ou número direto
  let balance = null;
  if (typeof data === "number") balance = data;
  else if (data && typeof data === "object") {
    const raw =
      data.balance ??
      data.cashBalance ??
      data.availableBalance ??
      data.available ??
      data.amount;
    if (raw != null && raw !== "") balance = Number(raw);
  }
  if (!Number.isFinite(balance)) {
    const err = new Error("Resposta de saldo BetBra sem campo balance");
    err.status = 502;
    err.code = "BETBRA_BALANCE_SHAPE";
    err.details = data;
    throw err;
  }
  const balanceCents = Math.round(balance * 100);
  return {
    ok: true,
    balance,
    balanceCents,
    currency: "BRL",
    raw: data,
    url,
  };
}

/**
 * Login + saldo em um passo (usa cashBalance do login se vier; senão GET balance).
 */
export async function betbraLoginAndBalance({ login, password } = {}) {
  const auth = await betbraClientLogin({ login, password });
  let bal = null;
  if (auth.cashBalance != null && Number.isFinite(auth.cashBalance)) {
    bal = {
      ok: true,
      balance: auth.cashBalance,
      balanceCents: Math.round(auth.cashBalance * 100),
      currency: auth.user?.currency || "BRL",
      source: "login",
      raw: { cashBalance: auth.cashBalance },
    };
  } else {
    const fetched = await betbraClientBalance({
      cookies: auth.cookies,
      token: auth.token,
    });
    bal = { ...fetched, source: "clients/balance" };
  }
  return {
    ok: true,
    ...bal,
    loginMasked: maskLogin(auth.user?.login || login),
    currency: bal.currency || auth.user?.currency || "BRL",
    houseToken: auth.token,
    cookies: auth.cookies,
    accountStatus: auth.user?.accountStatus || null,
  };
}

export function maskLogin(login) {
  const s = String(login || "").trim();
  if (!s) return null;
  if (s.includes("@")) {
    const [u, d] = s.split("@");
    const head = u.slice(0, Math.min(2, u.length));
    return `${head}***@${d}`;
  }
  if (s.length <= 3) return "***";
  return `${s.slice(0, 2)}***${s.slice(-1)}`;
}
