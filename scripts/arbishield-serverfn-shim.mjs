#!/usr/bin/env node
/**
 * Shim local para /_serverFn/* da ArbiShield na VPS (frontend estático).
 * Sem isso o nginx devolve index.html e a Gestão de Desafios fica no spinner.
 *
 * Env: ARBISHIELD_SUPABASE_URL, SERVICE_ROLE_KEY (ou ANON_KEY + Authorization do browser)
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Contrato travado — import opcional (se lib faltar na VPS, usa fallback inline
// para o shim não cair e a rota de saque continuar disponível).
let PROTECTION_FLOW_LOCK = "DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST";
let PROTECTION_FLOW_CONTRACT_VERSION = "protection-flow-contract-v10";
let PROTECTION_BILLING_MODEL_CANONICAL = "stake_lock_v1";
let PROTECTION_RUNTIME_HEALTH_MARKER = "protection-runtime-stake-lock-v10";
let CREATE_PROTECTION_FIX_MARKER = "create-protection-stake-lock-v6";
let isProtectionRuntimeHealthy = (health = {}) => {
  const model = String(health.createProtectionModel || "").trim();
  const runtime = String(
    health.protectionRuntime || health.fix || ""
  ).trim();
  const blob = JSON.stringify(health);
  if (/protection-fee-upfront-v\d+/i.test(blob)) return false;
  if (/fee_upfront/i.test(model)) return false;
  return (
    model === "stake_lock_v1" ||
    runtime.includes("protection-runtime-stake-lock-v10") ||
    runtime.includes("create-protection-stake-lock-v6")
  );
};
let isStakeLockProtection;
let settlementCreditParts;
let settlementCreditCents;
let settlementDeductionCents;
let settlementStatusForOutcome;
let isFeeUpfrontProtection;
let isVoidSettleOutcome;
let normalizeSettleOutcome;
let creditBucketForSettlement = () => "deduction_balance_cents";
let cancelRefundCents;
let CANCEL_FEE_UPFRONT_NO_STAKE_REFUND =
  "cancel-fee-upfront-nao-devolve-stake-v6";
let isExchangeWalletComplete;
let exchangeWalletHealNeeded;
let settlementOutcomeFromProtectionRow;
let EXCHANGE_CHARGE_DEDUCTION_RULE = "settle-exchange-cobra-so-deducao-v9";
let EXCHANGE_INCOMPLETE_HEAL_RULE = "settle-exchange-heal-incompleto-v10";
let SETTLEMENT_ODD_CANONICAL_RULE = "settlement-odd-canonico-v10";
let settlementExchangeCommissionCents;
let settlementExchangeCommissionWalletCents = () => 0;
let EXCHANGE_COMMISSION_RATE = 0.045;

try {
  const mod = await import(
    pathToFileURL(
      resolve(dirname(fileURLToPath(import.meta.url)), "lib/protection-flow-contract.mjs")
    ).href
  );
  PROTECTION_FLOW_LOCK = mod.PROTECTION_FLOW_LOCK;
  PROTECTION_FLOW_CONTRACT_VERSION = mod.PROTECTION_FLOW_CONTRACT_VERSION;
  if (mod.PROTECTION_BILLING_MODEL_CANONICAL) {
    PROTECTION_BILLING_MODEL_CANONICAL = mod.PROTECTION_BILLING_MODEL_CANONICAL;
  }
  if (mod.PROTECTION_RUNTIME_HEALTH_MARKER) {
    PROTECTION_RUNTIME_HEALTH_MARKER = mod.PROTECTION_RUNTIME_HEALTH_MARKER;
  }
  if (mod.CREATE_PROTECTION_FIX_MARKER) {
    CREATE_PROTECTION_FIX_MARKER = mod.CREATE_PROTECTION_FIX_MARKER;
  }
  if (typeof mod.isProtectionRuntimeHealthy === "function") {
    isProtectionRuntimeHealthy = mod.isProtectionRuntimeHealthy;
  }
  settlementCreditParts = mod.settlementCreditParts;
  settlementCreditCents = mod.settlementCreditCents;
  settlementDeductionCents = mod.settlementDeductionCents;
  settlementStatusForOutcome = mod.settlementStatusForOutcome;
  isFeeUpfrontProtection = mod.isFeeUpfrontProtection;
  isStakeLockProtection = mod.isStakeLockProtection;
  isVoidSettleOutcome = mod.isVoidSettleOutcome;
  normalizeSettleOutcome = mod.normalizeSettleOutcome;
  creditBucketForSettlement = mod.creditBucketForSettlement;
  cancelRefundCents = mod.cancelRefundCents;
  if (mod.CANCEL_FEE_UPFRONT_NO_STAKE_REFUND) {
    CANCEL_FEE_UPFRONT_NO_STAKE_REFUND = mod.CANCEL_FEE_UPFRONT_NO_STAKE_REFUND;
  }
  isExchangeWalletComplete = mod.isExchangeWalletComplete;
  if (typeof mod.exchangeWalletHealNeeded === "function") {
    exchangeWalletHealNeeded = mod.exchangeWalletHealNeeded;
  }
  if (typeof mod.settlementOutcomeFromProtectionRow === "function") {
    settlementOutcomeFromProtectionRow = mod.settlementOutcomeFromProtectionRow;
  }
  if (mod.EXCHANGE_CHARGE_DEDUCTION_RULE) {
    EXCHANGE_CHARGE_DEDUCTION_RULE = mod.EXCHANGE_CHARGE_DEDUCTION_RULE;
  }
  if (mod.EXCHANGE_INCOMPLETE_HEAL_RULE) {
    EXCHANGE_INCOMPLETE_HEAL_RULE = mod.EXCHANGE_INCOMPLETE_HEAL_RULE;
  }
  if (mod.SETTLEMENT_ODD_CANONICAL_RULE) {
    SETTLEMENT_ODD_CANONICAL_RULE = mod.SETTLEMENT_ODD_CANONICAL_RULE;
  }
  settlementExchangeCommissionCents = mod.settlementExchangeCommissionCents;
  if (typeof mod.settlementExchangeCommissionWalletCents === "function") {
    settlementExchangeCommissionWalletCents =
      mod.settlementExchangeCommissionWalletCents;
  }
  if (mod.EXCHANGE_COMMISSION_RATE != null) {
    EXCHANGE_COMMISSION_RATE = mod.EXCHANGE_COMMISSION_RATE;
  }
} catch (err) {
  console.warn(
    "[serverfn-shim] protection-flow-contract ausente — fallback inline:",
    err instanceof Error ? err.message : err
  );
  isVoidSettleOutcome = (outcome) => {
    const o = String(outcome || "")
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_");
    return (
      o === "void" ||
      o === "empate_anula" ||
      o === "anula" ||
      o === "draw" ||
      o === "push" ||
      o === "dnb" ||
      o === "draw_no_bet"
    );
  };
  normalizeSettleOutcome = (outcome) => {
    const o = String(outcome || "")
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_");
    if (o === "arbishield" || o === "exchange") return o;
    if (isVoidSettleOutcome(o)) return "void";
    return o;
  };
  isFeeUpfrontProtection = (row) => {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    if (meta.billing_model === "stake_lock_v1" || meta.stake_lock === true) {
      return false;
    }
    if (
      meta.billing_model === "fee_upfront_v1" ||
      meta.fee_upfront === true ||
      String(meta.source || "").includes("fee_upfront")
    ) {
      return true;
    }
    return Number(meta.fee_charged_cents || 0) > 0;
  };
  settlementDeductionCents = (row) => {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const stake = Math.max(
      0,
      Math.trunc(Number(row?.responsibility_cents || row?.amount_cents || meta.stake_cents) || 0)
    );
    let odd = Number(meta.market_odd);
    if (!(odd > 1.01)) odd = Number(row?.odd || 0);
    const mt = String(meta.market_type || "").toUpperCase();
    const compute = () => {
      if (!(stake > 0) || !(odd > 1.01)) return 0;
      // lay-lucro-back-equiv-v9: LAY → backOdd
      const eff = mt === "LAY" && odd > 1.01 ? odd / (odd - 1) : odd;
      const profit = Math.max(0, Math.round(stake * eff) - stake);
      const commission = Math.round(profit * EXCHANGE_COMMISSION_RATE);
      const userProfit = Math.round(stake * 0.015);
      return Math.max(0, profit - commission - userProfit);
    };
    const stored = Math.max(
      0,
      Number(
        row?.platform_deduction_cents ??
          row?.platform_profit_cents ??
          meta.fee_charged_cents ??
          row?.locked_deduction_cents
      ) || 0
    );
    // fee_upfront: stored; stake_lock: fórmula vigente (LAY: resp/odd − 4,5% − 1,5%)
    if (isFeeUpfrontProtection(row)) return stored > 0 ? stored : compute();
    const computed = compute();
    return computed > 0 ? computed : stored;
  };
  isStakeLockProtection = (row) => {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    if (meta.billing_model === "stake_lock_v1" || meta.stake_lock === true) return true;
    return !isFeeUpfrontProtection(row);
  };
  cancelRefundCents = (row) => {
    const stake = Math.max(
      0,
      Math.trunc(Number(row?.responsibility_cents || row?.amount_cents) || 0)
    );
    const fee = settlementDeductionCents(row);
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    if (meta.billing_model === "stake_lock_v1" || meta.stake_lock === true) return stake;
    if (isFeeUpfrontProtection(row)) return fee;
    return stake;
  };
  isExchangeWalletComplete = ({
    feeUpfront = false,
    feeExpected = 0,
    feeCharged = 0,
    feeShortfall = 0,
    unlocked = false,
    needsUnlock = false,
    stakeReturned = false,
    needsReturn = false,
  } = {}) => {
    if (feeUpfront) return true;
    if (needsUnlock && !unlocked) return false;
    if (needsReturn && !stakeReturned) return false;
    const fee = Math.max(0, Number(feeExpected) || 0);
    if (!(fee > 0)) return true;
    return (
      Math.max(0, Number(feeCharged) || 0) + Math.max(0, Number(feeShortfall) || 0) >=
      fee
    );
  };
  settlementExchangeCommissionCents = (row) => {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    let fee = Math.max(0, Number(row?.exchange_fee_cents ?? meta.exchange_commission_cents ?? meta.exchange_fee_cents) || 0);
    if (fee > 0) return fee;
    let gross = Math.max(0, Number(meta.gross_profit_cents ?? row?.exchange_profit_net_cents) || 0);
    if (!(gross > 0)) {
      const stake = Math.max(
        0,
        Math.trunc(Number(row?.responsibility_cents || row?.amount_cents || meta.stake_cents) || 0)
      );
      let odd = Number(meta.market_odd);
      if (!(odd > 1.01)) odd = Number(row?.odd || 0);
      const mt = String(meta.market_type || "").toUpperCase();
      if (stake > 0 && odd > 1.01) {
        gross =
          mt === "LAY"
            ? Math.max(0, Math.round(stake / odd))
            : Math.max(0, Math.round(stake * odd) - stake);
      }
    }
    if (gross > 0) return Math.round(gross * EXCHANGE_COMMISSION_RATE);
    return 0;
  };
  settlementCreditParts = (row, outcome) => {
    const amount = Math.max(
      0,
      Math.trunc(Number(row?.responsibility_cents || row?.amount_cents) || 0)
    );
    const fee = settlementDeductionCents(row);
    const o = normalizeSettleOutcome(outcome);
    const wonArbi = o === "arbishield";
    const isVoid = o === "void";
    if (!wonArbi && !isVoid) return { stake: 0, fee: 0, total: 0 };
    if (isFeeUpfrontProtection(row)) {
      if (isVoid) return { stake: 0, fee, total: fee };
      return { stake: amount, fee, total: amount + fee };
    }
    return { stake: amount, fee: 0, total: amount };
  };
  creditBucketForSettlement = (_balanceType, row, outcome) => {
    const o = normalizeSettleOutcome(outcome);
    if (o === "void" && isStakeLockProtection(row)) {
      const bt = String(
        (row?.metadata &&
          (row.metadata.balance_type ||
            row.metadata.balance_type_requested ||
            row.metadata.balanceType)) ||
          _balanceType ||
          "REAL"
      ).toUpperCase();
      if (bt === "DEMO") return "demo_balance_cents";
      if (bt === "INVESTOR") return "investor_balance_cents";
      return "balance_cents";
    }
    return "deduction_balance_cents";
  };
  settlementCreditCents = (row, outcome) => settlementCreditParts(row, outcome).total;
  settlementStatusForOutcome = (outcome) => {
    const o = normalizeSettleOutcome(outcome);
    if (o === "arbishield") return "lost_exchange";
    if (o === "void") return "void";
    return "won_exchange";
  };
  exchangeWalletHealNeeded = (row, prior = {}) => {
    const feeUpfront = isFeeUpfrontProtection(row);
    const amount = Math.max(
      0,
      Math.trunc(Number(row?.responsibility_cents || row?.amount_cents) || 0)
    );
    const stakeLock = isStakeLockProtection(row);
    const needsUnlock = (stakeLock || !feeUpfront) && amount > 0;
    const needsReturn = stakeLock && !feeUpfront && amount > 0;
    const fee = settlementDeductionCents(row);
    if (!prior || prior.hasTx !== true) return true;
    return !isExchangeWalletComplete({
      feeUpfront,
      feeExpected: fee,
      feeCharged: prior.feeCharged || 0,
      feeShortfall: prior.feeShortfall || 0,
      unlocked: prior.unlocked || !needsUnlock,
      needsUnlock,
      stakeReturned: prior.stakeReturned || !needsReturn,
      needsReturn,
    });
  };
  settlementOutcomeFromProtectionRow = (row) => {
    const stored = normalizeSettleOutcome(row?.settled_outcome || "");
    if (stored === "arbishield" || stored === "exchange" || stored === "void") {
      return stored;
    }
    const st = String(row?.status || "")
      .toLowerCase()
      .trim();
    if (st === "won_exchange") return "exchange";
    if (
      st === "lost_exchange" ||
      st === "won_platform" ||
      st === "lost_platform"
    ) {
      return "arbishield";
    }
    if (st === "cancelled" || st === "canceled" || st === "void") return "void";
    return "";
  };
}

void PROTECTION_FLOW_LOCK;
void PROTECTION_FLOW_CONTRACT_VERSION;
void PROTECTION_BILLING_MODEL_CANONICAL;
void PROTECTION_RUNTIME_HEALTH_MARKER;
void CREATE_PROTECTION_FIX_MARKER;
void isProtectionRuntimeHealthy;
void CANCEL_FEE_UPFRONT_NO_STAKE_REFUND;
void EXCHANGE_CHARGE_DEDUCTION_RULE;
void EXCHANGE_INCOMPLETE_HEAL_RULE;
void SETTLEMENT_ODD_CANONICAL_RULE;
void settlementCreditCents;

const require = createRequire(import.meta.url);
let toJSON;
try {
  ({ toJSON } = require("seroval"));
} catch {
  toJSON = null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(resolve(root, ".env.local"));
loadEnvFile(resolve(root, ".env"));
loadEnvFile("/opt/arbishield/deploy/vps-supabase/.env");
loadEnvFile("/opt/arbishield/.arbishield-odds-sync.env");

const LISTEN = process.env.SERVERFN_LISTEN || "127.0.0.1:3101";
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  process.env.SUPABASE_PUBLIC_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");
const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.ANON_KEY || process.env.SUPABASE_ANON_KEY;

/** Hashes usados pelo frontend estático na VPS */
const FN = {
  LIST_DESAFIOS:
    "1bb9f049aba8148a459a513d34c0dfe014f33de5cd8cab3e3f6ec006f6f9e510",
  DASHBOARD_STATS:
    "8867aca1da470aaa83906b6b13bb7e7018c9dea355ae3cff430f0f97ddbb4a62",
  ADMIN_TX_FEED:
    "b8e5956ab4d19dcac2cf2318fe933b86f3eba19702cdd8ffb947c5b0bb1a3c68",
  /** admin.users: Promise.all([listUsers, isSuperAdmin]) */
  ADMIN_LIST_USERS:
    "fb16933f5d8f0788db13c8b74f3c53149e2989eeae483bd064ab7a9a15432c7a",
  ADMIN_IS_SUPER:
    "7522f63695242dffa7a9bd8ff11c911129bae721fcfbe52bc99240398508d149",
  /** App usuário — useDashboardData / useMyProfile / notifications */
  USER_MY_PROFILE:
    "0b9cedaa2cd8cfbb349649b17fbb90b7787010fd34877267a0cc05b0344fe963",
  USER_DASH_CRITICAL:
    "ab071cfb2fe9b23085f40d59daf5a3ae60da0b5bff9b5c52014742fc892fd3d7",
  USER_DASH_SECONDARY:
    "b8374a52968db3ecab37d916b7b4d5690cdd213df514104e2d8285786240cd29",
  USER_NOTIFICATIONS:
    "a7dd1971020b4c9784307d27a0d0453a2ab0c88a98414b556ad61ef25e275a50",
  USER_GEO_LOG:
    "2536c7837adaa096529fad853f0b0284e9e9ee6f8a90557a96d0ff98cede975d",
  UPSERT_DESAFIO:
    "ab2bcac276202b9ac1d2f136884f8c3a1f072f457032e6d2062cdfce05358fd1",
  DELETE_DESAFIO:
    "1c8b336e8819e53d0326cf2fe66ad5c1b03a3c3cbb7235ae67de5d8ab739a4c3",
  /** banners.functions — público + admin CRUD */
  BANNERS_PUBLIC_LIST:
    "cb53fc03069486f35e46a97afc68d768074eaa2682e6703751b5b4346f64d44d",
  BANNERS_ADMIN_LIST:
    "1ba88b9010fce03e0ff3c3c5c51fa278db819ebf4bd77b99867e3064c86e091d",
  BANNERS_UPSERT:
    "e5068c82295243a913a4850dfd5bd1c64c5a4166ae501581a3a459960e630a87",
  BANNERS_DELETE:
    "198b78c34f17e6663dd0b2aee49a4b143a2d04f70a88a721d7a7b7992040a0f5",
  BANNERS_REORDER:
    "6bb5b94ad984dfda9b3f6d2310eceb0106f341515295fa988444b412c57367ca",
  /** App carteira — transferência banca → desafio (máx. 50%) */
  TRANSFER_TO_DESAFIO:
    "f0610601d4285267b31d611e5eb632c530485702882605895d90b39b8be5922c",
  /** App afiliados */
  AFFILIATE_ENSURE_CODE:
    "fbc95c35a41b7d1f4cbff94481e4cc717dd5380d319f9c14ff638a68fe355a1c",
  AFFILIATE_WITHDRAW:
    "fe464d9378f5852cb8f2f20c8e6b6ee390d83b070e7008ed29ccfbf7ac320d89",
  /** Monitor proteções — cancelar/estornar + encerrar sem estorno (SPA) */
  PROTECTION_CANCEL_REFUND:
    "7389baaef3c2b584c409c59fc824e6b8438e2b36b31962f19de0f1815c6e443a",
  PROTECTION_CLOSE_NO_REFUND:
    "85ba18adcbc268610fb2ac76551978abee821260d93161e23aca41bd5d531e21",
  /** Contestações de odd / cancelamento (SPA + v2) */
  CONTESTATION_LIST:
    "59c0d818802363264163ee9444e24b1e3264bcd8aec301585bdc70fcac943eed",
  CONTESTATION_SUBMIT:
    "2a6aef91a48eaa19a2fd107fe580b1c6edf54fd10f1962c1d5d3e40f5c38d120",
  CONTESTATION_APPROVE:
    "9915d3faeedf7212cb506bdd07689806611c78427c4cba1c2fdbd880cb5d8232",
  CONTESTATION_REJECT:
    "94342764ce144c96ccc6f2f642dee8f04c0f51a24a39b4ae8ff5a7b37a9cbcac",
  CONTESTATION_OPERATOR:
    "999f1648c68771b43e99a09e3f7072005159abcf97c194da771c8fa80d21bf85",
  /** Admin Jogos — liquidar partida / mercado (SPA admin.matches) */
  MATCH_SETTLE_SINGLE:
    "c18778cffbba4cac38b3df54b2a50b3179a999b1c9908c2adbddd929ada5932f",
  MATCH_SETTLE_MARKET:
    "21c595c85ce2650c9c69d344a653ac759200afa18939bed530bb7448f7f8ffe0",
  MATCH_SETTLE_MULTI:
    "b70f19e71ec3ab8c40e0717abe92ab2082c7eedd832da71ab87cea2f2d95e286",
  /** Admin depósitos manuais (SPA admin.manual-deposits) */
  DEPOSIT_APPROVE:
    "81753fec5a4788d0cecf17daf4605047d90238c386a240b54855a19f0fbc53d2",
  DEPOSIT_MARK_CREDITED:
    "1b3d8a890eea085aa1507094a9ce6e49ca532e35c3e17363c50b9dc1a253ddd5",
  DEPOSIT_REJECT:
    "97fbb202a39627b7eeade54ac383dd1197c5a76c5f392f3046ee5875fef4da50",
  /** Upload comprovante (cria bucket se faltar) */
  DEPOSIT_UPLOAD_PROOF:
    "a8c4e21f0b7d9e6a5f3c2d1b0a99887766554433221100ffeeddccbbaa997788",
  DEPOSIT_PROOF_URL:
    "c1d2e3f4a5b697887766554433221100ffeeddccbbaa99887766554433221100",
  /** Desafio — participação / settle (SPA surebet-validation) */
  DESAFIO_LIST_ACTIVE:
    "3d73b89476f54f1c738f12aa01a568e18829e0f8072936120346589e89b7b310",
  DESAFIO_BY_ID:
    "20c2d3787c1a5c9b929ff144f57f21ab03d16c29ef5059b233b1ef95797f0295",
  DESAFIO_REGISTER_ENTRY:
    "3c34027d8a2eb09861f6b73d3cde7533042d7ef97309fd62a78f46357c4e51d6",
  DESAFIO_CANCEL:
    "0ef0734039213d3b2c32371fe86cfa0486ad08ee0f364097c303347064f174c9",
  DESAFIO_LIST_PARTICIPATIONS:
    "75cfd1c4229fc49205ac01e4118352ced7608cca40417a415c1dd71561117355",
  DESAFIO_SETTLE:
    "357c98074708d437f1c98549857e29b1a5881358a44f70db45ed256f3bfb1b12",
  /** Provedor — distribuição admin (SPA) */
  PARTNER_ACTIVE_ROUNDS:
    "af661e4af08de0c265f682210b9bdb864049caf7d61b314c5b8c2ebefde48adc",
  PARTNER_DISTRIBUTE:
    "120795c23c4b588b868e5a2e18a3cd3839de0a1730c6c4022530fbb85c461dbc",
  PARTNER_DIST_HISTORY:
    "c3e505ca39c3e3d9e93ec2ee1e58a3168d6f34877d6de9caef17fd5d18dafd5d",
  PARTNER_MONTHLY_STATS:
    "5e62a59e14e7576ff86b0083e6e9ff57c75984e58b0904bf604e8cd041487fc8",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, apikey, x-tsr-serverFn, accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function wantsPlainJson(req) {
  const h = req?.headers || {};
  const plain = String(h["x-arbishield-plain"] || "").trim();
  return plain === "1" || plain.toLowerCase() === "true";
}

function replyFnOk(req, res, data) {
  if (wantsPlainJson(req)) return sendJson(res, 200, data);
  return sendTsrOk(res, data);
}

function replyFnError(req, res, message) {
  if (wantsPlainJson(req)) {
    return sendJson(res, 400, { error: message });
  }
  return sendTsrError(res, message);
}

/** Codifica valores no formato Seroval/TSR que o client TanStack Start espera. */
function encVal(value, ids) {
  if (value === null || value === undefined) return { t: 2, s: 1 };
  if (typeof value === "string") return { t: 1, s: value };
  if (typeof value === "boolean") return { t: 3, s: value ? 1 : 0 };
  if (typeof value === "number") return { t: 0, s: value };
  if (Array.isArray(value)) {
    const i = ids.n++;
    return {
      t: 9,
      i,
      a: value.map((x) => encVal(x, ids)),
      o: 0,
    };
  }
  if (typeof value === "object") {
    const i = ids.n++;
    const k = Object.keys(value);
    return {
      t: 10,
      i,
      p: { k, v: k.map((key) => encVal(value[key], ids)) },
      o: 0,
    };
  }
  return { t: 1, s: String(value) };
}

/** Resposta de sucesso no protocolo TSR (sem isso o SPA trata data como undefined). */
function sendTsrOk(res, data) {
  cors(res);
  const payload = { result: data, error: null, context: {} };
  let body;
  if (typeof toJSON === "function") {
    // Client fromJSON espera o nó; toJSON envolve em { t, f, m }.
    const encoded = toJSON(payload);
    body = encoded && encoded.t ? encoded.t : encoded;
  } else {
    const ids = { n: 1 };
    const resultNode = encVal(data, ids);
    const contextNode = { t: 10, i: ids.n++, p: { k: [], v: [] }, o: 0 };
    body = {
      t: 10,
      i: 0,
      p: {
        k: ["result", "error", "context"],
        v: [resultNode, { t: 2, s: 1 }, contextNode],
      },
      o: 0,
    };
  }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "x-tss-serialized": "true",
  });
  res.end(JSON.stringify(body));
}

function sendTsrError(res, message) {
  cors(res);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "x-tss-serialized": "true",
  });
  res.end(
    JSON.stringify({
      t: 10,
      i: 0,
      p: {
        k: ["result", "error", "context"],
        v: [
          { t: 2, s: 1 },
          {
            t: 25,
            i: 1,
            s: { message: { t: 1, s: message } },
            c: "$TSR/Error",
          },
          { t: 10, i: 2, p: { k: [], v: [] }, o: 0 },
        ],
      },
      o: 0,
    })
  );
}

