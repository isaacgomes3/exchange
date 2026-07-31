/**
 * Cria proteção LAY/BACK no mesmo schema do SPA (sem RPC legado).
 *
 * TRAVADO — DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST
 * Fonte da verdade: scripts/lib/protection-flow-contract.mjs (v6 stake_lock_v1)
 * Ativação trava stake (máx. 50% restante · 1 op/evento · só antes do kickoff) ·
 * Ganhou Arbi credita stake · Ganhou Exchange R$ 0 cobra dedução ·
 * Empate Anula / Cancelar destravam.
 */

export type BalanceType = "REAL" | "DEMO" | "INVESTOR";

export type CreateProtectionInput = {
  userId: string;
  matchId: string;
  marketId?: string | null;
  amountCents: number;
  odd: number;
  balanceType?: BalanceType;
  marketType?: "LAY" | "BACK";
  side?: string;
  metadata?: Record<string, unknown>;
};

export type CreateProtectionResult = {
  ok: true;
  protectionId: string;
  marketType: "LAY" | "BACK";
  amountCents: number;
  balanceAfterCents: number;
  /** stake_lock: sempre 0 na criação (dedução só no Exchange). */
  feeChargedCents?: number;
  /** Valor travado em locked_balance_cents. */
  lockedCents?: number;
  /** Dedução calculada (cobrada só se ganhar na Exchange). */
  platformDeductionCents?: number;
  billingModel?: string;
};

/* Cliente admin Supabase — tipagem frouxa para não acoplar ao Postgrest. */
type Sb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgrestQueryBuilder
  from: (table: string) => any;
};

/** LAY odd → odd back equivalente: L/(L−1). Ex.: 14 → ≈1,077. */
export function layToBackOdd(layOdd: number) {
  const o = Number.isFinite(layOdd) && layOdd > 1.01 ? layOdd : 1.01;
  return o / (o - 1);
}

/**
 * Cálculo da dedução (cobrada no PERDEU) sobre odd BACK efetiva.
 * `amountCents` = cobertura: BACK → stake · LAY → responsabilidade
 */
export function calcFeeUpfront(amountCents: number, odd: number) {
  const coverage =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const grossReturnCents = Math.round(coverage * o);
  const grossProfitCents = Math.max(0, grossReturnCents - coverage);
  const exchangeCommissionCents = Math.max(
    0,
    Math.round(grossProfitCents * 0.045)
  );
  const userProfitCents = Math.round(coverage * 0.015);
  // lucro − 4,5% − 1,5% = dedução
  const arbiShieldDeductionCents = Math.max(
    0,
    grossProfitCents - exchangeCommissionCents - userProfitCents
  );
  return {
    stakeCents: coverage,
    responsibilityCents: coverage,
    coverageCents: coverage,
    odd: o,
    effectiveBackOdd: o,
    grossReturnCents,
    grossProfitCents,
    userProfitCents,
    arbiShieldDeductionCents,
    exchangeCommissionCents,
    exchangeFeeCents: exchangeCommissionCents,
    lockedDeductionCents: 0,
    exchangeProfitNetCents: grossProfitCents,
    billing_model: "stake_lock_v1" as const,
  };
}

/**
 * LAY — amountCents = responsabilidade da casa (não o stake).
 * Lucro fee = resp/(odd−1). Ex.: 1000 @10 → 111,11 → dedução 91,11.
 * Na casa: stake LAY ≈ responsabilidade / (odd − 1).
 */
export function calcLay(amountCents: number, odd: number, _lockRatio = 0.9073) {
  const marketOdd = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const backOdd = layToBackOdd(marketOdd);
  const liability =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const c = calcFeeUpfront(liability, backOdd);
  const houseStakeCents =
    marketOdd > 1.01 ? Math.round(liability / (marketOdd - 1)) : 0;
  return {
    ...c,
    stakeCents: houseStakeCents,
    responsibilityCents: liability,
    coverageCents: liability,
    odd: marketOdd,
    marketOdd,
    effectiveBackOdd: backOdd,
    input_mode: "responsabilidade" as const,
  };
}

