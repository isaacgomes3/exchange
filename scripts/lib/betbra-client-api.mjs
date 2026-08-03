/**
 * Cliente HTTP Soft2Bet sportsbook (BetBra / Fulltbet / etc.).
 *   POST auth/login  → cookies de sessão + JWT em body.token
 *   GET  clients/balance → { balance }
 *
 * Marca via EXCHANGE_BRAND=betbra|fulltbet (default betbra).
 * Precisa IP BR (VPS). Fora do BR o Cloudflare redireciona para countryblock.
 */

function envStr(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : String(v);
}

/** Defaults por marca Mexchange (mesmo stack Soft2Bet). */
export function resolveExchangeBrand() {
  const raw = envStr("EXCHANGE_BRAND", envStr("BOTSHIELD_EXCHANGE_BRAND", "betbra"));
  const b = String(raw || "betbra").toLowerCase().trim();
  if (b === "fulltbet" || b === "fullt" || b === "ftb") return "fulltbet";
  return "betbra";
}

export function exchangeBrandDefaults(brand = resolveExchangeBrand()) {
  if (brand === "fulltbet") {
    return {
      brand: "fulltbet",
      label: "Fulltbet",
      site: "https://fulltbet.bet.br",
      clientApi: "https://fulltbet.bet.br/client/api",
      origin: "https://fulltbet.bet.br",
      referer: "https://fulltbet.bet.br/",
      mexchangeApi: "https://mexchange-api.fulltbet.bet.br/api",
      mexchangeOrigin: "https://mexchange.fulltbet.bet.br",
      mexchangeReferer: "https://mexchange.fulltbet.bet.br/",
    };
  }
  return {
    brand: "betbra",
    label: "BetBra",
    site: "https://betbra.bet.br",
    clientApi: "https://betbra.bet.br/client/api",
    origin: "https://betbra.bet.br",
    referer: "https://betbra.bet.br/",
    mexchangeApi: "https://mexchange-api.betbra.bet.br/api",
    mexchangeOrigin: "https://mexchange.betbra.bet.br",
    mexchangeReferer: "https://mexchange.betbra.bet.br/",
  };
}

export function resolveBetbraClientApiBase() {
  const d = exchangeBrandDefaults();
  return envStr("BETBRA_CLIENT_API_BASE", d.clientApi).replace(/\/$/, "");
}

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

let cachedPublicIp = "";
let cachedPublicIpAt = 0;

/** IP público da VPS — Soft2Bet rejeita login com ip 0.0.0.0 ("API blocked"). */
export async function resolveLoginPublicIp() {
  const forced = envStr("BETBRA_LOGIN_IP", "").trim();
  if (forced && forced !== "0.0.0.0") return forced;
  if (cachedPublicIp && Date.now() - cachedPublicIpAt < 30 * 60 * 1000) {
    return cachedPublicIp;
  }
  const urls = [
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        headers: { Accept: "text/plain" },
        signal: AbortSignal.timeout(4000),
      });
      const t = String(await r.text() || "")
        .trim()
        .split(/\s+/)[0];
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) {
        cachedPublicIp = t;
        cachedPublicIpAt = Date.now();
        return t;
      }
    } catch {
      /* tenta próximo */
    }
  }
  return "";
}