function bearerFromReq(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Ajusta platform_treasury (caixa operacional da empresa).
 * Desde o cutover do shim (~2026-07-19) não havia writer — esta função
 * religa créditos/débitos de P&L e caixa.
 * Idempotente por (action, entityType, entityId) via admin_audit_logs.
 */
async function adjustPlatformTreasury(deltaCents, meta = {}) {
  const delta = Math.round(Number(deltaCents) || 0);
  if (!delta) return { ok: true, skipped: true, reason: "delta_zero" };

  const action = String(meta.action || "TREASURY_ADJUST");
  const entityType = String(meta.entityType || meta.entity_type || "platform_treasury");
  const entityId = String(meta.entityId || meta.entity_id || "").trim();

  if (entityId) {
    try {
      const prev = await sb(
        `/rest/v1/admin_audit_logs?select=id&action=eq.${encodeURIComponent(action)}&entity_type=eq.${encodeURIComponent(entityType)}&entity_id=eq.${encodeURIComponent(entityId)}&limit=1`,
        { token: SERVICE_KEY }
      );
      if (Array.isArray(prev) && prev[0]) {
        return { ok: true, skipped: true, reason: "already_applied", id: prev[0].id };
      }
    } catch {
      /* sem tabela/audit — segue sem idempotência forte */
    }
  }

  const rows = await sb(
    `/rest/v1/platform_treasury?select=id,operational_balance_cents,balance_cents,reserve_balance_cents,locked_balance_cents&order=updated_at.desc&limit=1`,
    { token: SERVICE_KEY }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.id) {
    console.warn("[treasury] platform_treasury vazio — não foi possível ajustar", delta, meta);
    return { ok: false, skipped: true, reason: "no_row" };
  }

  const nextOp = n(row.operational_balance_cents) + delta;
  const body = {
    operational_balance_cents: nextOp,
    updated_at: new Date().toISOString(),
  };
  // Mantém balance_cents alinhado quando a coluna existe (UI v2 / legado)
  if (row.balance_cents != null) {
    body.balance_cents = n(row.balance_cents) + delta;
  }

  await sb(`/rest/v1/platform_treasury?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body,
  });

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: meta.adminId || meta.admin_id || null,
        action,
        entity_type: entityType,
        entity_id: entityId || row.id,
        details: {
          delta_cents: delta,
          before_operational_cents: n(row.operational_balance_cents),
          after_operational_cents: nextOp,
          fix: "treasury-writers-v1",
          ...(meta.details && typeof meta.details === "object" ? meta.details : {}),
        },
      },
    });
  } catch (e) {
    console.warn("[treasury] audit log:", e.message || e);
  }

  return {
    ok: true,
    deltaCents: delta,
    before: n(row.operational_balance_cents),
    after: nextOp,
    treasuryId: row.id,
  };
}

function startOfDaySaoPaulo(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return new Date(
    `${get("year")}-${get("month")}-${get("day")}T00:00:00-03:00`
  );
}

async function sb(path, { token, method = "GET", body } = {}) {
  const key = token || SERVICE_KEY || ANON_KEY;
  if (!key) throw new Error("Sem chave Supabase configurada");
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: ANON_KEY || key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (data && data.error_description) ||
      text.slice(0, 200) ||
      res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Nome amigável do admin (full_name → email → id curto). */
/** profiles-sem-coluna-email-v1 — email só em auth.users */
async function resolveAdminDisplayName(adminId) {
  const id = String(adminId || "").trim();
  if (!id) return null;
  let name = id.slice(0, 8);
  try {
    const profRows = await sb(
      `/rest/v1/profiles?select=full_name&id=eq.${encodeURIComponent(id)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const prof = Array.isArray(profRows) ? profRows[0] : null;
    if (prof) {
      name =
        (prof.full_name && String(prof.full_name).trim()) ||
        name;
    }
  } catch {
    /* keep short id */
  }
  return name;
}

function creatorMetaPatch(prevMeta, adminId, adminName) {
  const meta =
    prevMeta && typeof prevMeta === "object" ? { ...prevMeta } : {};
  meta.created_by = adminId;
  meta.created_by_name = adminName;
  return meta;
}

async function enrichDesafiosWithCreatorNames(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = {};
  for (const d of list) {
    const meta =
      d && d.metadata && typeof d.metadata === "object" ? d.metadata : {};
    const id = d?.created_by || meta.created_by || null;
    if (id) ids[String(id)] = true;
  }
  const idList = Object.keys(ids);
  const nameMap = {};
  if (idList.length) {
    try {
      // profiles-sem-coluna-email-v1
      const profs = await sb(
        `/rest/v1/profiles?select=id,full_name&id=in.(${idList
          .map(encodeURIComponent)
          .join(",")})`,
        { token: SERVICE_KEY }
      );
      for (const p of Array.isArray(profs) ? profs : []) {
        nameMap[String(p.id)] =
          (p.full_name && String(p.full_name).trim()) ||
          String(p.id).slice(0, 8);
      }
    } catch {
      /* nomes opcionais */
    }
  }
  for (const d of list) {
    const meta =
      d && d.metadata && typeof d.metadata === "object" ? d.metadata : {};
    const sid = d?.created_by || meta.created_by || null;
    d._createdById = sid || null;
    d._createdByName =
      (meta.created_by_name && String(meta.created_by_name).trim()) ||
      (sid && nameMap[String(sid)]) ||
      null;
  }
  return list;
}

async function listDesafios(token) {
  const rows = await sb(
    "/rest/v1/desafios?select=*,desafio_steps(*)&order=updated_at.desc",
    { token: token || SERVICE_KEY }
  );
  return enrichDesafiosWithCreatorNames(Array.isArray(rows) ? rows : []);
}

async function nextDesafioNumber(token) {
  const rows = await sb(
    "/rest/v1/desafios?select=number&order=number.desc&limit=1",
    { token: token || SERVICE_KEY }
  );
  const n =
    Array.isArray(rows) && rows[0]?.number != null ? Number(rows[0].number) : 0;
  return (Number.isFinite(n) ? n : 0) + 1;
}

function buildDesafioRow(body) {
  const isActive = Boolean(body.is_active);
  return {
    number: body.number != null ? Number(body.number) : undefined,
    title: body.title || "Desafio",
    subtitle: body.subtitle ?? null,
    total_steps: Number(body.total_steps) || (body.steps || []).length || 1,
    initial_balance_cents: Number(body.initial_balance_cents) || 20000,
    is_active: isActive,
    status: body.status || (isActive ? "active" : "draft"),
    target_profit_pct: Number(body.target_profit_pct) || 5,
    auto_link_matches: body.auto_link_matches !== false,
    published_at: isActive ? new Date().toISOString() : null,
  };
}

function buildStepRow(desafioId, stepIn, isActive) {
  return {
    desafio_id: desafioId,
    step_index: Number(stepIn.step_index) || 1,
    match_label: stepIn.match_label || null,
    league_name: stepIn.league_name ?? null,
    home_team: stepIn.home_team || null,
    away_team: stepIn.away_team || null,
    home_logo_url:
      stepIn.home_logo_url || stepIn.home_logo || null,
    away_logo_url:
      stepIn.away_logo_url || stepIn.away_logo || null,
    market_name: stepIn.market_name || stepIn.market_name_casa || null,
    market_name_casa: stepIn.market_name_casa || stepIn.market_name || null,
    market_name_arbishield: stepIn.market_name_arbishield || null,
    home_odd: stepIn.home_odd != null ? Number(stepIn.home_odd) : null,
    away_odd: stepIn.away_odd != null ? Number(stepIn.away_odd) : null,
    arbi_team_name: stepIn.arbi_team_name ?? null,
    arbi_team_logo_url:
      stepIn.arbi_team_logo_url ||
      (stepIn.arbi_team_name &&
      stepIn.home_team &&
      stepIn.arbi_team_name === stepIn.home_team
        ? stepIn.home_logo_url || stepIn.home_logo
        : null) ||
      (stepIn.arbi_team_name &&
      stepIn.away_team &&
      stepIn.arbi_team_name === stepIn.away_team
        ? stepIn.away_logo_url || stepIn.away_logo
        : null) ||
      null,
    arbi_odd: stepIn.arbi_odd != null ? Number(stepIn.arbi_odd) : null,
    casa_team_name: stepIn.casa_team_name ?? null,
    casa_team_logo_url:
      stepIn.casa_team_logo_url ||
      (stepIn.casa_team_name &&
      stepIn.home_team &&
      stepIn.casa_team_name === stepIn.home_team
        ? stepIn.home_logo_url || stepIn.home_logo
        : null) ||
      (stepIn.casa_team_name &&
      stepIn.away_team &&
      stepIn.casa_team_name === stepIn.away_team
        ? stepIn.away_logo_url || stepIn.away_logo
        : null) ||
      null,
    casa_odd: stepIn.casa_odd != null ? Number(stepIn.casa_odd) : null,
    casa_stake_cents:
      stepIn.casa_stake_cents != null ? Number(stepIn.casa_stake_cents) : null,
    arbi_commission_pct:
      stepIn.arbi_commission_pct != null
        ? Number(stepIn.arbi_commission_pct)
        : null,
    casa_commission_pct:
      stepIn.casa_commission_pct != null
        ? Number(stepIn.casa_commission_pct)
        : 4.5,
    liquidity_cents:
      stepIn.liquidity_cents != null ? Number(stepIn.liquidity_cents) : 200000,
    display_liquidity_cents:
      stepIn.display_liquidity_cents != null
        ? Number(stepIn.display_liquidity_cents)
        : stepIn.liquidity_cents != null
          ? Number(stepIn.liquidity_cents)
          : 200000,
    external_bet_link: stepIn.external_bet_link || null,
    starts_at: stepIn.starts_at || null,
    release_minutes_before:
      stepIn.release_minutes_before != null
        ? Number(stepIn.release_minutes_before)
        : 60,
    status: stepIn.status || "pending",
    is_published:
      stepIn.is_published != null ? Boolean(stepIn.is_published) : isActive,
    metadata: (() => {
      const prev =
        stepIn.metadata && typeof stepIn.metadata === "object"
          ? { ...stepIn.metadata }
          : {};
      const link = stepIn.external_bet_link || prev.external_bet_link || "";
      const fromLink = String(link).match(
        /[?&#](?:eventId|event_id|eventID|event)=([0-9]{6,})/i
      );
      const fromPath = String(link).match(
        /\/(?:event|evento|e)\/([0-9]{6,})(?:\/|$|\?|#)/i
      );
      const fromLong = String(link).match(/(?:^|[^\d])([0-9]{12,})(?:[^\d]|$)/);
      const eventId =
        prev.betbra_event_id ||
        prev.external_id ||
        prev.event_id ||
        (fromLink && fromLink[1]) ||
        (fromPath && fromPath[1]) ||
        (fromLong && fromLong[1]) ||
        null;
      if (eventId) {
        prev.betbra_event_id = String(eventId);
        prev.score_sync_enabled = true;
        prev.source = prev.source || "admin_manual_betbra";
      }
      if (link) prev.external_bet_link = link;
      return Object.keys(prev).length ? prev : undefined;
    })(),
  };
}

async function insertDesafioRow(auth, desafioRow) {
  // Tenta gravar created_by + metadata; schema antigo pode não ter as colunas.
  const attempts = [
    desafioRow,
    (() => {
      const { metadata: _m, ...rest } = desafioRow;
      return rest;
    })(),
    (() => {
      const { created_by: _c, metadata: _m, ...rest } = desafioRow;
      return rest;
    })(),
  ];
  let lastErr;
  for (const body of attempts) {
    try {
      const created = await sb("/rest/v1/desafios", {
        method: "POST",
        token: auth,
        body,
      });
      return Array.isArray(created) ? created[0] : created;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err || "").toLowerCase();
      if (
        msg.includes("created_by") ||
        msg.includes("metadata") ||
        msg.includes("column") ||
        msg.includes("schema cache")
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Falha ao criar desafio");
}

async function createDesafio(token, body) {
  const auth = token || SERVICE_KEY;
  const stepIn = body.step || (body.steps && body.steps[0]) || {};
  const desafioRow = buildDesafioRow(body);
  if (desafioRow.number == null) {
    desafioRow.number = await nextDesafioNumber(auth);
  }

  const payload = decodeJwtPayload(token);
  const adminId = payload?.sub ? String(payload.sub) : null;
  if (adminId) {
    const createdByName = await resolveAdminDisplayName(adminId);
    desafioRow.created_by = adminId;
    desafioRow.metadata = creatorMetaPatch(
      desafioRow.metadata,
      adminId,
      createdByName
    );
  }

  const desafio = await insertDesafioRow(auth, desafioRow);
  if (!desafio?.id) throw new Error("Falha ao criar desafio");

  const stepsOut = [];
  for (const step of body.steps || [stepIn]) {
    const stepRow = buildStepRow(desafio.id, step, desafioRow.is_active);
    let inserted;
    try {
      inserted = await sb("/rest/v1/desafio_steps", {
        method: "POST",
        token: auth,
        body: stepRow,
      });
    } catch (err) {
      // VPS antiga sem coluna metadata
      if (stepRow.metadata) {
        const { metadata: _m, ...slim } = stepRow;
        inserted = await sb("/rest/v1/desafio_steps", {
          method: "POST",
          token: auth,
          body: slim,
        });
      } else {
        throw err;
      }
    }
    stepsOut.push(Array.isArray(inserted) ? inserted[0] : inserted);
  }
  return { ...desafio, desafio_steps: stepsOut.filter(Boolean) };
}

async function upsertDesafio(token, body) {
  const auth = token || SERVICE_KEY;
  if (!body?.id) return createDesafio(auth, body);

  const desafioRow = buildDesafioRow(body);
  delete desafioRow.number;
  await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(body.id)}`, {
    method: "PATCH",
    token: auth,
    body: desafioRow,
  });

  const stepsOut = [];
  for (const step of body.steps || []) {
    const stepRow = buildStepRow(body.id, step, desafioRow.is_active);
    if (step.id) {
      const { desafio_id: _d, ...patch } = stepRow;
      const updated = await sb(
        `/rest/v1/desafio_steps?id=eq.${encodeURIComponent(step.id)}`,
        { method: "PATCH", token: auth, body: patch }
      );
      stepsOut.push(Array.isArray(updated) ? updated[0] : updated);
    } else {
      const inserted = await sb("/rest/v1/desafio_steps", {
        method: "POST",
        token: auth,
        body: stepRow,
      });
      stepsOut.push(Array.isArray(inserted) ? inserted[0] : inserted);
    }
  }

  const rows = await sb(
    `/rest/v1/desafios?select=*,desafio_steps(*)&id=eq.${encodeURIComponent(body.id)}&limit=1`,
    { token: auth }
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : { id: body.id, desafio_steps: stepsOut };
}

async function listPendingDesafioParticipations(desafioId) {
  const rows = await sb(
    `/rest/v1/desafio_participations?select=id,user_id,step_id,desafio_id,amount_cents,result,side&desafio_id=eq.${encodeURIComponent(desafioId)}&or=(result.eq.pending,result.is.null)&limit=2000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : []).filter((p) => {
    const r = String(p.result || "pending").toLowerCase();
    return r === "pending" || r === "" || r === "null";
  });
}

/**
 * Soft-delete desafio.
 * Marker: delete-desafio-guard-v3 — exige confirm:"EXCLUIR";
 * bloqueia etapas abertas/ao vivo sem force:true;
 * metadata.protect_from_casual_delete exige confirm:"FORCAR_EXCLUIR_PROTEGIDO".
 */
async function deleteDesafio(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const id = String(body?.id || body?.desafioId || body?.desafio_id || "").trim();
  if (!id) throw new Error("id obrigatório");

  const confirm = String(body?.confirm || body?.confirmText || "")
    .trim()
    .toUpperCase();
  const force =
    body?.force === true ||
    String(body?.force || "").toLowerCase() === "1" ||
    String(body?.force || "").toLowerCase() === "true";

  // Carrega metadata cedo — proteção anti-apagão acidental
  let curMeta = {};
  let curRow = null;
  try {
    const rows = await sb(
      `/rest/v1/desafios?select=id,is_active,status,deleted_at,title,metadata&id=eq.${encodeURIComponent(id)}&limit=1`,
      { token: SERVICE_KEY }
    );
    curRow = Array.isArray(rows) ? rows[0] : null;
    curMeta =
      curRow && curRow.metadata && typeof curRow.metadata === "object"
        ? curRow.metadata
        : {};
  } catch {
    /* */
  }

  // Marker: protect-desafio-casual-v1
  if (curMeta.protect_from_casual_delete === true) {
    if (confirm !== "FORCAR_EXCLUIR_PROTEGIDO" || !force) {
      const err = new Error(
        "Este desafio está protegido contra exclusão acidental. " +
          'Só com confirm:"FORCAR_EXCLUIR_PROTEGIDO" e force:true (ação deliberada).'
      );
      err.status = 409;
      throw err;
    }
  } else if (confirm !== "EXCLUIR") {
    const err = new Error(
      'Confirmação obrigatória: envie confirm:"EXCLUIR" para excluir um desafio.'
    );
    err.status = 400;
    throw err;
  }

  const pending = await listPendingDesafioParticipations(id);
  if (pending.length > 0) {
    const err = new Error(
      `Há ${pending.length} cliente(s) com entrada ativa. Use Cancelar para devolver o saldo à carteira Desafio.`
    );
    err.status = 409;
    throw err;
  }

  // Marker: hide-excluir-desafio-ativo-v1 — backend: não apagar ativo/publicado
  try {
    if (curRow && curRow.is_active === true && !force) {
      const err = new Error(
        "Desafio ativo/publicado não pode ser excluído. Desative/cancele antes, ou use force:true só se for intencional."
      );
      err.status = 409;
      throw err;
    }
  } catch (e) {
    if (e && e.status) throw e;
  }

  // Anti-regressão: não apagar desafio com etapa ainda jogável sem force
  try {
    const steps = await sb(
      `/rest/v1/desafio_steps?select=id,status,result,settled_at,deleted_at,starts_at,match_label&desafio_id=eq.${encodeURIComponent(id)}`,
      { token: SERVICE_KEY }
    );
    const open = (Array.isArray(steps) ? steps : []).filter((s) => {
      if (!s || s.deleted_at || s.settled_at) return false;
      const st = String(s.status || "").toLowerCase();
      if (["done", "settled", "closed", "cancelled", "canceled"].includes(st)) {
        return false;
      }
      const res = String(s.result || "").toLowerCase();
      if (
        ["win", "zebra_protected", "lost", "void", "empate_anula", "cancelled", "canceled"].includes(
          res
        )
      ) {
        return false;
      }
      return true;
    });
    if (open.length && !force) {
      const labels = open
        .slice(0, 3)
        .map((s) => s.match_label || s.id)
        .join(", ");
      const err = new Error(
        `Bloqueado: há ${open.length} etapa(s) aberta(s)/ao vivo (${labels}). ` +
          `Não exclua jogos em andamento. Use force:true + confirm:"EXCLUIR" só se for intencional.`
      );
      err.status = 409;
      throw err;
    }
  } catch (e) {
    if (e && e.status) throw e;
    /* se select falhar, segue com cuidado */
  }

  let adminId = null;
  try {
    adminId = requireUserId(token);
  } catch {
    /* */
  }

  const now = new Date().toISOString();
  const delBody = {
    deleted_at: now,
    is_active: false,
    status: "deleted",
    updated_at: now,
    metadata: {
      deleted_via: "delete-desafio-guard-v3",
      deleted_at: now,
      deleted_by: adminId,
      force: !!force,
    },
  };
  try {
    delBody.metadata = { ...curMeta, ...delBody.metadata };
  } catch {
    /* */
  }

  try {
    await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: delBody,
    });
  } catch {
    delete delBody.status;
    delete delBody.metadata;
    await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: delBody,
    });
  }
  return {
    ok: true,
    deleted: true,
    id,
    marker: "delete-desafio-guard-v3",
    force: !!force,
  };
}

/**
 * Restaura desafio soft-deleted (e etapas canceladas sem settle).
 * Marker: restore-desafio-v1
 */
async function restoreDesafio(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const id = String(body?.id || body?.desafioId || body?.desafio_id || "").trim();
  if (!id) throw new Error("id obrigatório");
  const publish =
    body?.publish === true ||
    body?.is_active === true ||
    String(body?.publish || "").toLowerCase() === "1";

  const desafioRows = await sb(
    `/rest/v1/desafios?select=id,title,status,is_active,deleted_at&id=eq.${encodeURIComponent(id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const desafio = Array.isArray(desafioRows) ? desafioRows[0] : null;
  if (!desafio?.id) {
    const err = new Error("Desafio não encontrado");
    err.status = 404;
    throw err;
  }

  const now = new Date().toISOString();
  const patch = {
    deleted_at: null,
    status: publish ? "active" : "draft",
    is_active: !!publish,
    updated_at: now,
  };
  if (publish) {
    patch.published_at = now;
  }

  try {
    await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: patch,
    });
  } catch {
    // alguns ambientes rejeitam null em deleted_at via JSON — retry sem status
    const soft = {
      is_active: !!publish,
      updated_at: now,
    };
    await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: soft,
    });
    // força deleted_at null via filtro dedicado se necessário
    try {
      await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: { deleted_at: null, status: publish ? "active" : "draft" },
      });
    } catch {
      /* */
    }
  }

  // reopen_settled / force: também limpa void+settled_at (senão o jogo some do app)
  const reopenSettled =
    body?.reopen_settled === true ||
    body?.force === true ||
    String(body?.reopen_settled || "").toLowerCase() === "1";
  const shiftMin = Math.max(0, Number(body?.shift_starts_minutes || body?.shiftMinutes || 0) || 0);
  const newStarts =
    shiftMin > 0 ? new Date(Date.now() + shiftMin * 60 * 1000).toISOString() : null;

  let stepsRestored = 0;
  try {
    const steps = await sb(
      `/rest/v1/desafio_steps?select=id,status,result,settled_at,deleted_at,starts_at&desafio_id=eq.${encodeURIComponent(id)}`,
      { token: SERVICE_KEY }
    );
    for (const s of Array.isArray(steps) ? steps : []) {
      const st = String(s.status || "").toLowerCase();
      const res = String(s.result || "").toLowerCase();
      const softNeeds =
        !!s.deleted_at ||
        st === "cancelled" ||
        st === "canceled" ||
        res === "cancelled" ||
        res === "canceled";
      const settledNeeds =
        reopenSettled &&
        (!!s.settled_at ||
          ["done", "settled", "closed", "void"].includes(st) ||
          ["void", "win", "lost", "bateu", "empate_anula"].includes(res));
      const needs = softNeeds || settledNeeds || (!!newStarts && !s.settled_at);
      if (!needs && st === "pending" && !s.deleted_at) {
        if (newStarts) {
          await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
            method: "PATCH",
            token: SERVICE_KEY,
            body: { starts_at: newStarts, updated_at: now },
          }).catch(() => null);
          stepsRestored += 1;
        }
        continue;
      }
      if (!needs) continue;
      const patchBody = {
        deleted_at: null,
        status: "pending",
        result: null,
        updated_at: now,
      };
      if (reopenSettled || settledNeeds) patchBody.settled_at = null;
      if (newStarts) patchBody.starts_at = newStarts;
      await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: patchBody,
      }).catch(() => null);
      stepsRestored += 1;
    }
  } catch {
    /* */
  }

  return {
    ok: true,
    restored: true,
    id,
    published: !!publish,
    stepsRestored,
    reopenSettled: !!reopenSettled,
    shiftedStartsMinutes: shiftMin || 0,
    marker: "restore-desafio-v2",
  };
}

/** Cancela o desafio inteiro e devolve entradas pendentes à carteira Desafio. */
async function cancelDesafio(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const id = String(body?.id || body?.desafioId || body?.desafio_id || "").trim();
  if (!id) throw new Error("id obrigatório");

  const desafioRows = await sb(
    `/rest/v1/desafios?select=id,title,status,is_active,deleted_at,metadata&id=eq.${encodeURIComponent(id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const desafio = Array.isArray(desafioRows) ? desafioRows[0] : null;
  if (!desafio?.id) {
    const err = new Error("Desafio não encontrado");
    err.status = 404;
    throw err;
  }
  if (desafio.deleted_at) {
    throw new Error("Desafio já excluído");
  }
  if (String(desafio.status) === "cancelled") {
    throw new Error("Desafio já cancelado");
  }

  // Marker: protect-desafio-casual-v1 — Cancelar também tira o jogo do ar
  const meta =
    desafio.metadata && typeof desafio.metadata === "object" ? desafio.metadata : {};
  const unlockCancel =
    body?.force === true ||
    String(body?.confirm || "").trim().toUpperCase() === "FORCAR_CANCELAR_PROTEGIDO";
  if (meta.protect_from_casual_delete === true && !unlockCancel) {
    const err = new Error(
      "Este desafio está protegido. Cancelar remove o jogo dos clientes. " +
        'Envie confirm:"FORCAR_CANCELAR_PROTEGIDO" (ou force:true) só se for intencional.'
    );
    err.status = 409;
    throw err;
  }

  const pending = await listPendingDesafioParticipations(id);
  let refundedCents = 0;
  let refundedCount = 0;
  const stepDelta = new Map();

  for (const p of pending) {
    const amount = Math.max(0, n(p.amount_cents));
    const userId = String(p.user_id || "").trim();
    if (!userId || !(amount > 0)) {
      await sb(
        `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`,
        {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            result: "cancelled",
            profit_cents: 0,
            updated_at: new Date().toISOString(),
          },
        }
      ).catch(() => null);
      continue;
    }

    const prof = await sb(
      `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const profile = Array.isArray(prof) ? prof[0] : null;
    const bal = n(profile?.desafio_balance_cents);

    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        desafio_balance_cents: bal + amount,
        updated_at: new Date().toISOString(),
      },
    });

    await sb(
      `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          result: "cancelled",
          profit_cents: 0,
          updated_at: new Date().toISOString(),
        },
      }
    );

    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: userId,
          type: "desafio_cancel_refund",
          amount_cents: amount,
          metadata: {
            desafio_id: id,
            participation_id: p.id,
            step_id: p.step_id || null,
            reason: "admin_cancel_desafio",
          },
        },
      });
    } catch {
      /* extrato opcional */
    }

    if (p.step_id) {
      stepDelta.set(p.step_id, (stepDelta.get(p.step_id) || 0) + amount);
    }
    refundedCents += amount;
    refundedCount += 1;
  }

  for (const [stepId, delta] of stepDelta.entries()) {
    try {
      const stepRows = await sb(
        `/rest/v1/desafio_steps?select=id,used_liquidity_cents&id=eq.${encodeURIComponent(stepId)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const step = Array.isArray(stepRows) ? stepRows[0] : null;
      if (!step) continue;
      await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(stepId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          used_liquidity_cents: Math.max(0, n(step.used_liquidity_cents) - delta),
          updated_at: new Date().toISOString(),
        },
      });
    } catch {
      /* */
    }
  }

  // Marca etapas abertas como cancelled
  try {
    const steps = await sb(
      `/rest/v1/desafio_steps?select=id,status,settled_at,deleted_at&desafio_id=eq.${encodeURIComponent(id)}`,
      { token: SERVICE_KEY }
    );
    for (const s of Array.isArray(steps) ? steps : []) {
      if (s.deleted_at || s.settled_at) continue;
      const st = String(s.status || "").toLowerCase();
      if (st === "done" || st === "settled" || st === "closed" || st === "cancelled") {
        continue;
      }
      await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          status: "cancelled",
          result: "cancelled",
          updated_at: new Date().toISOString(),
        },
      }).catch(() => null);
    }
  } catch {
    /* */
  }

  const cancelBody = {
    status: "cancelled",
    is_active: false,
    updated_at: new Date().toISOString(),
  };
  try {
    await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: cancelBody,
    });
  } catch {
    delete cancelBody.status;
    await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: cancelBody,
    });
  }

  return {
    ok: true,
    cancelled: true,
    id,
    refundedCount,
    refundedCents,
  };
}

async function listDesafioPendingCounts(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const ids = Array.isArray(body?.desafioIds || body?.ids)
    ? (body.desafioIds || body.ids).map((x) => String(x).trim()).filter(Boolean)
    : [];
  const counts = {};
  if (!ids.length) return { counts };
  for (const id of ids) counts[id] = 0;

  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const rows = await sb(
      `/rest/v1/desafio_participations?select=desafio_id,result&desafio_id=in.(${chunk.join(",")})&or=(result.eq.pending,result.is.null)&limit=5000`,
      { token: SERVICE_KEY }
    ).catch(() => []);
    for (const p of Array.isArray(rows) ? rows : []) {
      const did = String(p.desafio_id || "");
      if (!did || !(did in counts)) continue;
      const r = String(p.result || "pending").toLowerCase();
      if (r === "pending" || r === "" || r === "null") counts[did] += 1;
    }
  }
  return { counts };
}

function extractServerFnData(rawBody) {
  if (!rawBody) return {};
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  if (parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
    const d = parsed.data;
    if (
      !("t" in d) ||
      d.page != null ||
      d.from != null ||
      d.id != null ||
      d.title != null ||
      d.steps != null ||
      d.stepId != null ||
      d.winningSide != null ||
      d.percentage != null ||
      d.side != null ||
      d.amountCents != null ||
      d.protectionId != null ||
      d.reason != null ||
      d.newOdd != null ||
      d.proofUrl != null ||
      d.approvedOdd != null ||
      d.contestType != null ||
      d.betProofUrl != null ||
      d.note != null
    ) {
      return d;
    }
  }
  // fallback: procurar campos conhecidos na raiz
  const out = {};
  for (const k of [
    "category",
    "search",
    "from",
    "to",
    "page",
    "pageSize",
    "id",
    "number",
    "title",
    "subtitle",
    "total_steps",
    "initial_balance_cents",
    "is_active",
    "steps",
    "stepId",
    "step_id",
    "winningSide",
    "winning_side",
    "side",
    "amountCents",
    "amount_cents",
    "percentage",
    "description",
    "homeScore",
    "awayScore",
    "protectionId",
    "marketType",
    "market_category",
    "reason",
    "newOdd",
    "proofUrl",
    "approvedOdd",
    "contestType",
    "betProofUrl",
    "note",
  ]) {
    if (parsed[k] !== undefined) out[k] = parsed[k];
  }
  return out;
}

function dashPlatformCut(row) {
  const plat =
    n(row.platform_profit_cents) ||
    n(row.platform_deduction_cents) ||
    n(row.locked_deduction_cents);
  return plat + n(row.exchange_profit_net_cents) + n(row.exchange_fee_cents);
}

/** Dedução fee_upfront cobrada no ato da proteção. */
function dashFeeUpfrontCents(row) {
  const fee = settlementDeductionCents(row);
  if (fee > 0) return fee;
  return Math.max(
    0,
    n(row.platform_deduction_cents) || n(row.platform_profit_cents)
  );
}

function dashIsFeeReturnedStatus(row) {
  const st = String(row?.status || "").toLowerCase();
  const outcome = String(row?.settled_outcome || "").toLowerCase();
  if (st.includes("cancelled") || st === "canceled") return true;
  if (st.includes("won_platform")) return true;
  if (outcome === "arbishield") return true;
  return false;
}

async function sbPageAll(basePath, hardCap = 20000) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    const sep = basePath.includes("?") ? "&" : "?";
    const rows = await sb(
      `${basePath}${sep}limit=${pageSize}&offset=${from}`,
      { token: SERVICE_KEY }
    );
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < pageSize) break;
    from += pageSize;
    if (from >= hardCap) break;
  }
  return out;
}

async function sumDesafioCasaWinProfit(fromIso) {
  // Lucro desafio = stake zebra perdido quando etapa result=win (casa venceu)
  let q =
    "/rest/v1/desafio_steps?select=id,result,settled_at&result=eq.win&order=settled_at.asc";
  if (fromIso) {
    q += `&settled_at=gte.${encodeURIComponent(fromIso)}`;
  }
  let steps = [];
  try {
    steps = await sbPageAll(q);
  } catch {
    return { net: 0, steps: 0, zebra: 0, casaPaid: 0 };
  }
  let zebra = 0;
  let casaPaid = 0;
  for (let i = 0; i < steps.length; i += 50) {
    const chunk = steps.slice(i, i + 50);
    const ids = chunk.map((s) => s.id).join(",");
    if (!ids) continue;
    let parts = [];
    try {
      parts = await sbPageAll(
        `/rest/v1/desafio_participations?select=step_id,side,result,amount_cents,profit_cents&step_id=in.(${ids})`
      );
    } catch {
      parts = [];
    }
    for (const p of parts) {
      const side = String(p.side || "").toLowerCase();
      const res = String(p.result || "").toLowerCase();
      if (
        side === "arbishield" &&
        res !== "won" &&
        res !== "win" &&
        res !== "pending"
      ) {
        zebra += n(p.amount_cents);
      }
      if (side === "casa" && (res === "won" || res === "win")) {
        casaPaid += n(p.profit_cents);
      }
    }
  }
  return {
    net: zebra - casaPaid,
    steps: steps.length,
    zebra,
    casaPaid,
  };
}

/**
 * Receita de proteções:
 * - fee_upfront: dedução conta no DIA DA COBRANÇA (created_at), não no settle
 * - se depois for cancelada ou ArbiShield (won_platform), a dedução é estornada
 * - legado (lock): continua no settle (exceto won_platform)
 */
async function sumProtectionCuts(fromIso) {
  const cols =
    "id,status,created_at,settled_at,settled_outcome,platform_profit_cents,platform_deduction_cents,locked_deduction_cents,exchange_profit_net_cents,exchange_fee_cents,metadata,responsibility_cents,amount_cents,odd";

  async function loadBy(table, field) {
    let q = `/rest/v1/${table}?select=${cols}&order=${field}.asc`;
    if (fromIso) q += `&${field}=gte.${encodeURIComponent(fromIso)}`;
    try {
      return await sbPageAll(q);
    } catch {
      return [];
    }
  }

  const [
    laysCreated,
    backsCreated,
    laysSettled,
    backsSettled,
  ] = await Promise.all([
    loadBy("protections", "created_at"),
    loadBy("back_protections", "created_at"),
    (async () => {
      let q = `/rest/v1/protections?select=${cols}&settled_at=not.is.null&order=settled_at.asc`;
      if (fromIso) q += `&settled_at=gte.${encodeURIComponent(fromIso)}`;
      try {
        return await sbPageAll(q);
      } catch {
        return [];
      }
    })(),
    (async () => {
      let q = `/rest/v1/back_protections?select=${cols}&settled_at=not.is.null&order=settled_at.asc`;
      if (fromIso) q += `&settled_at=gte.${encodeURIComponent(fromIso)}`;
      try {
        return await sbPageAll(q);
      } catch {
        return [];
      }
    })(),
  ]);

  let charged = 0;
  let reversed = 0;
  let legacy = 0;
  let nCharged = 0;
  let nReversed = 0;
  let nLegacy = 0;

  for (const r of [...laysCreated, ...backsCreated]) {
    if (!isFeeUpfrontProtection(r)) continue;
    const fee = dashFeeUpfrontCents(r);
    if (!(fee > 0)) continue;
    charged += fee;
    nCharged += 1;
  }

  for (const r of [...laysSettled, ...backsSettled]) {
    if (isFeeUpfrontProtection(r)) {
      // Estorno: cancelamento ou ArbiShield devolve a dedução cobrada na ativação
      if (dashIsFeeReturnedStatus(r)) {
        const fee = dashFeeUpfrontCents(r);
        if (fee > 0) {
          reversed += fee;
          nReversed += 1;
        }
      }
      // Exchange: taxa já entrou em charged no created_at — não somar de novo
      continue;
    }
    const st = String(r.status || "").toLowerCase();
    if (st.includes("won_platform") || st.includes("cancelled")) continue;
    const c = dashPlatformCut(r);
    if (c > 0) {
      legacy += c;
      nLegacy += 1;
    }
  }

  return {
    cut: Math.max(0, charged - reversed) + legacy,
    charged,
    reversed,
    legacy,
    nRows: nCharged + nLegacy,
    nCharged,
    nReversed,
    nLegacy,
    model: "fee_upfront_on_charge_v2",
  };
}

async function getDashboardStats() {
  const dayStart = startOfDaySaoPaulo();
  const dayIso = dayStart.toISOString();
  const dayYmd = dayIso.slice(0, 10);

  const [
    profiles,
    treasury,
    activeProtections,
    refunds,
    expensesAll,
    depositsTodayWallet,
    depositsTodayManual,
    depositsTodayAsaas,
    refundsTodayWallet,
    expensesToday,
  ] = await Promise.all([
    sb(
      "/rest/v1/profiles?select=id,balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents",
      { token: SERVICE_KEY }
    ),
    sb(
      "/rest/v1/platform_treasury?select=id,operational_balance_cents,balance_cents,reserve_balance_cents,locked_balance_cents,updated_at&order=updated_at.desc&limit=1",
      { token: SERVICE_KEY }
    ),
    sb(
      "/rest/v1/protections?select=amount_cents,platform_profit_cents,exchange_profit_net_cents,exchange_fee_cents&status=eq.active",
      { token: SERVICE_KEY }
    ),
    sb("/rest/v1/refund_requests?select=amount_cents,status", {
      token: SERVICE_KEY,
    }),
    sb("/rest/v1/admin_expenses?select=amount_cents", { token: SERVICE_KEY }),
    sb(
      `/rest/v1/wallet_transactions?select=amount_cents,type&type=in.(deposit,manual_credit,asaas_deposit,desafio_deposit,provider_deposit)&created_at=gte.${encodeURIComponent(dayIso)}`,
      { token: SERVICE_KEY }
    ),
    sb(
      `/rest/v1/manual_deposits?select=amount_cents&status=eq.APPROVED&created_at=gte.${encodeURIComponent(dayIso)}`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/asaas_payments?select=amount_cents,confirmed_amount_cents,status&created_at=gte.${encodeURIComponent(dayIso)}`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/wallet_transactions?select=amount_cents,type&type=in.(protection_refund,refund,desafio_cancel_refund)&created_at=gte.${encodeURIComponent(dayIso)}`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/admin_expenses?select=amount_cents&expense_date=eq.${dayYmd}`,
      { token: SERVICE_KEY }
    ).catch(() =>
      sb(
        `/rest/v1/admin_expenses?select=amount_cents&created_at=gte.${encodeURIComponent(dayIso)}`,
        { token: SERVICE_KEY }
      ).catch(() => [])
    ),
  ]);

  const [
    protToday,
    protAll,
    desafioToday,
    desafioAll,
  ] = await Promise.all([
    sumProtectionCuts(dayIso),
    sumProtectionCuts(null),
    sumDesafioCasaWinProfit(dayIso),
    sumDesafioCasaWinProfit(null),
  ]);

  const profileRows = Array.isArray(profiles) ? profiles : [];
  const totalUserBalance = profileRows.reduce((a, r) => a + n(r.balance_cents), 0);
  const totalUsers = profileRows.length;
  const totalInvestorBalance = profileRows.reduce(
    (a, r) =>
      a + n(r.investor_balance_cents) + n(r.demo_balance_provider_cents),
    0
  );
  const lockedFromProfiles = profileRows.reduce(
    (a, r) => a + n(r.locked_balance_cents),
    0
  );
  const activeRows = Array.isArray(activeProtections) ? activeProtections : [];
  const totalBlocked =
    activeRows.reduce((a, r) => a + n(r.amount_cents), 0) || lockedFromProfiles;

  const refundRows = Array.isArray(refunds) ? refunds : [];
  const paidStatuses = new Set([
    "CONCLUÍDO",
    "concluido",
    "CONCLUIDO",
    "paid",
    "PAID",
    "completed",
    "COMPLETED",
    "PIX ENVIADO",
    "approved",
    "APPROVED",
  ]);
  const pendingStatuses = new Set([
    "EM ANÁLISE",
    "pending",
    "PENDING",
    "open",
    "OPEN",
    "processing",
    "PROCESSING",
  ]);
  const totalRefunded = refundRows
    .filter((r) => paidStatuses.has(String(r.status || "")))
    .reduce((a, r) => a + n(r.amount_cents), 0);
  const pendingRefunds = refundRows.filter((r) =>
    pendingStatuses.has(String(r.status || ""))
  ).length;

  const expenseTotal = (Array.isArray(expensesAll) ? expensesAll : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );

  const profitProtectionsAll = protAll.cut;
  const profitDesafioAll = desafioAll.net;
  const realNetProfit =
    profitProtectionsAll + profitDesafioAll - expenseTotal;

  const treasuryRow = Array.isArray(treasury) ? treasury[0] : null;
  // Caixa = tesouraria real (não fallback em banca de usuários)
  const cashBalance =
    treasuryRow == null
      ? 0
      : treasuryRow.operational_balance_cents != null
        ? n(treasuryRow.operational_balance_cents)
        : n(treasuryRow.balance_cents);

  const asaasRows = Array.isArray(depositsTodayAsaas) ? depositsTodayAsaas : [];
  const asaasOk = new Set([
    "CONFIRMED",
    "RECEIVED",
    "confirmed",
    "received",
    "PAID",
    "paid",
  ]);
  const todayAsaas = asaasRows
    .filter((r) => asaasOk.has(String(r.status || "")))
    .reduce((a, r) => a + n(r.confirmed_amount_cents || r.amount_cents), 0);
  const todayWallet = (
    Array.isArray(depositsTodayWallet) ? depositsTodayWallet : []
  ).reduce((a, r) => a + n(r.amount_cents), 0);
  const todayManual = (
    Array.isArray(depositsTodayManual) ? depositsTodayManual : []
  ).reduce((a, r) => a + n(r.amount_cents), 0);
  // Depósitos do dia (não é lucro)
  const todayDeposits = Math.max(todayWallet, todayManual + todayAsaas);

  const todayRefundsOut = (
    Array.isArray(refundsTodayWallet) ? refundsTodayWallet : []
  ).reduce((a, r) => a + n(r.amount_cents), 0);
  const todayExpenses = (
    Array.isArray(expensesToday) ? expensesToday : []
  ).reduce((a, r) => a + n(r.amount_cents), 0);

  const todayProtectionProfit = protToday.cut;
  const todayDesafioProfit = desafioToday.net;
  // Receita/lucro operacional do dia — NÃO inclui depósitos
  // Proteções fee_upfront: dedução no ato da proteção (created_at)
  const todayNetRevenue = todayProtectionProfit + todayDesafioProfit;
  const todayRealProfit = todayNetRevenue - todayExpenses;

  // Compat: todayEarnings era usado como "depósitos" no código antigo
  const todayEarnings = todayDeposits;

  const marginBase = totalUserBalance + totalBlocked;
  const profitMargin =
    marginBase > 0 ? (realNetProfit / marginBase) * 100 : 0;

  return {
    totalUserBalance,
    totalUsers,
    totalInvestorBalance,
    realNetProfit,
    profitProtectionsAll,
    profitDesafioAll,
    profitMargin: Number(profitMargin.toFixed(1)),
    totalBlocked,
    totalRefunded,
    pendingRefunds,
    cashBalance,
    treasuryUpdatedAt: treasuryRow?.updated_at || null,
    todayEarnings,
    todayDeposits,
    todayProtectionProfit,
    todayDesafioProfit,
    todayNetRevenue,
    todayRefundsOut,
    todayExpenses,
    todayRealProfit,
    todayProtectionCount: protToday.nRows,
    todayProtectionCharged: protToday.charged || 0,
    todayProtectionReversed: protToday.reversed || 0,
    todayDesafioSteps: desafioToday.steps,
    fix: "dashboard-kpis-v2",
  };
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const json = Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function listAuthUsersAdmin() {
  const key = SERVICE_KEY;
  if (!key) throw new Error("SERVICE_ROLE_KEY necessária para listar auth.users");
  const users = [];
  let page = 1;
  const perPage = 200;
  const maxPages = Number(process.env.ADMIN_AUTH_USERS_MAX_PAGES || 5);
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        (data && data.message) || text.slice(0, 200) || res.statusText;
      throw new Error(msg);
    }
    const batch = Array.isArray(data?.users)
      ? data.users
      : Array.isArray(data)
        ? data
        : [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > maxPages) break;
  }
  return users;
}

