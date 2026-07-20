/**
 * Cria proteção LAY/BACK no mesmo schema do SPA (sem RPC legado).
 * Fórmulas espelhadas do ProtectionDrawer do frontend-mirror.
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
};

type Sb = {
  from: (table: string) => any;
};

/** LAY (mercado padrão): amount = responsabilidade */
export function calcLay(amountCents: number, odd: number, lockRatio = 0.9073) {
  const responsibilityCents =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const ratio =
    Number.isFinite(lockRatio) && lockRatio >= 0 && lockRatio <= 1
      ? lockRatio
      : 0.9073;
  const stakeRealCents = Math.round(responsibilityCents / (o - 1));
  const lockedDeductionCents = Math.round(stakeRealCents * ratio);
  const exchangeProfitGrossCents = stakeRealCents;
  const exchangeFeeCents = Math.round(exchangeProfitGrossCents * 0.045);
  const exchangeProfitNetCents = exchangeProfitGrossCents - exchangeFeeCents;
  const userProfitCents = Math.round(responsibilityCents * 0.015);
  const arbiShieldDeductionCents = exchangeProfitNetCents - userProfitCents;
  return {
    responsibilityCents,
    odd: o,
    stakeRealCents,
    lockedDeductionCents,
    exchangeFeeCents,
    exchangeProfitNetCents,
    userProfitCents,
    arbiShieldDeductionCents,
  };
}

/** BACK: amount = cobertura */
export function calcBack(amountCents: number, odd: number) {
  const coverage =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd >= 1.01 ? odd : 1.01;
  const grossReturnCents = Math.round(coverage * o);
  const grossProfitCents = Math.max(0, grossReturnCents - coverage);
  const exchangeFeeCents = Math.round(grossProfitCents * 0.045);
  const netProfitExchangeCents = grossProfitCents - exchangeFeeCents;
  const userProfitCents = Math.round(coverage * 0.015);
  const arbiShieldDeductionCents = netProfitExchangeCents - userProfitCents;
  return {
    coverageCents: coverage,
    odd: o,
    grossReturnCents,
    grossProfitCents,
    exchangeFeeCents,
    netProfitExchangeCents,
    userProfitCents,
    arbiShieldDeductionCents,
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
  return num(profile.balance_cents) + num(profile.reusable_balance_cents);
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
  if (match.starts_at && new Date(match.starts_at).getTime() <= Date.now()) {
    throw Object.assign(
      new Error("Jogo já iniciado. Não é possível criar novas proteções."),
      { status: 400 }
    );
  }

  const markets = Array.isArray(match.markets) ? [...match.markets] : [];
  let market =
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
      "id,balance_cents,reusable_balance_cents,demo_balance_cents,investor_balance_cents,account_status,locked_balance_cents"
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

  const available = availableBalance(profile, balanceType);
  if (amountCents > available) {
    throw Object.assign(new Error("Saldo insuficiente"), { status: 400 });
  }

  const balanceBefore = available;
  let patch: Record<string, number> = {};
  let balanceAfter = 0;

  if (balanceType === "REAL") {
    const bal = num(profile.balance_cents);
    const reusable = num(profile.reusable_balance_cents);
    if (bal >= amountCents) {
      patch = { balance_cents: bal - amountCents };
      balanceAfter = bal - amountCents + reusable;
    } else {
      const rest = amountCents - bal;
      patch = { balance_cents: 0, reusable_balance_cents: reusable - rest };
      balanceAfter = reusable - rest;
    }
  } else {
    const field = pickBalanceField(balanceType);
    const cur = num(profile[field]);
    patch = { [field]: cur - amountCents };
    balanceAfter = cur - amountCents;
  }

  patch.locked_balance_cents =
    num(profile.locked_balance_cents) + amountCents;

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
    source: "v2_create_protection",
  };

  let protectionId = "";
  try {
    if (marketType === "BACK") {
      const c = calcBack(amountCents, odd);
      const row = {
        user_id: input.userId,
        match_id: input.matchId,
        odd: c.odd,
        status: "active",
        amount_cents: c.coverageCents,
        user_profit_cents: c.userProfitCents,
        platform_deduction_cents: c.arbiShieldDeductionCents,
        balance_before_cents: balanceBefore,
        balance_after_cents: balanceAfter,
        metadata: {
          ...meta,
          exchange_fee_cents: c.exchangeFeeCents,
          calculations: c,
          balance_type: balanceType,
        },
      };
      const { data: inserted, error } = await admin
        .from("back_protections")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      protectionId = inserted.id;
    } else {
      const c = calcLay(amountCents, odd);
      const row = {
        user_id: input.userId,
        match_id: input.matchId,
        side: input.side || "home",
        odd: c.odd,
        status: "active",
        amount_cents: c.responsibilityCents,
        responsibility_cents: c.responsibilityCents,
        user_profit_cents: c.userProfitCents,
        platform_deduction_cents: c.arbiShieldDeductionCents,
        platform_profit_cents: c.arbiShieldDeductionCents,
        locked_deduction_cents: c.lockedDeductionCents,
        exchange_fee_cents: c.exchangeFeeCents,
        exchange_profit_net_cents: c.exchangeProfitNetCents,
        balance_before_cents: balanceBefore,
        balance_after_cents: balanceAfter,
        metadata: {
          ...meta,
          balance_type: balanceType,
        },
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
    amount_cents: amountCents,
    balance_before_cents: balanceBefore,
    balance_after_cents: balanceAfter,
    ref: protectionId,
    metadata: {
      protection_id: protectionId,
      match_id: input.matchId,
      market_type: marketType,
      balance_type: balanceType,
    },
  });

  return {
    ok: true,
    protectionId,
    marketType,
    amountCents,
    balanceAfterCents: balanceAfter,
  };
}
