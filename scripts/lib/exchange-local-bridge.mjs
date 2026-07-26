/**
 * Cliente VPS → agente local (PC residencial).
 *
 * Quando EXCHANGE_LOCAL_BRIDGE_URL está setado, login/saldo/account/place
 * saem pelo IP do PC em vez da VPS (contorna WAF Soft2Bet em datacenter).
 *
 * Env:
 *   EXCHANGE_LOCAL_BRIDGE_URL=https://xxxx.trycloudflare.com
 *   EXCHANGE_LOCAL_BRIDGE_SECRET=... (mesmo do agente local)
 *   EXCHANGE_LOCAL_BRIDGE=1|0  (força on/off; default = URL setada)
 */

function envStr(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : String(v);
}

export function resolveLocalBridgeUrl() {
  return envStr("EXCHANGE_LOCAL_BRIDGE_URL", envStr("BOTSHIELD_LOCAL_BRIDGE_URL", ""))
    .trim()
    .replace(/\/$/, "");
}

export function resolveLocalBridgeSecret() {
  return envStr(
    "EXCHANGE_LOCAL_BRIDGE_SECRET",
    envStr("BOTSHIELD_LOCAL_BRIDGE_SECRET", "")
  ).trim();
}

export function isLocalBridgeEnabled() {
  const flag = envStr("EXCHANGE_LOCAL_BRIDGE", "").toLowerCase().trim();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") {
    return false;
  }
  if (flag === "1" || flag === "true" || flag === "on" || flag === "yes") {
    return !!resolveLocalBridgeUrl();
  }
  return !!resolveLocalBridgeUrl();
}

async function bridgeFetch(path, { method = "GET", body } = {}) {
  const base = resolveLocalBridgeUrl();
  if (!base) {
    const err = new Error("EXCHANGE_LOCAL_BRIDGE_URL não configurada");
    err.status = 503;
    err.code = "LOCAL_BRIDGE_URL_MISSING";
    throw err;
  }
  const secret = resolveLocalBridgeSecret();
  if (!secret) {
    const err = new Error(
      "EXCHANGE_LOCAL_BRIDGE_SECRET não configurada (mesmo segredo do PC)"
    );
    err.status = 503;
    err.code = "LOCAL_BRIDGE_SECRET_MISSING";
    throw err;
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
        "X-BotShield-Bridge-Secret": secret,
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(
        Number(envStr("EXCHANGE_LOCAL_BRIDGE_TIMEOUT_MS", "45000")) || 45000
      ),
    });
  } catch (e) {
    const err = new Error(
      `Bridge local inacessível (${base}): ${
        e instanceof Error ? e.message : e
      }. PC ligado? Túnel (cloudflared) ativo?`
    );
    err.status = 502;
    err.code = "LOCAL_BRIDGE_UNREACHABLE";
    throw err;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text?.slice(0, 300) };
  }
  if (!res.ok) {
    const err = new Error(
      (data && (data.error || data.message)) ||
        `Bridge local HTTP ${res.status}`
    );
    err.status = res.status;
    err.code = data?.code || "LOCAL_BRIDGE_HTTP";
    err.details = data;
    throw err;
  }
  return data;
}

export async function bridgeHealth() {
  return bridgeFetch("/health");
}

export async function bridgeLoginAndBalance(creds = {}) {
  return bridgeFetch("/v1/login-balance", {
    method: "POST",
    body: {
      login: creds.login,
      password: creds.password,
      validationCode: creds.validationCode || creds.code || undefined,
    },
  });
}

export async function bridgeMexchangeAccount(session = {}) {
  return bridgeFetch("/v1/mexchange-account", {
    method: "POST",
    body: { session },
  });
}

export async function bridgePlaceOrder(session, payload) {
  return bridgeFetch("/v1/place", {
    method: "POST",
    body: { session, payload },
  });
}

export async function bridgeCancelOrder(session, orderId) {
  return bridgeFetch("/v1/cancel", {
    method: "POST",
    body: { session, orderId },
  });
}

export async function bridgePublicIp() {
  return bridgeFetch("/v1/public-ip");
}
