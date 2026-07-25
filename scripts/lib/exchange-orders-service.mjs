/**
 * Serviço: sessão do cliente + place/cancel/status via adapter.
 * Persistência: tabelas exchange_connections / exchange_orders (criadas no hotfix).
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import {
  EXCHANGE_ORDERS_CONTRACT_VERSION,
  EXCHANGE_ORDERS_LOCK,
  validatePlaceOrderBody,
  validateCancelOrderBody,
  normalizeOrderStatus,
} from "./exchange-orders-contract.mjs";
import {
  createOrdersAdapter,
  ExchangeOrdersNotWiredError,
} from "./exchange-orders-adapter.mjs";

void EXCHANGE_ORDERS_LOCK;

function sessionSecret() {
  const raw =
    process.env.EXCHANGE_SESSION_SECRET ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "arbishield-dev-exchange-session";
  return createHash("sha256").update(String(raw)).digest();
}

export function encryptSessionPayload(obj) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionSecret(), iv);
  const plain = Buffer.from(JSON.stringify(obj), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSessionPayload(blob) {
  const buf = Buffer.from(String(blob || ""), "base64");
  if (buf.length < 29) throw new Error("Sessão exchange inválida");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", sessionSecret(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

/**
 * @param {object} deps
 * @param {(path:string, opts?:object)=>Promise<any>} deps.sb
 * @param {string} deps.serviceKey
 * @param {(token:string)=>Promise<string>} deps.requireUserId
 */