/** BACK — amountCents = stake da casa; fee sobre odd do mercado (cálculo interno). */
export function calcBack(amountCents: number, odd: number) {
  return {
    ...calcFeeUpfront(amountCents, odd),
    input_mode: "stake" as const,
  };
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickBalanceField(balanceType: BalanceType): string {
  if (balanceType === "DEMO") return "demo_balance_cents";
  if (balanceType === "INVESTOR") return "investor_balance_cents";
  return "balance_cents";
}

function availableBalance(
  profile: Record<string, unknown>,
  balanceType: BalanceType
): number {
  if (balanceType === "DEMO") return num(profile.demo_balance_cents);
  if (balanceType === "INVESTOR") return num(profile.investor_balance_cents);
  // Banca real + legado reusable + Saldo Reembolso (retornos ArbiShield)
  return (
    num(profile.balance_cents) +
    num(profile.reusable_balance_cents) +
    num(profile.deduction_balance_cents)
  );
}

/** Alinhado a scripts/lib/protection-flow-contract.mjs */
const MAX_STAKE_FRACTION_OF_APOSTADOR = 0.5;
function maxStakeLockCents(apostadorAvailableCents: number) {
  return Math.floor(
    Math.max(0, num(apostadorAvailableCents)) * MAX_STAKE_FRACTION_OF_APOSTADOR
  );
}

function isMatchKickoffPassed(startsAt: unknown, nowMs = Date.now()) {
  if (startsAt == null || startsAt === "") return false;
  const t = new Date(String(startsAt)).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs >= t;
}

function isCancelledProtectionStatus(status: unknown) {
  const s = String(status || "")
    .toLowerCase()
    .trim();
  return (
    s === "cancelled" ||
    s === "canceled" ||
    s === "refunded" ||
    s === "pending_refund"
  );
}

export async function createProtection(
  admin: Sb,
  input: CreateProtectionInput
): Promise<CreateProtectionResult> {
  const amountCents = Math.floor(Number(input.amountCents));
  const odd = Number(input.odd);
  const balanceType: BalanceType = input.balanceType || "REAL";

  if (!input.userId) throw Object.assign(new Error("Não autorizado"), { status: 401 });
  if (!input.matchId) throw Object.assign(new Error("matchId obrigatório"), { status: 400 });
  if (!(amountCents > 0)) {
    throw Object.assign(new Error("Valor inválido"), { status: 400 });
  }
  if (!(odd > 1.01)) {
    throw Object.assign(new Error("Odd inválida"), { status: 400 });
  }

  const { data: match, error: matchErr } = await admin
    .from("matches")
    .select(
      "id,home_team,away_team,starts_at,status,status_v2,is_published,deleted_at,markets,max_protection_cents,used_protection_cents,metadata"
    )
    .eq("id", input.matchId)
    .maybeSingle();

  if (matchErr) throw new Error(matchErr.message);
  if (!match || match.deleted_at) {
    throw Object.assign(new Error("Jogo não encontrado"), { status: 404 });
  }
  if (match.is_published === false) {
    throw Object.assign(new Error("Jogo não publicado"), { status: 400 });
  }
  if (match.starts_at) {
    const startMs = new Date(match.starts_at).getTime();
    const now = Date.now();
    // Entradas só ANTES do kickoff (contrato v6).
    if (isMatchKickoffPassed(match.starts_at, now)) {
      throw Object.assign(
        new Error(
          "Evento já iniciado. Não é possível ativar proteção após o início."
        ),
        { status: 400 }
      );
    }
    const meta =
      match.metadata && typeof match.metadata === "object"
        ? (match.metadata as Record<string, unknown>)
        : {};
    const releaseMins = Number(
      meta.release_minutes_before ??
        (match as { release_minutes_before?: number }).release_minutes_before ??
        0
    );
    if (Number.isFinite(releaseMins) && releaseMins > 0 && Number.isFinite(startMs)) {
      const unlockAt = startMs - releaseMins * 60_000;
      if (now < unlockAt) {
        throw Object.assign(
          new Error(
            `Entradas liberam ${releaseMins} min antes do jogo. Aguarde a liberação.`
          ),
          { status: 400 }
        );
      }
    }
  }

  // 1 operação por evento (LAY ou BACK)
  {
    const [laysRes, backsRes] = await Promise.all([
      admin
        .from("protections")
        .select("id,status")
        .eq("user_id", input.userId)
        .eq("match_id", input.matchId)
        .limit(20),
      admin
        .from("back_protections")
        .select("id,status")
        .eq("user_id", input.userId)
        .eq("match_id", input.matchId)
        .limit(20),
    ]);
    const existing = [
      ...((laysRes.data as { status?: string }[]) || []),
      ...((backsRes.data as { status?: string }[]) || []),
    ];
    if (existing.some((r) => !isCancelledProtectionStatus(r?.status))) {
      throw Object.assign(
        new Error(
          "Você já possui uma operação neste evento. Só é permitida uma proteção por jogo."
        ),
        { status: 400 }
      );
    }
  }

  const markets = Array.isArray(match.markets) ? [...match.markets] : [];
  const market =
    (input.marketId &&
      markets.find((m: { id?: string }) => String(m.id) === String(input.marketId))) ||
    markets[0] ||
    null;

  const marketType: "LAY" | "BACK" =
    input.marketType ||
    (String(market?.market_type || "").toUpperCase() === "BACK" ? "BACK" : "LAY");

  if (market) {
    const liq = num(market.liquidity);
    const used = num(market.used_liquidity);
    if (liq > 0 && amountCents > liq - used) {
      throw Object.assign(new Error("Liquidez insuficiente neste mercado"), {
        status: 400,
      });
    }
  }

  const usedMatch = num(match.used_protection_cents);
  const maxMatch = num(match.max_protection_cents);
  if (maxMatch > 0 && amountCents > maxMatch - usedMatch) {
    throw Object.assign(new Error("Liquidez insuficiente neste jogo"), {
      status: 400,
    });
  }

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select(
      "id,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,investor_balance_cents,account_status,locked_balance_cents"
    )
    .eq("id", input.userId)
    .maybeSingle();

  if (profErr) throw new Error(profErr.message);
  if (!profile) {
    throw Object.assign(new Error("Perfil não encontrado"), { status: 404 });
  }
  if (
    profile.account_status &&
    ["blocked", "suspended", "banned", "inactive", "inativo"].includes(
      String(profile.account_status).toLowerCase()
    )
  ) {
    throw Object.assign(new Error("Conta bloqueada para operar"), { status: 403 });
  }

  const c = marketType === "BACK" ? calcBack(amountCents, odd) : calcLay(amountCents, odd);
  const feeCents = Math.max(0, num(c.arbiShieldDeductionCents));
  const lockCents = amountCents;

  const available = availableBalance(profile, balanceType);
  if (lockCents > available) {
    throw Object.assign(
      new Error(
        `Saldo insuficiente para travar ${(lockCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
      ),
      { status: 400 }
    );
  }
  const maxLock = maxStakeLockCents(available);
  if (lockCents > maxLock) {
    throw Object.assign(
      new Error(
        `Stake máximo neste evento é 50% do Apostador restante agora (${(maxLock / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}). Disponível: ${(available / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. No próximo evento o teto será 50% do que sobrar.`
      ),
      { status: 400 }
    );
  }

  const balanceBefore = available;
  let patch: Record<string, number> = {
    locked_balance_cents:
      num(profile.locked_balance_cents) + lockCents,
  };
  let balanceAfter = 0;

  if (balanceType === "REAL") {
    let left = lockCents;
    const bal =
      num(profile.balance_cents) + num(profile.reusable_balance_cents);
    const ded = num(profile.deduction_balance_cents);
    if (bal >= left) {
      patch = {
        ...patch,
        balance_cents: bal - left,
        reusable_balance_cents: 0,
        deduction_balance_cents: ded,
      };
    } else {
      left -= bal;
      patch = {
        ...patch,
        balance_cents: 0,
        reusable_balance_cents: 0,
        deduction_balance_cents: Math.max(0, ded - left),
      };
    }
    balanceAfter =
      num(patch.balance_cents) + num(patch.deduction_balance_cents);
  } else {
    const field = pickBalanceField(balanceType);
    const cur = num(profile[field]);
    patch = { ...patch, [field]: cur - lockCents };
    balanceAfter = cur - lockCents;
  }
  // stake_lock_v1: trava stake; dedução só no PERDEU

  const { error: debitErr } = await admin
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", input.userId);

  if (debitErr) throw new Error(debitErr.message);

  const meta = {
    ...(input.metadata || {}),
    market_id: market?.id || input.marketId || null,
    market_name: market?.name || null,
    market_type: marketType,
    market_odd: market?.odd ?? odd,
    source: "v2_create_protection_stake_lock",
    billing_model: "stake_lock_v1",
    stake_lock: true,
    fee_charged_cents: 0,
    platform_deduction_cents: feeCents,
    // LAY = responsabilidade · BACK = stake
    input_mode: marketType === "LAY" ? "responsabilidade" : "stake",
    stake_cents: marketType === "BACK" ? amountCents : num(c.stakeCents),
    responsibility_cents:
      marketType === "LAY" ? amountCents : num(c.responsibilityCents),
    gross_profit_cents: num(c.grossProfitCents),
    user_profit_cents: num(c.userProfitCents),
    exchange_commission_cents: num(c.exchangeCommissionCents || c.exchangeFeeCents),
    exchange_commission_rate: 0.045,
    exchange_fee_cents: num(c.exchangeCommissionCents || c.exchangeFeeCents),
    calculations: c,
    balance_type: balanceType,
  };

  let protectionId = "";
  try {
    if (marketType === "BACK") {
      const row = {
        user_id: input.userId,
        match_id: input.matchId,
        odd: c.odd,
        status: "active",
        amount_cents: c.coverageCents,
        user_profit_cents: c.userProfitCents,
        platform_deduction_cents: feeCents,
        balance_before_cents: balanceBefore,
        balance_after_cents: balanceAfter,
        metadata: meta,
      };
      const { data: inserted, error } = await admin
        .from("back_protections")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      protectionId = inserted.id;
    } else {
      const row = {
        user_id: input.userId,
        match_id: input.matchId,
        side: input.side || "home",
        odd: c.odd,
        status: "active",
        amount_cents: c.responsibilityCents,
        responsibility_cents: c.responsibilityCents,
        user_profit_cents: c.userProfitCents,
        platform_deduction_cents: feeCents,
        platform_profit_cents: feeCents,
        locked_deduction_cents: 0,
        exchange_fee_cents: Number(c.exchangeFeeCents || c.exchangeCommissionCents || 0),
        exchange_profit_net_cents: c.grossProfitCents,
        balance_before_cents: balanceBefore,
        balance_after_cents: balanceAfter,
        metadata: meta,
      };
      const { data: inserted, error } = await admin
        .from("protections")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      protectionId = inserted.id;
    }
  } catch (err) {
    // rollback saldo
    await admin
      .from("profiles")
      .update({
        balance_cents: profile.balance_cents,
        reusable_balance_cents: profile.reusable_balance_cents,
        demo_balance_cents: profile.demo_balance_cents,
        investor_balance_cents: profile.investor_balance_cents,
        locked_balance_cents: profile.locked_balance_cents,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.userId);
    throw err;
  }

  if (market) {
    const idx = markets.findIndex(
      (m: { id?: string }) => String(m.id) === String(market.id)
    );
    if (idx >= 0) {
      markets[idx] = {
        ...markets[idx],
        used_liquidity: num(markets[idx].used_liquidity) + amountCents,
      };
    }
  }

  await admin
    .from("matches")
    .update({
      markets,
      used_protection_cents: usedMatch + amountCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.matchId);

  await admin.from("wallet_transactions").insert({
    user_id: input.userId,
    type: "protection_lock",
    amount_cents: -lockCents,
    balance_before_cents: balanceBefore,
    balance_after_cents: balanceAfter,
    ref: protectionId,
    metadata: {
      protection_id: protectionId,
      match_id: input.matchId,
      market_type: marketType,
      balance_type: balanceType,
      billing_model: "stake_lock_v1",
      stake_cents: lockCents,
      fee_cents: feeCents,
      note: "Ativação: trava stake (dedução cobrada só no PERDEU)",
    },
  });

  return {
    ok: true,
    protectionId,
    marketType,
    amountCents,
    feeChargedCents: 0,
    lockedCents: lockCents,
    platformDeductionCents: feeCents,
    billingModel: "stake_lock_v1",
    balanceAfterCents: balanceAfter,
  };
}
