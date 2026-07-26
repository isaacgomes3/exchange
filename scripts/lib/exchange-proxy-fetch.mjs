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

/** host:port:user:pass → http://user:pass@host:port */
export function parseProxyDsn(dsn = "") {
  const s = String(dsn || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || /^socks5?:\/\//i.test(s)) return s;
  const parts = s.split(":");
  if (parts.length < 4) return "";
  const host = parts[0];
  const port = parts[1];
  const user = parts[2];
  const pass = parts.slice(3).join(":"); // senha pode ter ':'
  if (!host || !port || !user) return "";
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(pass);
  return `http://${u}:${p}@${host}:${port}`;
}

export function resolveExchangeProxyUrl() {
  const direct =
    envStr("EXCHANGE_PROXY") ||
    envStr("BETBRA_PROXY") ||
    envStr("HTTPS_PROXY") ||
    envStr("HTTP_PROXY") ||
    envStr("ALL_PROXY");
  if (direct) {
    if (!/^https?:\/\//i.test(direct) && !/^socks/i.test(direct) && direct.includes(":")) {
      const fromDsn = parseProxyDsn(direct);
      if (fromDsn) return fromDsn;
    }
    return direct;
  }
  const dsn = envStr("EXCHANGE_PROXY_DSN") || envStr("BETBRA_PROXY_DSN");
  return parseProxyDsn(dsn);
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
  if (cachedAgent && cachedUrl === url) return cachedAgent;
  cachedUrl = url;
  cachedAgent = new ProxyAgent(url);
  return cachedAgent;
}

/** fetch com proxy quando configurado; senão fetch global. */
export async function exchangeFetch(url, init = {}) {
  const agent = getExchangeProxyAgent();
  if (!agent) {
    return fetch(url, init);
  }
  const { signal, ...rest } = init || {};
  return undiciFetch(url, {
    ...rest,
    signal,
    dispatcher: agent,
  });
}

export function proxyPublicInfo() {
  const url = resolveExchangeProxyUrl();
  if (!url) return { enabled: false };
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
