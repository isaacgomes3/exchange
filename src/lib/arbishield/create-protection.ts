/**
 * PROTECAO_DO_ZERO — create-protection desativado.
 * Reimplemente do zero (ver scripts/lib/protection-flow-scaffold.mjs).
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgrestQueryBuilder
  from: (table: string) => any;
};

/** @deprecated Removido — proteção do zero. */
export function calcLay(_amountCents: number, _odd: number, _lockRatio = 0.9073) {
  throw Object.assign(
    new Error("calcLay removido — proteção em reconstrução (do zero)"),
    { status: 501 }
  );
}

/** @deprecated Removido — proteção do zero. */
export function calcBack(_amountCents: number, _odd: number) {
  throw Object.assign(
    new Error("calcBack removido — proteção em reconstrução (do zero)"),
    { status: 501 }
  );
}

export async function createProtection(
  _admin: Sb,
  _input: CreateProtectionInput
): Promise<CreateProtectionResult> {
  throw Object.assign(
    new Error(
      "Proteção em reconstrução (do zero). Modelos legado/fee_upfront/lock_fee_after desativados."
    ),
    { status: 501 }
  );
}