function defaultHeaders() {
  const d = exchangeBrandDefaults();
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: envStr("BETBRA_REFERER", d.referer),
    Origin: envStr("BETBRA_ORIGIN", d.origin),
    // Soft2Bet bloqueia UA de bot com "API blocked in server"
    "User-Agent": envStr("BETBRA_USER_AGENT", CHROME_UA),
    "sec-ch-ua":
      '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

function mapBetbraApiError(msg, data, status) {
  const m = String(msg || "");
  if (/api blocked in server/i.test(m)) {
    const err = new Error(
      "Exchange bloqueou o login da VPS (API blocked). " +
        "Confira IP BR, evite spam de Atualizar saldo, " +
        "ou use Cookie/cURL da exchange logada no Chrome (Testar sessão → accountId)."
    );
    err.status = status || 403;
    err.code = "BETBRA_API_BLOCKED";
    err.details = data;
    return err;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
 * Se a BetBra enviar e-mail "Código de Login", passe validationCode no retry.
 * @returns {{ token, cookies, user, cashBalance, raw }}
 */
export async function betbraClientLogin({
  login,
  password,
  latitude,
  longitude,
  validationCode,
} = {}) {
  const user = String(login || "").trim();
  const pass = String(password || "");
  const code = String(validationCode || "").replace(/\s+/g, "").trim();
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
  const publicIp = await resolveLoginPublicIp();
  const body = {
    login: user,
    password: pass,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    ipDto: {
      // Nunca enviar 0.0.0.0 — Soft2Bet responde "API blocked in server"
      ip: publicIp || undefined,
      colo: envStr("BETBRA_LOGIN_COLO", "gru"),
      loc: envStr("BETBRA_LOGIN_LOC", "br"),
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
    },
  };
  if (!body.ipDto.ip) delete body.ipDto.ip;
  // Soft2Bet / BetBra: campos comuns do código de novo dispositivo
  if (code) {
    body.validationCode = code;
    body.code = code;
    body.otp = code;
    body.loginCode = code;
    body.deviceCode = code;
  }

  async function postLogin() {
    try {
      return await fetch(url, {
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
  }

  let res = await postLogin();
  let cookies = parseSetCookieHeaders(res);
  let { data, text } = await readJson(res);
  let loc = res.headers.get("location") || "";
  let msgRaw =
    (data && (data.errorMessage || data.message || data.error)) ||
    (typeof data === "string" ? data : null) ||
    text?.slice(0, 200) ||
    "";

  // Um retry curto: WAF Soft2Bet às vezes bloqueia o 1º hit da VPS
  if (
    /api blocked in server/i.test(String(msgRaw)) ||
    (res.status === 403 && /blocked/i.test(String(msgRaw || text || "")))
  ) {
    await sleep(1800);
    res = await postLogin();
    cookies = parseSetCookieHeaders(res);
    ({ data, text } = await readJson(res));
    loc = res.headers.get("location") || "";
    msgRaw =
      (data && (data.errorMessage || data.message || data.error)) ||
      (typeof data === "string" ? data : null) ||
      text?.slice(0, 200) ||
      "";
  }

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
    const mapped = mapBetbraApiError(msgRaw, data, res.status);
    if (mapped) throw mapped;
    const err = new Error(String(msgRaw || `Login exchange HTTP ${res.status}`));
    err.status = res.status;
    err.code = "BETBRA_LOGIN_FAILED";
    err.details = data;
    throw err;
  }
  // Soft2Bet às vezes responde 200 com "API blocked in server"
  if (msgRaw && /api blocked in server/i.test(String(msgRaw))) {
    throw mapBetbraApiError(msgRaw, data, 403);
  }
  if (data?.validationRequired) {
    const err = new Error(
      code
        ? "Código de login inválido ou expirado. Peça um novo em Atualizar saldo e use o código do e-mail."
        : "A exchange enviou código de novo dispositivo por e-mail/SMS. " +
          "Cole o código em Conta Exchange e clique em Enviar código."
    );
    err.status = 403;
    err.code = "BETBRA_DEVICE_VALIDATION";
    err.details = data;
    err.validationRequired = true;
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
  const msgRaw =
    (data && (data.errorMessage || data.message || data.error)) ||
    (typeof data === "string" ? data : null) ||
    text?.slice(0, 200) ||
    "";
  if (!res.ok) {
    const mapped = mapBetbraApiError(msgRaw, data, res.status);
    if (mapped) throw mapped;
    const err = new Error(String(msgRaw || `Saldo exchange HTTP ${res.status}`));
    err.status = res.status;
    err.code = "BETBRA_BALANCE_FAILED";
    err.details = data;
    throw err;
  }
  if (msgRaw && /api blocked in server/i.test(String(msgRaw))) {
    throw mapBetbraApiError(msgRaw, data, 403);
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
export async function betbraLoginAndBalance({
  login,
  password,
  validationCode,
} = {}) {
  const auth = await betbraClientLogin({ login, password, validationCode });
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