async function listAdminUsers() {
  // Limite defensivo: lista completa + auth admin paginado congelava o SPA.
  const MAX_PROFILES = Number(process.env.ADMIN_USERS_MAX || 800);
  const [profiles, roles, authUsers] = await Promise.all([
    sb(
      `/rest/v1/profiles?select=id,full_name,cpf,phone,pix_key,location,account_status,balance_cents,demo_balance_cents,demo_balance_provider_cents,investor_balance_cents,reusable_balance_cents,debited_balance_cents,locked_balance_cents,total_profit_cents,is_super_admin,is_affiliate,onboarding_completed,created_at,updated_at&order=created_at.desc&limit=${MAX_PROFILES}`
    ),
    sb("/rest/v1/user_roles?select=user_id,role"),
    listAuthUsersAdmin(),
  ]);

  const profileRows = Array.isArray(profiles) ? profiles : [];
  const roleRows = Array.isArray(roles) ? roles : [];
  const rolesByUser = new Map();
  for (const r of roleRows) {
    if (!r?.user_id) continue;
    const list = rolesByUser.get(r.user_id) || [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }

  const authById = new Map();
  for (const u of authUsers) {
    if (u?.id) authById.set(u.id, u);
  }

  return profileRows.map((p) => {
    const auth = authById.get(p.id) || {};
    const userRoles = rolesByUser.get(p.id) || [];
    const providerCents = n(p.demo_balance_provider_cents);
    return {
      ...p,
      email: auth.email || null,
      phone: p.phone || auth.phone || null,
      last_sign_in_at: auth.last_sign_in_at || null,
      // auth.created_at pode diferir do profile; UI usa profile.created_at
      roles: userRoles.length ? userRoles : ["user"],
      is_provider: providerCents > 0,
      balance_cents: n(p.balance_cents),
      demo_balance_cents: n(p.demo_balance_cents),
      demo_balance_provider_cents: providerCents,
      investor_balance_cents: n(p.investor_balance_cents),
      reusable_balance_cents: n(p.reusable_balance_cents),
      debited_balance_cents: n(p.debited_balance_cents),
      locked_balance_cents: n(p.locked_balance_cents),
      total_profit_cents: n(p.total_profit_cents),
      is_super_admin: !!p.is_super_admin,
      is_affiliate: !!p.is_affiliate,
      onboarding_completed: !!p.onboarding_completed,
    };
  });
}

async function currentUserIsSuperAdmin(token) {
  const payload = decodeJwtPayload(token);
  const uid = payload?.sub;
  if (!uid) return false;
  const rows = await sb(
    `/rest/v1/profiles?select=is_super_admin&id=eq.${uid}&limit=1`,
    { token: SERVICE_KEY }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return !!row?.is_super_admin;
}

async function currentUserIsAdmin(token) {
  if (await currentUserIsSuperAdmin(token)) return true;
  const payload = decodeJwtPayload(token);
  const uid = payload?.sub;
  if (!uid) return false;
  const roles = await sb(
    `/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(uid)}`,
    { token: SERVICE_KEY }
  );
  return (Array.isArray(roles) ? roles : []).some(
    (r) => r.role === "admin" || r.role === "master_admin"
  );
}

/** Só estes e-mails acessam APIs da área Financeiro. */
const FINANCE_ADMIN_EMAILS = new Set([
  "isaacgomes3@gmail.com",
  "financeiro@arbishield.com",
]);

function tokenEmail(token) {
  const payload = decodeJwtPayload(token);
  return String(
    payload?.email ||
      payload?.user_metadata?.email ||
      payload?.app_metadata?.email ||
      ""
  )
    .trim()
    .toLowerCase();
}

function canAccessFinance(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return !!e && FINANCE_ADMIN_EMAILS.has(e);
}

async function currentUserCanFinance(token) {
  if (!(await currentUserIsAdmin(token))) return false;
  return canAccessFinance(tokenEmail(token));
}

async function requireFinanceAdmin(token) {
  if (!(await currentUserCanFinance(token))) {
    const err = new Error("Sem permissão para a área Financeiro");
    err.status = 403;
    throw err;
  }
}

function normalizeBannerRow(body = {}) {
  const variant = String(body.variant || "custom").toLowerCase();
  const allowed = new Set(["custom", "affiliate", "match", "desafio"]);
  return {
    title: String(body.title || "").trim() || "Banner",
    subtitle: body.subtitle != null ? String(body.subtitle) : null,
    description: body.description != null ? String(body.description) : null,
    cta_label: body.cta_label != null ? String(body.cta_label) : null,
    cta_url: body.cta_url != null ? String(body.cta_url) : null,
    image_url: String(body.image_url || "").trim(),
    badge: body.badge != null ? String(body.badge) : null,
    variant: allowed.has(variant) ? variant : "custom",
    active: body.active !== false && body.active !== "false",
    sort_order:
      body.sort_order != null && Number.isFinite(Number(body.sort_order))
        ? Number(body.sort_order)
        : 0,
    updated_at: new Date().toISOString(),
  };
}

async function listBannersPublic() {
  const rows = await sb(
    "/rest/v1/banners?select=*&active=eq.true&order=sort_order.asc,created_at.desc",
    { token: SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows : [];
}

async function listBannersAdmin(token) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const rows = await sb(
    "/rest/v1/banners?select=*&order=sort_order.asc,created_at.desc",
    { token: SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows : [];
}

async function upsertBanner(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const row = normalizeBannerRow(body);
  if (!row.image_url) throw new Error("Imagem do banner obrigatória");

  if (body.id) {
    const updated = await sb(
      `/rest/v1/banners?id=eq.${encodeURIComponent(String(body.id))}`,
      { method: "PATCH", token: SERVICE_KEY, body: row }
    );
    return Array.isArray(updated) ? updated[0] : updated;
  }

  const created = await sb("/rest/v1/banners", {
    method: "POST",
    token: SERVICE_KEY,
    body: { ...row, created_at: new Date().toISOString() },
  });
  return Array.isArray(created) ? created[0] : created;
}

async function deleteBanner(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const id = body?.id;
  if (!id) throw new Error("id obrigatório");
  await sb(`/rest/v1/banners?id=eq.${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    token: SERVICE_KEY,
  });
  return { ok: true };
}

async function reorderBanners(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const ids = Array.isArray(body?.ids)
    ? body.ids
    : Array.isArray(body?.order)
      ? body.order
      : [];
  if (!ids.length) return { ok: true };
  await Promise.all(
    ids.map((id, index) =>
      sb(`/rest/v1/banners?id=eq.${encodeURIComponent(String(id))}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: { sort_order: index, updated_at: new Date().toISOString() },
      })
    )
  );
  return { ok: true };
}

function requireUserId(token) {
  const payload = decodeJwtPayload(token);
  const uid = payload?.sub;
  if (!uid) throw new Error("Não autorizado");
  return uid;
}

async function getUserProfileBundle(userId) {
  const dayIso = startOfDaySaoPaulo().toISOString();
  const [profiles, aff, protectedToday] = await Promise.all([
    sb(
      `/rest/v1/profiles?select=*&id=eq.${userId}&limit=1`,
      { token: SERVICE_KEY }
    ),
    sb(
      `/rest/v1/affiliate_stats?select=*&profile_id=eq.${userId}&limit=1`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/protections?select=amount_cents&user_id=eq.${userId}&created_at=gte.${dayIso}`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);
  const profile = Array.isArray(profiles) ? profiles[0] || null : null;
  const affiliateStats = Array.isArray(aff) ? aff[0] || null : null;
  const protectedTodayCents = (Array.isArray(protectedToday) ? protectedToday : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  return { profile, protectedTodayCents, affiliateStats };
}

async function getUserDashboardMetrics(userId) {
  const dayIso = startOfDaySaoPaulo().toISOString();
  const [active, settledToday] = await Promise.all([
    sb(
      `/rest/v1/protections?select=amount_cents&user_id=eq.${userId}&status=eq.active`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/protections?select=user_profit_cents,settled_at,status&user_id=eq.${userId}&settled_at=gte.${dayIso}`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);
  const activeProtectionCents = (Array.isArray(active) ? active : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  const todayEarningsCents = (Array.isArray(settledToday) ? settledToday : []).reduce(
    (a, r) => a + n(r.user_profit_cents),
    0
  );
  return { todayEarningsCents, activeProtectionCents };
}

function randomReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function ensureAffiliateReferralCode(token) {
  const userId = requireUserId(token);
  const rows = await sb(
    `/rest/v1/profiles?select=id,referral_code,is_affiliate&id=eq.${userId}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new Error("Perfil não encontrado");
  if (p.referral_code) {
    if (!p.is_affiliate) {
      try {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: { is_affiliate: true, updated_at: new Date().toISOString() },
        });
      } catch {
        /* */
      }
    }
    return {
      ok: true,
      referral_code: p.referral_code,
      code: p.referral_code,
      is_affiliate: true,
    };
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomReferralCode();
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          referral_code: code,
          is_affiliate: true,
          updated_at: new Date().toISOString(),
        },
      });
      try {
        await sb("/rest/v1/affiliate_stats", {
          method: "POST",
          token: SERVICE_KEY,
          body: {
            profile_id: userId,
            pending_cents: 0,
            total_earned_cents: 0,
          },
        });
      } catch {
        /* stats pode já existir ou schema divergir */
      }
      return { ok: true, referral_code: code, code, is_affiliate: true };
    } catch {
      /* retry on unique collision */
    }
  }
  throw new Error("Não foi possível gerar o código de indicação");
}

/**
 * Vincula referred_by a partir do código de afiliado (legado: /auth?ref=CODE).
 * Só aplica se o usuário ainda não tiver referred_by.
 */
async function applyReferralCode(token, body) {
  const userId = requireUserId(token);
  const code = String(body?.code || body?.ref || body?.referral_code || "")
    .trim()
    .toUpperCase();
  if (!code || code.length < 4) throw new Error("Código de indicação inválido");

  const meRows = await sb(
    `/rest/v1/profiles?select=id,referred_by,referral_code&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const me = Array.isArray(meRows) ? meRows[0] : null;
  if (!me) throw new Error("Perfil não encontrado");
  if (me.referred_by) {
    return {
      ok: true,
      already: true,
      referred_by: me.referred_by,
      message: "Indicação já vinculada",
    };
  }
  if (
    me.referral_code &&
    String(me.referral_code).toUpperCase() === code
  ) {
    throw new Error("Você não pode usar o próprio código");
  }

  const affRows = await sb(
    `/rest/v1/profiles?select=id,referral_code,is_affiliate&referral_code=eq.${encodeURIComponent(code)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const aff = Array.isArray(affRows) ? affRows[0] : null;
  if (!aff || !aff.id) throw new Error("Código de afiliado não encontrado");
  if (String(aff.id) === String(userId)) {
    throw new Error("Você não pode usar o próprio código");
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      referred_by: aff.id,
      updated_at: new Date().toISOString(),
    },
  });

  return {
    ok: true,
    referred_by: aff.id,
    referral_code: code,
    fix: "afiliados-ref-cadastro-v1",
  };
}

async function requestAffiliateWithdrawal(token, body) {
  // Saldo Reembolso reutiliza esta rota (já liberada no nginx) quando
  // wallet/kind indica reembolso — evita 404/not_found da rota nova.
  const wallet = String(body?.wallet || body?.kind || body?.origin || "").toLowerCase();
  if (
    wallet === "reembolso" ||
    wallet === "saldo_reembolso" ||
    wallet === "deduction" ||
    body?.saldo_reembolso === true
  ) {
    return requestDeductionWithdrawal(token, body);
  }

  const userId = requireUserId(token);
  const amountCents = Math.round(
    Number(body?.amountCents ?? body?.amount_cents ?? 0)
  );
  const pixKey = String(body?.pix_key ?? body?.pixKey ?? "").trim();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Valor inválido");
  }
  if (!pixKey) throw new Error("Informe a chave Pix");

  const day = new Date().getDate();
  if (day !== 15 && day !== 30) {
    throw new Error("Saques de afiliado só nos dias 15 e 30");
  }

  const open = await sb(
    `/rest/v1/withdrawals?select=id,status,metadata&user_id=eq.${userId}&status=in.(pending,approved,processing)&order=created_at.desc&limit=20`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const hasOpen = (Array.isArray(open) ? open : []).some((w) => {
    const meta = w?.metadata || {};
    const origin = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
    return (
      origin === "AFFILIATE_WITHDRAWAL" ||
      origin === "AFFILIATE_COMMISSION_WITHDRAWAL" ||
      origin === "AFFILIATE_PAYOUT_REQUEST"
    );
  });
  if (hasOpen) {
    throw new Error("Você já possui uma solicitação de saque em análise.");
  }

  const commissions = await sb(
    `/rest/v1/affiliate_commissions?select=amount_cents,status&affiliate_id=eq.${userId}`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const okStatus = new Set(["approved", "available", "pending_payout", "paid"]);
  const earned = (Array.isArray(commissions) ? commissions : [])
    .filter((c) => okStatus.has(String(c.status || "").toLowerCase()))
    .reduce((a, c) => a + n(c.amount_cents), 0);

  const wds = await sb(
    `/rest/v1/withdrawals?select=amount_cents,status,metadata&user_id=eq.${userId}`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const openStatuses = new Set(["pending", "approved", "paid", "processing"]);
  const alreadyOut = (Array.isArray(wds) ? wds : [])
    .filter((w) => {
      const meta = w?.metadata || {};
      const origin = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
      const isAff =
        origin === "AFFILIATE_WITHDRAWAL" ||
        origin === "AFFILIATE_COMMISSION_WITHDRAWAL" ||
        origin === "AFFILIATE_PAYOUT_REQUEST";
      return isAff && openStatuses.has(String(w.status || "").toLowerCase());
    })
    .reduce((a, w) => a + n(w.amount_cents), 0);

  const available = Math.max(0, earned - alreadyOut);
  if (amountCents > available) {
    throw new Error(
      `Saldo insuficiente (disponível ${(available / 100).toFixed(2)})`
    );
  }

  const created = await sb("/rest/v1/withdrawals", {
    method: "POST",
    token: SERVICE_KEY,
    body: {
      user_id: userId,
      amount_cents: amountCents,
      pix_key: pixKey,
      status: "pending",
      metadata: { origin: "AFFILIATE_WITHDRAWAL" },
    },
  });
  const row = Array.isArray(created) ? created[0] : created;
  return { ok: true, withdrawal: row, amountCents };
}

/** Saque do Saldo Reembolso (retornos ArbiShield: stake + dedução). */
async function requestDeductionWithdrawal(token, body) {
  const userId = requireUserId(token);
  const amountCents = Math.round(
    Number(body?.amountCents ?? body?.amount_cents ?? 0)
  );
  const pixKey = String(body?.pix_key ?? body?.pixKey ?? "").trim();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Valor inválido");
  }
  if (!pixKey) throw new Error("Informe a chave Pix");

  const open = await sb(
    `/rest/v1/withdrawals?select=id,status,metadata&user_id=eq.${userId}&status=in.(pending,approved,processing)&order=created_at.desc&limit=20`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const hasOpen = (Array.isArray(open) ? open : []).some((w) => {
    const meta = w?.metadata || {};
    const origin = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
    return (
      origin === "DEDUCTION_WITHDRAWAL" ||
      origin === "SALDO_DEDUCAO_WITHDRAWAL" ||
      origin === "REFUND_BALANCE_WITHDRAWAL" ||
      origin === "SALDO_REEMBOLSO_WITHDRAWAL"
    );
  });
  if (hasOpen) {
    throw new Error("Você já possui um saque de Saldo Reembolso em análise.");
  }

  const rows = await sb(
    `/rest/v1/profiles?select=deduction_balance_cents,pix_key&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new Error("Perfil não encontrado");
  const available = n(p.deduction_balance_cents);
  if (amountCents > available) {
    throw new Error(
      `Saldo Reembolso insuficiente (disponível ${(available / 100).toFixed(2)})`
    );
  }

  // Debita na hora (reserva) — admin libera/paga depois
  const afterCents = available - amountCents;
  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      deduction_balance_cents: afterCents,
      updated_at: new Date().toISOString(),
    },
  });

  const meta = {
    origin: "SALDO_REEMBOLSO_WITHDRAWAL",
    bucket: "deduction_balance_cents",
    label: "Saldo Reembolso",
    note: "Saque Saldo Reembolso (stake + dedução ArbiShield)",
  };
  const attempts = [
    {
      user_id: userId,
      amount_cents: amountCents,
      pix_key: pixKey,
      status: "pending",
      metadata: meta,
    },
    {
      user_id: userId,
      amount_cents: amountCents,
      status: "pending",
      metadata: { ...meta, pix_key: pixKey },
    },
  ];

  let row = null;
  let lastErr = null;
  for (const body of attempts) {
    try {
      const created = await sb("/rest/v1/withdrawals", {
        method: "POST",
        token: SERVICE_KEY,
        body,
      });
      row = Array.isArray(created) ? created[0] : created;
      if (row) break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!row) {
    // Estorna o débito se não conseguiu criar o pedido
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          deduction_balance_cents: available,
          updated_at: new Date().toISOString(),
        },
      });
    } catch {
      /* */
    }
    throw new Error(
      lastErr instanceof Error
        ? `Falha ao registrar saque: ${lastErr.message}`
        : "Falha ao registrar saque do Saldo Reembolso"
    );
  }

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "withdrawal_request",
        amount_cents: -amountCents,
        ref: row?.id || null,
        metadata: {
          origin: "SALDO_REEMBOLSO_WITHDRAWAL",
          bucket: "deduction_balance_cents",
          label: "Saldo Reembolso",
        },
      },
    });
  } catch {
    /* */
  }

  return { ok: true, withdrawal: row, amountCents, availableAfter: afterCents };
}

async function transferRealToDesafio(_token, _body) {
  // Bloqueado por pedido do produto: sem transferência Banca → Desafio.
  // Cliente deve depositar via PIX no saldo do Desafio.
  void _token;
  void _body;
  const err = new Error(
    "Transferência interna para a banca do Desafio está bloqueada. Deposite via PIX no saldo do Desafio."
  );
  err.status = 403;
  throw err;
}

/**
 * Transferência interna: Saldo Reembolso → Desafio (100% do disponível, sem teto 50%).
 * Banca Real → Desafio continua bloqueada.
 *
 * Marker: transfer-reembolso-desafio-atomic-v1
 * Update condicional em deduction_balance_cents (evita race / TX sem débito).
 */
