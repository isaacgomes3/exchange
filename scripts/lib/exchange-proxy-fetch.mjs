/**
 * fetch() da Soft2Bet/Mexchange via proxy residencial (Undici ProxyAgent).
 *
 * Env (qualquer uma):
 *   EXCHANGE_PROXY=http://user:pass@host:port
 *   EXCHANGE_PROXY_DSN=host:port:user:pass
 *   HTTPS_PROXY / BETBRA_PROXY / ALL_PROXY (URL completa)
 *
 * Sticky BR: use user com country-br e sessão sticky do provedor.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadUndici() {
  const candidates = [
    "undici",
    resolve(__dirname, "../../node_modules/undici"),
    resolve(__dirname, "../../../node_modules/undici"),
    "/opt/arbishield/node_modules/undici",
    "/opt/arbishield/scripts/node_modules/undici",
  ];
  let lastErr;
  for (const id of candidates) {
    try {
      if (id !== "undici" && !existsSync(id) && !existsSync(id + ".js")) {
        continue;
      }
      return require(id);
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error(
    "Pacote undici nao encontrado. Na VPS: cd /opt/arbishield && npm install undici@7"
  );
  err.cause = lastErr;
  err.code = "UNDICI_MISSING";
  throw err;
}

const undici = loadUndici();
const ProxyAgent = undici.ProxyAgent;
const undiciFetch = undici.fetch;

function envStr(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : String(v).trim();
}

/** Remove aspas acidentais de valores de .env */
function stripEnvQuotes(s = "") {
  return String(s || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

const PROXY_PLACEHOLDERS = new Set([
  "",
  "sua-url",
  "sua_url",
  "your-url",
  "changeme",
  "placeholder",
  "none",
  "null",
  "undefined",
  "-",
  "n/a",
]);

function looksLikePlaceholder(raw = "") {
  const s = stripEnvQuotes(raw).toLowerCase();
  if (PROXY_PLACEHOLDERS.has(s)) return true;
  if (/^https?:\/\/(sua-?url|your-?url|example\.com|localhost)\/?$/i.test(s)) {
    return true;
  }
  return false;
}

/** host:port:user:pass → http://user:pass@host:port */
export function parseProxyDsn(dsn = "") {
  const s = stripEnvQuotes(dsn);
  if (!s || looksLikePlaceholder(s)) return "";
  if (/^https?:\/\//i.test(s) || /^socks5?:\/\//i.test(s)) return s;
  const parts = s.split(":");
  if (parts.length < 4) return "";
  const host = parts[0];
  const port = parts[1];
  const user = parts[2];
  const pass = parts.slice(3).join(":"); // senha pode ter ':'
  if (!host || !port || !user) return "";
  if (!/^\d+$/.test(port)) return "";
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(pass);
  return `http://${u}:${p}@${host}:${port}`;
}

/** Aceita só URL de proxy que o Undici ProxyAgent consegue usar. */
export function normalizeProxyUrl(raw = "") {
  const s = stripEnvQuotes(raw);
  if (!s || looksLikePlaceholder(s)) return "";

  let candidate = s;
  if (!/^https?:\/\//i.test(s) && !/^socks5?:\/\//i.test(s)) {
    if (s.includes(":")) {
      candidate = parseProxyDsn(s);
      if (!candidate) return "";
    } else {
      return "";
    }
  }

  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      // socks: ProxyAgent do undici não aceita — rejeita com clareza depois
      if (/^socks/i.test(u.protocol)) return candidate;
      return "";
    }
    if (!u.hostname) return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function resolveExchangeProxyUrl() {
  const candidates = [
    envStr("EXCHANGE_PROXY"),
    envStr("BETBRA_PROXY"),
    envStr("HTTPS_PROXY"),
    envStr("HTTP_PROXY"),
    envStr("ALL_PROXY"),
    envStr("EXCHANGE_PROXY_DSN"),
    envStr("BETBRA_PROXY_DSN"),
  ];

  const skipped = [];
  for (const raw of candidates) {
    if (!raw) continue;
    const url = normalizeProxyUrl(raw);
    if (url) return url;
    skipped.push(raw.slice(0, 48));
  }

  // Se só havia placeholders (ex.: EXCHANGE_PROXY=SUA-URL), devolve vazio
  // para o caller não chamar ProxyAgent com lixo.
  if (skipped.length) {
    return "";
  }
  return "";
}

export function isExchangeProxyEnabled() {
  const flag = envStr("EXCHANGE_PROXY_ENABLED", "").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") {
    return false;
  }
  return !!resolveExchangeProxyUrl();
}

let cachedAgent = null;
let cachedUrl = "";

export function getExchangeProxyAgent() {
  if (!isExchangeProxyEnabled()) return null;
  const url = resolveExchangeProxyUrl();
  if (!url) return null;
  if (/^socks/i.test(url)) {
    const err = new Error(
      "Proxy SOCKS não suportado pelo Undici. Use HTTP(S) sticky BR " +
        "(EXCHANGE_PROXY_DSN=host:port:user:pass)."
    );
    err.code = "EXCHANGE_PROXY_SOCKS";
    throw err;
  }
  if (cachedAgent && cachedUrl === url) return cachedAgent;
  try {
    cachedUrl = url;
    cachedAgent = new ProxyAgent(url);
    return cachedAgent;
  } catch (e) {
    cachedAgent = null;
    cachedUrl = "";
    const err = new Error(
      "Proxy inválido (Invalid URL). Confira EXCHANGE_PROXY_DSN=host:port:user:pass " +
        "e remova EXCHANGE_PROXY=SUA-URL / placeholders do .env. " +
        (e instanceof Error ? e.message : String(e))
    );
    err.code = "EXCHANGE_PROXY_INVALID";
    err.cause = e;
    throw err;
  }
}

/** fetch com proxy quando configurado; senão fetch global. */
export async function exchangeFetch(url, init = {}) {
  const target = String(url || "").trim();
  if (!target || !/^https?:\/\//i.test(target)) {
    const err = new Error(
      `URL da exchange inválida: ${JSON.stringify(target)}. ` +
        "Confira BETBRA_CLIENT_API_BASE (ex.: https://betbra.bet.br/client/api)."
    );
    err.code = "EXCHANGE_TARGET_INVALID";
    throw err;
  }
  const agent = getExchangeProxyAgent();
  if (!agent) {
    return fetch(target, init);
  }
  const { signal, ...rest } = init || {};
  try {
    return await undiciFetch(target, {
      ...rest,
      signal,
      dispatcher: agent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid url/i.test(msg)) {
      const err = new Error(
        "Invalid URL no proxy/fetch — geralmente EXCHANGE_PROXY=SUA-URL no .env. " +
          "Rode o hotfix proxy de novo com EXCHANGE_PROXY_DSN=host:port:user:pass " +
          "(ele limpa placeholders)."
      );
      err.code = "EXCHANGE_PROXY_INVALID";
      err.cause = e;
      throw err;
    }
    throw e;
  }
}

export function proxyPublicInfo() {
  const rawDsn = envStr("EXCHANGE_PROXY_DSN") || envStr("BETBRA_PROXY_DSN");
  const rawUrl = envStr("EXCHANGE_PROXY") || envStr("BETBRA_PROXY");
  const url = resolveExchangeProxyUrl();
  if (!url) {
    return {
      enabled: false,
      hint:
        rawUrl || rawDsn
          ? "proxy env presente mas inválido (ex.: SUA-URL) — use DSN host:port:user:pass"
          : "sem EXCHANGE_PROXY_DSN",
    };
  }
  try {
    const u = new URL(url);
    return {
      enabled: true,
      host: u.hostname,
      port: u.port || (u.protocol === "https:" ? "443" : "80"),
      user: decodeURIComponent(u.username || "").slice(0, 24),
    };
  } catch {
    return { enabled: true, host: "(url inválida)" };
  }
}