export function createExchangeOrdersService(deps) {
  const { sb, serviceKey, requireUserId } = deps;
  const adapter = createOrdersAdapter();

  async function ensureTablesHint(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    if (msg.includes("exchange_connections") || msg.includes("exchange_orders")) {
      const e = new Error(
        "Tabelas exchange_* ausentes. Rode o hotfix vps-hotfix-exchange-orders-api.sh"
      );
      e.status = 503;
      e.code = "EXCHANGE_SCHEMA_MISSING";
      throw e;
    }
    throw err;
  }

  function maskLogin(login) {
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

  async function connectSession(token, body) {
    const userId = await requireUserId(token);
    let accessToken = String(
      body?.accessToken || body?.sessionToken || body?.token || ""
    ).trim();
    const provider = String(body?.provider || "demo").toLowerCase();
    const login = String(
      body?.login || body?.email || body?.username || body?.user || ""
    ).trim();
    const password = String(body?.password || body?.senha || "").trim();
    // Atalho demo: sem token da casa, aceita "demo" / vazio com provider=demo
    if (!accessToken && (provider === "demo" || body?.demo === true) && !login) {
      accessToken = "demo";
    }
    // Conta BetBra: login+senha criptografados (sem devolver a senha nas respostas)
    if (!accessToken && login && password) {
      accessToken = `cred:${login}`;
    }
    if (!accessToken && !(login && password)) {
      const err = new Error(
        "Informe login+senha da BetBra, ou accessToken / sessionToken"
      );
      err.status = 400;
      throw err;
    }
    if (login && !password && provider !== "demo") {
      const err = new Error("Senha da BetBra obrigatória junto com o login");
      err.status = 400;
      throw err;
    }
    const payload = {
      accessToken: accessToken || `cred:${login}`,
      refreshToken: body?.refreshToken || null,
      expiresAt: body?.expiresAt || null,
      accountLabel:
        body?.accountLabel ||
        body?.label ||
        (login ? login : provider === "demo" ? "Conta demo" : null),
      extraHeaders: body?.extraHeaders || null,
      connectedAt: new Date().toISOString(),
      demo: provider === "demo" || accessToken === "demo",
      login: login || null,
      // senha só no blob AES-GCM — nunca em metadata / response
      password: password || null,
      authMode: password ? "credentials" : accessToken?.startsWith("cred:")
        ? "credentials"
        : "token",
    };
    const sessionEnc = encryptSessionPayload(payload);
    const now = new Date().toISOString();
    const row = {
      user_id: userId,
      provider,
      status: "active",
      session_enc: sessionEnc,
      account_label: payload.accountLabel,
      metadata: {
        provider,
        has_refresh: !!payload.refreshToken,
        has_login: !!login,
        login_masked: maskLogin(login),
        auth_mode: payload.authMode,
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      },
      updated_at: now,
      connected_at: now,
    };
    try {
      // desativa conexões anteriores do mesmo provider
      await sb(
        `/rest/v1/exchange_connections?user_id=eq.${encodeURIComponent(userId)}&provider=eq.${encodeURIComponent(provider)}`,
        {
          method: "PATCH",
          token: serviceKey,
          body: { status: "revoked", updated_at: now },
        }
      ).catch(() => null);
      const created = await sb("/rest/v1/exchange_connections", {
        method: "POST",
        token: serviceKey,
        body: row,
      });
      const conn = Array.isArray(created) ? created[0] : created;
      return {
        ok: true,
        connectionId: conn?.id,
        provider,
        status: "active",
        demo: !!payload.demo,
        hasLogin: !!login,
        loginMasked: maskLogin(login),
        authMode: payload.authMode,
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
        adapter: adapter.provider,
        live:
          process.env.EXCHANGE_ORDERS_LIVE === "1" ||
          process.env.EXCHANGE_ORDERS_LIVE === "true",
      };
    } catch (err) {
      return ensureTablesHint(err);
    }
  }

  /** Status da sessão (login mascarado — nunca devolve senha). */
  async function sessionStatus(token, query = {}) {
    const userId = await requireUserId(token);
    const provider = String(query?.provider || "betbra").toLowerCase();
    try {
      const rows = await sb(
        `/rest/v1/exchange_connections?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&provider=eq.${encodeURIComponent(provider)}&select=id,provider,status,account_label,metadata,connected_at,updated_at&order=connected_at.desc&limit=1`,
        { token: serviceKey }
      );
      const conn = Array.isArray(rows) ? rows[0] : null;
      if (!conn) {
        return {
          ok: true,
          connected: false,
          provider,
          hasLogin: false,
          hasPassword: false,
          loginMasked: null,
        };
      }
      let hasPassword = false;
      let loginMasked = conn.metadata?.login_masked || null;
      let authMode = conn.metadata?.auth_mode || null;
      try {
        const full = await sb(
          `/rest/v1/exchange_connections?id=eq.${encodeURIComponent(conn.id)}&select=session_enc&limit=1`,
          { token: serviceKey }
        );
        const enc = Array.isArray(full) ? full[0]?.session_enc : full?.session_enc;
        if (enc) {
          const session = decryptSessionPayload(enc);
          hasPassword = !!session?.password;
          if (!loginMasked && session?.login) loginMasked = maskLogin(session.login);
          authMode = session?.authMode || authMode;
        }
      } catch {
        /* ignore decrypt errors */
      }
      return {
        ok: true,
        connected: true,
        connectionId: conn.id,
        provider: conn.provider,
        status: conn.status,
        accountLabel: conn.account_label,
        hasLogin: !!conn.metadata?.has_login || !!loginMasked,
        hasPassword,
        loginMasked,
        authMode,
        connectedAt: conn.connected_at,
        demo: conn.provider === "demo",
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      };
    } catch (err) {
      return ensureTablesHint(err);
    }
  }

  async function disconnectSession(token, body) {
    const userId = await requireUserId(token);
    const connectionId = String(body?.connectionId || body?.id || "").trim();
    const provider = String(body?.provider || "").trim().toLowerCase();
    const now = new Date().toISOString();
    try {
      if (connectionId) {
        await sb(
          `/rest/v1/exchange_connections?id=eq.${encodeURIComponent(connectionId)}&user_id=eq.${encodeURIComponent(userId)}`,
          {
            method: "PATCH",
            token: serviceKey,
            body: { status: "revoked", updated_at: now, session_enc: null },
          }
        );
      } else {
        let path = `/rest/v1/exchange_connections?user_id=eq.${encodeURIComponent(userId)}&status=eq.active`;
        if (provider) {
          path += `&provider=eq.${encodeURIComponent(provider)}`;
        }
        await sb(path, {
          method: "PATCH",
          token: serviceKey,
          body: { status: "revoked", updated_at: now, session_enc: null },
        });
      }
      return { ok: true };
    } catch (err) {
      return ensureTablesHint(err);
    }
  }

  async function loadActiveConnection(userId, connectionId) {
    let q = `/rest/v1/exchange_connections?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=*&order=connected_at.desc&limit=1`;
    if (connectionId) {
      q = `/rest/v1/exchange_connections?id=eq.${encodeURIComponent(connectionId)}&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`;
    }
    const rows = await sb(q, { token: serviceKey });
    const conn = Array.isArray(rows) ? rows[0] : null;
    if (!conn) {
      const err = new Error(
        "Nenhuma sessão exchange ativa. Cliente precisa autenticar a conta."
      );
      err.status = 401;
      err.code = "EXCHANGE_SESSION_REQUIRED";
      throw err;
    }
    if (!conn.session_enc) {
      const err = new Error("Sessão exchange revogada ou vazia");
      err.status = 401;
      err.code = "EXCHANGE_SESSION_EMPTY";
      throw err;
    }
    const session = decryptSessionPayload(conn.session_enc);
    return { conn, session };
  }

  async function persistOrder(userId, connId, place, result, errMsg) {
    const now = new Date().toISOString();
    const row = {
      user_id: userId,
      connection_id: connId,
      external_order_id: result?.orderId || null,
      side: place.side,
      odd: place.odd,
      stake_cents: place.stakeCents,
      event_id: place.eventId,
      market_id: place.marketId,
      selection_id: place.selectionId,
      status: result
        ? normalizeOrderStatus(result.status)
        : "failed",
      client_order_id: place.clientOrderId,
      provider: adapter.provider,
      metadata: {
        ...(place.metadata || {}),
        error: errMsg || null,
        adapter_raw: result?.raw || null,
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      },
      created_at: now,
      updated_at: now,
    };
    try {
      const created = await sb("/rest/v1/exchange_orders", {
        method: "POST",
        token: serviceKey,
        body: row,
      });
      return Array.isArray(created) ? created[0] : created;
    } catch {
      return row;
    }
  }

  async function placeOrder(token, body) {
    const userId = await requireUserId(token);
    const place = validatePlaceOrderBody(body || {});
    const { conn, session } = await loadActiveConnection(
      userId,
      body?.connectionId
    );
    try {
      const result = await adapter.placeOrder(session, place);
      const saved = await persistOrder(userId, conn.id, place, result, null);
      return {
        ok: true,
        orderId: result.orderId,
        status: result.status,
        provider: adapter.provider,
        demo: !!result.demo,
        wired: !!result.wired,
        recordId: saved?.id || null,
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
        message: result.message || undefined,
      };
    } catch (err) {
      if (err instanceof ExchangeOrdersNotWiredError) {
        await persistOrder(userId, conn.id, place, null, err.message);
        throw err;
      }
      await persistOrder(
        userId,
        conn.id,
        place,
        null,
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }
  }

  async function cancelOrder(token, body) {
    const userId = await requireUserId(token);
    const { orderId, reason } = validateCancelOrderBody(body || {});
    const { conn, session } = await loadActiveConnection(
      userId,
      body?.connectionId
    );
    const result = await adapter.cancelOrder(session, orderId);
    try {
      await sb(
        `/rest/v1/exchange_orders?external_order_id=eq.${encodeURIComponent(orderId)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          token: serviceKey,
          body: {
            status: normalizeOrderStatus(result.status || "cancelled"),
            updated_at: new Date().toISOString(),
            metadata: { cancel_reason: reason },
          },
        }
      );
    } catch {
      /* log best-effort */
    }
    return {
      ok: true,
      orderId: result.orderId || orderId,
      status: result.status,
      provider: adapter.provider,
      demo: !!result.demo,
      wired: !!result.wired,
      contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      message: result.message || undefined,
    };
  }

  async function orderStatus(token, query) {
    const userId = await requireUserId(token);
    const orderId = String(query?.orderId || query?.id || "").trim();
    if (!orderId) {
      const err = new Error("orderId obrigatório");
      err.status = 400;
      throw err;
    }
    const { session } = await loadActiveConnection(userId, query?.connectionId);
    const result = await adapter.getOrderStatus(session, orderId);
    return {
      ok: true,
      ...result,
      contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
    };
  }

  async function listMyOrders(token) {
    const userId = await requireUserId(token);
    try {
      const rows = await sb(
        `/rest/v1/exchange_orders?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=100`,
        { token: serviceKey }
      );
      return { ok: true, orders: Array.isArray(rows) ? rows : [] };
    } catch (err) {
      return ensureTablesHint(err);
    }
  }

  return {
    connectSession,
    disconnectSession,
    sessionStatus,
    placeOrder,
    cancelOrder,
    orderStatus,
    listMyOrders,
    adapterProvider: () => adapter.provider,
  };
}