async function transferDeductionToDesafio(token, body) {
  const userId = requireUserId(token);
  const amountCents = Math.round(
    Number(body?.amountCents ?? body?.amount_cents ?? 0)
  );
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    const err = new Error("Valor inválido");
    err.status = 400;
    throw err;
  }

  const rows = await sb(
    `/rest/v1/profiles?select=deduction_balance_cents,desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) {
    const err = new Error("Perfil não encontrado");
    err.status = 404;
    throw err;
  }
  const dedBefore = n(p.deduction_balance_cents);
  const desBefore = n(p.desafio_balance_cents);
  if (amountCents > dedBefore) {
    const err = new Error(
      `Saldo Reembolso insuficiente (disponível ${(dedBefore / 100).toFixed(2)})`
    );
    err.status = 400;
    throw err;
  }

  const dedAfter = dedBefore - amountCents;
  const desAfter = desBefore + amountCents;
  const now = new Date().toISOString();

  // Update atômico: só aplica se Reembolso ainda for exatamente dedBefore
  // (bloqueia race com correção admin / duplo clique).
  let patched = null;
  try {
    patched = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&deduction_balance_cents=eq.${dedBefore}`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          deduction_balance_cents: dedAfter,
          desafio_balance_cents: desAfter,
          updated_at: now,
        },
      }
    );
  } catch (e) {
    const err = new Error(
      e instanceof Error ? e.message : "Falha ao debitar Saldo Reembolso"
    );
    err.status = 500;
    throw err;
  }
  const row = Array.isArray(patched) ? patched[0] : patched;
  if (!row || n(row.deduction_balance_cents) !== dedAfter) {
    const err = new Error(
      "Saldo Reembolso mudou durante a transferência — tente de novo"
    );
    err.status = 409;
    throw err;
  }

  const verify = await sb(
    `/rest/v1/profiles?select=deduction_balance_cents,desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const v = Array.isArray(verify) ? verify[0] : null;
  if (
    !v ||
    n(v.deduction_balance_cents) !== dedAfter ||
    n(v.desafio_balance_cents) !== desAfter
  ) {
    const err = new Error("Falha ao confirmar transferência Reembolso → Desafio");
    err.status = 500;
    throw err;
  }

  // Só grava extrato DEPOIS do débito confirmado
  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "internal_transfer",
        amount_cents: amountCents,
        balance_before_cents: dedBefore,
        balance_after_cents: dedAfter,
        metadata: {
          from_bucket: "deduction_balance_cents",
          to_bucket: "desafio_balance_cents",
          label: "Saldo Reembolso → Desafio",
          source: "transfer_reembolso_desafio_v1",
          fix: "transfer-reembolso-desafio-atomic-v1",
          desafio_before_cents: desBefore,
          desafio_after_cents: desAfter,
          deduction_before_cents: dedBefore,
          deduction_after_cents: dedAfter,
        },
      },
    });
  } catch (e) {
    console.warn(
      "[transferDeductionToDesafio] wallet_transactions:",
      e instanceof Error ? e.message : e
    );
  }

  return {
    ok: true,
    amountCents,
    deductionBefore: dedBefore,
    deductionAfter: dedAfter,
    desafioBefore: desBefore,
    desafioAfter: desAfter,
  };
}

/**
 * Legado: removia “retido” do saldo usável.
 * Com desafio-saldo-reutilizavel-v1 o green na zebra credita o retorno no saldo;
 * esta função permanece só para hotfixes antigos / reparos manuais.
 */
async function clawbackDesafioRetainedFromSpendable(userId, retainedCents) {
  const takeWanted = Math.max(0, Math.round(Number(retainedCents) || 0));
  if (!(takeWanted > 0) || !userId) return 0;
  const pr = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const cur = Array.isArray(pr) ? pr[0] : null;
  if (!cur) return 0;
  const bal = n(cur.desafio_balance_cents);
  const take = Math.min(bal, takeWanted);
  if (!(take > 0)) return 0;
  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      desafio_balance_cents: Math.max(0, bal - take),
      updated_at: new Date().toISOString(),
    },
  });
  return take;
}


/** Matemática ciclo Desafio/Sinais (espelho desafio-ciclo-math) */
function desafioClampFee(pct) {
  const x = Number(pct);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.min(100, x) / 100;
}
function desafioEffectiveL(odd, commissionPct) {
  const o = Number(odd);
  if (!(o > 1)) return NaN;
  const fee = desafioClampFee(commissionPct);
  return 1 + (o - 1) * (1 - fee);
}
function desafioOddFromL(L, commissionPct) {
  const fee = desafioClampFee(commissionPct);
  if (!(L > 1) || fee >= 1) return NaN;
  return 1 + (L - 1) / (1 - fee);
}
function calcZebraOddFromFavorite(
  casaOdd,
  targetProfitPct = 5,
  casaCommissionPct = 0,
  arbiCommissionPct = 0
) {
  const Lc = desafioEffectiveL(casaOdd, casaCommissionPct);
  const margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
  if (!(Lc > margin)) {
    const err = new Error(
      `Odd do favorito (${casaOdd}) baixa demais para lucro de ${targetProfitPct}%.`
    );
    err.status = 400;
    throw err;
  }
  const Lz = (margin * Lc) / (Lc - margin);
  const zebraOdd = desafioOddFromL(Lz, arbiCommissionPct);
  if (!(zebraOdd > 1)) throw new Error("Não foi possível calcular a odd da zebra");
  return Math.round(zebraOdd * 100) / 100;
}
function calcCasaStakeFromZebra(
  zebraStakeCents,
  arbiOdd,
  casaOdd,
  arbiCommissionPct = 0,
  casaCommissionPct = 0
) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  const Lz = desafioEffectiveL(arbiOdd, arbiCommissionPct);
  const Lc = desafioEffectiveL(casaOdd, casaCommissionPct);
  if (!(Sz > 0) || !(Lz > 1) || !(Lc > 1)) return 0;
  return Math.round((Sz * Lz) / Lc);
}
function calcZebraPayoutCents(zebraStakeCents, arbiOdd, arbiCommissionPct = 0) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  const Lz = desafioEffectiveL(arbiOdd, arbiCommissionPct);
  if (!(Sz > 0) || !(Lz > 1)) return 0;
  return Math.round(Sz * Lz);
}
function calcProjectedReturnCents(zebraStakeCents, casaStakeCents, targetProfitPct = 5) {
  const total =
    Math.max(0, Math.round(Number(zebraStakeCents) || 0)) +
    Math.max(0, Math.round(Number(casaStakeCents) || 0));
  const margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
  return Math.round(total * margin);
}

/** Lucro surebet aproximado (lado vencedor). */
function desafioProfitCents(amountCents, odd, commissionPct) {
  const stake = Math.max(0, Math.round(Number(amountCents) || 0));
  const o = Number(odd);
  if (!(stake > 0) || !(o > 1)) return 0;
  const fee = Math.max(0, Math.min(100, Number(commissionPct) || 0)) / 100;
  return Math.round(stake * (o - 1) * (1 - fee));
}

async function listDesafioParticipations(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const stepId = String(body?.stepId || body?.step_id || "").trim();
  if (!stepId) throw new Error("stepId obrigatório");
  const rows = await sb(
    `/rest/v1/desafio_participations?select=*,profiles(full_name,avatar_url)&step_id=eq.${encodeURIComponent(stepId)}&order=created_at.desc&limit=500`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  const totals = {
    total: list.length,
    arbishield: 0,
    casa: 0,
    amount_arbishield_cents: 0,
    amount_casa_cents: 0,
  };
  for (const r of list) {
    const side = String(r.side || "").toLowerCase();
    const amt = n(r.amount_cents);
    if (side === "casa") {
      totals.casa += 1;
      totals.amount_casa_cents += amt;
    } else {
      totals.arbishield += 1;
      totals.amount_arbishield_cents += amt;
    }
  }
  return { rows: list, totals };
}

/**
 * Distribui valor confiscado do circuito Desafio para provedores ativos
 * (proporcional ao invested_amount das partner_rounds).
 */
async function distributeToActiveProviders(amountCents, description) {
  const total = Math.max(0, Math.round(Number(amountCents) || 0));
  if (!(total > 0)) return { count: 0, totalDistributed: 0 };
  const rounds = await sb(
    `/rest/v1/partner_rounds?select=id,user_id,invested_amount,accumulated_amount,status&status=eq.active&invested_amount=gt.0&limit=2000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(rounds) ? rounds : [];
  if (!list.length) return { count: 0, totalDistributed: 0 };
  const pool = list.reduce((a, r) => a + n(r.invested_amount), 0);
  if (!(pool > 0)) return { count: 0, totalDistributed: 0 };

  let distributed = 0;
  let count = 0;
  for (const r of list) {
    const share = Math.floor((total * n(r.invested_amount)) / pool);
    if (share <= 0) continue;
    await sb("/rest/v1/partner_distributions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        round_id: r.id,
        user_id: r.user_id,
        partner_id: r.user_id,
        distribution_amount: share,
        contribution_amount: n(r.invested_amount),
        description:
          description || "Liquidez Desafio — circuito sem vitória na casa",
      },
    });
    const nextAcc = n(r.accumulated_amount) + share;
    await sb(`/rest/v1/partner_rounds?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        accumulated_amount: nextAcc,
        updated_at: new Date().toISOString(),
      },
    }).catch(() => null);
    try {
      const prof = await sb(
        `/rest/v1/profiles?select=investor_balance_cents&id=eq.${encodeURIComponent(r.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const cur = Array.isArray(prof) ? prof[0] : null;
      if (cur) {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(r.user_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            investor_balance_cents: n(cur.investor_balance_cents) + share,
            updated_at: new Date().toISOString(),
          },
        });
      }
    } catch {
      /* saldo provedor opcional */
    }
    distributed += share;
    count += 1;
  }
  return { count, totalDistributed: distributed };
}

async function maybeForfeitCircuitToProviders(desafioId, userId) {
  const desafioRows = await sb(
    `/rest/v1/desafios?select=id,total_steps,initial_balance_cents&id=eq.${encodeURIComponent(desafioId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const desafio = Array.isArray(desafioRows) ? desafioRows[0] : null;
  if (!desafio) return null;

  const steps = await sb(
    `/rest/v1/desafio_steps?select=id,status,result,step_index&desafio_id=eq.${encodeURIComponent(desafioId)}&order=step_index.asc`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const stepList = Array.isArray(steps) ? steps : [];
  const totalSteps = Math.max(
    n(desafio.total_steps) || stepList.length || 5,
    1
  );
  const done = stepList.filter((s) => String(s.status) === "done");
  if (done.length < totalSteps) return null;

  const stepIds = stepList.map((s) => s.id).filter(Boolean);
  if (!stepIds.length) return null;
  const parts = await sb(
    `/rest/v1/desafio_participations?select=id,user_id,step_id,side,result,amount_cents,profit_cents&user_id=eq.${encodeURIComponent(userId)}&step_id=in.(${stepIds.join(",")})`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const userParts = Array.isArray(parts) ? parts : [];
  if (!userParts.length) return null;

  const wonCasa = userParts.some(
    (p) =>
      String(p.side).toLowerCase() === "casa" &&
      String(p.result).toLowerCase() === "won"
  );
  if (wonCasa) return { forfeited: false, reason: "objetivo_casa_atingido" };

  const arbiWins = userParts.filter(
    (p) =>
      String(p.side).toLowerCase() === "arbishield" &&
      String(p.result).toLowerCase() === "won"
  );
  const wonAmount = arbiWins.reduce(
    (a, p) => a + n(p.profit_cents) + n(p.amount_cents),
    0
  );
  if (!(wonAmount > 0)) return { forfeited: false, reason: "sem_ganhos" };

  const prof = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const profile = Array.isArray(prof) ? prof[0] : null;
  const bal = n(profile?.desafio_balance_cents);
  const take = Math.min(bal, wonAmount);
  if (take > 0) {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        desafio_balance_cents: Math.max(0, bal - take),
        updated_at: new Date().toISOString(),
      },
    });
  }
  const dist = await distributeToActiveProviders(
    take > 0 ? take : wonAmount,
    `Circuito Desafio ${desafioId.slice(0, 8)} — sem vitória na casa`
  );
  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "desafio_forfeit_to_provider",
        amount_cents: -(take || wonAmount),
        metadata: {
          desafio_id: desafioId,
          providers: dist.count,
          totalDistributed: dist.totalDistributed,
        },
      },
    });
  } catch {
    /* opcional */
  }
  return {
    forfeited: true,
    amountCents: take || wonAmount,
    providers: dist,
  };
}

async function getDesafioCircuitForUser(desafioId, userId) {
  const desafioRows = await sb(
    `/rest/v1/desafios?select=id,total_steps,initial_balance_cents,target_profit_pct,title&id=eq.${encodeURIComponent(desafioId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const desafio = Array.isArray(desafioRows) ? desafioRows[0] : null;
  if (!desafio) return null;

  const parts = await sb(
    `/rest/v1/desafio_participations?select=id,step_id,side,result,amount_cents,profit_cents,created_at&user_id=eq.${encodeURIComponent(userId)}&desafio_id=eq.${encodeURIComponent(desafioId)}&side=eq.arbishield&order=created_at.asc&limit=50`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(parts) ? parts : [];
  const maxEntries = Math.min(5, Math.max(1, n(desafio.total_steps) || 5));
  const pending = list.find((p) => String(p.result || "").toLowerCase() === "pending");
  const won = list.filter((p) => String(p.result || "").toLowerCase() === "won");
  const lost = list.filter((p) => String(p.result || "").toLowerCase() === "lost");
  const last = list.length ? list[list.length - 1] : null;
  const lastResult = last ? String(last.result || "").toLowerCase() : "";
  // Casa externa bateu → zebra lost → ciclo encerrado com sucesso externo
  const cycleEndedSuccess = lastResult === "lost";
  // 5 zebras won without casa → circuit exhausted (forfeit path)
  const cycleEndedMax = won.length >= maxEntries && !pending;
  const entryIndex = list.length + (pending ? 0 : 1);
  // Último retorno da zebra (stake+lucro) — só sugestão de stake; NÃO é saldo travado.
  let lastPayoutCents = 0;
  if (won.length) {
    const lastWin = won[won.length - 1];
    lastPayoutCents = n(lastWin.amount_cents) + n(lastWin.profit_cents);
  }
  return {
    desafio,
    maxEntries,
    entryIndex: Math.min(entryIndex, maxEntries + 1),
    participations: list,
    pending,
    lastPayoutCents,
    /** @deprecated use lastPayoutCents — não há mais retenção/congelamento */
    retainedCents: lastPayoutCents,
    cycleEndedSuccess,
    cycleEndedMax,
    targetProfitPct: Number(desafio.target_profit_pct) || 5,
    entriesPlayed: list.length,
    saldoMode: "desafio-saldo-reutilizavel-v1",
  };
}

function normalizeDesafioPartResult(raw) {
  const r = String(raw || "").toLowerCase().trim();
  if (!r || r === "null" || r === "undefined") return "pending";
  if (["won", "win", "won_platform", "victory", "vitoria", "vitória"].includes(r)) {
    return "won";
  }
  if (
    ["lost", "lose", "loss", "won_exchange", "won_casa", "casa", "external"].includes(
      r
    )
  ) {
    return "lost";
  }
  if (["pending", "active", "open", "current"].includes(r)) return "pending";
  return r;
}

function isClientDesafioSide(side) {
  const s = String(side || "").toLowerCase().trim();
  // Entrada do cliente no ciclo = lado ArbiShield/zebra.
  // Aceita legado sem side ou variações de nome.
  if (!s) return true;
  if (s === "casa" || s === "exchange" || s === "external" || s === "back") {
    return false;
  }
  return (
    s === "arbishield" ||
    s === "arbi" ||
    s === "zebra" ||
    s === "lay" ||
    s === "platform"
  );
}

/**
 * Histórico do cliente: desafios em andamento + realizados,
 * com valores apostados e lucros por ciclo.
 */
async function listMyDesafioHistory(token) {
  const userId = requireUserId(token);

  // Select enxuto (sem metadata) — coluna pode não existir e quebrava tudo no .catch([]).
  let parts = await sb(
    `/rest/v1/desafio_participations?select=id,desafio_id,step_id,side,result,amount_cents,profit_cents,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=500`,
    { token: SERVICE_KEY }
  ).catch((err) => {
    console.warn(
      "[desafio-history] query participations falhou",
      err instanceof Error ? err.message : err
    );
    return [];
  });
  if (!Array.isArray(parts)) parts = [];

  // Resolve desafio_id ausente via step_id (registros legados).
  const missingStepIds = [
    ...new Set(
      parts
        .filter((p) => !p.desafio_id && p.step_id)
        .map((p) => String(p.step_id))
    ),
  ];
  const stepToDesafio = new Map();
  const stepMap = new Map();
  if (missingStepIds.length) {
    for (let i = 0; i < missingStepIds.length; i += 40) {
      const chunk = missingStepIds.slice(i, i + 40);
      const inList = chunk.map(encodeURIComponent).join(",");
      const srows = await sb(
        `/rest/v1/desafio_steps?select=id,desafio_id,step_index,home_team,away_team,match_label,arbi_team_name,casa_team_name,starts_at,status&id=in.(${inList})&limit=200`,
        { token: SERVICE_KEY }
      ).catch(() => []);
      for (const s of Array.isArray(srows) ? srows : []) {
        stepMap.set(String(s.id), s);
        if (s.desafio_id) stepToDesafio.set(String(s.id), String(s.desafio_id));
      }
    }
  }

  const clientParts = [];
  for (const p of parts) {
    if (!isClientDesafioSide(p.side)) continue;
    const did =
      String(p.desafio_id || "") ||
      stepToDesafio.get(String(p.step_id || "")) ||
      "";
    if (!did) continue;
    clientParts.push({ ...p, desafio_id: did });
  }

  const byDesafio = new Map();
  for (const p of clientParts) {
    const did = String(p.desafio_id);
    if (!byDesafio.has(did)) byDesafio.set(did, []);
    byDesafio.get(did).push(p);
  }
  const desafioIds = [...byDesafio.keys()];
  const desafioMap = new Map();
  if (desafioIds.length) {
    const chunkSize = 40;
    for (let i = 0; i < desafioIds.length; i += chunkSize) {
      const chunk = desafioIds.slice(i, i + chunkSize);
      const inList = chunk.map(encodeURIComponent).join(",");
      const drows = await sb(
        `/rest/v1/desafios?select=id,number,title,subtitle,status,is_active,total_steps,target_profit_pct,initial_balance_cents,created_at,updated_at&id=in.(${inList})`,
        { token: SERVICE_KEY }
      ).catch(() => []);
      for (const d of Array.isArray(drows) ? drows : []) {
        desafioMap.set(String(d.id), d);
      }
      const srows = await sb(
        `/rest/v1/desafio_steps?select=id,desafio_id,step_index,home_team,away_team,match_label,arbi_team_name,casa_team_name,starts_at,status&desafio_id=in.(${inList})&order=step_index.asc&limit=500`,
        { token: SERVICE_KEY }
      ).catch(() => []);
      for (const s of Array.isArray(srows) ? srows : []) {
        stepMap.set(String(s.id), s);
      }
    }
  }

  const items = [];
  for (const [desafioId, partsOf] of byDesafio.entries()) {
    const ordered = partsOf
      .slice()
      .sort(
        (a, b) =>
          new Date(a.created_at || 0).getTime() -
          new Date(b.created_at || 0).getTime()
      );
    const d = desafioMap.get(desafioId) || {};
    const maxEntries = Math.min(5, Math.max(1, n(d.total_steps) || 5));
    let wagered = 0;
    let profit = 0;
    let wonN = 0;
    let lostN = 0;
    let pendingN = 0;
    const entries = ordered.map((p) => {
      const res = normalizeDesafioPartResult(p.result);
      const amt = n(p.amount_cents);
      const pr = n(p.profit_cents);
      wagered += amt;
      if (res === "won") {
        profit += pr > 0 ? pr : 0;
        wonN += 1;
      } else if (res === "lost") {
        lostN += 1;
      } else {
        pendingN += 1;
      }
      const step = stepMap.get(String(p.step_id || "")) || null;
      const matchLabel =
        (step &&
          (step.match_label ||
            [step.home_team || step.casa_team_name, step.away_team || step.arbi_team_name]
              .filter(Boolean)
              .join(" × "))) ||
        null;
      return {
        id: p.id,
        stepId: p.step_id || null,
        stepIndex: step ? Number(step.step_index) || null : null,
        matchLabel,
        side: String(p.side || "arbishield").toLowerCase(),
        result: res,
        amountCents: amt,
        profitCents: res === "won" ? pr : 0,
        createdAt: p.created_at || null,
        startsAt: step ? step.starts_at || null : null,
      };
    });
    const last = ordered[ordered.length - 1];
    const lastResult = last
      ? normalizeDesafioPartResult(last.result)
      : "";
    const cycleEndedSuccess = lastResult === "lost";
    const cycleEndedMax = wonN >= maxEntries && pendingN === 0;
    let status = "em_andamento";
    let statusLabel = "Em andamento";
    if (cycleEndedSuccess) {
      status = "sucesso_casa";
      statusLabel = "Sucesso na casa";
    } else if (cycleEndedMax) {
      status = "finalizado";
      statusLabel = "Finalizado";
    } else if (pendingN > 0) {
      status = "em_andamento";
      statusLabel = "Aguardando resultado";
    } else if (wonN > 0 || lostN > 0) {
      status = "em_andamento";
      statusLabel = "Em andamento";
    } else if (ordered.length === 0) {
      status = "vazio";
      statusLabel = "Sem entradas";
    }
    // Desafio admin inativo + sem pendência → trata como finalizado
    if (
      status === "em_andamento" &&
      pendingN === 0 &&
      d &&
      d.is_active === false &&
      (wonN > 0 || lostN > 0)
    ) {
      status = lostN > 0 ? "sucesso_casa" : "finalizado";
      statusLabel = lostN > 0 ? "Sucesso na casa" : "Finalizado";
    }
    const firstAt = ordered[0]?.created_at || null;
    const lastAt = last?.created_at || null;
    items.push({
      desafioId,
      number: d.number ?? null,
      title: d.title || `Desafio ${String(desafioId).slice(0, 8)}`,
      subtitle: d.subtitle || null,
      targetProfitPct: Number(d.target_profit_pct) || 5,
      maxEntries,
      status,
      statusLabel,
      entriesCount: ordered.length,
      wonCount: wonN,
      lostCount: lostN,
      pendingCount: pendingN,
      wageredCents: wagered,
      profitCents: profit,
      firstAt,
      lastAt,
      entries,
      journeyUrl: `/app-desafio-jornada.html?desafioId=${encodeURIComponent(desafioId)}`,
    });
  }

  items.sort((a, b) => {
    const rank = (s) =>
      s === "em_andamento" ? 0 : s === "sucesso_casa" ? 1 : 2;
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime();
  });

  const totals = {
    desafios: items.length,
    emAndamento: items.filter((x) => x.status === "em_andamento").length,
    finalizados: items.filter((x) => x.status !== "em_andamento").length,
    wageredCents: items.reduce((a, x) => a + x.wageredCents, 0),
    profitCents: items.reduce((a, x) => a + x.profitCents, 0),
  };

  return {
    ok: true,
    items,
    totals,
    debug: {
      userId: String(userId).slice(0, 8),
      rawParticipations: parts.length,
      clientParticipations: clientParts.length,
      desafios: items.length,
    },
  };
}

async function resolveDesafioStepId(raw) {
  const stepId = String(raw || "").trim();
  if (!stepId) return null;
  if (!stepId.includes(":")) return stepId;
  // Compat: "desafioId:stepIndex" (bug antigo do app-desafio)
  const [desafioId, idxStr] = stepId.split(":");
  const idx = Number(idxStr);
  if (!desafioId || !(idx > 0)) return stepId;
  const rows = await sb(
    `/rest/v1/desafio_steps?select=id&desafio_id=eq.${encodeURIComponent(desafioId)}&step_index=eq.${idx}&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.id || stepId;
}

async function activateNextDesafioStep(desafioId, currentStepIndex) {
  const nextIdx = Number(currentStepIndex) + 1;
  if (!(nextIdx >= 2)) return null;
  const rows = await sb(
    `/rest/v1/desafio_steps?select=id,status,step_index&desafio_id=eq.${encodeURIComponent(desafioId)}&step_index=eq.${nextIdx}&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const next = Array.isArray(rows) ? rows[0] : null;
  if (!next?.id) return null;
  if (String(next.status) === "done") return next;
  await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(next.id)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      status: "current",
      is_published: true,
      updated_at: new Date().toISOString(),
    },
  }).catch(() => null);
  return { ...next, status: "current", activated: true };
}

async function settleDesafioStep(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const stepId = String(body?.stepId || body?.step_id || "").trim();
  let winningSide = String(
    body?.winningSide || body?.winning_side || body?.outcome || ""
  )
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if (!stepId) throw new Error("stepId obrigatório");
  const isVoid =
    winningSide === "void" ||
    winningSide === "empate_anula" ||
    winningSide === "anula" ||
    winningSide === "draw" ||
    winningSide === "push" ||
    winningSide === "dnb" ||
    winningSide === "draw_no_bet";
  if (isVoid) winningSide = "void";
  if (winningSide !== "arbishield" && winningSide !== "casa" && winningSide !== "void") {
    throw new Error(
      "winningSide deve ser arbishield, casa ou empate_anula/void"
    );
  }

  const stepRows = await sb(
    `/rest/v1/desafio_steps?select=*&id=eq.${encodeURIComponent(stepId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const step = Array.isArray(stepRows) ? stepRows[0] : null;
  if (!step) throw new Error("Etapa não encontrada");
  if (String(step.status) === "done") {
    throw new Error("Etapa já encerrada");
  }

  const parts = await sb(
    `/rest/v1/desafio_participations?select=*&step_id=eq.${encodeURIComponent(stepId)}&limit=2000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(parts) ? parts : [];
  const adminId = (() => {
    try {
      return requireUserId(token);
    } catch {
      return null;
    }
  })();

  const advances = [];
  let zebraKeptCents = 0;
  let casaPaidCents = 0;
  let voidRefundedCents = 0;
  for (const p of list) {
    const side = String(p.side || "").toLowerCase();
    const partResult = String(p.result || "").toLowerCase();
    // Já liquidada / cancelada — não recredita
    if (
      partResult &&
      partResult !== "pending" &&
      partResult !== "null" &&
      partResult !== "open"
    ) {
      continue;
    }

    // Empate Anula: devolve o valor apostado à carteira Desafio (sem lucro).
    if (winningSide === "void") {
      const stake = Math.max(0, n(p.amount_cents));
      await sb(
        `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`,
        {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            result: "void",
            profit_cents: 0,
            updated_at: new Date().toISOString(),
          },
        }
      );
      if (stake > 0 && p.user_id) {
        try {
          const pr = await sb(
            `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(p.user_id)}&limit=1`,
            { token: SERVICE_KEY }
          );
          const cur = Array.isArray(pr) ? pr[0] : null;
          if (cur) {
            await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.user_id)}`, {
              method: "PATCH",
              token: SERVICE_KEY,
              body: {
                desafio_balance_cents: n(cur.desafio_balance_cents) + stake,
                updated_at: new Date().toISOString(),
              },
            });
            voidRefundedCents += stake;
            try {
              await sb("/rest/v1/wallet_transactions", {
                method: "POST",
                token: SERVICE_KEY,
                body: {
                  user_id: p.user_id,
                  type: "desafio_void_refund",
                  amount_cents: stake,
                  metadata: {
                    desafio_id: step.desafio_id || null,
                    step_id: stepId,
                    participation_id: p.id,
                    reason: "empate_anula",
                    side,
                  },
                },
              });
            } catch {
              /* */
            }
          }
        } catch {
          /* */
        }
      }
      continue;
    }

    const won = side === winningSide;
    let profit = 0;
    let credit = 0;
    if (won) {
      if (side === "arbishield") {
        // Green na Zebra: retorno (stake + lucro) volta ao saldo Desafio usável.
        profit = calcZebraPayoutCents(
          p.amount_cents,
          step.arbi_odd ?? step.home_odd,
          step.arbi_commission_pct
        ) - n(p.amount_cents);
        if (profit < 0) profit = 0;
        // fallback se odd inválida
        if (!(profit > 0)) {
          profit = desafioProfitCents(
            p.amount_cents,
            step.arbi_odd ?? step.home_odd,
            step.arbi_commission_pct
          );
        }
        credit = n(p.amount_cents) + profit;
      } else {
        profit = desafioProfitCents(
          p.amount_cents,
          step.casa_odd ?? step.away_odd,
          step.casa_commission_pct
        );
        credit = profit;
      }
    }
    if (winningSide === "casa") {
      if (side === "arbishield" && !won) zebraKeptCents += n(p.amount_cents);
      if (side === "casa" && won) casaPaidCents += profit;
    }
    await sb(
      `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          result: won ? "won" : "lost",
          profit_cents: won ? profit : 0,
          updated_at: new Date().toISOString(),
        },
      }
    );
    // Green na zebra OU participação side=casa: credita no saldo Desafio usável.
    // Cliente reutiliza o valor em qualquer entrada seguinte (sem retenção).
    if (won && credit > 0 && p.user_id && (side === "arbishield" || side === "casa")) {
      try {
        const pr = await sb(
          `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(p.user_id)}&limit=1`,
          { token: SERVICE_KEY }
        );
        const cur = Array.isArray(pr) ? pr[0] : null;
        if (cur) {
          await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.user_id)}`, {
            method: "PATCH",
            token: SERVICE_KEY,
            body: {
              desafio_balance_cents: n(cur.desafio_balance_cents) + credit,
              updated_at: new Date().toISOString(),
            },
          });
        }
      } catch {
        /* */
      }
    }

    // Após green na zebra: avança ciclo e ativa próxima etapa se existir
    if (
      won &&
      side === "arbishield" &&
      p.user_id &&
      step.desafio_id
    ) {
      const next = await activateNextDesafioStep(
        step.desafio_id,
        step.step_index
      );
      if (next) {
        advances.push({
          userId: p.user_id,
          nextStepId: next.id,
          nextStepIndex: next.step_index,
          creditedCents: credit,
          retainedCents: credit,
        });
      } else {
        advances.push({
          userId: p.user_id,
          nextStepId: null,
          creditedCents: credit,
          retainedCents: credit,
          awaitingAdminSignal: true,
        });
      }
    }
  }

  const result =
    winningSide === "void"
      ? "void"
      : winningSide === "arbishield"
        ? "zebra_protected"
        : "win";
  await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(stepId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      status: "done",
      result,
      settled_at: new Date().toISOString(),
      settled_by: adminId,
      final_score_home:
        body?.homeScore != null ? Number(body.homeScore) : step.final_score_home,
      final_score_away:
        body?.awayScore != null ? Number(body.awayScore) : step.final_score_away,
      updated_at: new Date().toISOString(),
    },
  });

  // Se não restar etapa aberta, tira o desafio da lista "ativos" do cliente
  let desafioDeactivated = false;
  if (step.desafio_id) {
    try {
      const allSteps = await sb(
        `/rest/v1/desafio_steps?select=id,status,result,settled_at,deleted_at&desafio_id=eq.${encodeURIComponent(step.desafio_id)}`,
        { token: SERVICE_KEY }
      );
      const open = (Array.isArray(allSteps) ? allSteps : []).filter((s) => {
        if (s.deleted_at) return false;
        const st = String(s.status || "").toLowerCase();
        if (st === "done" || st === "settled" || st === "closed" || st === "cancelled") {
          return false;
        }
        if (s.settled_at) return false;
        const res = String(s.result || "").toLowerCase();
        if (
          res === "win" ||
          res === "zebra_protected" ||
          res === "lost" ||
          res === "void" ||
          res === "empate_anula"
        ) {
          return false;
        }
        return true;
      });
      if (!open.length) {
        await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(step.desafio_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            is_active: false,
            status: "completed",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });
        desafioDeactivated = true;
      }
    } catch {
      /* best-effort */
    }
  }

  const forfeits = [];
  if (winningSide === "arbishield" && step.desafio_id) {
    const userIds = [...new Set(list.map((p) => p.user_id).filter(Boolean))];
    for (const uid of userIds) {
      const f = await maybeForfeitCircuitToProviders(step.desafio_id, uid);
      if (f) forfeits.push({ userId: uid, ...f });
    }
  }

  const retained =
    winningSide === "void"
      ? 0
      : list
          .filter((p) => String(p.side || "").toLowerCase() !== winningSide)
          .reduce((a, p) => a + n(p.amount_cents), 0);

  // Casa venceu → stake zebra fica com a plataforma (= lucro operacional).
  // Credita tesouraria (antes: só saía do desafio_balance, caixa empresa não andava).
  let treasury = null;
  if (winningSide === "casa") {
    const net = zebraKeptCents - casaPaidCents;
    if (net) {
      treasury = await adjustPlatformTreasury(net, {
        adminId,
        action: "TREASURY_DESAFIO_CASA_WIN",
        entityType: "desafio_steps",
        entityId: stepId,
        details: {
          desafio_id: step.desafio_id || null,
          zebra_kept_cents: zebraKeptCents,
          casa_paid_cents: casaPaidCents,
          winning_side: winningSide,
        },
      }).catch((e) => {
        console.warn("[treasury] desafio settle:", e.message || e);
        return { ok: false, error: String(e.message || e) };
      });
    }
  }

  return {
    ok: true,
    stepId,
    winningSide,
    result,
    participants: list.length,
    retainedCents: retained,
    voidRefundedCents,
    advances,
    forfeits,
    desafioDeactivated,
    treasury,
    ciclo: "desafio-ciclo-sinais-v1",
    fix:
      winningSide === "void"
        ? "desafio-empate-anula-v1"
        : "desafio-saldo-reutilizavel-v1",
  };
}

async function registerDesafioEntry(token, body) {
  const userId = requireUserId(token);
  let stepId = await resolveDesafioStepId(body?.stepId || body?.step_id);
  const side = String(body?.side || "arbishield")
    .toLowerCase()
    .trim();
  if (!stepId) throw new Error("stepId obrigatório");
  if (side !== "arbishield" && side !== "casa") {
    throw new Error("side inválido");
  }

  const stepRows = await sb(
    `/rest/v1/desafio_steps?select=*,desafios(id,initial_balance_cents,is_active,status,total_steps,target_profit_pct,title)&id=eq.${encodeURIComponent(stepId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const step = Array.isArray(stepRows) ? stepRows[0] : null;
  if (!step) throw new Error("Etapa não encontrada");
  if (String(step.status) === "done") throw new Error("Etapa já encerrada");
  if (String(step.status) === "live") {
    throw new Error("Jogo ao vivo — entradas encerradas");
  }

  const desafioId = step.desafio_id || step.desafios?.id;
  if (!desafioId) throw new Error("Desafio inválido");

  const circuit = await getDesafioCircuitForUser(desafioId, userId);
  if (!circuit) throw new Error("Desafio não encontrado");
  if (circuit.cycleEndedSuccess) {
    throw new Error("Ciclo já encerrado com sucesso na casa externa");
  }
  if (circuit.pending) {
    throw new Error("Já existe entrada pendente neste ciclo");
  }
  if (circuit.entriesPlayed >= circuit.maxEntries) {
    throw new Error("Máximo de 5 entradas atingido neste ciclo");
  }

  const entryNumber = circuit.entriesPlayed + 1;
  const targetPct = circuit.targetProfitPct;
  const arbiOdd = Number(step.arbi_odd ?? step.home_odd);
  const casaOdd = Number(step.casa_odd ?? step.away_odd);

  let amountCents = Math.round(
    Number(body?.amountCents ?? body?.amount_cents ?? 0)
  );

  // Todas as entradas (1–5) debitam o saldo Desafio usável.
  // Green na zebra devolve o retorno ao mesmo saldo — valor reutilizável.
  if (!(amountCents > 0)) {
    amountCents =
      n(circuit.lastPayoutCents) ||
      n(circuit.retainedCents) ||
      n(step.desafios?.initial_balance_cents) ||
      0;
  }
  if (!(amountCents > 0)) throw new Error("Informe o valor da aposta na zebra");

  const existing = await sb(
    `/rest/v1/desafio_participations?select=id&user_id=eq.${userId}&step_id=eq.${encodeURIComponent(stepId)}&side=eq.${side}&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  if (Array.isArray(existing) && existing[0]) {
    throw new Error("already registered");
  }

  const prof = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents,locked_balance_cents&id=eq.${userId}&limit=1`,
    { token: SERVICE_KEY }
  );
  const profile = Array.isArray(prof) ? prof[0] : null;
  const bal = n(profile?.desafio_balance_cents);

  const casaStakeCents = calcCasaStakeFromZebra(
    amountCents,
    arbiOdd,
    casaOdd,
    step.arbi_commission_pct,
    step.casa_commission_pct
  );
  const projectedReturnCents = calcProjectedReturnCents(
    amountCents,
    casaStakeCents,
    targetPct
  );

  if (bal < amountCents) throw new Error("insufficient");
  await sb(`/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      desafio_balance_cents: bal - amountCents,
      updated_at: new Date().toISOString(),
    },
  });

  const created = await sb("/rest/v1/desafio_participations", {
    method: "POST",
    token: SERVICE_KEY,
    body: {
      user_id: userId,
      step_id: stepId,
      desafio_id: desafioId,
      side,
      amount_cents: amountCents,
      result: "pending",
      profit_cents: 0,
    },
  });
  const row = Array.isArray(created) ? created[0] : created;

  try {
    await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(stepId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        used_liquidity_cents: n(step.used_liquidity_cents) + amountCents,
        // Guarda stake sugerido da casa para o painel (último cálculo)
        casa_stake_cents: casaStakeCents || step.casa_stake_cents,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    /* */
  }

  return {
    ok: true,
    participation: row,
    sinal: {
      entryNumber,
      maxEntries: circuit.maxEntries,
      zebraStakeCents: amountCents,
      casaStakeCents,
      arbiOdd,
      casaOdd,
      projectedReturnCents,
      targetProfitPct: targetPct,
      zebraTeam: step.arbi_team_name || step.away_team || step.home_team,
      favoriteTeam: step.casa_team_name || step.home_team || step.away_team,
      matchLabel: step.match_label,
      externalBetLink: step.external_bet_link,
      allocatedAutomatically: false,
      debitedFromDesafioBalance: true,
    },
    ciclo: "desafio-ciclo-sinais-v1",
    fix: "desafio-saldo-reutilizavel-v1",
  };
}


async function cancelDesafioParticipation(token, body) {
  const callerId = requireUserId(token);
  const isAdmin = await currentUserIsAdmin(token);
  const participationId = String(
    body?.participationId || body?.participation_id || body?.id || ""
  ).trim();
  let stepId = String(body?.stepId || body?.step_id || "").trim();
  const desafioIdHint = String(body?.desafioId || body?.desafio_id || "").trim();

  let row = null;
  if (participationId) {
    const rows = await sb(
      `/rest/v1/desafio_participations?select=*&id=eq.${encodeURIComponent(participationId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    row = Array.isArray(rows) ? rows[0] : null;
  } else if (stepId) {
    stepId = (await resolveDesafioStepId(stepId)) || stepId;
    const qUser = isAdmin && body?.userId ? String(body.userId) : callerId;
    const rows = await sb(
      `/rest/v1/desafio_participations?select=*&user_id=eq.${encodeURIComponent(qUser)}&step_id=eq.${encodeURIComponent(stepId)}&result=eq.pending&order=created_at.desc&limit=1`,
      { token: SERVICE_KEY }
    );
    row = Array.isArray(rows) ? rows[0] : null;
  } else if (desafioIdHint) {
    const rows = await sb(
      `/rest/v1/desafio_participations?select=*&user_id=eq.${encodeURIComponent(callerId)}&desafio_id=eq.${encodeURIComponent(desafioIdHint)}&result=eq.pending&order=created_at.desc&limit=1`,
      { token: SERVICE_KEY }
    );
    row = Array.isArray(rows) ? rows[0] : null;
  }

  if (!row) throw new Error("Entrada pendente não encontrada");
  if (!isAdmin && String(row.user_id) !== String(callerId)) {
    throw new Error("Acesso negado");
  }

  const result = String(row.result || "").toLowerCase();
  if (result === "cancelled") {
    return {
      ok: true,
      alreadyCancelled: true,
      participationId: row.id,
      refundedCents: 0,
    };
  }
  if (result !== "pending") {
    throw new Error("Só entradas pendentes podem ser canceladas");
  }

  stepId = row.step_id || stepId;
  const stepRows = await sb(
    `/rest/v1/desafio_steps?select=id,status,starts_at,used_liquidity_cents,desafio_id&id=eq.${encodeURIComponent(stepId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const step = Array.isArray(stepRows) ? stepRows[0] : null;
  if (!step) throw new Error("Etapa não encontrada");

  const stepStatus = String(step.status || "").toLowerCase();
  if (stepStatus === "done") {
    throw new Error("Etapa já encerrada — não é possível cancelar");
  }

  const startsMs = step.starts_at ? new Date(step.starts_at).getTime() : NaN;
  if (!isAdmin) {
    if (stepStatus === "live") {
      throw new Error("Jogo ao vivo — cancelamento encerrado");
    }
    if (Number.isFinite(startsMs) && Date.now() >= startsMs) {
      throw new Error("Partida já iniciou — cancelamento encerrado");
    }
  }

  const amount = n(row.amount_cents);
  const userId = row.user_id;
  if (amount > 0) {
    const prof = await sb(
      `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const bal = n(Array.isArray(prof) ? prof[0]?.desafio_balance_cents : 0);
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        desafio_balance_cents: bal + amount,
        updated_at: new Date().toISOString(),
      },
    });
  }

  let cancelledVia = "patch";
  try {
    await sb(
      `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(row.id)}`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          result: "cancelled",
          profit_cents: 0,
          updated_at: new Date().toISOString(),
        },
      }
    );
  } catch (e) {
    cancelledVia = "delete";
    await sb(
      `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(row.id)}`,
      { method: "DELETE", token: SERVICE_KEY }
    );
  }

  try {
    const used = Math.max(0, n(step.used_liquidity_cents) - amount);
    await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(stepId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        used_liquidity_cents: used,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    /* */
  }

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "desafio_cancel_refund",
        amount_cents: amount,
        metadata: {
          participation_id: row.id,
          step_id: stepId,
          desafio_id: row.desafio_id || step.desafio_id,
          cancelled_by: callerId,
          admin: !!isAdmin,
          via: cancelledVia,
        },
      },
    });
  } catch (e) {
    console.warn("[desafio-cancel] wallet_transactions:", e.message || e);
  }

  return {
    ok: true,
    participationId: row.id,
    stepId,
    userId,
    refundedCents: amount,
    result: "cancelled",
    via: cancelledVia,
    admin: !!isAdmin,
  };
}

