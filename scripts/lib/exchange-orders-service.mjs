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
import {
  betbraLoginAndBalance,
  cookieHeaderFromJar,
} from "./betbra-client-api.mjs";
import {
  fetchMexchangeAccountInfo,
  hasTradingSession,
  resolveExactScoreRunner,
  sanitizeTradingCookieHeader,
  sessionCookieHeader,
} from "./mexchange-offers.mjs";

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
    const code = String(err?.code || err?.details?.code || "").toLowerCase();
    if (
      msg.includes("exchange_connections") ||
      msg.includes("exchange_orders") ||
      msg.includes("schema cache") ||
      msg.includes("does not exist") ||
      msg === "not_found" ||
      code === "not_found" ||
      code === "pgrst205" ||
      code === "42p01"
    ) {
      const e = new Error(
        "Tabelas exchange_* ausentes. Na VPS rode: vps-hotfix-botshield.sh (ou vps-hotfix-exchange-orders-api.sh)"
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
    // Reaplicar modo BetBra com credenciais/token já salvos (sem reenviar senha)
    const useSaved =
      body?.useSaved === true ||
      body?.useSavedCredentials === true ||
      body?.reuseSession === true;
    if (!accessToken && !(login && password) && useSaved && provider !== "demo") {
      const existing = await sessionStatus(token, { provider });
      if (!existing?.connected) {
        const err = new Error(
          "Nenhuma Conta BetBra salva. Cadastre login/senha em Conta BetBra."
        );
        err.status = 400;
        throw err;
      }
      if (!existing.hasPassword && existing.authMode !== "token") {
        const err = new Error(
          "Conta BetBra incompleta (sem senha). Salve de novo em Conta BetBra ou cole um token."
        );
        err.status = 400;
        throw err;
      }
      return {
        ok: true,
        connectionId: existing.connectionId,
        provider: existing.provider || provider,
        status: existing.status || "active",
        demo: false,
        hasLogin: !!existing.hasLogin,
        loginMasked: existing.loginMasked || null,
        authMode: existing.authMode || (existing.hasPassword ? "credentials" : "token"),
        reused: true,
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
        adapter: adapter.provider,
        live:
          process.env.EXCHANGE_ORDERS_LIVE === "1" ||
          process.env.EXCHANGE_ORDERS_LIVE === "true",
      };
    }
    const hasBrowserSession = !!(
      String(body?.cookieHeader || body?.cookiesHeader || body?.cookie || "").trim() ||
      String(body?.houseToken || body?.mexchangeToken || "").trim()
    );
    if (!accessToken && !(login && password) && !hasBrowserSession) {
      const err = new Error(
        "Informe login+senha da BetBra, cookies do navegador, ou accessToken"
      );
      err.status = 400;
      throw err;
    }
    if (login && !password && provider !== "demo" && !hasBrowserSession) {
      const err = new Error("Senha da BetBra obrigatória junto com o login");
      err.status = 400;
      throw err;
    }
    const cookieHeader = sanitizeTradingCookieHeader(
      String(body?.cookieHeader || body?.cookiesHeader || body?.cookie || "").trim()
    );
    const houseToken = String(
      body?.houseToken || body?.mexchangeToken || ""
    ).trim();

    // Atualiza só cookies/token sem apagar login/senha já salvos
    if ((cookieHeader || houseToken) && !(login && password)) {
      try {
        const { conn, session } = await loadActiveConnection(userId, null);
        if (conn?.provider === provider || !body?.provider) {
          const next = {
            ...session,
            cookieHeader: cookieHeader || session.cookieHeader || null,
            houseToken: houseToken || session.houseToken || null,
            accessToken:
              houseToken ||
              session.houseToken ||
              session.accessToken ||
              "browser-session",
            authMode: "browser_session",
          };
          const sessionEnc = encryptSessionPayload(next);
          const now = new Date().toISOString();
          await sb(
            `/rest/v1/exchange_connections?id=eq.${encodeURIComponent(conn.id)}`,
            {
              method: "PATCH",
              token: serviceKey,
              body: {
                session_enc: sessionEnc,
                metadata: {
                  ...(conn.metadata && typeof conn.metadata === "object"
                    ? conn.metadata
                    : {}),
                  auth_mode: "browser_session",
                  has_browser_cookies: !!next.cookieHeader,
                  has_house_token: !!next.houseToken,
                },
                updated_at: now,
              },
            }
          );
          return {
            ok: true,
            connectionId: conn.id,
            provider: conn.provider,
            status: "active",
            demo: false,
            authMode: "browser_session",
            hasBrowserCookies: !!next.cookieHeader,
            reused: true,
            mergedCookies: true,
            contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
            adapter: adapter.provider,
            live:
              process.env.EXCHANGE_ORDERS_LIVE === "1" ||
              process.env.EXCHANGE_ORDERS_LIVE === "true",
          };
        }
      } catch {
        /* sem conexão prévia — cria abaixo */
      }
    }

    // Só cookies/token do navegador (sem login+senha) — útil quando a VPS pede device validation
    if (!accessToken && !(login && password) && (cookieHeader || houseToken)) {
      accessToken = houseToken || "browser-session";
    }
    const payload = {
      accessToken: accessToken || `cred:${login}`,
      houseToken: houseToken || null,
      refreshToken: body?.refreshToken || null,
      expiresAt: body?.expiresAt || null,
      accountLabel:
        body?.accountLabel ||
        body?.label ||
        (login ? login : provider === "demo" ? "Conta demo" : null),
      extraHeaders: body?.extraHeaders || null,
      cookieHeader: cookieHeader || null,
      cookies: body?.cookies && typeof body.cookies === "object" ? body.cookies : null,
      connectedAt: new Date().toISOString(),
      demo: provider === "demo" || accessToken === "demo",
      login: login || null,
      // senha só no blob AES-GCM — nunca em metadata / response
      password: password || null,
      authMode: cookieHeader || houseToken
        ? "browser_session"
        : password
          ? "credentials"
          : accessToken?.startsWith("cred:")
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
      const live =
        process.env.EXCHANGE_ORDERS_LIVE === "1" ||
        process.env.EXCHANGE_ORDERS_LIVE === "true";
      if (!conn) {
        return {
          ok: true,
          connected: false,
          provider,
          hasLogin: false,
          hasPassword: false,
          loginMasked: null,
          live,
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
        live,
        lastBalance:
          conn.metadata?.last_balance != null
            ? Number(conn.metadata.last_balance)
            : null,
        lastBalanceAt: conn.metadata?.last_balance_at || null,
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

  async function refreshTradingSession(conn, session, { force = false } = {}) {
    // Já tem cookies/token do navegador — não força login (evita device validation da VPS)
    if (!force && hasTradingSession(session)) {
      return session;
    }
    const login = String(session?.login || "").trim();
    const password = String(session?.password || "").trim();
    if (!login || !password) return session;
    try {
      const result = await betbraLoginAndBalance({ login, password });
      const next = {
        ...session,
        accessToken: result.houseToken || session.accessToken,
        houseToken: result.houseToken || null,
        cookies: result.cookies || session.cookies || null,
        cookieHeader:
          cookieHeaderFromJar(result.cookies) || session.cookieHeader || null,
        authMode: "credentials",
        lastBalance: result.balance,
        lastBalanceAt: new Date().toISOString(),
        demo: false,
      };
      try {
        const sessionEnc = encryptSessionPayload(next);
        const meta = {
          ...(conn.metadata && typeof conn.metadata === "object"
            ? conn.metadata
            : {}),
          has_login: true,
          auth_mode: "credentials",
          last_balance: result.balance,
          last_balance_at: next.lastBalanceAt,
          has_house_token: !!result.houseToken,
        };
        await sb(
          `/rest/v1/exchange_connections?id=eq.${encodeURIComponent(conn.id)}`,
          {
            method: "PATCH",
            token: serviceKey,
            body: {
              session_enc: sessionEnc,
              metadata: meta,
              updated_at: new Date().toISOString(),
            },
          }
        );
      } catch {
        /* best-effort */
      }
      return next;
    } catch (err) {
      // Se o login da VPS pediu device validation mas já há cookies salvos, mantém
      if (
        err?.code === "BETBRA_DEVICE_VALIDATION" &&
        hasTradingSession(session)
      ) {
        return session;
      }
      throw err;
    }
  }

  async function placeOrder(token, body) {
    const userId = await requireUserId(token);
    const place = validatePlaceOrderBody(body || {});
    let { conn, session } = await loadActiveConnection(
      userId,
      body?.connectionId
    );
    const live =
      process.env.EXCHANGE_ORDERS_LIVE === "1" ||
      process.env.EXCHANGE_ORDERS_LIVE === "true";
    if (live && !place.confirmLive) {
      const err = new Error(
        "Modo LIVE: envie confirmLive:true para confirmar ordem real na BetBra."
      );
      err.status = 400;
      err.code = "CONFIRM_LIVE_REQUIRED";
      throw err;
    }
    try {
      // Place real: usa cookies salvos; só tenta login VPS se ainda não houver sessão
      if (live) {
        session = await refreshTradingSession(conn, session, {
          force: !hasTradingSession(session),
        });
        if (!hasTradingSession(session)) {
          const err = new Error(
            "Sem cookies/token de trading. O login da VPS é um dispositivo diferente do Chrome. " +
              "Cole a sessão do navegador em Conta BetBra, ou aprove o device da VPS por e-mail/SMS."
          );
          err.status = 401;
          err.code = "EXCHANGE_SESSION_REQUIRED";
          throw err;
        }
        if (!place.selectionId && place.scoreline && place.eventId) {
          const resolved = await resolveExactScoreRunner({
            eventId: place.eventId,
            marketId: place.marketId,
            scoreline: place.scoreline,
            session,
          });
          place.selectionId = resolved.selectionId;
          place.metadata = {
            ...place.metadata,
            runnerName: resolved.runnerName,
            scoreline: resolved.scoreline,
          };
        }
      }
      const result = await adapter.placeOrder(session, place);
      const saved = await persistOrder(userId, conn.id, place, result, null);
      return {
        ok: true,
        orderId: result.orderId,
        status: result.status,
        provider: adapter.provider,
        demo: !!result.demo,
        wired: !!result.wired,
        selectionId: place.selectionId,
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

  /**
   * Lê saldo BetBra (login com credenciais salvas → clients/balance).
   * Atualiza session_enc com JWT/cookies da casa quando o login ok.
   */
  async function sessionBalance(token, query = {}) {
    const userId = await requireUserId(token);
    const provider = String(query?.provider || "betbra").toLowerCase();
    try {
      const rows = await sb(
        `/rest/v1/exchange_connections?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&provider=eq.${encodeURIComponent(provider)}&select=*&order=connected_at.desc&limit=1`,
        { token: serviceKey }
      );
      const conn = Array.isArray(rows) ? rows[0] : null;
      if (!conn?.session_enc) {
        const err = new Error(
          "Nenhuma Conta BetBra salva. Cadastre login/senha em Conta BetBra."
        );
        err.status = 400;
        err.code = "BETBRA_NO_CONNECTION";
        throw err;
      }
      const session = decryptSessionPayload(conn.session_enc);
      const login = String(session?.login || "").trim();
      const password = String(session?.password || "").trim();
      if (!login || !password) {
        const err = new Error(
          "Conta BetBra sem login/senha. Salve as credenciais de novo ou cole um token e use outro fluxo."
        );
        err.status = 400;
        err.code = "BETBRA_NO_CREDENTIALS";
        throw err;
      }

      const result = await betbraLoginAndBalance({ login, password });

      // Persiste token/cookies da casa (mantém login+senha)
      try {
        const next = {
          ...session,
          accessToken: result.houseToken || session.accessToken,
          houseToken: result.houseToken || null,
          cookies: result.cookies || session.cookies || null,
          cookieHeader:
            cookieHeaderFromJar(result.cookies) || session.cookieHeader || null,
          authMode: "credentials",
          lastBalance: result.balance,
          lastBalanceAt: new Date().toISOString(),
          demo: false,
        };
        const sessionEnc = encryptSessionPayload(next);
        const meta = {
          ...(conn.metadata && typeof conn.metadata === "object"
            ? conn.metadata
            : {}),
          has_login: true,
          login_masked: maskLogin(login),
          auth_mode: "credentials",
          last_balance: result.balance,
          last_balance_at: next.lastBalanceAt,
          has_house_token: !!result.houseToken,
        };
        await sb(
          `/rest/v1/exchange_connections?id=eq.${encodeURIComponent(conn.id)}`,
          {
            method: "PATCH",
            token: serviceKey,
            body: {
              session_enc: sessionEnc,
              metadata: meta,
              updated_at: new Date().toISOString(),
            },
          }
        );
      } catch {
        /* persistência best-effort — saldo já foi lido */
      }

      return {
        ok: true,
        provider,
        balance: result.balance,
        balanceCents: result.balanceCents,
        currency: result.currency || "BRL",
        source: result.source || "clients/balance",
        loginMasked: maskLogin(login),
        accountStatus: result.accountStatus || null,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return ensureTablesHint(err);
    }
  }

  /**
   * Diagnóstico: GET mexchange /account/info com cookies salvos.
   */
  async function sessionMexchangeAccount(token, query = {}) {
    const userId = await requireUserId(token);
    const provider = String(query?.provider || "betbra").toLowerCase();
    const rows = await sb(
      `/rest/v1/exchange_connections?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&provider=eq.${encodeURIComponent(provider)}&select=*&order=connected_at.desc&limit=1`,
      { token: serviceKey }
    );
    const conn = Array.isArray(rows) ? rows[0] : null;
    if (!conn?.session_enc) {
      const err = new Error("Nenhuma Conta BetBra salva");
      err.status = 400;
      err.code = "BETBRA_NO_CONNECTION";
      throw err;
    }
    let session = decryptSessionPayload(conn.session_enc);
    if (session.cookieHeader) {
      session = {
        ...session,
        cookieHeader: sanitizeTradingCookieHeader(session.cookieHeader),
      };
    }
    const cookieHeader = sessionCookieHeader(session);
    const cookieNames = cookieHeader
      ? cookieHeader
          .split(";")
          .map((p) => p.trim().split("=")[0])
          .filter(Boolean)
      : [];
    if (!hasTradingSession(session)) {
      return {
        ok: false,
        authenticated: false,
        accountId: null,
        cookieNames,
        error:
          "Sem cookies de sessão. Cole o cURL em Conta BetBra → Extrair → Salvar.",
        hint: "Cookie do Chrome pode não valer na VPS (IP diferente).",
      };
    }
    const acc = await fetchMexchangeAccountInfo(session);
    const authenticated = !!(acc.ok && acc.accountId);
    const balance =
      acc.raw?.balance != null
        ? Number(acc.raw.balance)
        : acc.raw?.availableBalance != null
          ? Number(acc.raw.availableBalance)
          : null;
    return {
      ok: authenticated,
      authenticated,
      accountId: acc.accountId || null,
      balance: Number.isFinite(balance) ? balance : null,
      currency: acc.currency,
      minBet: acc.minBet,
      httpStatus: acc.status,
      cookieAuthed: true,
      cookieNames,
      hint: authenticated
        ? "Sessão OK na Mexchange — pode tentar o place."
        : "AccountId vazio: sessão do Chrome não autentica na VPS (IP diferente). " +
          "Aprove o login da VPS por e-mail/SMS (Atualizar saldo) — Cookie do Chrome costuma falhar fora do seu IP.",
      rawKeys:
        acc.raw && typeof acc.raw === "object" ? Object.keys(acc.raw) : [],
    };
  }

  return {
    connectSession,
    disconnectSession,
    sessionStatus,
    sessionBalance,
    sessionMexchangeAccount,
    placeOrder,
    cancelOrder,
    orderStatus,
    listMyOrders,
    adapterProvider: () => adapter.provider,
  };
}
