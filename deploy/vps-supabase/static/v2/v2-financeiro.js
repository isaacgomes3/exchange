/**
 * Centro Financeiro v2 — extrato consolidado (paridade com SPA Vnt / carteira).
 */
(function () {
  var PERIODS = [
    { id: "today", label: "Hoje" },
    { id: "7d", label: "7 dias" },
    { id: "30d", label: "30 dias" },
    { id: "90d", label: "90 dias" },
    { id: "month", label: "Este mês" },
    { id: "lastMonth", label: "Mês passado" },
    { id: "all", label: "Tudo" },
  ];
  var GROUP_LABEL = {
    protecao: "Proteção",
    reembolso: "Reembolso",
    contestacao: "Contestação",
    deposito: "Depósito",
    saque: "Saque",
    afiliado: "Afiliado",
    provedor: "Provedor",
  };
  var AFF_OK = { approved: 1, available: 1, pending_payout: 1 };
  var WD_OPEN = { pending: 1, approved: 1, paid: 1, processing: 1 };
  var AFF_WD = {
    AFFILIATE_WITHDRAWAL: 1,
    AFFILIATE_COMMISSION_WITHDRAWAL: 1,
    AFFILIATE_PAYOUT_REQUEST: 1,
  };

  var state = {
    period: "30d",
    tab: "extrato",
    group: "all",
    search: "",
    page: 1,
    pageSize: 10,
    ledger: [],
    filtered: [],
    profile: null,
    protections: [],
    backProtections: [],
    refunds: [],
    backRefunds: [],
    contestations: [],
    manualDeposits: [],
    asaas: [],
    withdrawals: [],
    commissions: [],
    distributions: [],
    partnerWithdrawals: [],
    walletTx: [],
    affBalance: 0,
    realBalance: 0,
    transferableReal: 0,
    apostadorHeader: 0,
    providerBalance: 0,
    locked: 0,
    activeCount: 0,
    desafio: 0,
    metrics: {
      total: 0,
      balance: 0,
      blocked: 0,
      profit: 0,
      refunded: 0,
      monthVar: "0.00",
      feeAvg: 1.5,
      yield: 0,
    },
  };

  function money(cents) {
    return ArbiV2.money(cents);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }
  function showErr(msg) {
    var el = document.getElementById("err");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("show", !!msg);
  }
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function statusLabel(raw) {
    var t = String(raw || "").toLowerCase();
    var map = {
      pending: "Pendente",
      pending_payout: "A pagar",
      pending_review: "Em análise",
      under_review: "Em análise",
      in_review: "Em análise",
      approved: "Aprovado",
      available: "Disponível",
      paid: "Pago",
      rejected: "Rejeitado",
      refunded: "Reembolsado",
      cancelled: "Cancelado",
      canceled: "Cancelado",
      settled: "Encerrado",
      active: "Ativa",
      confirmed: "Confirmado",
      expired: "Expirado",
      exchange: "Exchange",
      arbishield: "ArbiShield",
      won: "Vitória",
      win: "Vitória",
      user_won: "Vitória",
      lost: "Derrota",
      loss: "Derrota",
    };
    return map[t] || raw || "—";
  }
  function depositOrigin(row) {
    var t = String(row && row.deposit_type || "").toLowerCase();
    var n = String(row && row.network || "").toLowerCase();
    if (t === "investor") return "Saldo Provedor";
    if (t === "user_balance") return "Saldo Apostador";
    if (t === "affiliate") return "Saldo Afiliado";
    if (n === "pix" || t === "pix") return "PIX";
    if (n.indexOf("usdt") >= 0 || n.indexOf("crypto") >= 0 || t === "crypto") return "Cripto";
    return row && (row.deposit_type || row.network) || "Manual";
  }
  function isAffiliateWd(row) {
    var meta = (row && row.metadata) || {};
    var n = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
    return !!AFF_WD[n];
  }
  function isRefundPaid(row) {
    var fe = String((row && row.status) || "");
    var re = fe.toLowerCase();
    var Se = fe.toUpperCase();
    return re === "paid" || !!(row && row.paid_at) || Se === "CONCLUÍDO" || Se === "CONCLUIDO" || Se === "PIX ENVIADO";
  }
  function refundValue(row) {
    var fe = Number((row && row.amount_cents) || 0);
    var re = Number((row && row.external_loss_cents) || 0);
    var Se = String((row && row.refund_modality) || "").toUpperCase();
    var Ce = String((row && row.refund_method) || "").toUpperCase();
    if (Se === "SALDO_INTEGRAL" || Se === "SALDO_PIX" || Ce === "PIX+SALDO") return fe + re;
    return fe;
  }
  function periodBounds(id) {
    var t = new Date();
    if (id === "today") {
      var n = new Date(t);
      n.setHours(0, 0, 0, 0);
      return { start: n, end: null };
    }
    if (id === "7d" || id === "30d" || id === "90d") {
      var days = id === "7d" ? 7 : id === "30d" ? 30 : 90;
      var r = new Date(t);
      r.setDate(r.getDate() - days);
      return { start: r, end: null };
    }
    if (id === "month") return { start: new Date(t.getFullYear(), t.getMonth(), 1), end: null };
    if (id === "lastMonth") {
      return {
        start: new Date(t.getFullYear(), t.getMonth() - 1, 1),
        end: new Date(t.getFullYear(), t.getMonth(), 1),
      };
    }
    return { start: null, end: null };
  }
  function affAvailable(comms, wds) {
    var n = (comms || [])
      .filter(function (a) {
        return AFF_OK[String(a.status || "").toLowerCase()];
      })
      .reduce(function (a, i) {
        return a + Number(i.amount_cents || 0);
      }, 0);
    var r = (wds || [])
      .filter(function (a) {
        return isAffiliateWd(a) && WD_OPEN[String(a.status || "").toLowerCase()];
      })
      .reduce(function (a, i) {
        return a + Number(i.amount_cents || 0);
      }, 0);
    return Math.max(0, n - r);
  }
  function safeQuery(supa, table, select, filterFn) {
    var q = supa.from(table).select(select);
    if (filterFn) q = filterFn(q);
    return q.then(function (res) {
      if (res.error) return [];
      return res.data || [];
    }).catch(function () {
      return [];
    });
  }

  function buildLedger() {
    var G = [];
    var refundModality = function (se) {
      var fe = String((se && se.refund_modality) || "").toUpperCase();
      var re = String((se && se.refund_method) || "").toUpperCase();
      if (fe === "SALDO_INTEGRAL") return "Reembolso Integral em Saldo (entrada + perda na casa)";
      if (fe === "SALDO_PIX" || re === "PIX+SALDO") return "Reembolso Saldo + PIX (entrada no saldo, perda via PIX)";
      if (re === "PIX") return "Reembolso via PIX (valor enviado à sua chave PIX)";
      if (re === "SALDO") return "Reembolso em Saldo (valor creditado na conta)";
      return null;
    };
    var ce = new Map();
    var Pe = new Set();
    [].concat(state.refunds, state.backRefunds).forEach(function (se) {
      if (!se || !se.protection_id) return;
      var fe = refundModality(se);
      if (fe) ce.set(String(se.protection_id), fe);
      if (isRefundPaid(se)) Pe.add(String(se.protection_id));
    });

    var allProt = [].concat(state.protections, state.backProtections);
    allProt.forEach(function (se) {
      var fe = String(se.id);
      var re = String(se.status || "").toLowerCase();
      var Se = String(se.settled_outcome || "").toLowerCase();
      var Ce = re === "cancelled" || re === "canceled";
      var Ne = Number(se.amount_cents || 0);
      var Je = Number(se.user_profit_cents || 0);
      var Ye = Number(
        se.platform_deduction_cents != null
          ? se.platform_deduction_cents
          : se.locked_deduction_cents != null
            ? se.locked_deduction_cents
            : 0
      );
      var at = ce.get(fe);
      if (se.refunded_at && Pe.has(fe)) return;
      var ze = "Proteção Ativa";
      var je = statusLabel(se.status);
      var pe = Ne;
      var Ae = false;
      var Ue = se.created_at;
      var Qe = "Capital alocado";
      if (se.refunded_at) {
        ze = "Proteção Reembolsada";
        je = "Reembolsado";
        pe = Ne;
        Ae = true;
        Ue = se.refunded_at;
        Qe = at ? "Capital devolvido • " + at : "Capital devolvido";
      } else if (Ce) {
        ze = "Proteção Cancelada";
        je = "Cancelado";
        pe = Ne;
        Ae = true;
        Ue = se.settled_at || se.updated_at || se.created_at;
        Qe = "Capital devolvido (jogo cancelado)";
      } else if (se.settled_at) {
        ze = "Proteção Encerrada";
        Ue = se.settled_at;
        if (Se === "arbishield") {
          je = "ArbiShield";
          pe = Ne;
          Ae = true;
          Qe = "Coberto pela ArbiShield • stake + dedução no Saldo Reembolso";
        } else if (Se === "exchange") {
          je = "Exchange";
          if (Ye > 0) {
            pe = Ye;
            Ae = false;
            Qe = "Bateu na exchange • dedução da taxa (devolvido " + money(Ne - Ye) + ")";
          } else {
            pe = Ne;
            Ae = true;
            Qe = "Bateu na exchange • capital devolvido";
          }
        } else if (Se === "won" || Se === "win" || Se === "user_won") {
          je = "Vitória";
          pe = Je > 0 ? Je : Ne;
          Ae = true;
          Qe = Je > 0 ? "Lucro real creditado" : "Capital devolvido";
        } else {
          je = statusLabel(se.settled_outcome || se.status);
          pe = Ne;
          Ae = true;
          Qe = "Encerramento";
        }
      } else {
        je = statusLabel(se.status) || "Ativa";
      }
      var match = se.match || {};
      G.push({
        id: "prot-" + fe,
        ts: Ue,
        group: "protecao",
        action: ze,
        status: je,
        valueCents: pe,
        credit: Ae,
        protectionId: fe,
        origin: Qe,
        home: match.home_team || se.home_team || "",
        away: match.away_team || se.away_team || "",
        market: se.market_category || match.league || "",
        side: se.side || "",
        odd: se.odd,
      });
    });

    function pushRefund(se) {
      var fe = String(se.id);
      var Ce = Number(se.amount_cents || 0);
      var Ne = Number(se.external_loss_cents || 0);
      var Se = refundValue(se);
      var Je =
        Ne > 0
          ? "Entrada " + money(Ce) + " + Perda na casa " + money(Ne) + " = " + money(Se)
          : null;
      var mod = refundModality(se);
      var Ye = mod ? (Je ? mod + " • " + Je : mod) : Je || undefined;
      var at = String(se.status || "");
      var ze = at.toLowerCase();
      var je = at.toUpperCase();
      var pe = "Reembolso Solicitado";
      var Ae;
      var Ue = se.created_at;
      var Qe = statusLabel(se.status);
      if (isRefundPaid(se)) {
        var ct = String((se && se.refund_modality) || "").toUpperCase();
        var xt = String((se && se.refund_method) || "").toUpperCase();
        var Fe = "";
        if (ct === "SALDO_INTEGRAL") Fe = " — Saldo Integral";
        else if (ct === "SALDO_PIX" || xt === "PIX+SALDO") Fe = " — Saldo + PIX";
        else if (xt === "PIX") Fe = " — PIX";
        else if (xt === "SALDO") Fe = " — Saldo";
        pe = "Reembolso Pago" + Fe;
        Qe = "Pago";
        Ae = true;
        Ue = se.paid_at || se.processed_at || se.updated_at || se.created_at;
      } else if (
        ze === "approved" ||
        ze === "available" ||
        je === "SALDO LIBERADO" ||
        je === "PIX APROVADO"
      ) {
        pe = "Reembolso Aprovado";
        Qe = "Aprovado";
        Ue = se.updated_at || se.processed_at || se.created_at;
      } else if (ze === "rejected" || je === "REJEITADO") {
        pe = "Reembolso Rejeitado";
        Qe = "Rejeitado";
        Ue = se.updated_at || se.created_at;
      } else if (ze === "cancelled" || ze === "canceled") {
        pe = "Reembolso Cancelado";
        Qe = "Cancelado";
        Ue = se.updated_at || se.created_at;
      } else if (
        ze === "under_review" ||
        ze === "in_review" ||
        ze === "pending_review" ||
        je === "EM ANÁLISE" ||
        je === "AGUARDANDO COMPROVANTE"
      ) {
        pe = "Reembolso Em Análise";
        Qe = "Em análise";
        Ue = se.updated_at || se.created_at;
      }
      G.push({
        id: "rf-" + fe,
        ts: Ue,
        group: "reembolso",
        action: pe,
        status: Qe,
        valueCents: Se,
        credit: Ae,
        protectionId: se.protection_id,
        origin: Ye,
        externalLossCents: Ne,
      });
    }
    state.refunds.forEach(pushRefund);
    state.backRefunds.forEach(pushRefund);

    state.contestations.forEach(function (se) {
      var fe = String(se.id);
      var re = String(se.status || "").toLowerCase();
      var Se = "Contestação Aberta";
      var Ce = statusLabel(se.status);
      var Ne = se.created_at;
      if (se.resolved_at) {
        if (re === "approved") {
          Se = "Contestação Procedente";
          Ce = "Aprovado";
        } else if (re === "rejected") {
          Se = "Contestação Improcedente";
          Ce = "Rejeitado";
        } else Se = "Contestação Encerrada";
        Ne = se.resolved_at;
      } else if (re === "under_review" || re === "in_review" || re === "pending_review") {
        Se = "Contestação Em Análise";
        Ce = "Em análise";
        Ne = se.updated_at || se.created_at;
      }
      G.push({
        id: "ct-" + fe,
        ts: Ne,
        group: "contestacao",
        action: Se,
        status: Ce,
        protectionId: se.protection_id,
        origin:
          se.requested_odd != null
            ? "Odd solicitada " + Number(se.requested_odd).toFixed(2)
            : undefined,
      });
    });

    state.manualDeposits.forEach(function (se) {
      var fe = String(se.id);
      var re = String(se.status || "").toLowerCase();
      var Se;
      var Ce;
      var Ne = statusLabel(se.status);
      var Je = se.updated_at || se.created_at;
      if (re === "approved") {
        Se = "Depósito Aprovado";
        Ne = "Aprovado";
        Ce = true;
      } else if (re === "rejected") {
        Se = "Depósito Rejeitado";
        Ne = "Rejeitado";
      } else if (re === "cancelled" || re === "canceled") {
        Se = "Depósito Cancelado";
        Ne = "Cancelado";
      } else if (se.proof_url) {
        Se = "Comprovante Enviado";
        Ne = "Em análise";
        Je = se.created_at;
      } else {
        Se = "Depósito Criado";
        Ne = "Pendente";
        Je = se.created_at;
      }
      G.push({
        id: "md-" + fe,
        ts: Je,
        group: "deposito",
        action: Se,
        status: Ne,
        valueCents: Number(se.amount_cents || 0),
        credit: Ce,
        origin: depositOrigin(se),
      });
    });

    state.asaas.forEach(function (se) {
      var fe = String(se.id);
      var re = String(se.status || "").toLowerCase();
      var Se = re === "confirmed" || re === "approved" || re === "paid";
      var Ce;
      var Ne;
      var Je = statusLabel(se.status);
      var Ye = se.updated_at || se.created_at;
      if (Se) {
        Ce = "Depósito Aprovado";
        Je = "Aprovado";
        Ne = true;
      } else if (re === "rejected") {
        Ce = "Depósito Rejeitado";
        Je = "Rejeitado";
      } else if (re === "expired") {
        Ce = "Depósito Expirado";
        Je = "Expirado";
      } else if (re === "cancelled" || re === "canceled") {
        Ce = "Depósito Cancelado";
        Je = "Cancelado";
      } else {
        Ce = "Depósito Criado";
        Je = "Pendente";
        Ye = se.created_at;
      }
      G.push({
        id: "as-" + fe,
        ts: Ye,
        group: "deposito",
        action: Ce,
        status: Je,
        valueCents: Number(se.confirmed_amount_cents || se.amount_cents || 0),
        credit: Ne,
        origin: "PIX",
      });
    });

    state.withdrawals.forEach(function (se) {
      var fe = String(se.id);
      var re = isAffiliateWd(se);
      var Se = re ? "afiliado" : "saque";
      var Ce = String(se.status || "").toLowerCase();
      var Ne;
      var Je = false;
      var Ye = statusLabel(se.status);
      var at = se.updated_at || se.created_at;
      if (Ce === "paid") {
        Ne = re ? "Saque Afiliado Pago" : "Saque Pago";
        Ye = "Pago";
      } else if (Ce === "rejected") {
        Ne = re ? "Saque Afiliado Rejeitado" : "Saque Rejeitado";
        Ye = "Rejeitado";
        Je = undefined;
      } else if (Ce === "cancelled" || Ce === "canceled") {
        Ne = re ? "Saque Afiliado Cancelado" : "Saque Cancelado";
        Ye = "Cancelado";
        Je = undefined;
      } else if (Ce === "pending_payout" || Ce === "approved") {
        Ne = re ? "Saque Afiliado Em Análise" : "Saque Em Análise";
        Ye = "Em análise";
      } else {
        Ne = re ? "Saque Afiliado Solicitado" : "Saque Solicitado";
        Ye = "Pendente";
        at = se.created_at;
      }
      G.push({
        id: "wd-" + fe,
        ts: at,
        group: Se,
        action: Ne,
        status: Ye,
        valueCents: Number(se.amount_cents || 0),
        credit: Je,
        origin: se.pix_key ? "PIX " + se.pix_key : "PIX",
      });
    });

    state.commissions.forEach(function (se) {
      var fe = String(se.id);
      var re = String(se.status || "").toLowerCase();
      var Se = re === "approved" || re === "available" || re === "paid";
      var Ce = "Comissão Gerada";
      var Ne = statusLabel(se.status);
      var Je;
      var Ye = se.created_at;
      if (Se) {
        Ce = "Comissão Liberada";
        Ne = re === "paid" ? "Pago" : "Disponível";
        Je = true;
        Ye = se.updated_at || se.created_at;
      } else if (re === "rejected") {
        Ce = "Comissão Rejeitada";
        Ne = "Rejeitado";
        Ye = se.updated_at || se.created_at;
      } else if (re === "cancelled" || re === "canceled") {
        Ce = "Comissão Cancelada";
        Ne = "Cancelado";
        Ye = se.updated_at || se.created_at;
      } else Ne = "Pendente";
      G.push({
        id: "co-" + fe,
        ts: Ye,
        group: "afiliado",
        action: Ce,
        status: Ne,
        valueCents: Number(se.amount_cents || 0),
        credit: Je,
        origin: "Rede de afiliados",
        referredId: se.referred_id,
        protectionId: se.protection_id,
      });
    });

    state.distributions.forEach(function (se) {
      G.push({
        id: "pd-" + se.id,
        ts: se.created_at,
        group: "provedor",
        action: "Distribuição Recebida",
        status: "Pago",
        valueCents: Math.round(Number(se.distribution_amount || 0)),
        credit: true,
        origin: se.description || "Pool de liquidez",
        aporte: se.contribution_amount != null ? Math.round(Number(se.contribution_amount)) : null,
      });
    });

    state.partnerWithdrawals.forEach(function (se) {
      var fe = String(se.id);
      var re = Math.round(Number(se.amount || se.amount_cents || 0));
      var Se = String(se.status || "").toLowerCase();
      var Ce;
      var Ne = false;
      var Je = statusLabel(se.status);
      var Ye = se.updated_at || se.created_at;
      if (Se === "paid") {
        Ce = "Saque Provedor Pago";
        Je = "Pago";
      } else if (Se === "rejected") {
        Ce = "Saque Provedor Rejeitado";
        Je = "Rejeitado";
        Ne = undefined;
      } else if (Se === "cancelled" || Se === "canceled") {
        Ce = "Saque Provedor Cancelado";
        Je = "Cancelado";
        Ne = undefined;
      } else if (Se === "approved" || Se === "pending_payout") {
        Ce = "Saque Provedor Em Análise";
        Je = "Em análise";
      } else {
        Ce = "Saque Provedor Solicitado";
        Je = "Pendente";
        Ye = se.created_at;
      }
      G.push({
        id: "pw-" + fe,
        ts: Ye,
        group: "provedor",
        action: Ce,
        status: Je,
        valueCents: re,
        credit: Ne,
      });
    });

    G.sort(function (a, b) {
      return new Date(b.ts).getTime() - new Date(a.ts).getTime();
    });
    state.ledger = G;
  }

  function applyFilters() {
    var bounds = periodBounds(state.period);
    var q = state.search.trim().toLowerCase();
    state.filtered = state.ledger.filter(function (row) {
      var ie = new Date(row.ts);
      if (bounds.start && ie < bounds.start) return false;
      if (bounds.end && ie >= bounds.end) return false;
      if (state.group !== "all" && row.group !== state.group) return false;
      if (!q) return true;
      var game = ((row.home || "") + " " + (row.away || "")).toLowerCase();
      return (
        String(row.action || "").toLowerCase().indexOf(q) >= 0 ||
        String(row.origin || "").toLowerCase().indexOf(q) >= 0 ||
        String(row.status || "").toLowerCase().indexOf(q) >= 0 ||
        String(GROUP_LABEL[row.group] || "").toLowerCase().indexOf(q) >= 0 ||
        game.indexOf(q) >= 0 ||
        String(row.market || "").toLowerCase().indexOf(q) >= 0
      );
    });
    var pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    if (state.page > pages) state.page = pages;
  }

  function periodSummary() {
    var G = 0,
      Q = 0,
      ie = 0,
      we = 0,
      ce = 0;
    var Pe = { saque: 1, afiliado: 1, provedor: 1 };
    state.filtered.forEach(function (se) {
      if (se.valueCents == null) return;
      var fe = Number(se.valueCents || 0);
      if (se.credit === true) {
        if (se.group === "deposito") G += fe;
        if (se.group === "reembolso" && se.status === "Pago") ie += Number(se.externalLossCents || 0);
        if (se.group === "afiliado") we += fe;
        if (se.group === "provedor") ce += fe;
      }
      if (se.credit === false && Pe[se.group] && se.status === "Pago") Q += fe;
    });
    return {
      entradas: G,
      saidas: Q,
      reembolsos: ie,
      comissoes: we,
      distribuicoes: ce,
      final: G + ie + we + ce - Q,
    };
  }

  function computeMetrics() {
    var p = state.profile || {};
    // Saldo Real (carteira) = balance (+ legado reusable consolidado) — sem demo
    var real =
      Number(p.balance_cents || 0) + Number(p.reusable_balance_cents || 0);
    var deduction = Number(p.deduction_balance_cents || 0);
    // Transferência Banca→Desafio: só saldo real livre (nunca reusable/locked/dedução).
    var transferableReal = Number(p.balance_cents || 0);
    // Chip do header "Apostador" = mesma fórmula do shell (inclui demo + saldo dedução)
    var apostadorHeader =
      real + deduction + Number(p.demo_balance_cents || 0);
    var provider =
      Number(p.investor_balance_cents || 0) +
      Number(p.demo_balance_provider_cents || 0);
    var locked = Number(p.locked_balance_cents || 0);
    var desafio = Number(p.desafio_balance_cents || 0);
    var active = [].concat(state.protections, state.backProtections).filter(function (r) {
      return String(r.status || "").toLowerCase() === "active";
    });
    var activeLocked = active.reduce(function (a, r) {
      return a + Number(r.amount_cents || 0);
    }, 0);
    if (!locked) locked = activeLocked;
    var aff = affAvailable(state.commissions, state.withdrawals);
    state.realBalance = real;
    state.deductionBalance = deduction;
    state.transferableReal = transferableReal;
    state.apostadorHeader = apostadorHeader;
    state.providerBalance = provider;
    state.affBalance = aff;
    state.locked = locked;
    state.activeCount = active.length;
    state.desafio = desafio;

    var monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    var d30 = new Date();
    d30.setDate(d30.getDate() - 30);

    var profit = (state.walletTx || [])
      .filter(function (t) {
        return t.type === "profit" && t.created_at && new Date(t.created_at) >= d30;
      })
      .reduce(function (a, t) {
        return a + Number(t.amount_cents || 0);
      }, 0);
    if (!profit) {
      profit = [].concat(state.protections, state.backProtections)
        .filter(function (r) {
          return r.settled_at && new Date(r.settled_at) >= d30;
        })
        .reduce(function (a, r) {
          return a + Number(r.user_profit_cents || 0);
        }, 0);
    }
    var refunded = [].concat(state.protections, state.backProtections)
      .filter(function (r) {
        var st = String(r.status || "").toLowerCase();
        var when = r.refunded_at || r.updated_at || r.created_at;
        return (
          (st === "refunded" || st === "refund_requested" || r.refunded_at) &&
          when &&
          new Date(when) >= monthStart
        );
      })
      .reduce(function (a, r) {
        return a + Number(r.amount_cents || 0);
      }, 0);

    var total = real + deduction + provider + aff + locked;
    state.metrics = {
      total: total,
      balance: real,
      blocked: locked,
      profit: profit,
      refunded: refunded,
      monthVar: profit > 0 ? ((profit / Math.max(total, 1)) * 100).toFixed(2) : "0.00",
      feeAvg: 1.5,
      yield: provider > 0 ? ((profit / Math.max(provider, 1)) * 100).toFixed(2) : "0.00",
    };
  }

  function renderBalances() {
    setText("finBalReal", money(state.realBalance));
    setText("finBalDeduction", money(state.deductionBalance || 0));
    setText("finBalProv", money(state.providerBalance));
    setText("finBalAff", money(state.affBalance));
    setText(
      "finBalTotal",
      money(
        state.realBalance +
          (state.deductionBalance || 0) +
          state.providerBalance +
          state.affBalance +
          state.locked
      )
    );
    var btnDed = document.getElementById("btnSaqueDeduction");
    if (btnDed) {
      btnDed.disabled = !(state.deductionBalance > 0);
    }
    setText("finProtCount", String(state.activeCount));
    setText("finProtLocked", money(state.locked));
    setText("metTotal", money(state.metrics.total));
    setText("metMonthVar", "▲ +" + state.metrics.monthVar + "% este mês");
    setText("metBlocked", money(state.metrics.blocked));
    setText("metActiveSub", state.activeCount + " proteções ativas");
    setText("metProfit", money(state.metrics.profit));
    setText("metRefunded", money(state.metrics.refunded));
    setText("metPL", money(state.metrics.profit));
    setText("metFee", "1,50%");
    setText("metYield", state.metrics.yield + "%");
    // Não sobrescrever o chip com "Saldo Real" (sem demo) — isso fazia o
    // header mudar ao atualizar /app-carteira.html vs /app.html
    var hdr = document.getElementById("v2BalApostador");
    if (hdr) hdr.textContent = money(state.apostadorHeader);
    var hdrCongelado = document.getElementById("v2BalCongelado");
    if (hdrCongelado) hdrCongelado.textContent = money(state.locked);
    var hdrProv = document.getElementById("v2BalProvedor");
    if (hdrProv) hdrProv.textContent = money(state.providerBalance);
    var hdrDesafio = document.getElementById("v2BalDesafio");
    if (hdrDesafio) hdrDesafio.textContent = money(state.desafio);
    var hdrAff = document.getElementById("v2BalAfiliado");
    if (hdrAff) hdrAff.textContent = money(state.affBalance);
  }

  function valueCell(row) {
    if (row.valueCents == null) return "—";
    var cls =
      row.credit === true ? "pos" : row.credit === false ? "neg" : "";
    var prefix = row.credit === true ? "+" : row.credit === false ? "−" : "";
    return (
      '<span class="' +
      cls +
      '">' +
      prefix +
      esc(money(Math.abs(Number(row.valueCents || 0)))) +
      "</span>"
    );
  }

  function detailsCell(row) {
    var parts = [];
    if (row.home && row.away) parts.push(esc(row.home) + " × " + esc(row.away));
    if (row.side) {
      parts.push(
        '<span class="fin-tag ' +
          (String(row.side).toUpperCase() === "LAY" ? "lay" : "back") +
          '">' +
          esc(String(row.side).toUpperCase()) +
          "</span>"
      );
    }
    if (row.odd != null) parts.push("Odd " + esc(Number(row.odd).toFixed(2)));
    if (row.origin) parts.push(esc(row.origin));
    return parts.length ? parts.join(" · ") : "—";
  }

  function renderLedger() {
    applyFilters();
    var body = document.getElementById("finLedgerBody");
    var pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    var page = Math.min(state.page, pages);
    state.page = page;
    var slice = state.filtered.slice((page - 1) * state.pageSize, page * state.pageSize);
    if (!slice.length) {
      body.innerHTML = '<tr><td colspan="6" class="fin-empty">Nenhum dado encontrado</td></tr>';
    } else {
      body.innerHTML = slice
        .map(function (row) {
          var d = new Date(row.ts);
          return (
            "<tr>" +
            "<td>" +
            esc(d.toLocaleString("pt-BR")) +
            "</td>" +
            "<td><span class=\"fin-group\">" +
            esc(GROUP_LABEL[row.group] || row.group) +
            "</span></td>" +
            "<td>" +
            esc(row.action) +
            "</td>" +
            "<td>" +
            esc(row.status || "—") +
            "</td>" +
            "<td class=\"fin-details\">" +
            detailsCell(row) +
            "</td>" +
            '<td class="num">' +
            valueCell(row) +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }
    setText("finPageInfo", page + " / " + pages);
    document.getElementById("finPrev").disabled = page <= 1;
    document.getElementById("finNext").disabled = page >= pages;

    var sum = periodSummary();
    var plabel = (PERIODS.find(function (p) {
      return p.id === state.period;
    }) || {}).label || state.period;
    setText("finPeriodLabel", plabel);
    setText("sumDep", money(sum.entradas));
    setText("sumWd", money(sum.saidas));
    setText("sumRf", money(sum.reembolsos));
    setText("sumCo", money(sum.comissoes));
    setText("sumDi", money(sum.distribuicoes));
    setText("sumFinal", money(sum.final));

    renderReports(sum);
    renderWidgets();
  }

  function renderCommissions() {
    var body = document.getElementById("finCommBody");
    var rows = state.commissions || [];
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="5" class="fin-empty">Nenhuma comissão registrada.</td></tr>';
    } else {
      body.innerHTML = rows
        .map(function (G) {
          return (
            "<tr><td>" +
            esc(new Date(G.created_at).toLocaleString("pt-BR")) +
            "</td><td>" +
            esc(statusLabel(G.status)) +
            '</td><td class="mono">' +
            esc(String(G.referred_id || "").slice(0, 8)) +
            (G.referred_id ? "…" : "—") +
            '</td><td class="mono">' +
            esc(String(G.protection_id || "").slice(0, 8)) +
            (G.protection_id ? "…" : "—") +
            '</td><td class="num pos">' +
            esc(money(Number(G.amount_cents || 0))) +
            "</td></tr>"
          );
        })
        .join("");
    }
    setText(
      "finAffNote",
      "Saldo afiliado disponível para saque: " +
        money(state.affBalance) +
        " — calculado conservadoramente (comissões aprovadas menos saques pendentes/aprovados/pagos)."
    );
  }

  function renderDistributions() {
    var body = document.getElementById("finDistBody");
    var rows = state.distributions || [];
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="4" class="fin-empty">Nenhuma distribuição de provedor.</td></tr>';
    } else {
      body.innerHTML = rows
        .map(function (G) {
          var aporte =
            G.contribution_amount != null
              ? money(Math.round(Number(G.contribution_amount)))
              : "—";
          return (
            "<tr><td>" +
            esc(new Date(G.created_at).toLocaleString("pt-BR")) +
            "</td><td>" +
            esc(G.description || "Distribuição") +
            '</td><td class="num">' +
            esc(aporte) +
            '</td><td class="num pos">' +
            esc(money(Math.round(Number(G.distribution_amount || 0)))) +
            "</td></tr>"
          );
        })
        .join("");
    }
  }

  function renderReports(sum) {
    sum = sum || periodSummary();
    var periodUl = document.getElementById("finReportPeriod");
    var balUl = document.getElementById("finReportBalances");
    if (periodUl) {
      periodUl.innerHTML = [
        ["Entradas", money(sum.entradas)],
        ["Saídas", money(sum.saidas)],
        ["Reembolsos", money(sum.reembolsos)],
        ["Comissões", money(sum.comissoes)],
        ["Distribuições", money(sum.distribuicoes)],
        ["Saldo do Período", money(sum.final)],
      ]
        .map(function (r) {
          return "<li><span>" + esc(r[0]) + "</span><strong>" + esc(r[1]) + "</strong></li>";
        })
        .join("");
    }
    if (balUl) {
      balUl.innerHTML = [
        ["Saldo Real (não sacável)", money(state.realBalance)],
        ["Saldo Reembolso (usável/sacável)", money(state.deductionBalance || 0)],
        ["Saldo Provedor", money(state.providerBalance)],
        ["Saldo Afiliado disponível", money(state.affBalance)],
        ["Capital em proteções", money(state.locked)],
        [
          "Total consolidado",
          money(state.realBalance + state.providerBalance + state.affBalance + state.locked),
        ],
      ]
        .map(function (r) {
          return "<li><span>" + esc(r[0]) + "</span><strong>" + esc(r[1]) + "</strong></li>";
        })
        .join("");
    }
  }

  function renderWidgets() {
    var mov = document.getElementById("finMovList");
    var ops = document.getElementById("finOpsList");
    var top = state.filtered.slice(0, 6);
    if (mov) {
      mov.innerHTML = top.length
        ? top
            .map(function (r) {
              return (
                "<li><div><strong>" +
                esc(r.action) +
                "</strong><span>" +
                esc(new Date(r.ts).toLocaleDateString("pt-BR")) +
                "</span></div><em>" +
                (r.valueCents != null ? esc(money(r.valueCents)) : "—") +
                "</em></li>"
              );
            })
            .join("")
        : '<li class="fin-empty-li">Nenhuma movimentação no período.</li>';
    }
    var protOps = state.filtered
      .filter(function (r) {
        return r.group === "protecao" || r.group === "reembolso";
      })
      .slice(0, 6);
    if (ops) {
      ops.innerHTML = protOps.length
        ? protOps
            .map(function (r) {
              return (
                "<li><div><strong>" +
                esc(r.action) +
                "</strong><span>" +
                esc(r.status || "") +
                "</span></div><em>" +
                (r.valueCents != null ? esc(money(r.valueCents)) : "—") +
                "</em></li>"
              );
            })
            .join("")
        : '<li class="fin-empty-li">Nenhuma operação registrada.</li>';
    }
    renderDonut();
    renderChart();
  }

  function renderDonut() {
    var parts = [
      { name: "Disponível", value: state.metrics.balance, color: "#C6FF00" },
      { name: "Bloqueado", value: state.metrics.blocked, color: "#3b82f6" },
      { name: "Lucro Real", value: Math.max(0, state.metrics.profit), color: "#22c55e" },
      { name: "Reembolsos", value: state.metrics.refunded, color: "#a855f7" },
    ];
    var total = parts.reduce(function (a, p) {
      return a + p.value;
    }, 0) || 1;
    var host = document.getElementById("finDonut");
    var legend = document.getElementById("finLegend");
    var acc = 0;
    var segs = parts
      .map(function (p) {
        var pct = (p.value / total) * 100;
        var start = acc;
        acc += pct;
        return p.color + " " + start.toFixed(2) + "% " + acc.toFixed(2) + "%";
      })
      .join(", ");
    if (host) {
      host.style.background =
        "conic-gradient(" + (total === 1 && parts.every(function (p) { return !p.value; })
          ? "#1a1a1a 0% 100%"
          : segs) +
        ")";
      host.innerHTML = "<span>Total<br/><strong>" + esc(money(state.metrics.total)) + "</strong></span>";
    }
    if (legend) {
      legend.innerHTML = parts
        .map(function (p) {
          return (
            "<li><i style=\"background:" +
            p.color +
            "\"></i><span>" +
            esc(p.name) +
            '</span><strong>' +
            ((p.value / total) * 100).toFixed(1) +
            "%</strong></li>"
          );
        })
        .join("");
    }
  }

  function renderChart() {
    var host = document.getElementById("finChart");
    if (!host) return;
    var deltas = new Map();
    (state.walletTx || []).forEach(function (O) {
      var I = new Date(O.created_at);
      I.setHours(0, 0, 0, 0);
      var L = I.toDateString();
      var $ = Number(O.amount_cents) / 100;
      var B = ["deposit", "profit", "coverage_credit", "refund"].indexOf(O.type) >= 0;
      deltas.set(L, (deltas.get(L) || 0) + (B ? $ : -$));
    });
    var A = state.metrics.total / 100;
    var R = [];
    for (var O = 0; O < 30; O++) {
      var I = new Date();
      I.setHours(0, 0, 0, 0);
      I.setDate(I.getDate() - O);
      R.push({ d: 29 - O, v: Math.max(0, A) });
      A -= deltas.get(I.toDateString()) || 0;
    }
    R.reverse();
    var w = 640;
    var h = 220;
    var pad = 12;
    var max = Math.max.apply(
      null,
      R.map(function (p) {
        return p.v;
      }).concat([1])
    );
    var min = Math.min.apply(
      null,
      R.map(function (p) {
        return p.v;
      })
    );
    var span = Math.max(max - min, 1);
    var coords = R.map(function (p, i) {
      var x = pad + (i / Math.max(R.length - 1, 1)) * (w - pad * 2);
      var y = h - pad - ((p.v - min) / span) * (h - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    host.innerHTML =
      '<svg viewBox="0 0 ' +
      w +
      " " +
      h +
      '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="finLine" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0%" stop-color="#C6FF00" stop-opacity="0.45"/>' +
      '<stop offset="100%" stop-color="#C6FF00" stop-opacity="1"/>' +
      "</linearGradient>" +
      '<linearGradient id="finFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#C6FF00" stop-opacity="0.18"/>' +
      '<stop offset="100%" stop-color="#C6FF00" stop-opacity="0"/>' +
      "</linearGradient></defs>" +
      '<polygon fill="url(#finFill)" points="' +
      pad +
      "," +
      (h - pad) +
      " " +
      coords.join(" ") +
      " " +
      (w - pad) +
      "," +
      (h - pad) +
      '"/>' +
      '<polyline fill="none" stroke="url(#finLine)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="' +
      coords.join(" ") +
      '"/>' +
      "</svg>";
  }

  function exportCsv() {
    applyFilters();
    var rows = [
      ["data", "hora", "grupo", "acao", "status", "jogo", "mercado", "tipo", "odd", "valor_cents"],
    ].concat(
      state.filtered.map(function (Pe) {
        var de = new Date(Pe.ts);
        return [
          de.toLocaleDateString("pt-BR"),
          de.toLocaleTimeString("pt-BR"),
          GROUP_LABEL[Pe.group] || Pe.group,
          Pe.action,
          Pe.status || "",
          Pe.home && Pe.away ? Pe.home + " x " + Pe.away : "",
          Pe.market || "",
          String(Pe.side || "").toUpperCase(),
          Pe.odd != null ? String(Pe.odd) : "",
          Pe.valueCents != null ? String(Pe.valueCents) : "",
        ];
      })
    );
    var csv = rows
      .map(function (Pe) {
        return Pe.map(function (de) {
          return '"' + String(de).replace(/"/g, '""') + '"';
        }).join(",");
      })
      .join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "centro-financeiro-" + state.period + "-" + Date.now() + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".fin-tab").forEach(function (btn) {
      var on = btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".fin-panel").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-panel") !== tab;
    });
  }

  function openTransfer() {
    var modal = document.getElementById("finTransferModal");
    var banca = Number(state.transferableReal != null ? state.transferableReal : state.realBalance) || 0;
    var max = Math.floor(banca / 2);
    setText("finTransferAvail", money(banca));
    setText("finTransferMax", money(max));
    document.getElementById("finTransferAmount").value = "";
    var err = document.getElementById("finTransferErr");
    err.hidden = true;
    err.textContent = "";
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("open");
  }
  function closeTransfer() {
    var modal = document.getElementById("finTransferModal");
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("open");
  }

  async function submitTransfer() {
    var err = document.getElementById("finTransferErr");
    var raw = document.getElementById("finTransferAmount").value || "";
    var normalized = raw.replace(/\./g, "").replace(",", ".");
    var reais = parseFloat(normalized);
    var cents = Math.round((reais || 0) * 100);
    if (!cents || cents <= 0) {
      err.textContent = "Informe um valor válido.";
      err.hidden = false;
      return;
    }
    var btn = document.getElementById("finTransferSubmit");
    btn.disabled = true;
    try {
      var supa = ArbiV2.client();
      var sess = await supa.auth.getSession();
      var token = sess && sess.data && sess.data.session && sess.data.session.access_token;
      if (!token) throw new Error("Sessão expirada");
      var res = await fetch("/api/arbishield/transfer-desafio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ amountCents: cents }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Falha na transferência");
      closeTransfer();
      location.reload();
    } catch (ex) {
      err.textContent = ex.message || "Erro";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function requestDeductionWithdraw() {
    var avail = Number(state.deductionBalance || 0);
    if (!(avail > 0)) {
      alert("Saldo Reembolso zerado.");
      return;
    }
    var pix =
      (state.profile && (state.profile.pix_key || state.profile.pixKey)) || "";
    if (!pix) {
      alert("Cadastre sua chave Pix no Perfil antes de sacar o Saldo Reembolso.");
      return;
    }
    var def = (avail / 100).toFixed(2).replace(".", ",");
    var raw = window.prompt(
      "Valor do saque do Saldo Reembolso (disponível R$ " + def + "):",
      def
    );
    if (raw == null) return;
    var normalized = String(raw).replace(/\./g, "").replace(",", ".");
    var cents = Math.round((parseFloat(normalized) || 0) * 100);
    if (!(cents > 0)) {
      alert("Valor inválido.");
      return;
    }
    if (cents > avail) {
      alert("Valor acima do Saldo Reembolso disponível.");
      return;
    }
    try {
      var supa = ArbiV2.client();
      var sess = await supa.auth.getSession();
      var token =
        sess && sess.data && sess.data.session && sess.data.session.access_token;
      if (!token) throw new Error("Sessão expirada");
      // Usa affiliate-withdraw (rota já liberada no nginx). O shim desvia
      // para Saldo Reembolso quando wallet=reembolso.
      async function postWithdraw(url, payload) {
        var r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(payload),
        });
        var rawText = await r.text();
        var parsed = {};
        try {
          parsed = rawText ? JSON.parse(rawText) : {};
        } catch (_) {
          parsed = {};
        }
        return { res: r, data: parsed, raw: rawText };
      }
      var payload = {
        amountCents: cents,
        pix_key: pix,
        wallet: "reembolso",
        saldo_reembolso: true,
        kind: "saldo_reembolso",
      };
      var attempt = await postWithdraw("/api/arbishield/affiliate-withdraw", payload);
      // fallback se a VPS já tiver a rota dedicada
      if (
        !attempt.res.ok &&
        (attempt.data.error === "not_found" || attempt.res.status === 404)
      ) {
        attempt = await postWithdraw("/api/arbishield/deduction-withdraw", payload);
      }
      var res = attempt.res;
      var data = attempt.data;
      if (!res.ok) {
        var errCode = String(data.error || data.message || "");
        var msg = errCode;
        if (!msg || errCode === "not_found") {
          msg =
            "API de saque desatualizada na VPS. Rode como root:\n" +
            "bash <(curl -fsSL \"https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saldo-reembolso-saque-FORCE.sh\")";
        }
        // shim antigo trata como afiliado (dias 15/30) — pedir update
        if (/afiliado|15 e 30/i.test(errCode)) {
          msg =
            "Shim antigo na VPS (ainda trata como afiliado). Rode:\n" +
            "bash <(curl -fsSL \"https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saldo-reembolso-saque-FORCE.sh\")";
        }
        throw new Error(msg);
      }
      alert("Saque do Saldo Reembolso solicitado. Aguarde a análise.");
      location.reload();
    } catch (ex) {
      alert(ex.message || "Erro ao solicitar saque");
    }
  }

  function bindUi() {
    var btnDed = document.getElementById("btnSaqueDeduction");
    if (btnDed) btnDed.addEventListener("click", requestDeductionWithdraw);
    document.getElementById("finPeriod").addEventListener("change", function (e) {
      state.period = e.target.value;
      state.page = 1;
      renderLedger();
    });
    document.getElementById("finSearch").addEventListener("input", function (e) {
      state.search = e.target.value || "";
      state.page = 1;
      renderLedger();
    });
    document.getElementById("finPageSize").addEventListener("change", function (e) {
      state.pageSize = Number(e.target.value) || 10;
      state.page = 1;
      renderLedger();
    });
    document.getElementById("finPrev").addEventListener("click", function () {
      state.page = Math.max(1, state.page - 1);
      renderLedger();
    });
    document.getElementById("finNext").addEventListener("click", function () {
      state.page += 1;
      renderLedger();
    });
    document.getElementById("finChips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-group]");
      if (!btn) return;
      state.group = btn.getAttribute("data-group");
      state.page = 1;
      document.querySelectorAll(".fin-chip").forEach(function (c) {
        c.classList.toggle("active", c === btn);
      });
      renderLedger();
    });
    document.querySelectorAll(".fin-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchTab(btn.getAttribute("data-tab"));
      });
    });
    ["finExportCsv", "finExportCsv2"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", exportCsv);
    });
    ["finExportPdf", "finExportPdf2"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el)
        el.addEventListener("click", function () {
          window.print();
        });
    });
    document.getElementById("finScrollExtrato").addEventListener("click", function () {
      switchTab("extrato");
      document.getElementById("finExtratoAnchor").scrollIntoView({ behavior: "smooth" });
    });
    document.getElementById("finVerMov").addEventListener("click", function () {
      switchTab("extrato");
      document.getElementById("finExtratoAnchor").scrollIntoView({ behavior: "smooth" });
    });
    document.getElementById("finFilterProofs").addEventListener("click", function () {
      switchTab("extrato");
      state.group = "deposito";
      document.querySelectorAll(".fin-chip").forEach(function (c) {
        c.classList.toggle("active", c.getAttribute("data-group") === "deposito");
      });
      state.page = 1;
      renderLedger();
      document.getElementById("finExtratoAnchor").scrollIntoView({ behavior: "smooth" });
    });
    document.getElementById("finOpenTransfer").addEventListener("click", openTransfer);
    document.getElementById("finTransferSubmit").addEventListener("click", submitTransfer);
    document.getElementById("finTransferModal").addEventListener("click", function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute("data-fin-close") === "1") {
        closeTransfer();
      }
    });
  }

  async function loadAll(supa, userId) {
    var protSelect =
      "id,user_id,match_id,side,odd,status,amount_cents,user_profit_cents,platform_deduction_cents,locked_deduction_cents,created_at,settled_at,refunded_at,settled_outcome,updated_at,market_category,match:matches(home_team,away_team,league)";
    var protSelectPlain =
      "id,user_id,match_id,side,odd,status,amount_cents,user_profit_cents,platform_deduction_cents,locked_deduction_cents,created_at,settled_at,refunded_at,settled_outcome,updated_at";

    var profileRes = await supa
      .from("profiles")
      .select(
        "balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key"
      )
      .eq("id", userId)
      .maybeSingle();
    if (profileRes.error) {
      profileRes = await supa
        .from("profiles")
        .select(
          "balance_cents,reusable_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key"
        )
        .eq("id", userId)
        .maybeSingle();
    }
    if (profileRes.error) throw profileRes.error;
    state.profile = profileRes.data || {};

    var protections = await safeQuery(supa, "protections", protSelect, function (q) {
      return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
    });
    if (!protections.length) {
      protections = await safeQuery(supa, "protections", protSelectPlain, function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      });
    }
    state.protections = protections;

    state.backProtections = await safeQuery(
      supa,
      "back_protections",
      protSelectPlain + ",odd",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );

    state.refunds = await safeQuery(
      supa,
      "refund_requests",
      "id,user_id,protection_id,amount_cents,external_loss_cents,status,refund_modality,refund_method,paid_at,processed_at,updated_at,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );
    state.backRefunds = await safeQuery(
      supa,
      "back_refund_requests",
      "id,user_id,protection_id,amount_cents,external_loss_cents,status,refund_modality,refund_method,paid_at,processed_at,updated_at,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );
    state.contestations = await safeQuery(
      supa,
      "odd_contestations",
      "id,user_id,protection_id,status,requested_odd,resolved_at,updated_at,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );
    state.manualDeposits = await safeQuery(
      supa,
      "manual_deposits",
      "id,user_id,amount_cents,status,proof_url,deposit_type,network,updated_at,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );
    state.asaas = await safeQuery(
      supa,
      "asaas_payments",
      "id,user_id,amount_cents,confirmed_amount_cents,status,updated_at,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );
    state.withdrawals = await safeQuery(
      supa,
      "withdrawals",
      "id,user_id,amount_cents,status,pix_key,metadata,updated_at,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );
    state.commissions = await safeQuery(
      supa,
      "affiliate_commissions",
      "id,affiliate_id,referred_id,protection_id,amount_cents,status,updated_at,created_at",
      function (q) {
        return q.eq("affiliate_id", userId).order("created_at", { ascending: false }).limit(1000);
      }
    );
    state.distributions = await safeQuery(
      supa,
      "partner_distributions",
      "id,user_id,partner_id,distribution_amount,contribution_amount,description,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
      }
    );
    if (!state.distributions.length) {
      state.distributions = await safeQuery(
        supa,
        "partner_rounds",
        "id,user_id,distribution_amount,contribution_amount,description,created_at,status",
        function (q) {
          return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
        }
      );
    }
    state.partnerWithdrawals = await safeQuery(
      supa,
      "partner_withdraw_requests",
      "id,user_id,amount,amount_cents,status,updated_at,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
      }
    );

    state.walletTx = await safeQuery(
      supa,
      "unified_wallet_transactions",
      "id,type,amount_cents,created_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
      }
    );
    if (!state.walletTx.length) {
      state.walletTx = await safeQuery(
        supa,
        "wallet_transactions",
        "id,type,amount_cents,created_at",
        function (q) {
          return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
        }
      );
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!document.body || document.body.getAttribute("data-active") !== "carteira") return;
    bindUi();
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      var viewId = ArbiV2.getEffectiveUserId ? ArbiV2.getEffectiveUserId(user) : user.id;
      await loadAll(supa, viewId);
      buildLedger();
      computeMetrics();
      renderBalances();
      renderLedger();
      renderCommissions();
      renderDistributions();
    } catch (ex) {
      showErr(ex.message || "Erro ao carregar o centro financeiro");
    }
  });
})();