async function getDesafioJornada(token, body) {
  const userId = requireUserId(token);
  let desafioId = String(body?.desafioId || body?.desafio_id || "").trim();

  // Desafio ativo mais recente (ou o informado)
  let desafio = null;
  if (desafioId) {
    const rows = await sb(
      `/rest/v1/desafios?select=*,desafio_steps(*)&id=eq.${encodeURIComponent(desafioId)}&deleted_at=is.null&limit=1`,
      { token: SERVICE_KEY }
    );
    desafio = Array.isArray(rows) ? rows[0] : null;
  } else {
    const rows = await sb(
      `/rest/v1/desafios?select=*,desafio_steps(*)&is_active=eq.true&deleted_at=is.null&order=updated_at.desc&limit=5`,
      { token: SERVICE_KEY }
    );
    const list = Array.isArray(rows) ? rows : [];
    desafio = list[0] || null;
  }
  if (!desafio) {
    return { ok: true, empty: true, stages: [], progress: null };
  }
  desafioId = desafio.id;

  const steps = (Array.isArray(desafio.desafio_steps) ? desafio.desafio_steps : [])
    .slice()
    .sort((a, b) => n(a.step_index) - n(b.step_index));
  const maxEntries = Math.min(5, Math.max(steps.length || 5, n(desafio.total_steps) || 5));

  const parts = await sb(
    `/rest/v1/desafio_participations?select=*&user_id=eq.${encodeURIComponent(userId)}&desafio_id=eq.${encodeURIComponent(desafioId)}&side=eq.arbishield&order=created_at.asc&limit=50`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const partList = Array.isArray(parts) ? parts : [];
  const byStep = new Map();
  for (const p of partList) {
    byStep.set(String(p.step_id), p);
  }

  const prof = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const bal = n(Array.isArray(prof) ? prof[0]?.desafio_balance_cents : 0);

  let accumulatedProfit = 0;
  let currentIndex = 1;
  let foundCurrent = false;
  let inRecovery = false;
  let failedAt = null;

  const stages = [];
  for (let i = 0; i < maxEntries; i++) {
    const step = steps[i] || null;
    const stepIndex = i + 1;
    const isFinal = stepIndex === maxEntries;
    const part = step ? byStep.get(String(step.id)) : null;
    const partResult = part ? String(part.result || "").toLowerCase() : "";
    const stepStatus = step ? String(step.status || "").toLowerCase() : "pending";
    const stepResult = step ? String(step.result || "").toLowerCase() : "";

    let state = "locked"; // locked | waiting | current | won | lost | protected | final_ready
    let label = isFinal ? "Etapa Final" : `Etapa ${stepIndex}`;

    if (partResult === "won") {
      state = "won";
      accumulatedProfit += n(part.profit_cents);
      currentIndex = Math.min(stepIndex + 1, maxEntries);
    } else if (partResult === "lost") {
      // Zebra perdeu = green na casa externa = sucesso do ciclo (fora)
      // Mas no mapa do cliente "derrota" na zebra abre recuperação se for falha de proteção
      // Wilson: green favorito = sucesso ciclo; green zebra = avança
      // Aqui part lost no lado arbishield = casa bateu = ciclo sucesso externo
      state = "won_external"; // sucesso fora
      accumulatedProfit += 0;
      foundCurrent = true;
      currentIndex = stepIndex;
    } else if (partResult === "pending") {
      state = "current";
      foundCurrent = true;
      currentIndex = stepIndex;
    } else if (!foundCurrent) {
      // Sem participação ainda
      if (step && (stepStatus === "current" || stepStatus === "pending" || step.is_published)) {
        // primeira etapa disponível sem part
        if (i === 0 || (stages[i - 1] && (stages[i - 1].state === "won" || stages[i - 1].state === "protected"))) {
          state = "current";
          foundCurrent = true;
          currentIndex = stepIndex;
        } else if (i === 0) {
          state = "current";
          foundCurrent = true;
          currentIndex = 1;
        } else {
          state = "locked";
        }
      } else if (!step && i === 0) {
        state = "waiting";
        foundCurrent = true;
        currentIndex = 1;
      } else {
        state = "locked";
      }
    } else {
      state = "locked";
    }

    // Se etapa anterior foi lost no sentido de "precisa proteção" — 
    // No modelo Wilson, lost na zebra (casa won) encerra com sucesso.
    // Recuperação: quando admin marca zebra_protected vs necessidade de recovery path
    // Usamos step.result === 'zebra_protected' com part won como vitória;
    // recovery branch: se houver steps com step_index tipo 3.1 ou metadata recovery
    if (stepResult === "zebra_protected" && partResult === "won") {
      state = "won";
    }

    if (isFinal && state === "current") state = "final_ready";

    const startsAt = step?.starts_at || null;
    let whenLabel = "A definir";
    if (startsAt) {
      const d = new Date(startsAt);
      if (!Number.isNaN(d.getTime())) {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        if (d.toDateString() === now.toDateString()) whenLabel = `Hoje ${time}`;
        else if (d.toDateString() === tomorrow.toDateString()) whenLabel = `Amanhã ${time}`;
        else {
          whenLabel =
            d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
            " " +
            time;
        }
      }
    }

    const arbiOdd = Number(step?.arbi_odd ?? step?.home_odd) || null;
    const casaOdd = Number(step?.casa_odd ?? step?.away_odd) || null;
    const entrada =
      n(part?.amount_cents) ||
      n(desafio.initial_balance_cents) ||
      0;
    const retorno =
      arbiOdd && entrada
        ? calcZebraPayoutCents(entrada, arbiOdd, step?.arbi_commission_pct)
        : Math.round(entrada * (1 + (Number(desafio.target_profit_pct) || 5) / 100));
    const lucro = Math.max(0, retorno - entrada);

    stages.push({
      index: stepIndex,
      isFinal,
      label,
      state,
      stepId: step?.id || null,
      matchLabel:
        step?.match_label ||
        [step?.home_team, step?.away_team].filter(Boolean).join(" x ") ||
        null,
      homeTeam: step?.home_team || step?.casa_team_name || null,
      awayTeam: step?.away_team || step?.arbi_team_name || null,
      zebraTeam: step?.arbi_team_name || step?.away_team || null,
      favoriteTeam: step?.casa_team_name || step?.home_team || null,
      whenLabel,
      startsAt,
      arbiOdd,
      casaOdd,
      externalHouse: "Casa Externa",
      externalBetLink: step?.external_bet_link || null,
      recommendedCents: entrada,
      returnCents: retorno,
      profitCents: partResult === "won" ? n(part?.profit_cents) : lucro,
      participation: part
        ? {
            id: part.id,
            result: partResult,
            amountCents: n(part.amount_cents),
            profitCents: n(part.profit_cents),
          }
        : null,
      statusText:
        state === "won"
          ? "Vitória"
          : state === "won_external"
            ? "Sucesso na casa externa"
            : state === "lost"
              ? "Derrota"
              : state === "protected"
                ? "Proteção acionada"
                : state === "current" || state === "final_ready"
                  ? partResult === "pending"
                    ? "Aguardando resultado"
                    : "Você está aqui"
                  : state === "waiting"
                    ? "Aguardando início"
                    : "Bloqueada",
    });
  }

  // Trilha de recuperação: etapas extras com metadata/source recovery ou step_index > max e label A
  const recoverySteps = steps.filter((s) => {
    const meta = s.metadata && typeof s.metadata === "object" ? s.metadata : {};
    return (
      meta.recovery === true ||
      meta.path === "recovery" ||
      String(s.market_name_arbishield || "").toLowerCase().includes("recupera") ||
      String(s.match_label || "").toLowerCase().includes("recupera")
    );
  });
  const recovery = recoverySteps.map((step, idx) => {
    const part = byStep.get(String(step.id));
    const partResult = part ? String(part.result || "").toLowerCase() : "";
    let state = "locked";
    if (partResult === "won") state = "won";
    else if (partResult === "lost") state = "lost";
    else if (partResult === "pending") state = "current";
    else if (idx === 0) state = "current";
    return {
      index: `R${idx + 1}`,
      label: idx === recoverySteps.length - 1 ? "Final (Recuperação)" : `Etapa ${step.step_index}A`,
      state,
      stepId: step.id,
      matchLabel: step.match_label,
      arbiOdd: Number(step.arbi_odd) || null,
      whenLabel: step.starts_at || null,
      participation: part
        ? {
            result: partResult,
            amountCents: n(part.amount_cents),
            profitCents: n(part.profit_cents),
          }
        : null,
    };
  });

  // Detecta falha que abre proteção: participação lost onde step.result não é win (casa)
  // No fluxo atual lost = casa bateu = sucesso. Para UI demo de recuperação:
  // se houver recovery steps e algum stage lost, marca inRecovery
  const lostStage = stages.find((s) => s.state === "lost");
  if (lostStage || recovery.length) {
    inRecovery = recovery.length > 0;
    failedAt = lostStage?.index || null;
  }

  const doneCount = stages.filter((s) =>
    ["won", "won_external", "protected"].includes(s.state)
  ).length;
  const progressPct = Math.round((doneCount / maxEntries) * 100);
  const remaining = Math.max(0, maxEntries - doneCount);

  return {
    ok: true,
    empty: false,
    ciclo: "desafio-jornada-v1",
    desafio: {
      id: desafio.id,
      title: desafio.title,
      subtitle: desafio.subtitle,
      number: desafio.number,
      targetProfitPct: Number(desafio.target_profit_pct) || 5,
      totalSteps: maxEntries,
      initialBalanceCents: n(desafio.initial_balance_cents),
    },
    stages,
    recovery,
    inRecovery,
    failedAt,
    progress: {
      percent: progressPct,
      currentStage: currentIndex,
      totalStages: maxEntries,
      accumulatedProfitCents: accumulatedProfit,
      gamesRemaining: remaining,
      protectionActive: inRecovery || bal > 0,
      desafioBalanceCents: bal,
    },
  };
}

async function previewDesafioSinal(token, body) {
  const userId = requireUserId(token);
  const stepId = await resolveDesafioStepId(body?.stepId || body?.step_id);
  if (!stepId) throw new Error("stepId obrigatório");

  const stepRows = await sb(
    `/rest/v1/desafio_steps?select=*,desafios(id,initial_balance_cents,total_steps,target_profit_pct,title)&id=eq.${encodeURIComponent(stepId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const step = Array.isArray(stepRows) ? stepRows[0] : null;
  if (!step) throw new Error("Etapa não encontrada");
  const desafioId = step.desafio_id || step.desafios?.id;
  const circuit = await getDesafioCircuitForUser(desafioId, userId);
  if (!circuit) throw new Error("Desafio não encontrado");

  const entryNumber = circuit.pending
    ? circuit.entriesPlayed
    : circuit.entriesPlayed + 1;
  const arbiOdd = Number(step.arbi_odd ?? step.home_odd);
  const casaOdd = Number(step.casa_odd ?? step.away_odd);
  let zebraStakeCents = Math.round(
    Number(body?.amountCents ?? body?.amount_cents ?? 0)
  );
  if (!(zebraStakeCents > 0)) {
    zebraStakeCents =
      n(circuit.lastPayoutCents) ||
      n(circuit.retainedCents) ||
      n(step.desafios?.initial_balance_cents) ||
      0;
  }
  const casaStakeCents = calcCasaStakeFromZebra(
    zebraStakeCents,
    arbiOdd,
    casaOdd,
    step.arbi_commission_pct,
    step.casa_commission_pct
  );
  const projectedReturnCents = calcProjectedReturnCents(
    zebraStakeCents,
    casaStakeCents,
    circuit.targetProfitPct
  );

  const prof = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${userId}&limit=1`,
    { token: SERVICE_KEY }
  );
  const bal = n(Array.isArray(prof) ? prof[0]?.desafio_balance_cents : 0);

  return {
    ok: true,
    ciclo: "desafio-ciclo-sinais-v1",
    status: circuit.cycleEndedSuccess
      ? "success_closed"
      : circuit.pending
        ? "pending_entry"
        : circuit.entriesPlayed > 0
          ? "extraction_active"
          : "ready",
    entryNumber: Math.min(entryNumber, circuit.maxEntries),
    maxEntries: circuit.maxEntries,
    lastPayoutCents: circuit.lastPayoutCents,
    retainedCents: circuit.retainedCents,
    desafioBalanceCents: bal,
    fix: "desafio-saldo-reutilizavel-v1",
    sinal: {
      zebraStakeCents,
      casaStakeCents,
      arbiOdd,
      casaOdd,
      projectedReturnCents,
      targetProfitPct: circuit.targetProfitPct,
      zebraTeam: step.arbi_team_name || step.away_team || "Zebra",
      favoriteTeam: step.casa_team_name || step.home_team || "Favorito",
      matchLabel: step.match_label,
      marketZebra: step.market_name_arbishield || step.market_name,
      marketFavorite: step.market_name_casa || step.market_name,
      externalBetLink: step.external_bet_link,
      allocatedAutomatically: false,
      stepId: step.id,
      desafioId,
      title: step.desafios?.title || circuit.desafio?.title,
    },
  };
}

async function listActivePartnerRounds(token) {

  await requireFinanceAdmin(token);
  // profiles-sem-coluna-email-v1 — embed sem email
  const rounds = await sb(
    `/rest/v1/partner_rounds?select=*,profiles(full_name)&status=eq.active&order=created_at.desc&limit=500`,
    { token: SERVICE_KEY }
  ).catch(() =>
    sb(
      `/rest/v1/partner_rounds?select=*&status=eq.active&order=created_at.desc&limit=500`,
      { token: SERVICE_KEY }
    )
  );
  return Array.isArray(rounds) ? rounds : [];
}

async function distributePartnerYield(token, body) {
  await requireFinanceAdmin(token);
  const percentage = Number(body?.percentage ?? body?.pct ?? 0);
  if (!(percentage > 0) || percentage > 100) {
    throw new Error("Informe um percentual válido.");
  }
  const description =
    String(body?.description || "").trim() ||
    `Rendimento ${percentage.toFixed(2)}%`;

  const rounds = await listActivePartnerRounds(token);
  let totalDistributed = 0;
  let count = 0;
  for (const r of rounds) {
    const invested = n(r.invested_amount);
    if (!(invested > 0)) continue;
    const share = Math.round((invested * percentage) / 100);
    if (share <= 0) continue;
    await sb("/rest/v1/partner_distributions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        round_id: r.id,
        user_id: r.user_id,
        partner_id: r.user_id,
        distribution_amount: share,
        contribution_amount: invested,
        description,
      },
    });
    await sb(`/rest/v1/partner_rounds?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        accumulated_amount: n(r.accumulated_amount) + share,
        updated_at: new Date().toISOString(),
      },
    }).catch(() => null);
    try {
      const prof = await sb(
        `/rest/v1/profiles?select=investor_balance_cents&id=eq.${encodeURIComponent(r.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const cur = Array.isArray(prof) ? prof[0] : null;
      if (cur) {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(r.user_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            investor_balance_cents: n(cur.investor_balance_cents) + share,
            updated_at: new Date().toISOString(),
          },
        });
      }
    } catch {
      /* */
    }
    totalDistributed += share;
    count += 1;
  }
  return { success: true, count, totalDistributed, percentage };
}

async function partnerDistributionHistory(token) {
  await requireFinanceAdmin(token);
  const rows = await sb(
    `/rest/v1/partner_distributions?select=*&order=created_at.desc&limit=200`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function partnerMonthlyStats(token) {
  await requireFinanceAdmin(token);
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const rows = await sb(
    `/rest/v1/partner_distributions?select=distribution_amount,contribution_amount,created_at&created_at=gte.${from}&limit=5000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  const totalPaid = list.reduce((a, r) => a + n(r.distribution_amount), 0);
  const investedBase = list.reduce((a, r) => a + n(r.contribution_amount), 0);
  const monthPct =
    investedBase > 0 ? Number(((totalPaid / investedBase) * 100).toFixed(2)) : 0;
  return { monthPct, totalPaid, count: list.length };
}

async function patchProtectionSafe(table, protectionId, body) {
  // VPS: protections pode não ter updated_at — tenta com e sem.
  const withTs = { ...body, updated_at: new Date().toISOString() };
  const withoutTs = { ...body };
  delete withoutTs.updated_at;
  let lastErr = null;
  for (const payload of [withoutTs, withTs]) {
    try {
      await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: payload,
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Falha ao atualizar proteção");
}

async function loadProtectionRow(protectionId, marketType) {
  const isBack = String(marketType || "").toUpperCase() === "BACK";
  const table = isBack ? "back_protections" : "protections";
  const rows = await sb(
    `/rest/v1/${table}?select=*&id=eq.${encodeURIComponent(protectionId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error("Proteção não encontrada");
  return { table, row, isBack };
}

async function restoreMatchLiquidity(matchId, amountCents, marketId) {
  if (!matchId || !(amountCents > 0)) return;
  try {
    const matches = await sb(
      `/rest/v1/matches?select=id,used_protection_cents,markets&id=eq.${encodeURIComponent(matchId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const match = Array.isArray(matches) ? matches[0] : null;
    if (!match) return;
    const used = Math.max(0, n(match.used_protection_cents) - amountCents);
    let markets = Array.isArray(match.markets) ? [...match.markets] : [];
    if (marketId && markets.length) {
      markets = markets.map((m) => {
        if (String(m?.id) !== String(marketId)) return m;
        return {
          ...m,
          used_liquidity: Math.max(0, n(m.used_liquidity) - amountCents),
        };
      });
    }
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        used_protection_cents: used,
        markets,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    /* liquidez best-effort */
  }
}

async function closeProtectionNoRefund(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const marketType = String(body?.marketType || body?.market_category || "LAY");
  const reason = String(body?.reason || "").trim();
  if (!protectionId) throw new Error("protectionId obrigatório");
  if (!reason) throw new Error("Motivo é obrigatório para encerrar sem estornar.");

  const { table, row } = await loadProtectionRow(protectionId, marketType);
  const st = String(row.status || "").toLowerCase();
  if (st === "cancelled" || st === "settled" || st === "closed") {
    throw new Error("Proteção já finalizada");
  }
  const amount = n(row.responsibility_cents || row.amount_cents);
  const adminId = requireUserId(token);

  await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      status: "settled",
      settled_at: new Date().toISOString(),
      result: "closed_no_refund",
      metadata: {
        ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
        close_reason: reason,
        closed_by: adminId,
        closed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
  });

  if (row.user_id) {
    try {
      const prof = await sb(
        `/rest/v1/profiles?select=locked_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const p = Array.isArray(prof) ? prof[0] : null;
      if (p) {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            locked_balance_cents: Math.max(0, n(p.locked_balance_cents) - amount),
            updated_at: new Date().toISOString(),
          },
        });
      }
    } catch {
      /* */
    }
  }

  const marketId =
    row.market_id ||
    (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
    null;
  await restoreMatchLiquidity(row.match_id, amount, marketId);

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: "protection_close_no_refund",
        entity_type: table,
        entity_id: protectionId,
        details: { reason, amount_cents: amount, marketType },
      },
    });
  } catch {
    /* */
  }

  return { ok: true, protectionId, status: "settled" };
}

/**
 * Cancelamento: devolve à carteira de origem.
 * stake_lock → stake + destrava locked
 * fee_upfront histórico → só dedução (sem mexer locked)
 * Nunca credita Saldo Reembolso no cancel.
 */
async function refundProtectionCancelToWallet(row, opts) {
  const protectionId = opts.protectionId;
  const amount = Math.max(0, n(opts.amount));
  const stakeCents = Math.max(0, n(opts.stakeCents));
  const feeCents = Math.max(0, n(opts.feeCents));
  const feeUpfront = !!opts.feeUpfront;
  const stakeLock = !!opts.stakeLock;
  const balanceType = String(opts.balanceType || "REAL").toUpperCase();
  const extraMeta =
    opts.extraMeta && typeof opts.extraMeta === "object" ? opts.extraMeta : {};
  if (!(row?.user_id && amount > 0)) return { refundedCents: 0 };

  const prof = await sb(
    `/rest/v1/profiles?select=balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) throw new Error("Perfil do usuário não encontrado");

  const patchFull = { updated_at: new Date().toISOString() };
  if (balanceType === "DEMO") {
    patchFull.demo_balance_cents = n(p.demo_balance_cents) + amount;
  } else if (balanceType === "INVESTOR") {
    patchFull.investor_balance_cents = n(p.investor_balance_cents) + amount;
  } else {
    patchFull.balance_cents = n(p.balance_cents) + amount;
  }
  if (!(feeUpfront && !stakeLock)) {
    patchFull.locked_balance_cents = Math.max(
      0,
      n(p.locked_balance_cents) - stakeCents
    );
  }
  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: patchFull,
    });
  } catch {
    const slim = { ...patchFull };
    delete slim.updated_at;
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: slim,
    });
  }
  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: row.user_id,
        type: "protection_refund",
        amount_cents: amount,
        ref: protectionId,
        metadata: {
          protection_id: protectionId,
          billing_model: feeUpfront
            ? "fee_upfront_v1"
            : stakeLock
              ? "stake_lock_v1"
              : "legacy_lock",
          refund_kind: feeUpfront && !stakeLock ? "fee" : "stake",
          fee_cents: feeCents,
          stake_cents: stakeCents,
          balance_type: balanceType,
          ...extraMeta,
        },
      },
    });
  } catch {
    /* */
  }
  return { refundedCents: amount };
}

async function cancelProtectionRefund(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const marketType = String(body?.marketType || body?.market_category || "LAY");
  if (!protectionId) throw new Error("protectionId obrigatório");

  const { table, row } = await loadProtectionRow(protectionId, marketType);
  const st = String(row.status || "").toLowerCase();
  // cancelled sem estorno é reparado mais abaixo (não engolir)
  if (st === "settled" || st === "closed") {
    throw new Error("Proteção já encerrada — use estorno manual se necessário");
  }
  const feeUpfront =
    typeof isFeeUpfrontProtection === "function" && isFeeUpfrontProtection(row);
  const stakeLock =
    typeof isStakeLockProtection === "function"
      ? isStakeLockProtection(row)
      : !feeUpfront;
  const feeCents =
    typeof settlementDeductionCents === "function"
      ? settlementDeductionCents(row)
      : 0;
  const stakeCents = n(row.responsibility_cents || row.amount_cents);
  // Guarda cancel-fee-upfront-nao-devolve-stake-v6
  const amount =
    typeof cancelRefundCents === "function"
      ? cancelRefundCents(row)
      : feeUpfront && !stakeLock
        ? feeCents
        : stakeCents;
  const refundFeeOnly =
    !stakeLock &&
    (feeUpfront ||
      (amount === feeCents && feeCents > 0 && feeCents !== stakeCents));
  const balanceType = String(
    (row.metadata &&
      (row.metadata.balance_type ||
        row.metadata.balance_type_requested ||
        row.metadata.balanceType)) ||
      "REAL"
  ).toUpperCase();
  const adminId = requireUserId(token);

  if (await protectionAlreadyCredited(protectionId)) {
    if (st !== "cancelled") {
      await claimProtectionCancelled(table, protectionId, {});
    }
    return {
      ok: true,
      alreadyRefunded: true,
      protectionId,
      status: "cancelled",
      refundedCents: 0,
    };
  }

  // Status cancelled sem TX → reparar estorno (não engolir)
  if (st === "cancelled") {
    await refundProtectionCancelToWallet(row, {
      protectionId,
      amount,
      stakeCents,
      feeCents,
      feeUpfront: refundFeeOnly,
      stakeLock: !refundFeeOnly && stakeLock,
      balanceType,
      extraMeta: {
        marketType,
        cancelled_by_admin: adminId,
        guard: CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
        fix: "cancel-stake-lock-devolve-stake-v6",
        repaired: true,
      },
    });
    return {
      ok: true,
      repaired: true,
      protectionId,
      status: "cancelled",
      refundedCents: amount,
    };
  }

  const claimed = await claimProtectionCancelled(table, protectionId, {});
  if (!claimed) {
    // Outro processo cancelou — tenta reparar se ainda não creditou
    if (!(await protectionAlreadyCredited(protectionId)) && amount > 0) {
      await refundProtectionCancelToWallet(row, {
        protectionId,
        amount,
        stakeCents,
        feeCents,
        feeUpfront: refundFeeOnly,
        stakeLock: !refundFeeOnly && stakeLock,
        balanceType,
        extraMeta: {
          marketType,
          cancelled_by_admin: adminId,
          guard: CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
          fix: "cancel-stake-lock-devolve-stake-v6",
          repaired: true,
        },
      });
      return {
        ok: true,
        repaired: true,
        protectionId,
        status: "cancelled",
        refundedCents: amount,
      };
    }
    return { ok: true, alreadyCancelled: true, protectionId, refundedCents: 0 };
  }

  await refundProtectionCancelToWallet(row, {
    protectionId,
    amount,
    stakeCents,
    feeCents,
    feeUpfront: refundFeeOnly,
    stakeLock: !refundFeeOnly && stakeLock,
    balanceType,
    extraMeta: {
      marketType,
      cancelled_by_admin: adminId,
      guard: CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
      fix: "cancel-stake-lock-devolve-stake-v6",
    },
  });

  const marketId =
    row.market_id ||
    (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
    null;
  await restoreMatchLiquidity(row.match_id, stakeCents, marketId);

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: "protection_cancel_refund",
        entity_type: table,
        entity_id: protectionId,
        details: { amount_cents: amount, marketType },
      },
    });
  } catch {
    /* */
  }

  return { ok: true, protectionId, status: "cancelled", refundedCents: amount };
}

/** Depósitos manuais — aprovar / já creditado / rejeitar (legado SPA) */
async function loadManualDeposit(id) {
  const rows = await sb(
    `/rest/v1/manual_deposits?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error("Depósito não encontrado");
  return row;
}

/** PATCH resiliente: se coluna não existir / schema antigo, tenta campos essenciais */
async function patchManualDepositSafe(id, body) {
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no shim — não dá para rejeitar/aprovar");
  try {
    await sb(`/rest/v1/manual_deposits?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body,
    });
    return;
  } catch (e) {
    console.warn("[deposit] patch full falhou, tentando slim:", e instanceof Error ? e.message : e);
  }
  const slim = { status: body.status };
  if (body.admin_notes != null) slim.admin_notes = body.admin_notes;
  if (body.proof_url != null) slim.proof_url = body.proof_url;
  try {
    await sb(`/rest/v1/manual_deposits?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: slim,
    });
  } catch (e2) {
    console.warn("[deposit] patch slim falhou, só status:", e2 instanceof Error ? e2.message : e2);
    // último recurso: só status
    await sb(`/rest/v1/manual_deposits?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: { status: body.status },
    });
  }
}

async function approveManualDeposit(token, body) {
  await requireFinanceAdmin(token);
  const adminId = requireUserId(token);
  const id = String(body?.id || body?.depositId || "").trim();
  if (!id) throw new Error("id obrigatório");
  const row = await loadManualDeposit(id);
  const st = String(row.status || "").toUpperCase();
  if (st === "APPROVED") return { ok: true, alreadyApproved: true, id };
  if (st === "REJECTED") throw new Error("Depósito já rejeitado");
  if (st !== "PENDING" && st !== "PROCESSING" && st !== "AWAITING_PROOF") {
    throw new Error(`Status inválido para aprovação: ${st}`);
  }
  const amount = n(row.amount_cents);
  if (!(amount > 0)) throw new Error("Valor do depósito inválido");
  const userId = row.user_id;
  if (!userId) throw new Error("Depósito sem usuário");

  const dtype = String(row.deposit_type || "user_balance").toLowerCase();
  const isInvestor = dtype === "investor" || dtype === "provider" || dtype === "partner";
  const isDesafio = dtype === "desafio" || dtype === "challenge";
  const prof = await sb(
    `/rest/v1/profiles?select=balance_cents,investor_balance_cents,desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) throw new Error("Perfil do usuário não encontrado");

  const patch = { updated_at: new Date().toISOString() };
  let creditBucket = "user_balance";
  let txType = "deposit";
  if (isDesafio) {
    patch.desafio_balance_cents = n(p.desafio_balance_cents) + amount;
    creditBucket = "desafio";
    txType = "desafio_deposit";
  } else if (isInvestor) {
    patch.investor_balance_cents = n(p.investor_balance_cents) + amount;
    creditBucket = "investor";
    txType = "provider_deposit";
  } else {
    patch.balance_cents = n(p.balance_cents) + amount;
  }
  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: patch,
    });
  } catch (e) {
    // sem updated_at
    const slim = { ...patch };
    delete slim.updated_at;
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: slim,
    });
  }

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: txType,
        amount_cents: amount,
        metadata: {
          manual_deposit_id: id,
          network: row.network || null,
          deposit_type: row.deposit_type || "user_balance",
          credit_bucket: creditBucket,
        },
      },
    });
  } catch (e) {
    console.warn("[deposit] wallet_transactions:", e.message || e);
  }

  await patchManualDepositSafe(id, {
    status: "APPROVED",
    reviewed_at: new Date().toISOString(),
    reviewed_by: adminId,
    updated_at: new Date().toISOString(),
    admin_notes: row.admin_notes || "Aprovado e creditado",
  });

  // PIX/depósito entrou no caixa da empresa
  const treasury = await adjustPlatformTreasury(amount, {
    adminId,
    action: "TREASURY_DEPOSIT_IN",
    entityType: "manual_deposits",
    entityId: id,
    details: {
      user_id: userId,
      deposit_type: creditBucket,
      amount_cents: amount,
    },
  }).catch((e) => {
    console.warn("[treasury] deposit:", e.message || e);
    return { ok: false, error: String(e.message || e) };
  });

  return {
    ok: true,
    id,
    status: "APPROVED",
    creditedCents: amount,
    depositType: creditBucket,
    treasury,
    fix: "treasury-writers-v1",
  };
}

async function markManualDepositCredited(token, body) {
  await requireFinanceAdmin(token);
  const adminId = requireUserId(token);
  const id = String(body?.id || body?.depositId || "").trim();
  if (!id) throw new Error("id obrigatório");
  const row = await loadManualDeposit(id);
  const st = String(row.status || "").toUpperCase();
  if (st === "APPROVED") return { ok: true, alreadyApproved: true, id };
  if (st === "REJECTED") throw new Error("Depósito já rejeitado");

  await patchManualDepositSafe(id, {
    status: "APPROVED",
    reviewed_at: new Date().toISOString(),
    reviewed_by: adminId,
    updated_at: new Date().toISOString(),
    admin_notes: "Já creditado (sem alterar saldo)",
  });
  return { ok: true, id, status: "APPROVED", creditedCents: 0, markedOnly: true };
}

async function rejectManualDeposit(token, body) {
  await requireFinanceAdmin(token);
  const adminId = requireUserId(token);
  const id = String(body?.id || body?.depositId || "").trim();
  const reason = String(body?.reason || body?.note || "Comprovante inválido").trim();
  if (!id) throw new Error("id obrigatório");
  const row = await loadManualDeposit(id);
  const st = String(row.status || "").toUpperCase();
  if (st === "REJECTED") return { ok: true, alreadyRejected: true, id };
  if (st === "APPROVED") throw new Error("Depósito já aprovado");

  // aceita PENDING / PROCESSING / AWAITING_PROOF (e quaisquer outros não-aprovados)
  await patchManualDepositSafe(id, {
    status: "REJECTED",
    reviewed_at: new Date().toISOString(),
    reviewed_by: adminId,
    updated_at: new Date().toISOString(),
    admin_notes: reason || "Rejeitado",
  });
  return { ok: true, id, status: "REJECTED", reason: reason || "Rejeitado" };
}

/** Garante buckets usados pelo app (service role). */
async function ensureStorageBuckets() {
  if (!SERVICE_KEY) return { ok: false, error: "SERVICE_ROLE_KEY ausente" };
  const buckets = [
    {
      id: "deposit-proofs",
      name: "deposit-proofs",
      public: false,
      file_size_limit: 10485760,
      allowed_mime_types: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/heic",
        "application/pdf",
      ],
    },
    {
      id: "bet-proofs",
      name: "bet-proofs",
      public: false,
      file_size_limit: 10485760,
      allowed_mime_types: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/heic",
        "application/pdf",
      ],
    },
  ];
  const results = [];

  async function createViaStorageApi(b) {
    const existing = await fetch(
      `${SUPABASE_URL}/storage/v1/bucket/${encodeURIComponent(b.id)}`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      }
    );
    if (existing.ok) return { id: b.id, status: "exists", via: "storage-api" };
    const created = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(b),
    });
    const text = await created.text();
    if (created.ok || /already|duplicate|exists/i.test(text)) {
      return { id: b.id, status: "created", via: "storage-api" };
    }
    return { id: b.id, status: "error", via: "storage-api", detail: text.slice(0, 180) };
  }

  /** Fallback: insert direto no schema storage via PostgREST */
  async function createViaRest(b) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/buckets`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
        "Content-Profile": "storage",
        "Accept-Profile": "storage",
      },
      body: JSON.stringify({
        id: b.id,
        name: b.name,
        public: false,
        file_size_limit: b.file_size_limit,
        allowed_mime_types: b.allowed_mime_types,
      }),
    });
    const text = await res.text();
    if (res.ok || res.status === 409 || /duplicate|exists/i.test(text)) {
      return { id: b.id, status: "created", via: "rest-storage" };
    }
    return { id: b.id, status: "error", via: "rest-storage", detail: text.slice(0, 180) };
  }

  for (const b of buckets) {
    try {
      let r = await createViaStorageApi(b);
      if (r.status === "error") {
        const r2 = await createViaRest(b);
        if (r2.status !== "error") r = r2;
        else r = { ...r, detail: `${r.detail || ""} | ${r2.detail || ""}` };
      }
      results.push(r);
    } catch (e) {
      results.push({
        id: b.id,
        status: "error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { ok: results.every((r) => r.status !== "error"), results };
}

/**
 * Upload comprovante via service role (contorna bucket ausente no client).
 * body: { depositId?, fileName, contentType, base64, amountCents?, network?, depositType? }
 */
async function uploadDepositProof(token, body) {
  const userId = requireUserId(token);
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente");
  const ensured = await ensureStorageBuckets();
  const depositBucket = (ensured.results || []).find((r) => r.id === "deposit-proofs");
  if (depositBucket && depositBucket.status === "error") {
    throw new Error(
      `Não foi possível criar o bucket deposit-proofs: ${depositBucket.detail || "erro"}. Rode vps-fix-deposito-agora.sh na VPS.`
    );
  }

  const base64 = String(body?.base64 || body?.data || "").replace(
    /^data:[^;]+;base64,/,
    ""
  );
  if (!base64) throw new Error("Arquivo (base64) obrigatório");
  if (base64.length > 14e6) throw new Error("Arquivo muito grande (máx. ~10MB)");

  const fileName = String(body?.fileName || body?.name || "comprovante.jpg");
  const ext = (fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const contentType =
    String(body?.contentType || body?.mime || "image/jpeg").trim() ||
    "image/jpeg";
  const objectPath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const bin = Buffer.from(base64, "base64");
  if (!(bin.length > 0)) throw new Error("Arquivo vazio");
  if (bin.length > 10485760) throw new Error("Arquivo maior que 10MB");

  const up = await fetch(
    `${SUPABASE_URL}/storage/v1/object/deposit-proofs/${objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: bin,
    }
  );
  if (!up.ok) {
    const t = await up.text();
    throw new Error(`Falha no upload Storage: ${t.slice(0, 200)}`);
  }

  // URL assinada para o ADM abrir sem depender do client storage
  let signedUrl = null;
  try {
    const signed = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/deposit-proofs/${objectPath}`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 }),
      }
    );
    const sj = await signed.json().catch(() => ({}));
    if (sj?.signedURL) {
      signedUrl = String(sj.signedURL).startsWith("http")
        ? sj.signedURL
        : `${SUPABASE_URL}/storage/v1${sj.signedURL}`;
    } else if (sj?.data?.signedUrl) {
      signedUrl = sj.data.signedUrl;
    }
  } catch {
    /* */
  }

  let depositId = String(body?.depositId || body?.id || "").trim();
  const amountCents = Math.floor(Number(body?.amountCents || 0));
  const network = String(body?.network || "PIX").trim() || "PIX";
  const depositType = String(body?.depositType || "user_balance").trim() || "user_balance";
  // Guarda path (legado) e, se possível, URL assinada em admin_notes/meta
  const proofStore = objectPath;

  if (depositId) {
    await sb(`/rest/v1/manual_deposits?id=eq.${encodeURIComponent(depositId)}&user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        proof_url: proofStore,
        status: "PENDING",
        updated_at: new Date().toISOString(),
        admin_notes: signedUrl ? `proof_signed:${signedUrl}` : undefined,
      },
    });
  } else {
    if (!(amountCents > 0)) throw new Error("amountCents obrigatório sem depositId");
    const inserted = await sb("/rest/v1/manual_deposits", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        amount_cents: amountCents,
        network,
        proof_url: proofStore,
        status: "PENDING",
        deposit_type: depositType,
        admin_notes: signedUrl ? `proof_signed:${signedUrl}` : null,
      },
    });
    depositId = Array.isArray(inserted) && inserted[0]?.id ? inserted[0].id : null;
  }

  return {
    ok: true,
    path: objectPath,
    signedUrl,
    depositId,
    status: "PENDING",
    label: "Comprovante enviado",
  };
}

/** ADM: URL assinada do comprovante (service role) */
async function getDepositProofSignedUrl(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente");
  const id = String(body?.id || body?.depositId || "").trim();
  const pathIn = String(body?.path || body?.proof_url || "").trim();
  let path = pathIn;
  if (id && !path) {
    const row = await loadManualDeposit(id);
    path = String(row.proof_url || "").trim();
    // fallback notes
    if (!path && row.admin_notes && String(row.admin_notes).startsWith("proof_signed:")) {
      return { ok: true, url: String(row.admin_notes).slice("proof_signed:".length) };
    }
  }
  if (!path) throw new Error("Comprovante não encontrado");
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) {
    return { ok: true, url: path };
  }
  // remove bucket prefix se veio completo
  path = path.replace(/^deposit-proofs\//, "");
  const signed = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/deposit-proofs/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    }
  );
  const sj = await signed.json().catch(() => ({}));
  let url = sj?.signedURL || sj?.data?.signedUrl || null;
  if (!url) throw new Error("Falha ao assinar comprovante (bucket ausente?)");
  if (!String(url).startsWith("http")) {
    url = `${SUPABASE_URL}/storage/v1${url}`;
  }
  return { ok: true, url, path };
}

/** Contestações — janela: até 5 min antes do kickoff */
const CONTESTATION_LOCK_MS = 5 * 60 * 1000;

function calcLayContest(amountCents, odd, lockRatio = 0.9073) {
  const responsibilityCents =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const ratio =
    Number.isFinite(lockRatio) && lockRatio >= 0 && lockRatio <= 1
      ? lockRatio
      : 0.9073;
  const stakeRealCents = Math.round(responsibilityCents / (o - 1));
  const lockedDeductionCents = Math.round(stakeRealCents * ratio);
  // lay-lucro-back-equiv-v9: lucro = resp/(odd−1) (= stakeReal)
  const exchangeProfitGrossCents = stakeRealCents;
  const exchangeFeeCents = Math.round(exchangeProfitGrossCents * 0.045);
  const exchangeProfitNetCents = exchangeProfitGrossCents - exchangeFeeCents;
  const userProfitCents = Math.round(responsibilityCents * 0.015);
  const arbiShieldDeductionCents = Math.max(
    0,
    exchangeProfitGrossCents - exchangeFeeCents - userProfitCents
  );
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

function calcBackContest(amountCents, odd) {
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

function getContestMeta(row, isBack) {
  if (isBack) {
    const calc =
      row.calculations && typeof row.calculations === "object"
        ? row.calculations
        : row.metadata && typeof row.metadata === "object"
          ? row.metadata
          : {};
    return (
      (calc && calc.contestation) ||
      (row.metadata && row.metadata.contestation) ||
      null
    );
  }
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return meta.contestation || null;
}

function contestationWindowOk(startsAt) {
  if (!startsAt) return true;
  const t = new Date(startsAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() <= t - CONTESTATION_LOCK_MS;
}

async function loadMatchStartsAt(matchId) {
  if (!matchId) return null;
  const rows = await sb(
    `/rest/v1/matches?select=id,starts_at,home_team,away_team,league&id=eq.${encodeURIComponent(matchId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function notifyUser(userId, title, message, meta = {}) {
  if (!userId) return;
  try {
    await sb("/rest/v1/notifications", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        title,
        message,
        body: message,
        type: meta.type || "contestation",
        meta,
        read: false,
        created_at: new Date().toISOString(),
      },
    });
  } catch {
    /* tabela pode não existir / schema diferente */
  }
}

async function upsertOddContestationRow(payload) {
  try {
    await sb("/rest/v1/odd_contestations", {
      method: "POST",
      token: SERVICE_KEY,
      body: payload,
    });
  } catch (err) {
    console.warn(
      "[serverfn-shim] odd_contestations insert:",
      err instanceof Error ? err.message : err
    );
  }
}

async function patchOddContestationForProtection(protectionId, patch) {
  try {
    await sb(
      `/rest/v1/odd_contestations?protection_id=eq.${encodeURIComponent(protectionId)}&status=eq.pending`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: { ...patch, updated_at: new Date().toISOString() },
      }
    );
  } catch {
    /* */
  }
}

async function listContestationsAdmin(token) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");

  const [lay, back] = await Promise.all([
    sb(
      `/rest/v1/protections?select=*&status=eq.review_odd&order=created_at.desc&limit=300`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/back_protections?select=*&status=eq.review_odd&order=created_at.desc&limit=300`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);

  const rows = [
    ...(Array.isArray(lay) ? lay : []).map((r) => ({
      ...r,
      market_category: "LAY",
    })),
    ...(Array.isArray(back) ? back : []).map((r) => ({
      ...r,
      market_category: "BACK",
    })),
  ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))];
  const protectionIds = rows.map((r) => r.id).filter(Boolean);

  const [profiles, matches, contests] = await Promise.all([
    userIds.length
      ? sb(
          `/rest/v1/profiles?select=id,full_name&id=in.(${userIds.map(encodeURIComponent).join(",")})`,
          { token: SERVICE_KEY }
        ).catch(() => [])
      : [],
    matchIds.length
      ? sb(
          `/rest/v1/matches?select=id,home_team,away_team,league,starts_at&id=in.(${matchIds.map(encodeURIComponent).join(",")})`,
          { token: SERVICE_KEY }
        ).catch(() => [])
      : [],
    protectionIds.length
      ? sb(
          `/rest/v1/odd_contestations?select=*&protection_id=in.(${protectionIds.map(encodeURIComponent).join(",")})&order=created_at.desc`,
          { token: SERVICE_KEY }
        ).catch(() => [])
      : [],
  ]);

  const profileMap = new Map(
    (Array.isArray(profiles) ? profiles : []).map((p) => [p.id, p])
  );
  const matchMap = new Map(
    (Array.isArray(matches) ? matches : []).map((m) => [m.id, m])
  );
  const contestByProtection = new Map();
  for (const c of Array.isArray(contests) ? contests : []) {
    if (!c?.protection_id) continue;
    if (!contestByProtection.has(c.protection_id)) {
      contestByProtection.set(c.protection_id, c);
    }
  }

  return rows
    .map((r) => {
    const isBack = String(r.market_category).toUpperCase() === "BACK";
    const metaContest = getContestMeta(r, isBack) || {};
    const rowContest = contestByProtection.get(r.id) || null;
    const contestType =
      metaContest.type ||
      metaContest.contest_type ||
      rowContest?.contest_type ||
      (metaContest.requested_odd != null || rowContest?.requested_odd != null
        ? "odd_adjustment"
        : "odd_adjustment");
    return {
      ...r,
      profiles: profileMap.get(r.user_id) || { full_name: "Usuário" },
      matches: matchMap.get(r.match_id) || null,
      odd_contestation: rowContest,
      contestation: {
        type: contestType === "cancellation" ? "cancellation" : "odd_adjustment",
        requested_odd:
          metaContest.requested_odd ?? rowContest?.requested_odd ?? null,
        original_odd:
          metaContest.original_odd ??
          rowContest?.original_odd ??
          Number(r.odd),
        proof_url:
          metaContest.proof_url ??
          rowContest?.proof_url ??
          metaContest.bet_proof_url ??
          null,
        reason: metaContest.reason ?? rowContest?.reason ?? null,
        requested_at:
          metaContest.requested_at ??
          rowContest?.created_at ??
          r.updated_at ??
          r.created_at,
      },
    };
  })
    .filter((r) => r.contestation.type !== "cancellation");
}

async function countPendingContestations(token) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const [lay, back] = await Promise.all([
    sb(
      `/rest/v1/protections?select=id&status=eq.review_odd`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/back_protections?select=id&status=eq.review_odd`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);
  return {
    pending:
      (Array.isArray(lay) ? lay.length : 0) +
      (Array.isArray(back) ? back.length : 0),
  };
}

async function submitContestation(token, body) {
  const userId = requireUserId(token);
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const category = String(
    body?.category || body?.marketType || body?.market_category || "LAY"
  ).toUpperCase();
  const contestTypeRaw = String(
    body?.contestType || body?.type || "odd_adjustment"
  ).toLowerCase();
  const contestType =
    contestTypeRaw === "cancellation" ||
    contestTypeRaw === "cancel" ||
    contestTypeRaw === "cancelamento"
      ? "cancellation"
      : "odd_adjustment";

  if (!protectionId) throw new Error("protectionId obrigatório");

  const { table, row, isBack } = await loadProtectionRow(protectionId, category);
  if (String(row.user_id) !== String(userId)) {
    throw new Error("Proteção não pertence a este usuário");
  }
  const st = String(row.status || "").toLowerCase();
  if (st === "cancelled") {
    return { ok: true, alreadyCancelled: true, status: "cancelled", protectionId };
  }
  // review_odd de cancelamento antigo → estorna agora; odd_adjustment → já existe
  if (st === "review_odd" && contestType !== "cancellation") {
    return { ok: true, alreadyExists: true };
  }
  if (st !== "active" && st !== "pending" && !(st === "review_odd" && contestType === "cancellation")) {
    throw new Error("Só é possível contestar proteções ativas");
  }

  // Cancelamento = automático (legado Cancelar Ancoragem). Não entra na fila ADM.
  if (contestType === "cancellation") {
    let reason = String(body?.reason || body?.note || "").trim();
    if (reason.length < 5) {
      reason = "Cancelamento solicitado pelo cliente";
    }
    const matchCancel = await loadMatchStartsAt(row.match_id);
    if (!contestationWindowOk(matchCancel?.starts_at)) {
      throw new Error(
        "Cancelamento bloqueado: faltam menos de 5 minutos para o início da partida (ou o jogo já começou)."
      );
    }
    const feeUpfront =
      typeof isFeeUpfrontProtection === "function" && isFeeUpfrontProtection(row);
    const stakeLock =
      typeof isStakeLockProtection === "function"
        ? isStakeLockProtection(row)
        : !feeUpfront;
    const feeCents =
      typeof settlementDeductionCents === "function"
        ? settlementDeductionCents(row)
        : 0;
    const stakeCents = n(row.responsibility_cents || row.amount_cents);
    // Guarda cancel-fee-upfront-nao-devolve-stake-v6
    const amount =
      typeof cancelRefundCents === "function"
        ? cancelRefundCents(row)
        : feeUpfront && !stakeLock
          ? feeCents
          : stakeCents;
    const refundFeeOnly =
      feeUpfront ||
      (amount === feeCents && feeCents > 0 && feeCents !== stakeCents);
    const balanceType = String(
      (row.metadata &&
        (row.metadata.balance_type ||
          row.metadata.balance_type_requested ||
          row.metadata.balanceType)) ||
        "REAL"
    ).toUpperCase();
    if (st === "cancelled") {
      return { ok: true, alreadyCancelled: true, status: "cancelled", protectionId };
    }
    if (await protectionAlreadyCredited(protectionId)) {
      await claimProtectionCancelled(table, protectionId, {});
      return {
        ok: true,
        alreadyRefunded: true,
        action: "cancellation",
        auto: true,
        protectionId,
        status: "cancelled",
        refundedCents: 0,
      };
    }
    const prevMeta =
      row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
    prevMeta.auto_cancel = {
      reason,
      cancelled_at: new Date().toISOString(),
      cancelled_by: userId,
      auto: true,
      refund_kind: refundFeeOnly ? "fee" : "stake",
      refund_cents: amount,
      guard: CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
    };
    // Claim ANTES do crédito — impede F5 / race re-creditar
    const claimed = await claimProtectionCancelled(table, protectionId, {
      metadata: prevMeta,
    });
    if (!claimed) {
      return {
        ok: true,
        alreadyCancelled: true,
        action: "cancellation",
        auto: true,
        protectionId,
        status: "cancelled",
        refundedCents: 0,
      };
    }
    await refundProtectionCancelToWallet(row, {
      protectionId,
      amount,
      stakeCents,
      feeCents,
      feeUpfront: refundFeeOnly,
      stakeLock: !refundFeeOnly && stakeLock,
      balanceType,
      extraMeta: {
        auto_cancel: true,
        cancelled_by: userId,
        guard: CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
      },
    });
    const marketId =
      row.market_id ||
      (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
      null;
    await restoreMatchLiquidity(row.match_id, stakeCents, marketId);
    return {
      ok: true,
      action: "cancellation",
      auto: true,
      protectionId,
      status: "cancelled",
      refundedCents: amount,
    };
  }

  const match = await loadMatchStartsAt(row.match_id);
  if (!contestationWindowOk(match?.starts_at)) {
    throw new Error(
      "Contestação bloqueada: faltam menos de 5 minutos para o início da partida (ou o jogo já começou)."
    );
  }

  const originalOdd = Number(row.odd);
  let requestedOdd = null;
  let proofUrl = String(
    body?.proofUrl || body?.betProofUrl || body?.proof_url || ""
  ).trim();
  let reasonOdd = String(body?.reason || body?.note || "").trim();

  requestedOdd = Number(
    String(body?.newOdd ?? body?.requestedOdd ?? body?.approvedOdd ?? "")
      .replace(",", ".")
  );
  if (!(requestedOdd > 1)) throw new Error("Informe uma odd válida (> 1)");
  if (!proofUrl) {
    throw new Error("Anexe o print do comprovante da casa de aposta");
  }

  const contestation = {
    type: "odd_adjustment",
    original_odd: originalOdd,
    requested_odd: requestedOdd,
    proof_url: proofUrl || null,
    reason: reasonOdd || null,
    requested_at: new Date().toISOString(),
    requested_by: userId,
  };

  const patch = {
    status: "review_odd",
    updated_at: new Date().toISOString(),
  };

  if (isBack) {
    const prevMeta =
      row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
    const prevCalc =
      row.calculations && typeof row.calculations === "object"
        ? { ...row.calculations }
        : prevMeta.calculations && typeof prevMeta.calculations === "object"
          ? { ...prevMeta.calculations }
          : {};
    prevCalc.contestation = contestation;
    prevMeta.contestation = contestation;
    prevMeta.calculations = prevCalc;
    patch.metadata = prevMeta;
    if (row.calculations != null || prevCalc) {
      patch.calculations = prevCalc;
    }
  } else {
    const prevMeta =
      row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
    prevMeta.contestation = contestation;
    patch.metadata = prevMeta;
  }

  await patchProtectionSafe(table, protectionId, patch);

  await upsertOddContestationRow({
    user_id: userId,
    protection_id: protectionId,
    status: "pending",
    contest_type: "odd_adjustment",
    original_odd: originalOdd,
    requested_odd: requestedOdd,
    proof_url: proofUrl || null,
    reason: reasonOdd || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return {
    ok: true,
    alreadyExists: false,
    status: "review_odd",
    contestType: "odd_adjustment",
    label: "Em Contestação (Pendente)",
  };
}

async function submitOperatorContestation(token, body) {
  // SPA operator path: proof + note (pode não trazer odd nova)
  const proofUrl = String(body?.betProofUrl || body?.proofUrl || "").trim();
  const note = String(body?.note || body?.reason || "").trim();
  if (!proofUrl) throw new Error("Comprovante obrigatório");
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const category = String(
    body?.category || body?.marketType || body?.market_category || "LAY"
  ).toUpperCase();
  let newOdd = body?.newOdd ?? body?.requestedOdd ?? null;
  if (newOdd == null && protectionId) {
    const { row } = await loadProtectionRow(protectionId, category);
    newOdd = Number(row.odd);
  }
  return submitContestation(token, {
    ...body,
    contestType: "odd_adjustment",
    proofUrl,
    reason: note || "Divergência reportada pelo operador",
    newOdd,
  });
}

async function approveContestation(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const adminId = requireUserId(token);
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const category = String(
    body?.category || body?.marketType || body?.market_category || "LAY"
  ).toUpperCase();
  if (!protectionId) throw new Error("protectionId obrigatório");

  const { table, row, isBack } = await loadProtectionRow(protectionId, category);
  const st = String(row.status || "").toLowerCase();
  if (st !== "review_odd") {
    throw new Error("Esta proteção não está em contestação");
  }

  const metaContest = getContestMeta(row, isBack) || {};
  const contestType =
    metaContest.type === "cancellation" ? "cancellation" : "odd_adjustment";

  if (contestType === "cancellation") {
    // Reaproveita estorno integral
    const result = await cancelProtectionRefund(token, {
      protectionId,
      marketType: category,
    });
    await patchOddContestationForProtection(protectionId, {
      status: "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: adminId,
    });
    await notifyUser(
      row.user_id,
      "Contestação aprovada",
      "Sua solicitação de cancelamento foi aprovada e o saldo foi estornado.",
      { type: "contestation_approved", protection_id: protectionId }
    );
    return { ok: true, action: "cancellation", ...result };
  }

  const approvedOdd = Number(
    String(body?.approvedOdd ?? metaContest.requested_odd ?? "").replace(",", ".")
  );
  if (!(approvedOdd > 1)) throw new Error("Odd aprovada inválida");

  const amount = n(row.responsibility_cents || row.amount_cents);
  let patch = {
    status: "active",
    odd: approvedOdd,
    updated_at: new Date().toISOString(),
  };

  if (isBack) {
    const c = calcBackContest(amount, approvedOdd);
    const prevMeta =
      row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
    const prevCalc =
      row.calculations && typeof row.calculations === "object"
        ? { ...row.calculations }
        : {};
    prevCalc.contestation = {
      ...metaContest,
      approved_odd: approvedOdd,
      approved_at: new Date().toISOString(),
      approved_by: adminId,
      contestation_approved: true,
    };
    prevMeta.contestation = prevCalc.contestation;
    prevMeta.market_odd = approvedOdd;
    prevMeta.market_type = "BACK";
    prevMeta.calculations = { ...prevCalc, ...c, marketOdd: approvedOdd };
    patch = {
      ...patch,
      amount_cents: c.coverageCents,
      user_profit_cents: c.userProfitCents,
      platform_deduction_cents: c.arbiShieldDeductionCents,
      metadata: prevMeta,
      calculations: prevMeta.calculations,
    };
  } else {
    const c = calcLayContest(amount, approvedOdd);
    const prevMeta =
      row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
    prevMeta.contestation = {
      ...metaContest,
      approved_odd: approvedOdd,
      approved_at: new Date().toISOString(),
      approved_by: adminId,
      contestation_approved: true,
    };
    prevMeta.market_odd = approvedOdd;
    prevMeta.market_type = "LAY";
    prevMeta.calculations = {
      ...(prevMeta.calculations || {}),
      ...c,
      marketOdd: approvedOdd,
      contestation: prevMeta.contestation,
    };
    patch = {
      ...patch,
      amount_cents: c.responsibilityCents,
      responsibility_cents: c.responsibilityCents,
      user_profit_cents: c.userProfitCents,
      platform_deduction_cents: c.arbiShieldDeductionCents,
      platform_profit_cents: c.arbiShieldDeductionCents,
      locked_deduction_cents: c.lockedDeductionCents,
      exchange_fee_cents: c.exchangeFeeCents,
      exchange_profit_net_cents: c.exchangeProfitNetCents,
      metadata: prevMeta,
    };
  }

  await patchProtectionSafe(table, protectionId, patch);

  await patchOddContestationForProtection(protectionId, {
    status: "approved",
    approved_odd: approvedOdd,
    resolved_at: new Date().toISOString(),
    resolved_by: adminId,
  });

  await notifyUser(
    row.user_id,
    "Contestação aprovada",
    `Ajuste de odd aprovado. Nova odd: ${approvedOdd.toFixed(2)}. Cálculos recalculados.`,
    {
      type: "contestation_approved",
      protection_id: protectionId,
      approved_odd: approvedOdd,
    }
  );

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: "contestation_approve_odd",
        entity_type: table,
        entity_id: protectionId,
        details: {
          approved_odd: approvedOdd,
          original_odd: metaContest.original_odd ?? row.odd,
        },
      },
    });
  } catch {
    /* */
  }

  return {
    ok: true,
    action: "odd_adjustment",
    protectionId,
    approvedOdd,
    status: "active",
  };
}

async function rejectContestation(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const adminId = requireUserId(token);
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const category = String(
    body?.category || body?.marketType || body?.market_category || "LAY"
  ).toUpperCase();
  const reason = String(
    body?.reason || body?.note || "Odd validada como correta pelo sistema."
  ).trim();
  if (!protectionId) throw new Error("protectionId obrigatório");

  const { table, row, isBack } = await loadProtectionRow(protectionId, category);
  const st = String(row.status || "").toLowerCase();
  if (st !== "review_odd") {
    throw new Error("Esta proteção não está em contestação");
  }

  const metaContest = getContestMeta(row, isBack) || {};
  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  const rejectedMeta = {
    ...metaContest,
    rejected_at: new Date().toISOString(),
    rejected_by: adminId,
    reject_reason: reason,
  };
  prevMeta.contestation = rejectedMeta;

  const patch = {
    status: "active",
    metadata: prevMeta,
    updated_at: new Date().toISOString(),
  };

  if (isBack) {
    const prevCalc =
      row.calculations && typeof row.calculations === "object"
        ? { ...row.calculations }
        : {};
    prevCalc.contestation = rejectedMeta;
    patch.calculations = prevCalc;
    prevMeta.calculations = prevCalc;
    patch.metadata = prevMeta;
  }

  await patchProtectionSafe(table, protectionId, patch);

  await patchOddContestationForProtection(protectionId, {
    status: "rejected",
    resolved_at: new Date().toISOString(),
    resolved_by: adminId,
    reject_reason: reason,
  });

  await notifyUser(
    row.user_id,
    "Contestação rejeitada",
    reason || "Sua contestação foi analisada e mantida com os valores originais.",
    { type: "contestation_rejected", protection_id: protectionId }
  );

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: "contestation_reject",
        entity_type: table,
        entity_id: protectionId,
        details: { reason },
      },
    });
  } catch {
    /* */
  }

  return { ok: true, protectionId, status: "active", rejected: true };
}


function openProtectionStatuses() {
  return ["active", "pending", "review_odd"];
}

function isOpenProtectionStatus(st) {
  return openProtectionStatuses().includes(String(st || "").toLowerCase());
}

// Regras de settle/fee: scripts/lib/protection-flow-contract.mjs (TRAVADO)

async function protectionAlreadyCredited(protectionId) {
  if (!protectionId) return false;
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(protectionId)}&type=in.(protection_settlement,protection_release,protection_refund)&select=id&limit=1`,
      { token: SERVICE_KEY }
    );
    if (Array.isArray(rows) && rows.length > 0) return true;
  } catch {
    /* */
  }
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?type=eq.protection_refund&select=id,metadata&order=created_at.desc&limit=200`,
      { token: SERVICE_KEY }
    );
    return (Array.isArray(rows) ? rows : []).some(
      (t) =>
        t?.metadata &&
        String(t.metadata.protection_id || "") === String(protectionId)
    );
  } catch {
    return false;
  }
}

/**
 * Claim atômico cancelled — impede re-crédito em F5 / listagens.
 * Restaurado (apagado acidentalmente no hotfix de comissão 4,5%).
 * Marker: cancel-stake-lock-devolve-stake-v6
 */
async function claimProtectionCancelled(table, protectionId, extraBody = {}) {
  const body = {
    status: "cancelled",
    settled_at: new Date().toISOString(),
    result: "cancelled_refund",
    ...extraBody,
  };
  delete body.updated_at;
  try {
    const claimed = await sb(
      `/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}&status=in.(active,pending,review_odd)`,
      { method: "PATCH", token: SERVICE_KEY, body }
    );
    return Array.isArray(claimed) && claimed.length > 0;
  } catch {
    try {
      const claimed = await sb(
        `/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}&status=in.(active,pending,review_odd)`,
        {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            status: "cancelled",
            settled_at: new Date().toISOString(),
          },
        }
      );
      return Array.isArray(claimed) && claimed.length > 0;
    } catch {
      return false;
    }
  }
}

async function loadExchangeSettlementPrior(protectionId) {
  const empty = {
    feeCharged: 0,
    feeShortfall: 0,
    unlocked: false,
    stakeReturned: false,
    hasTx: false,
    commissionCharged: 0,
  };
  if (!protectionId) return empty;
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(protectionId)}&type=in.(protection_settlement,exchange_commission)&select=id,type,amount_cents,metadata&order=created_at.desc&limit=40`,
      { token: SERVICE_KEY }
    );
    const list = Array.isArray(rows) ? rows : [];
    let feeCharged = 0;
    let feeShortfall = 0;
    let unlocked = false;
    let stakeReturned = false;
    let hasTx = false;
    let commissionCharged = 0;
    for (const t of list) {
      const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
      if (String(t.type || "") === "exchange_commission") {
        commissionCharged += Math.abs(n(t.amount_cents));
        hasTx = true;
        continue;
      }
      if (meta.outcome && String(meta.outcome).toLowerCase() !== "exchange") continue;
      hasTx = true;
      feeCharged += Math.max(0, n(meta.fee_charged_cents));
      if (!(n(meta.fee_charged_cents) > 0) && n(t.amount_cents) < 0) {
        feeCharged += Math.abs(n(t.amount_cents));
      }
      feeShortfall = Math.max(feeShortfall, n(meta.fee_shortfall_cents));
      if (meta.unlocked_locked === true) unlocked = true;
      if (
        meta.stake_returned === true ||
        meta.returned_stake_cents > 0 ||
        meta.unlock_return_to_origin === true
      ) {
        stakeReturned = true;
      }
      commissionCharged += Math.max(0, n(meta.exchange_commission_charged_cents));
    }
    return { feeCharged, feeShortfall, unlocked, stakeReturned, hasTx, commissionCharged };
  } catch {
    return empty;
  }
}

async function creditWalletForSettlement(row, outcome, now) {
  // Marker: settle-exchange-cobra-deducao-v6 · settle-exchange-nunca-reembolso-v1
  const amount = n(row.responsibility_cents || row.amount_cents);
  const parts = settlementCreditParts(row, outcome);
  const outcomeNorm = normalizeSettleOutcome
    ? normalizeSettleOutcome(outcome)
    : String(outcome || "").toLowerCase();
  const wonArbi = outcomeNorm === "arbishield";
  const isVoid =
    outcomeNorm === "void" ||
    (isVoidSettleOutcome && isVoidSettleOutcome(outcome));
  const feeUpfront = isFeeUpfrontProtection(row);
  let credit = parts.total;
  if (!wonArbi && !isVoid && credit > 0) {
    console.warn(
      "[settle] BLOQUEADO crédito Exchange→Reembolso — forçando 0",
      row.id,
      credit
    );
    credit = 0;
  }
  const balanceType = String(
    (row.metadata &&
      (row.metadata.balance_type ||
        row.metadata.balance_type_requested ||
        row.metadata.balanceType)) ||
      "REAL"
  ).toUpperCase();
  if (!row.user_id) {
    if (!wonArbi && !isVoid) {
      throw new Error(
        `Exchange settle sem user_id (proteção ${row.id}) — não marca won_exchange`
      );
    }
    return { refunded: 0, credited: 0, skipped: true };
  }
  if ((wonArbi || isVoid) && amount <= 0 && credit <= 0) {
    return { refunded: 0, credited: 0, skipped: true };
  }
  if ((wonArbi || isVoid) && (await protectionAlreadyCredited(row.id))) {
    return { refunded: 0, credited: 0, alreadyCredited: true };
  }

  // Ganhou na Exchange: R$ 0 Reembolso; stake_lock DEVOLVE stake; cobra SÓ dedução.
  // Guarda: settle-exchange-cobra-so-deducao-v9 · settle-exchange-sem-comissao-extra-v9
  if (!wonArbi && !isVoid) {
    const fee =
      (typeof settlementDeductionCents === "function"
        ? settlementDeductionCents(row)
        : 0) ||
      parts.fee ||
      0;
    // v9: comissão informativa existe, mas carteira SEMPRE 0
    let commission =
      typeof settlementExchangeCommissionWalletCents === "function"
        ? settlementExchangeCommissionWalletCents(row)
        : 0;
    if (commission > 0) {
      console.warn(
        "[settle] BLOQUEADO débito de comissão Exchange na carteira — forçando 0",
        row.id,
        commission
      );
      commission = 0;
    }
    const stakeLock =
      typeof isStakeLockProtection === "function"
        ? isStakeLockProtection(row)
        : !feeUpfront;
    const needsUnlock = (stakeLock || !feeUpfront) && amount > 0;
    const needsReturn = stakeLock && !feeUpfront && amount > 0;
    const prior = await loadExchangeSettlementPrior(row.id);
    const completeFn =
      typeof isExchangeWalletComplete === "function"
        ? isExchangeWalletComplete
        : () => false;
    if (
      prior.hasTx &&
      completeFn({
        feeUpfront,
        feeExpected: fee,
        feeCharged: prior.feeCharged,
        feeShortfall: prior.feeShortfall,
        unlocked: prior.unlocked || !needsUnlock,
        needsUnlock,
        stakeReturned: prior.stakeReturned || !needsReturn,
        needsReturn,
      }) &&
      (prior.commissionCharged || 0) >= commission
    ) {
      return {
        refunded: 0,
        credited: 0,
        alreadyCredited: true,
        exchangeNoCredit: true,
        feeChargedCents: prior.feeCharged,
        feeShortfallCents: prior.feeShortfall,
        exchangeCommissionChargedCents: prior.commissionCharged,
        unlocked: prior.unlocked,
        stakeReturned: prior.stakeReturned,
      };
    }

    let unlocked = prior.unlocked;
    let stakeReturned = !!prior.stakeReturned;
    let feeCharged = prior.feeCharged;
    let feeShortfall = prior.feeShortfall;
    const feeStillDue = Math.max(0, fee - feeCharged - feeShortfall);

    let prof = await sb(
      `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents,deduction_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
      { token: SERVICE_KEY }
    ).catch(() => null);
    if (!Array.isArray(prof) || !prof[0]) {
      prof = await sb(
        `/rest/v1/profiles?select=locked_balance_cents,balance_cents,reusable_balance_cents,demo_balance_cents,investor_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
    }
    const p = Array.isArray(prof) ? prof[0] : null;
    if (!p) {
      throw new Error(
        `Perfil ${row.user_id} não encontrado para settle Exchange (cobrar dedução)`
      );
    }

    const patch = { updated_at: now };
    if (needsUnlock && !unlocked) {
      patch.locked_balance_cents = Math.max(0, n(p.locked_balance_cents) - amount);
      unlocked = true;
    }
    if (needsReturn && !stakeReturned) {
      if (balanceType === "DEMO") {
        const base =
          patch.demo_balance_cents != null ? n(patch.demo_balance_cents) : n(p.demo_balance_cents);
        patch.demo_balance_cents = base + amount;
      } else if (balanceType === "INVESTOR") {
        const base =
          patch.investor_balance_cents != null
            ? n(patch.investor_balance_cents)
            : n(p.investor_balance_cents);
        patch.investor_balance_cents = base + amount;
      } else {
        const base =
          patch.balance_cents != null
            ? n(patch.balance_cents)
            : n(p.balance_cents) + n(p.reusable_balance_cents);
        patch.reusable_balance_cents = 0;
        patch.balance_cents = base + amount;
      }
      stakeReturned = true;
    }

    let chargedNow = 0;
    if (stakeLock && !feeUpfront && feeStillDue > 0) {
      let left = feeStillDue;
      if (balanceType === "DEMO") {
        const cur =
          patch.demo_balance_cents != null ? n(patch.demo_balance_cents) : n(p.demo_balance_cents);
        const take = Math.min(cur, left);
        patch.demo_balance_cents = cur - take;
        chargedNow = take;
        left -= take;
      } else if (balanceType === "INVESTOR") {
        const cur =
          patch.investor_balance_cents != null
            ? n(patch.investor_balance_cents)
            : n(p.investor_balance_cents);
        const take = Math.min(cur, left);
        patch.investor_balance_cents = cur - take;
        chargedNow = take;
        left -= take;
      } else {
        let bal =
          patch.balance_cents != null
            ? n(patch.balance_cents)
            : n(p.balance_cents) + n(p.reusable_balance_cents);
        let ded =
          patch.deduction_balance_cents != null
            ? n(patch.deduction_balance_cents)
            : n(p.deduction_balance_cents);
        patch.reusable_balance_cents = 0;
        if (bal >= left) {
          patch.balance_cents = bal - left;
          patch.deduction_balance_cents = ded;
          chargedNow = left;
          left = 0;
        } else {
          left -= bal;
          const takeDed = Math.min(ded, left);
          patch.balance_cents = 0;
          patch.deduction_balance_cents = Math.max(0, ded - takeDed);
          chargedNow = bal + takeDed;
          left -= takeDed;
        }
      }
      feeCharged += chargedNow;
      feeShortfall = Math.max(0, left);
    }

    // INSERT: Comissão Exchange 4,5% do lucro
    let commissionCharged = prior.commissionCharged || 0;
    let commissionShortfall = 0;
    let commissionNow = 0;
    const commissionDue = Math.max(0, commission - commissionCharged);
    if (commissionDue > 0) {
      let left = commissionDue;
      const curDemo =
        patch.demo_balance_cents != null ? n(patch.demo_balance_cents) : n(p.demo_balance_cents);
      const curInv =
        patch.investor_balance_cents != null
          ? n(patch.investor_balance_cents)
          : n(p.investor_balance_cents);
      const curBal =
        patch.balance_cents != null
          ? n(patch.balance_cents)
          : n(p.balance_cents) +
            (patch.reusable_balance_cents != null ? 0 : n(p.reusable_balance_cents));
      const curDed =
        patch.deduction_balance_cents != null
          ? n(patch.deduction_balance_cents)
          : n(p.deduction_balance_cents);
      if (balanceType === "DEMO") {
        const take = Math.min(curDemo, left);
        patch.demo_balance_cents = curDemo - take;
        commissionNow = take;
        left -= take;
      } else if (balanceType === "INVESTOR") {
        const take = Math.min(curInv, left);
        patch.investor_balance_cents = curInv - take;
        commissionNow = take;
        left -= take;
      } else {
        patch.reusable_balance_cents = 0;
        if (curBal >= left) {
          patch.balance_cents = curBal - left;
          patch.deduction_balance_cents = curDed;
          commissionNow = left;
          left = 0;
        } else {
          left -= curBal;
          const takeDed = Math.min(curDed, left);
          patch.balance_cents = 0;
          patch.deduction_balance_cents = Math.max(0, curDed - takeDed);
          commissionNow = curBal + takeDed;
          left -= takeDed;
        }
      }
      commissionCharged += commissionNow;
      commissionShortfall = Math.max(0, left);
    }

    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: patch,
    });

    if (
      !completeFn({
        feeUpfront,
        feeExpected: fee,
        feeCharged,
        feeShortfall,
        unlocked,
        needsUnlock,
        stakeReturned,
        needsReturn,
      })
    ) {
      throw new Error(
        `Exchange incompleto (proteção ${row.id}): feeExpected=${fee} feeCharged=${feeCharged} shortfall=${feeShortfall} unlocked=${unlocked} returned=${stakeReturned}`
      );
    }

    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: row.user_id,
          type: "protection_settlement",
          amount_cents: chargedNow > 0 ? -chargedNow : 0,
          ref: row.id,
          metadata: {
            protection_id: row.id,
            match_id: row.match_id || null,
            outcome: "exchange",
            stake_cents: amount,
            fee_cents: fee,
            fee_charged_cents: feeCharged,
            fee_charged_now_cents: chargedNow,
            fee_shortfall_cents: feeShortfall,
            exchange_commission_cents: commission,
            exchange_commission_rate: EXCHANGE_COMMISSION_RATE,
            exchange_commission_charged_cents: commissionCharged,
            billing_model: feeUpfront
              ? "fee_upfront_v1"
              : stakeLock
                ? "stake_lock_v1"
                : "legacy_lock",
            fix: EXCHANGE_CHARGE_DEDUCTION_RULE,
            unlocked_locked: unlocked,
            stake_returned: stakeReturned,
            returned_stake_cents: stakeReturned ? amount : 0,
            unlock_return_to_origin: stakeReturned,
            note: feeUpfront
              ? "Ganhou Exchange: taxa já cobrada na criação — sem crédito Reembolso"
              : "Ganhou Exchange: R$ 0 Reembolso; destrava e devolve stake; cobra só dedução (v9)",
          },
        },
      });
    } catch {
      /* */
    }
    if (commissionNow > 0 || (commission > 0 && commissionDue > 0 && commissionCharged > 0)) {
      try {
        await sb("/rest/v1/wallet_transactions", {
          method: "POST",
          token: SERVICE_KEY,
          body: {
            user_id: row.user_id,
            type: "exchange_commission",
            amount_cents: commissionNow > 0 ? -commissionNow : 0,
            ref: row.id,
            metadata: {
              protection_id: row.id,
              match_id: row.match_id || null,
              outcome: "exchange",
              label: "Comissão Exchange (4,5% do lucro)",
              exchange_commission_rate: EXCHANGE_COMMISSION_RATE,
              exchange_commission_cents: commission,
              exchange_commission_charged_cents: commissionCharged,
              exchange_commission_shortfall_cents: commissionShortfall,
              note: "Comissão Exchange 4,5% sobre o lucro da aposta (PERDEU/Exchange)",
            },
          },
        });
      } catch {
        /* */
      }
    }
    return {
      refunded: 0,
      credited: 0,
      exchangeNoCredit: true,
      feeUpfrontExchange: feeUpfront,
      feeChargedCents: feeCharged,
      feeShortfallCents: feeShortfall,
      exchangeCommissionCents: commission,
      exchangeCommissionChargedCents: commissionCharged,
      unlocked,
      stakeReturned,
      returnedStakeCents: stakeReturned ? amount : 0,
    };
  }


  let prof = await sb(
    `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents,deduction_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => null);
  if (!Array.isArray(prof) || !prof[0]) {
    prof = await sb(
      `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
      { token: SERVICE_KEY }
    );
  }
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) throw new Error(`Perfil ${row.user_id} não encontrado para crédito`);

  const patch = { updated_at: now };
  if ((typeof isStakeLockProtection === "function" && isStakeLockProtection(row)) || !feeUpfront) {
    patch.locked_balance_cents = Math.max(0, n(p.locked_balance_cents) - amount);
  }
  let bucket = creditBucketForSettlement(balanceType, row, outcomeNorm);
  if (bucket === "demo_balance_cents") {
    patch.demo_balance_cents = n(p.demo_balance_cents) + credit;
  } else if (bucket === "investor_balance_cents") {
    patch.investor_balance_cents = n(p.investor_balance_cents) + credit;
  } else if (bucket === "balance_cents") {
    patch.balance_cents = n(p.balance_cents) + credit;
  } else {
    patch.deduction_balance_cents = n(p.deduction_balance_cents) + credit;
  }

  let creditedOk = false;
  let lastErr = null;
  const attempts = [patch, { ...patch }];
  delete attempts[1].updated_at;
  if (bucket === "deduction_balance_cents") {
    attempts.push({
      updated_at: now,
      balance_cents: n(p.balance_cents) + credit,
      ...(patch.locked_balance_cents != null
        ? { locked_balance_cents: patch.locked_balance_cents }
        : {}),
    });
  }
  for (const body of attempts) {
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      creditedOk = true;
      if (body.balance_cents != null && body.deduction_balance_cents == null) {
        bucket = "balance_cents";
      }
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!creditedOk) {
    throw lastErr || new Error("Falha ao creditar carteira do cliente");
  }

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: row.user_id,
        type: "protection_settlement",
        amount_cents: credit,
        ref: row.id,
        metadata: {
          protection_id: row.id,
          match_id: row.match_id || null,
          outcome: String(outcome).toLowerCase(),
          stake_cents: parts.stake,
          fee_cents: parts.fee,
          fee_returned_cents: wonArbi || isVoid ? parts.fee : 0,
          bucket,
          billing_model: feeUpfront ? "fee_upfront_v1" : "legacy_lock",
          fix: isVoid
            ? "settle-empate-anula-deducao-v1"
            : "settle-arbishield-stake-mais-deducao-v1",
          note: isVoid
            ? "Empate Anula: devolve só a dedução (Saldo Reembolso)"
            : wonArbi
              ? "ArbiShield: stake + dedução creditados (Saldo Reembolso)"
              : undefined,
        },
      },
    });
  } catch {
    /* */
  }

  return {
    refunded: credit,
    credited: credit,
    stakeCents: parts.stake,
    feeCents: parts.fee,
    bucket,
    void: isVoid,
  };
}

function platformCutCents(row) {
  // Mesma regra da auditoria: não somar profit+deduction (duplicata no LAY).
  const plat =
    n(row.platform_profit_cents) ||
    n(row.platform_deduction_cents) ||
    settlementDeductionCents(row);
  return plat + n(row.exchange_profit_net_cents) + n(row.exchange_fee_cents);
}

async function applyProtectionSettlement(row, table, outcome) {
  const amount = n(row.responsibility_cents || row.amount_cents);
  const outcomeNorm = normalizeSettleOutcome
    ? normalizeSettleOutcome(outcome)
    : String(outcome || "").toLowerCase();
  const wonArbi = outcomeNorm === "arbishield";
  const isVoid = outcomeNorm === "void";
  const status = settlementStatusForOutcome(outcome);
  const now = new Date().toISOString();

  const creditResult = await creditWalletForSettlement(row, outcome, now);
  const refunded = creditResult.refunded || 0;

  // Exchange ganhou → plataforma fica com a dedução/fee (lucro).
  // Empate Anula devolve a dedução — não credita tesouraria.
  let treasury = null;
  if (
    !wonArbi &&
    !isVoid &&
    !creditResult.alreadyCredited &&
    !creditResult.skipped
  ) {
    const cut = platformCutCents(row);
    if (cut > 0) {
      treasury = await adjustPlatformTreasury(cut, {
        action: "TREASURY_PROTECTION_FEE",
        entityType: table,
        entityId: row.id,
        details: {
          match_id: row.match_id || null,
          outcome: String(outcome).toLowerCase(),
          stake_cents: amount,
          cut_cents: cut,
        },
      }).catch((e) => {
        console.warn("[treasury] protection settle:", e.message || e);
        return { ok: false, error: String(e.message || e) };
      });
    }
  }

  const settledOutcome = isVoid ? "void" : String(outcome).toLowerCase();
  const attempts = [
    {
      status,
      settled_at: now,
      settled_outcome: settledOutcome,
      result: status,
    },
    {
      status,
      settled_at: now,
      settled_outcome: settledOutcome,
    },
    { status, settled_at: now, result: status },
    { status, settled_at: now },
  ];
  if (wonArbi) {
    attempts.push(
      {
        status: "won_platform",
        settled_at: now,
        settled_outcome: settledOutcome,
        result: "lost_exchange",
      },
      {
        status: "won_platform",
        settled_at: now,
        settled_outcome: settledOutcome,
      }
    );
  }
  if (isVoid) {
    // fallback se status "void" não existir no enum do banco
    attempts.push(
      {
        status: "cancelled",
        settled_at: now,
        settled_outcome: "void",
        result: "void",
      },
      { status: "cancelled", settled_at: now, settled_outcome: "void" }
    );
  }
  let lastErr = null;
  for (const body of attempts) {
    try {
      await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      return {
        id: row.id,
        status: body.status,
        amount,
        refunded,
        alreadyCredited: !!creditResult.alreadyCredited,
        treasury,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw (
    lastErr ||
    new Error(
      `Falha ao liquidar proteção ${row.id} (crédito ${refunded}¢ já pode ter sido lançado)`
    )
  );
}

async function settleMatch(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const matchId = String(body?.matchId || body?.id || "").trim();
  if (!matchId) throw new Error("matchId obrigatório");

  const outcomesMap =
    body?.outcomes && typeof body.outcomes === "object" && !Array.isArray(body.outcomes)
      ? body.outcomes
      : null;
  const marketId = body?.marketId ? String(body.marketId) : null;
  let outcome = String(body?.outcome || "").toLowerCase();
  if (!outcome && outcomesMap) {
    const vals = Object.values(outcomesMap).map((v) => String(v).toLowerCase());
    outcome = vals[0] || "";
  }
  if (outcome) {
    const o = normalizeSettleOutcome
      ? normalizeSettleOutcome(outcome)
      : String(outcome).toLowerCase();
    if (o !== "arbishield" && o !== "exchange" && o !== "void") {
      throw new Error(
        "outcome inválido (use arbishield, exchange ou empate_anula/void)"
      );
    }
    outcome = o === "void" ? "void" : o;
  }

  let finalScore = body?.finalScore || body?.final_score || null;
  if (
    !finalScore &&
    (body?.homeScore != null ||
      body?.awayScore != null ||
      body?.final_score_home != null ||
      body?.final_score_away != null)
  ) {
    finalScore = `${Number(body.homeScore ?? body.final_score_home ?? 0)}-${Number(
      body.awayScore ?? body.final_score_away ?? 0
    )}`;
  }

  const rows = await sb(
    `/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}&select=*&limit=1`,
    { token: SERVICE_KEY }
  );
  const match = Array.isArray(rows) ? rows[0] : null;
  if (!match) throw new Error("Partida não encontrada");

  let markets = Array.isArray(match.markets) ? [...match.markets] : [];
  if (marketId && outcome) {
    markets = markets.map((m) =>
      String(m?.id) === String(marketId)
        ? { ...m, settled_outcome: outcome }
        : m
    );
  } else if (outcomesMap) {
    markets = markets.map((m) => {
      const key = String(m?.id);
      const o = outcomesMap[key] ?? outcomesMap[m?.id];
      return o ? { ...m, settled_outcome: String(o).toLowerCase() } : m;
    });
    if (!outcome) {
      const first = markets.find((m) => m.settled_outcome);
      outcome = String(first?.settled_outcome || "").toLowerCase();
    }
  } else if (outcome) {
    markets = markets.map((m) => ({ ...m, settled_outcome: outcome }));
  }

  if (!outcome && !marketId && !outcomesMap) {
    throw new Error("Informe outcome (arbishield/exchange/empate_anula)");
  }

  const now = new Date().toISOString();
  const statusFilter = openProtectionStatuses()
    .map(encodeURIComponent)
    .join(",");
  const [lays, backs] = await Promise.all([
    sb(
      `/rest/v1/protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${statusFilter})&select=*&limit=2000`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/back_protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${statusFilter})&select=*&limit=2000`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);

  let all = [
    ...(Array.isArray(lays) ? lays : []).map((r) => ({
      ...r,
      _table: "protections",
    })),
    ...(Array.isArray(backs) ? backs : []).map((r) => ({
      ...r,
      _table: "back_protections",
    })),
  ].filter((r) => isOpenProtectionStatus(r.status));

  let repaired = false;
  if (all.length === 0 && !marketId) {
    async function loadSettled(table) {
      try {
        const rows = await sb(
          `/rest/v1/${table}?match_id=eq.${encodeURIComponent(matchId)}&status=in.(won_exchange,won_platform,lost_exchange,lost_platform,settled)&select=*&limit=2000`,
          { token: SERVICE_KEY }
        );
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    }
    const [sl, sbk] = await Promise.all([
      loadSettled("protections"),
      loadSettled("back_protections"),
    ]);
    const candidates = [
      ...sl.map((r) => ({ ...r, _table: "protections" })),
      ...sbk.map((r) => ({ ...r, _table: "back_protections" })),
    ];
    const needing = [];
    for (const row of candidates) {
      // Marker: settle-exchange-heal-incompleto-v10
      const healOutcome =
        typeof settlementOutcomeFromProtectionRow === "function"
          ? settlementOutcomeFromProtectionRow(row)
          : "";
      if (healOutcome === "exchange") {
        const prior = await loadExchangeSettlementPrior(row.id);
        const needs =
          typeof exchangeWalletHealNeeded === "function"
            ? exchangeWalletHealNeeded(row, prior)
            : !prior.hasTx || !prior.stakeReturned;
        if (needs) needing.push(row);
        continue;
      }
      if (!(await protectionAlreadyCredited(row.id))) needing.push(row);
    }
    if (needing.length) {
      all = needing;
      repaired = true;
    }
  }

  // Liquidar proteções ANTES do PATCH na partida (trigger legado bloqueia
  // encerramento enquanto houver LAY/BACK ativos).
  let settledCount = 0;
  let refundedCents = 0;
  for (const row of all) {
    const rowMarket =
      row.market_id ||
      (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
      null;
    let rowOutcome = outcome;
    if (repaired) {
      const stored =
        typeof settlementOutcomeFromProtectionRow === "function"
          ? settlementOutcomeFromProtectionRow(row)
          : "";
      if (stored) rowOutcome = stored;
    } else if (marketId) {
      if (rowMarket && String(rowMarket) !== String(marketId)) continue;
      rowOutcome = outcome;
    } else if (outcomesMap && rowMarket) {
      const o = outcomesMap[String(rowMarket)] ?? outcomesMap[rowMarket];
      if (o) rowOutcome = String(o).toLowerCase();
    }
    if (!rowOutcome) continue;
    const r = await applyProtectionSettlement(row, row._table, rowOutcome);
    settledCount += 1;
    refundedCents += r.refunded || 0;
  }

  if (!marketId && !repaired) {
    const stillLay = await sb(
      `/rest/v1/protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${statusFilter})&select=id&limit=50`,
      { token: SERVICE_KEY }
    ).catch(() => []);
    const stillBack = await sb(
      `/rest/v1/back_protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${statusFilter})&select=id&limit=50`,
      { token: SERVICE_KEY }
    ).catch(() => []);
    const layN = Array.isArray(stillLay) ? stillLay.length : 0;
    const backN = Array.isArray(stillBack) ? stillBack.length : 0;
    if (layN + backN > 0) {
      throw new Error(
        `Não foi possível liquidar todas as proteções (${layN} LAY / ${backN} BACK ainda abertas).`
      );
    }
  }

  const adminId = requireUserId(token);
  // profiles-sem-coluna-email-v1
  let settledByName = String(adminId).slice(0, 8);
  try {
    const profRows = await sb(
      `/rest/v1/profiles?select=full_name&id=eq.${encodeURIComponent(adminId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const prof = Array.isArray(profRows) ? profRows[0] : null;
    if (prof) {
      settledByName =
        (prof.full_name && String(prof.full_name).trim()) ||
        settledByName;
    }
  } catch {
    /* */
  }

  const prevMeta =
    match.metadata && typeof match.metadata === "object" ? { ...match.metadata } : {};
  if (!marketId) {
    prevMeta.settled_by = adminId;
    prevMeta.settled_by_name = settledByName;
    prevMeta.settled_at = now;
    if (outcome) prevMeta.settled_outcome = outcome;
  }

  const patchMatch = {
    markets,
    updated_at: now,
    updated_by: adminId,
    metadata: prevMeta,
  };
  if (!marketId) {
    if (finalScore) patchMatch.final_score = String(finalScore);
    patchMatch.settled_at = now;
    patchMatch.status = "settled";
    patchMatch.settled_by = adminId;
    // Finalizado NUNCA fica publicado — some da grade do cliente e da Fila.
    patchMatch.is_published = false;
  }

  // status_v2 enum VPS: "closed" (não "settled"); updated_by alimenta trigger admin_id
  let matchPatched = false;
  for (const body of [
    { ...patchMatch, status_v2: "closed" },
    { ...patchMatch, status_v2: "finished" },
    patchMatch,
  ]) {
    try {
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      matchPatched = true;
      break;
    } catch {
      try {
        await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
          method: "PATCH",
          token,
          body,
        });
        matchPatched = true;
        break;
      } catch {
        /* next */
      }
    }
  }
  if (!matchPatched) {
    throw new Error(
      "Falha ao marcar partida (admin_id/status). Confirme login admin e tente de novo."
    );
  }
  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: marketId
          ? "ADMIN_ACTION_SETTLE_MARKET"
          : "ADMIN_ACTION_SETTLE",
        entity_type: "matches",
        entity_id: matchId,
        details: {
          outcome,
          finalScore: finalScore || null,
          marketId: marketId || null,
          outcomes: outcomesMap || null,
          settledCount,
          refundedCents,
          repaired,
          fix: "settle-credito-carteira-v1",
        },
      },
    });
  } catch {
    /* */
  }

  return {
    ok: true,
    matchId,
    outcome: outcome || null,
    finalScore: finalScore || null,
    settledCount,
    refundedCents,
    repaired,
    fix: "settle-credito-carteira-v1",
  };
}

async function getUserDashboardCritical(token) {
  const userId = requireUserId(token);
  const [profileBundle, metrics] = await Promise.all([
    getUserProfileBundle(userId),
    getUserDashboardMetrics(userId),
  ]);
  return { profile: profileBundle, metrics };
}

async function getUserDashboardSecondary(token) {
  const userId = requireUserId(token);
  const [protections, openMatches] = await Promise.all([
    sb(
      `/rest/v1/protections?select=*&user_id=eq.${userId}&order=created_at.desc&limit=200`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(`/rest/v1/matches?select=id&status=eq.open`, { token: SERVICE_KEY }).catch(
      () => []
    ),
  ]);
  const list = Array.isArray(protections) ? protections : [];
  const openCount = Array.isArray(openMatches) ? openMatches.length : 0;

  // pontos semanais (Seg–Dom) a partir de user_profit_cents settled
  const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const now = new Date();
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  const points = [];
  for (let i = 0; i < 7; i++) {
    const start = new Date(weekStart);
    start.setDate(weekStart.getDate() + i);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const value =
      list
        .filter((p) => {
          if (!p.settled_at) return false;
          const d = new Date(p.settled_at);
          return d >= start && d <= end;
        })
        .reduce((a, p) => a + n(p.user_profit_cents), 0) / 100;
    points.push({ name: labels[i], value });
  }
  const hasData = list.some((p) => p.settled_at);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthProfit = 0;
  for (const p of list) {
    if (!p.settled_at) continue;
    if (!["lost_platform", "won_exchange", "settled"].includes(String(p.status || ""))) {
      continue;
    }
    if (new Date(p.settled_at) >= monthStart) monthProfit += n(p.user_profit_cents);
  }

  return {
    protections: list,
    newMarkets: { count: openCount },
    bankPerformance: {
      points,
      variationPct: hasData ? Number(((monthProfit / 100) || 0).toFixed(2)) : null,
      hasData,
    },
  };
}

async function getUserNotifications(token) {
  const userId = requireUserId(token);
  const rows = await sb(
    `/rest/v1/notifications?select=*&user_id=eq.${userId}&order=created_at.desc&limit=50`,
    { token: SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows : [];
}

async function getProfileMap(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  // PostgREST: in.(uuid,uuid)
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const q = encodeURIComponent(`in.(${chunk.join(",")})`);
    const rows = await sb(`/rest/v1/profiles?select=id,full_name&id=${q}`);
    for (const r of Array.isArray(rows) ? rows : []) {
      map.set(r.id, r.full_name || null);
    }
  }
  return map;
}

async function getAdminTxFeed(params = {}) {
  const page = Math.max(1, n(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, n(params.pageSize) || 50));
  const from = params.from ? new Date(params.from) : startOfDaySaoPaulo();
  const to = params.to ? new Date(params.to) : new Date();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const category = params.category || null;
  const search = (params.search || "").toString().trim().toLowerCase();

  const want = (cat) => !category || category === cat;

  const tasks = [];
  if (want("deposit") || !category) {
    tasks.push(
      sb(
        `/rest/v1/wallet_transactions?select=id,user_id,type,amount_cents,created_at,balance_after_cents,balance_before_cents,metadata,ref&type=eq.deposit&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `wt-${r.id}`,
          created_at: r.created_at,
          category: "deposit",
          type: r.type,
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: 1,
          status: "completed",
          balance_after_cents: r.balance_after_cents,
          balance_before_cents: r.balance_before_cents,
          description: r.ref || "Depósito",
          match_label: null,
        }))
      )
    );
    tasks.push(
      sb(
        `/rest/v1/manual_deposits?select=id,user_id,amount_cents,status,created_at,admin_notes&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `md-${r.id}`,
          created_at: r.created_at,
          category: "deposit",
          type: "manual_deposit",
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: String(r.status).toUpperCase() === "APPROVED" ? 1 : 0,
          status: r.status,
          balance_after_cents: null,
          balance_before_cents: null,
          description: r.admin_notes || "Depósito manual",
          match_label: null,
        }))
      )
    );
  }
  if (want("refund") || !category) {
    tasks.push(
      sb(
        `/rest/v1/refund_requests?select=id,user_id,amount_cents,status,created_at,admin_notes&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `rr-${r.id}`,
          created_at: r.created_at,
          category: "refund",
          type: "refund",
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: -1,
          status: r.status,
          balance_after_cents: null,
          balance_before_cents: null,
          description: r.admin_notes || "Reembolso",
          match_label: null,
        }))
      )
    );
  }
  if (want("expense") || !category) {
    tasks.push(
      sb(
        `/rest/v1/admin_expenses?select=id,amount_cents,category,description,expense_date,created_at&expense_date=gte.${fromIso.slice(0, 10)}&expense_date=lte.${toIso.slice(0, 10)}&order=expense_date.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `ex-${r.id}`,
          created_at: r.created_at || `${r.expense_date}T12:00:00.000Z`,
          category: "expense",
          type: r.category || "expense",
          user_id: null,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: -1,
          status: "completed",
          balance_after_cents: null,
          balance_before_cents: null,
          description: r.description || "Despesa",
          match_label: null,
        }))
      )
    );
  }
  if (want("wallet") || !category) {
    tasks.push(
      sb(
        `/rest/v1/protections?select=id,user_id,amount_cents,status,created_at,settled_at,platform_profit_cents,exchange_profit_net_cents,settled_outcome,balance_before_cents,balance_after_cents,match_id,side&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `pr-${r.id}`,
          created_at: r.settled_at || r.created_at,
          category: "wallet",
          type: "protection",
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: 0,
          status: r.status,
          balance_after_cents: r.balance_after_cents,
          balance_before_cents: r.balance_before_cents,
          description: `Proteção ${r.side || ""}`.trim(),
          match_label: r.match_id ? String(r.match_id).slice(0, 8) : null,
          platform_profit_cents: n(r.platform_profit_cents || r.exchange_profit_net_cents),
          settled_outcome: r.settled_outcome,
          is_exchange_settlement: n(r.exchange_profit_net_cents) > 0,
          gross_entry_cents: n(r.amount_cents),
        }))
      )
    );
  }
  if (want("withdraw") || !category) {
    tasks.push(
      sb(
        `/rest/v1/withdrawals?select=id,user_id,amount_cents,status,created_at&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      )
        .then((rows) =>
          (Array.isArray(rows) ? rows : []).map((r) => ({
            id: `wd-${r.id}`,
            created_at: r.created_at,
            category: "withdraw",
            type: "withdraw",
            user_id: r.user_id,
            amount_cents: Math.abs(n(r.amount_cents)),
            cash_flow: -1,
            status: r.status,
            balance_after_cents: null,
            balance_before_cents: null,
            description: "Saque",
            match_label: null,
          }))
        )
        .catch(() => [])
    );
  }

  const chunks = await Promise.all(tasks);
  let items = chunks.flat();

  const profiles = await getProfileMap(items.map((i) => i.user_id));
  for (const it of items) {
    it.user_name = it.user_id ? profiles.get(it.user_id) || null : null;
    it.user_email = null;
  }

  if (search) {
    items = items.filter(
      (it) =>
        String(it.user_name || "")
          .toLowerCase()
          .includes(search) ||
        String(it.user_id || "")
          .toLowerCase()
          .includes(search) ||
        String(it.description || "")
          .toLowerCase()
          .includes(search) ||
        String(it.id || "")
          .toLowerCase()
          .includes(search)
    );
  }

  items.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const totalIn = items
    .filter((i) => i.cash_flow === 1)
    .reduce((a, i) => a + n(i.amount_cents), 0);
  const totalOut = items
    .filter((i) => i.cash_flow === -1)
    .reduce((a, i) => a + n(i.amount_cents), 0);
  const total = items.length;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    items: pageItems,
    total,
    kpis: {
      totalTransactions: total,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
    },
  };
}

async function handleServerFn(req, res, id, rawBody = "") {
  const token = bearerFromReq(req);

  if (id === FN.LIST_DESAFIOS) {
    console.log("[serverfn-shim] LIST_DESAFIOS");
    try {
      const data = await listDesafios(token);
      return sendTsrOk(res, data);
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.UPSERT_DESAFIO && req.method === "POST") {
    console.log("[serverfn-shim] UPSERT_DESAFIO");
    try {
      const params = extractServerFnData(rawBody);
      const data = await upsertDesafio(token, params);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] UPSERT_DESAFIO error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DELETE_DESAFIO && req.method === "POST") {
    console.log("[serverfn-shim] DELETE_DESAFIO");
    try {
      const params = extractServerFnData(rawBody);
      const data = await deleteDesafio(token, params);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] DELETE_DESAFIO error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_PUBLIC_LIST) {
    try {
      return sendTsrOk(res, await listBannersPublic());
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_ADMIN_LIST) {
    try {
      return sendTsrOk(res, await listBannersAdmin(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_UPSERT && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await upsertBanner(token, params));
    } catch (err) {
      console.error("[serverfn-shim] BANNERS_UPSERT error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_DELETE && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await deleteBanner(token, params));
    } catch (err) {
      console.error("[serverfn-shim] BANNERS_DELETE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.TRANSFER_TO_DESAFIO && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await transferRealToDesafio(token, params));
    } catch (err) {
      console.error("[serverfn-shim] TRANSFER_TO_DESAFIO error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.AFFILIATE_ENSURE_CODE && (req.method === "POST" || req.method === "GET")) {
    try {
      return sendTsrOk(res, await ensureAffiliateReferralCode(token));
    } catch (err) {
      console.error("[serverfn-shim] AFFILIATE_ENSURE_CODE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.AFFILIATE_WITHDRAW && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await requestAffiliateWithdrawal(token, params));
    } catch (err) {
      console.error("[serverfn-shim] AFFILIATE_WITHDRAW error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DESAFIO_REGISTER_ENTRY && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await registerDesafioEntry(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DESAFIO_REGISTER_ENTRY error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DESAFIO_LIST_PARTICIPATIONS && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await listDesafioParticipations(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DESAFIO_SETTLE && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await settleDesafioStep(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DESAFIO_SETTLE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_ACTIVE_ROUNDS) {
    try {
      return sendTsrOk(res, await listActivePartnerRounds(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_DISTRIBUTE && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await distributePartnerYield(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] PARTNER_DISTRIBUTE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_DIST_HISTORY) {
    try {
      return sendTsrOk(res, await partnerDistributionHistory(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_MONTHLY_STATS) {
    try {
      return sendTsrOk(res, await partnerMonthlyStats(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DEPOSIT_APPROVE && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await approveManualDeposit(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DEPOSIT_APPROVE error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.DEPOSIT_MARK_CREDITED && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await markManualDepositCredited(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DEPOSIT_MARK_CREDITED error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.DEPOSIT_REJECT && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await rejectManualDeposit(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DEPOSIT_REJECT error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.DEPOSIT_UPLOAD_PROOF && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await uploadDepositProof(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DEPOSIT_UPLOAD_PROOF error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.DEPOSIT_PROOF_URL && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await getDepositProofSignedUrl(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DEPOSIT_PROOF_URL error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.PROTECTION_CLOSE_NO_REFUND && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await closeProtectionNoRefund(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] PROTECTION_CLOSE_NO_REFUND error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PROTECTION_CANCEL_REFUND && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await cancelProtectionRefund(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] PROTECTION_CANCEL_REFUND error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.CONTESTATION_LIST && (req.method === "GET" || req.method === "POST")) {
    try {
      return replyFnOk(req, res, await listContestationsAdmin(token));
    } catch (err) {
      console.error("[serverfn-shim] CONTESTATION_LIST error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.CONTESTATION_SUBMIT && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await submitContestation(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] CONTESTATION_SUBMIT error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.CONTESTATION_OPERATOR && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await submitOperatorContestation(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] CONTESTATION_OPERATOR error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.CONTESTATION_APPROVE && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await approveContestation(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] CONTESTATION_APPROVE error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (id === FN.CONTESTATION_REJECT && req.method === "POST") {
    try {
      return replyFnOk(
        req,
        res,
        await rejectContestation(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] CONTESTATION_REJECT error", err);
      return replyFnError(req, res, err instanceof Error ? err.message : String(err));
    }
  }

  if (
    (id === FN.MATCH_SETTLE_SINGLE ||
      id === FN.MATCH_SETTLE_MARKET ||
      id === FN.MATCH_SETTLE_MULTI) &&
    req.method === "POST"
  ) {
    try {
      return sendTsrOk(
        res,
        await settleMatch(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] MATCH_SETTLE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_REORDER && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await reorderBanners(token, params));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DASHBOARD_STATS) {
    console.log("[serverfn-shim] DASHBOARD_STATS");
    try {
      if (!(await currentUserIsAdmin(token))) {
        return sendTsrError(res, "Acesso negado");
      }
      // agregações com service role (RLS bloqueia anon)
      const data = await getDashboardStats();
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] DASHBOARD_STATS error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.ADMIN_TX_FEED) {
    console.log("[serverfn-shim] ADMIN_TX_FEED");
    try {
      const params = extractServerFnData(rawBody);
      const data = await getAdminTxFeed(params);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] ADMIN_TX_FEED error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.ADMIN_LIST_USERS) {
    console.log("[serverfn-shim] ADMIN_LIST_USERS");
    try {
      const data = await listAdminUsers();
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] ADMIN_LIST_USERS error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.ADMIN_IS_SUPER) {
    console.log("[serverfn-shim] ADMIN_IS_SUPER");
    try {
      const data = await currentUserIsSuperAdmin(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] ADMIN_IS_SUPER error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_MY_PROFILE) {
    console.log("[serverfn-shim] USER_MY_PROFILE");
    try {
      const userId = requireUserId(token);
      const data = await getUserProfileBundle(userId);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_MY_PROFILE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_DASH_CRITICAL) {
    console.log("[serverfn-shim] USER_DASH_CRITICAL");
    try {
      const data = await getUserDashboardCritical(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_DASH_CRITICAL error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_DASH_SECONDARY) {
    console.log("[serverfn-shim] USER_DASH_SECONDARY");
    try {
      const data = await getUserDashboardSecondary(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_DASH_SECONDARY error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_NOTIFICATIONS) {
    console.log("[serverfn-shim] USER_NOTIFICATIONS");
    try {
      const data = await getUserNotifications(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_NOTIFICATIONS error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_GEO_LOG) {
    console.log("[serverfn-shim] USER_GEO_LOG");
    // Aceita o log de geo sem persistir (evita retry infinito no SecurityMonitor)
    return sendTsrOk(res, { ok: true });
  }

  // Stubs: não lançar erro (travava o admin). Geo/session e mutações
  // ainda não portadas — retornam sucesso vazio.
  // IMPORTANTE: GET default = null (não []). [] corrompe cache do dashboard
  // (dash:critical / dash:secondary) porque [] é truthy e sem .profile.
  console.log("[serverfn-shim]", req.method, id.slice(0, 12));
  if (req.method === "GET") {
    return sendTsrOk(res, null);
  }
  return sendTsrOk(res, null);
}

function parseBody(req, maxBytes = 14e6) {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > maxBytes) req.destroy();
    });
    req.on("end", () => resolvePromise(data));
    req.on("error", (e) => rejectPromise(e));
  });
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/arbishield/desafios") {
    try {
      const token = bearerFromReq(req);
      if (req.method === "GET") {
        const data = await listDesafios(token);
        return sendJson(res, 200, data);
      }
      if (req.method === "POST") {
        const raw = await parseBody(req);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return sendJson(res, 400, { error: "JSON inválido" });
        }
        const created = await createDesafio(token, body);
        return sendJson(res, 201, { ok: true, desafio: created });
      }
      return sendJson(res, 405, { error: "method_not_allowed" });
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/dashboard-stats") {
    try {
      const token = bearerFromReq(req);
      if (!(await currentUserIsAdmin(token))) {
        return sendJson(res, 403, { error: "Acesso negado" });
      }
      const data = await getDashboardStats();
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/transfer-desafio" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      if (!token) {
        return sendJson(res, 401, { ok: false, error: "Não autorizado" });
      }
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const payload = body.data || body;
      const source = String(
        payload.source || payload.from || payload.bucket || ""
      )
        .toLowerCase()
        .trim();
      // Só libera Reembolso → Desafio. Banca Real → Desafio permanece bloqueada.
      if (
        source === "reembolso" ||
        source === "deduction" ||
        source === "deduction_balance" ||
        source === "saldo_reembolso"
      ) {
        const data = await transferDeductionToDesafio(token, payload);
        return sendJson(res, 200, data);
      }
      return sendJson(res, 403, {
        ok: false,
        error:
          "Transferência Banca → Desafio está bloqueada. Use Saldo Reembolso → Desafio, ou deposite via PIX no Desafio.",
        blocked: true,
      });
    } catch (err) {
      return sendJson(res, err.status || 400, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/affiliate-ensure-code" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const data = await ensureAffiliateReferralCode(token);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/apply-referral" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const data = await applyReferralCode(token, body.data || body);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/deduction-withdraw" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const data = await requestDeductionWithdrawal(token, body.data || body);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/affiliate-withdraw" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const data = await requestAffiliateWithdrawal(token, body.data || body);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    (url.pathname === "/api/arbishield/desafio-jornada" ||
      url.pathname === "/api/arbishield/desafio-journey") &&
    req.method === "POST"
  ) {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await getDesafioJornada(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    (url.pathname === "/api/arbishield/desafio-sinal" ||
      url.pathname === "/api/arbishield/desafio-sinal-preview") &&
    req.method === "POST"
  ) {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await previewDesafioSinal(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-register" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await registerDesafioEntry(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-settle" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await settleDesafioStep(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-participations" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await listDesafioParticipations(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    url.pathname === "/api/arbishield/desafio-history" &&
    (req.method === "GET" || req.method === "POST")
  ) {
    try {
      const token = bearerFromReq(req);
      if (!token) {
        return sendJson(res, 401, { ok: false, error: "Não autorizado" });
      }
      return sendJson(res, 200, await listMyDesafioHistory(token));
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-delete" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await deleteDesafio(token, body.data || body));
    } catch (err) {
      const status = Number(err && err.status) || 400;
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-restore" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await restoreDesafio(token, body.data || body));
    } catch (err) {
      const status = Number(err && err.status) || 400;
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-cancel" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const data = body.data || body;
      // Admin cancela desafio inteiro: { id, cancelWhole: true }
      if (data.cancelWhole === true || data.cancel_desafio === true) {
        return sendJson(res, 200, await cancelDesafio(token, data));
      }
      // Entrada individual (cliente ou admin): participationId / stepId / desafioId
      if (
        data.participationId ||
        data.participation_id ||
        data.stepId ||
        data.step_id ||
        data.desafioId ||
        data.desafio_id
      ) {
        return sendJson(res, 200, await cancelDesafioParticipation(token, data));
      }
      // Fallback admin: só { id } sem refs de entrada
      if (data.id) {
        return sendJson(res, 200, await cancelDesafio(token, data));
      }
      throw new Error("Informe participationId ou id do desafio");
    } catch (err) {
      const status = Number(err && err.status) || 400;
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    url.pathname === "/api/arbishield/desafio-pending-counts" &&
    req.method === "POST"
  ) {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await listDesafioPendingCounts(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/partner-rounds" && req.method === "GET") {
    try {
      const token = bearerFromReq(req);
      return sendJson(res, 200, await listActivePartnerRounds(token));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/partner-distribute" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await distributePartnerYield(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/protection-close" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await closeProtectionNoRefund(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/protection-cancel" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await cancelProtectionRefund(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/contestations" && req.method === "GET") {
    try {
      const token = bearerFromReq(req);
      return sendJson(res, 200, await listContestationsAdmin(token));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/contestations/pending-count" && req.method === "GET") {
    try {
      const token = bearerFromReq(req);
      return sendJson(res, 200, await countPendingContestations(token));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/contestations/submit" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await submitContestation(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/contestations/approve" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await approveContestation(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/contestations/reject" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await rejectContestation(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/match-settle" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await settleMatch(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/health") {
    const base = {
      ok: true,
      service: "serverfn-shim",
      fix: CREATE_PROTECTION_FIX_MARKER,
      protectionRuntime: PROTECTION_RUNTIME_HEALTH_MARKER,
      createProtectionModel: PROTECTION_BILLING_MODEL_CANONICAL,
      cancelRefundGuard: CANCEL_FEE_UPFRONT_NO_STAKE_REFUND,
      exchangeChargeGuard: EXCHANGE_CHARGE_DEDUCTION_RULE,
      protectionFlowContract: PROTECTION_FLOW_CONTRACT_VERSION,
      env: process.env.ARBISHIELD_ENV || "production",
      listen: LISTEN,
    };
    const runtimeOk = isProtectionRuntimeHealthy(base);
    base.ok = runtimeOk;
    const status = runtimeOk ? 200 : 503;
    try {
      const buckets = await ensureStorageBuckets();
      return sendJson(res, status, { ...base, buckets });
    } catch (e) {
      return sendJson(res, status, base);
    }
  }

  if (url.pathname === "/api/arbishield/ensure-storage-buckets" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      if (!token) return sendJson(res, 401, { error: "Não autorizado" });
      const out = await ensureStorageBuckets();
      return sendJson(res, 200, out);
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/deposit-proof" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      if (!token) return sendJson(res, 401, { error: "Não autorizado" });
      const raw = await parseBody(req, 14e6);
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return sendJson(res, 400, { error: "JSON inválido" });
      }
      const result = await uploadDepositProof(token, body.data || body);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const m = url.pathname.match(/^\/_serverFn\/([a-f0-9]+)/i);
  if (!m) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "not_found" }));
  }

  let rawBody = "";
  if (req.method === "POST") rawBody = await parseBody(req);

  try {
    await handleServerFn(req, res, m[1].toLowerCase(), rawBody);
  } catch (err) {
    sendTsrError(res, err instanceof Error ? err.message : String(err));
  }
});

const [host, portStr] = LISTEN.split(":");
server.listen(Number(portStr || 3101), host, async () => {
  console.log(`serverfn-shim on http://${host}:${portStr || 3101}`);
  try {
    const out = await ensureStorageBuckets();
    console.log("[serverfn-shim] storage buckets:", JSON.stringify(out));
  } catch (e) {
    console.warn(
      "[serverfn-shim] ensureStorageBuckets:",
      e instanceof Error ? e.message : e
    );
  }
});
