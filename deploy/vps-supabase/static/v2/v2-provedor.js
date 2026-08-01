/**
 * Aba Provedor v2 — Aporte de Capital (wizard SPA) + painel da rodada ativa.
 * Marker: provedor-espelho-dashboard-v1
 */
(function () {
  var STEPS = [
    { id: "welcome", label: "Boas Vindas" },
    { id: "amount", label: "Valor do Aporte" },
    { id: "payment", label: "Pagamento" },
    { id: "confirm", label: "Confirmação" },
  ];
  var PRESETS = [50000, 100000, 500000, 1000000];
  var PIX_FALLBACK = "35.163.917/0001-91";
  var PIX_QR = "/brand/pix-qr-inter.png";

  var state = {
    step: 0,
    busy: false,
    amountCents: 100000,
    amountText: "R$ 1.000,00",
    depositId: null,
    file: null,
    previewUrl: null,
    confirmAt: null,
    pixKey: PIX_FALLBACK,
    pixQr: PIX_QR,
    minCents: 10000,
    maxCents: 10000000,
    round: null,
    distributions: [],
    withdrawals: [],
    pendingDeposit: null,
    investorBalanceCents: 0,
    viewUserId: null,
    isMirror: false,
    forceWizard: false,
    err: "",
    ok: "",
    copied: false,
    withdrawOpen: false,
    withdrawAmount: "",
    withdrawPix: "",
    withdrawType: "CPF",
  };

  function viewUserIdOf(authUser) {
    if (typeof ArbiV2 !== "undefined" && ArbiV2.getEffectiveUserId) {
      return ArbiV2.getEffectiveUserId(authUser);
    }
    return authUser && authUser.id ? authUser.id : null;
  }

  function hasProviderCapital() {
    if (state.round && state.round.id) return true;
    return Number(state.investorBalanceCents || 0) > 0;
  }

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
  function formatMoneyInput(cents) {
    return money(cents);
  }
  function parseReaisToCents(raw) {
    var digits = String(raw || "").replace(/\D/g, "");
    return Number(digits || 0);
  }
  function isWithdrawWindow() {
    var d = new Date();
    var day = d.getDate();
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return day === 15 || day === 30 || day === last;
  }
  function withdrawable() {
    var dist = (state.distributions || []).reduce(function (a, r) {
      return a + Number(r.distribution_amount || 0);
    }, 0);
    var paid = (state.withdrawals || []).reduce(function (a, r) {
      return String(r.status || "").toUpperCase() === "PAID"
        ? a + Number(r.amount || r.amount_cents || 0)
        : a;
    }, 0);
    return Math.max(0, dist - paid);
  }
  function qrUrl(data) {
    if (state.pixQr) return state.pixQr;
    return (
      "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" +
      encodeURIComponent(data || state.pixKey)
    );
  }

  function headerHtml(title, sub) {
    return (
      '<header class="prov-head">' +
      "<div><h1>" +
      title +
      '</h1><p class="sub">' +
      esc(sub) +
      "</p></div>" +
      '<div class="prov-secure">' +
      '<span class="prov-secure-ico" aria-hidden="true">⛨</span>' +
      "<div><strong>Transação 100% segura</strong>" +
      "<span>Seus dados e pagamentos estão protegidos.</span></div></div></header>"
    );
  }

  function stepperHtml() {
    var pct = state.step / Math.max(STEPS.length - 1, 1);
    var fill = "calc(" + pct * 100 + "% - " + pct * 12 + "px)";
    return (
      '<div class="prov-stepper">' +
      '<div class="prov-stepper-track"></div>' +
      '<div class="prov-stepper-fill" style="width:' +
      fill +
      '"></div>' +
      '<div class="prov-stepper-grid">' +
      STEPS.map(function (s, i) {
        var on = state.step >= i;
        var done = state.step > i;
        return (
          '<div class="prov-step' +
          (on ? " on" : "") +
          '">' +
          '<div class="prov-step-dot">' +
          (done ? "✓" : String(i + 1)) +
          "</div>" +
          "<span>" +
          esc(s.label) +
          "</span></div>"
        );
      }).join("") +
      "</div></div>"
    );
  }

  function alertHtml() {
    var html = "";
    if (state.err) html += '<div class="prov-alert bad">' + esc(state.err) + "</div>";
    if (state.ok) html += '<div class="prov-alert ok">' + esc(state.ok) + "</div>";
    return html;
  }

  function renderWelcome() {
    var items = [
      "Rentabilidade diária",
      "Atualização de segunda a sexta",
      "Saques nos dias 15 e 30",
      "Painel completo de acompanhamento",
    ];
    return (
      '<div class="prov-card">' +
      '<div class="prov-card-glow"></div>' +
      '<h2>Boas <em>Vindas</em></h2>' +
      "<p>Faça seu aporte e participe dos resultados gerados pelas operações da plataforma.</p>" +
      '<ul class="prov-benefits">' +
      items
        .map(function (t) {
          return (
            "<li><span class=\"check\" aria-hidden=\"true\">✓</span><span>" +
            esc(t) +
            "</span></li>"
          );
        })
        .join("") +
      "</ul>" +
      '<button type="button" class="prov-btn" data-act="to-amount">Continuar <span aria-hidden="true">→</span></button>' +
      "</div>"
    );
  }

  function renderAmount() {
    return (
      '<div class="prov-card">' +
      '<div class="prov-card-glow"></div>' +
      '<h2>Valor do <em>Aporte</em></h2>' +
      "<p>Escolha o valor que deseja investir.</p>" +
      '<div class="prov-presets">' +
      PRESETS.map(function (c) {
        return (
          '<button type="button" class="prov-preset' +
          (state.amountCents === c ? " active" : "") +
          '" data-preset="' +
          c +
          '">' +
          esc(money(c).split(",")[0]) +
          "</button>"
        );
      }).join("") +
      "</div>" +
      '<label class="prov-label">Outro valor</label>' +
      '<input class="prov-amount-input" id="provAmount" type="text" inputmode="numeric" value="' +
      esc(state.amountText) +
      '" />' +
      '<p class="prov-hint">Investimento mínimo: ' +
      esc(money(state.minCents)) +
      "</p>" +
      '<div class="prov-row">' +
      '<button type="button" class="prov-btn ghost" data-act="to-welcome">Voltar</button>' +
      '<button type="button" class="prov-btn grow" data-act="gerar-pix"' +
      (state.busy ? " disabled" : "") +
      ">" +
      (state.busy ? "Gerando…" : "Gerar PIX →") +
      "</button></div></div>"
    );
  }

  function renderPayment() {
    var key = state.pixKey || PIX_FALLBACK;
    return (
      '<div class="prov-card">' +
      '<div class="prov-card-glow"></div>' +
      '<h2><em>Pagamento</em></h2>' +
      "<p>Realize o pagamento via PIX.</p>" +
      '<div class="prov-value-bar">' +
      "<span>Valor do aporte</span><strong>" +
      esc(money(state.amountCents)) +
      "</strong></div>" +
      '<div class="prov-qr-box">' +
      '<div class="prov-qr"><img src="' +
      esc(qrUrl(key)) +
      '" alt="QR Code PIX" width="200" height="200" /></div>' +
      '<p class="prov-hint center">Escaneie o QR Code com seu banco</p></div>' +
      '<label class="prov-label">Copia e Cola PIX</label>' +
      '<div class="prov-copy">' +
      "<code>" +
      esc(key) +
      '</code><button type="button" class="prov-icon-btn" data-act="copy-pix" aria-label="Copiar">' +
      (state.copied ? "✓" : "⎘") +
      "</button></div>" +
      '<p class="prov-hint center">Após o pagamento, aguardaremos a confirmação.</p>' +
      '<div class="prov-proof">' +
      '<label class="prov-label lime">Anexar comprovante</label>' +
      '<label class="prov-file' +
      (state.file ? " has" : "") +
      '"><input type="file" id="provFile" accept="image/*,.pdf" />' +
      (state.file
        ? "<strong>" + esc(state.file.name) + "</strong>"
        : "<span>Selecione o arquivo</span>") +
      "</label>" +
      (state.previewUrl
        ? '<img class="prov-preview" src="' + esc(state.previewUrl) + '" alt="Prévia" />'
        : "") +
      '<button type="button" class="prov-btn" data-act="send-proof"' +
      (state.busy || !state.file ? " disabled" : "") +
      ">" +
      (state.busy ? "Enviando…" : "Enviar comprovante") +
      "</button></div></div>"
    );
  }

  function renderConfirm() {
    var when = state.confirmAt || new Date();
    var value =
      state.pendingDeposit && state.pendingDeposit.amount_cents != null
        ? money(Number(state.pendingDeposit.amount_cents))
        : money(state.amountCents);
    return (
      '<div class="prov-card center">' +
      '<div class="prov-card-glow"></div>' +
      '<div class="prov-success-ico" aria-hidden="true">✓</div>' +
      "<h2><em>Confirmação</em></h2>" +
      "<p><strong>Aporte registrado com sucesso.</strong></p>" +
      '<div class="prov-confirm-grid">' +
      '<div><span class="l">Valor aplicado</span><strong>' +
      esc(value) +
      "</strong></div>" +
      '<div><span class="l">Data</span><strong>' +
      esc(when.toLocaleDateString("pt-BR")) +
      "</strong></div>" +
      '<div><span class="l">Hora</span><strong>' +
      esc(when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })) +
      "</strong></div>" +
      '<div class="warn"><span class="l">Status</span><strong>Aguardando aprovação</strong></div>' +
      "</div>" +
      '<p class="prov-hint center">Após validação manual da equipe, seu capital entrará nas operações da plataforma.</p>' +
      '<button type="button" class="prov-btn" data-act="reload">Atualizar status</button>' +
      "</div>"
    );
  }

  function renderWizard() {
    var body = "";
    if (state.step === 0) body = renderWelcome();
    else if (state.step === 1) body = renderAmount();
    else if (state.step === 2) body = renderPayment();
    else body = renderConfirm();
    return (
      '<div class="prov-aporte">' +
      headerHtml(
        'Aporte de <span>Capital</span>',
        "Faça seu aporte e comece a receber rentabilidade diária."
      ) +
      stepperHtml() +
      alertHtml() +
      '<section class="prov-stage">' +
      body +
      "</section></div>"
    );
  }

  function renderDashboard() {
    var r = state.round || {};
    var invested = Number(
      r.invested_amount != null ? r.invested_amount : state.investorBalanceCents || 0
    );
    var accrued = Number(r.accumulated_amount || 0);
    var avail = withdrawable();
    var windowOk = isWithdrawWindow();
    var distRows = (state.distributions || []).slice(0, 12);
    var wdRows = (state.withdrawals || []).slice(0, 8);
    var mirrorNote = state.isMirror
      ? '<p class="prov-empty" style="margin:0 0 12px">Espelho: somente leitura. Saques e novos aportes ficam com o cliente.</p>'
      : "";

    return (
      '<div class="prov-dash">' +
      headerHtml(
        'Painel do <span>Provedor</span>',
        "Acompanhe seu capital, rentabilidade e saques."
      ) +
      alertHtml() +
      mirrorNote +
      '<section class="prov-kpis">' +
      '<article><span class="l">Capital investido</span><strong>' +
      esc(money(invested)) +
      "</strong></article>" +
      '<article><span class="l">Acumulado</span><strong class="lime">' +
      esc(money(accrued || invested + avail)) +
      "</strong></article>" +
      '<article><span class="l">Disponível p/ saque</span><strong class="lime">' +
      esc(money(avail)) +
      "</strong></article>" +
      '<article><span class="l">Janela de saque</span><strong>' +
      (windowOk ? "Aberta (15/30)" : "Dias 15 e 30") +
      "</strong></article>" +
      "</section>" +
      '<div class="prov-row end" style="margin:0 0 14px">' +
      '<button type="button" class="prov-btn sm ghost" data-act="novo-aporte"' +
      (state.isMirror ? " disabled" : "") +
      ">Novo aporte</button></div>" +
      '<section class="prov-dash-grid">' +
      '<article class="prov-panel">' +
      "<h3>Distribuições</h3>" +
      (distRows.length
        ? '<ul class="prov-list">' +
          distRows
            .map(function (d) {
              return (
                "<li><div><strong>" +
                esc(new Date(d.created_at).toLocaleDateString("pt-BR")) +
                "</strong><span>" +
                esc(d.description || "Rendimento") +
                "</span></div><em>" +
                esc(money(Math.round(Number(d.distribution_amount || 0)))) +
                "</em></li>"
              );
            })
            .join("") +
          "</ul>"
        : '<p class="prov-empty">Nenhuma distribuição ainda.</p>') +
      "</article>" +
      '<article class="prov-panel">' +
      '<div class="prov-panel-head"><h3>Saques</h3>' +
      '<button type="button" class="prov-btn sm" data-act="open-withdraw"' +
      (!windowOk || avail <= 0 || state.isMirror || !state.round ? " disabled" : "") +
      ">Solicitar saque</button></div>" +
      (wdRows.length
        ? '<ul class="prov-list">' +
          wdRows
            .map(function (w) {
              return (
                "<li><div><strong>" +
                esc(new Date(w.created_at).toLocaleDateString("pt-BR")) +
                "</strong><span>" +
                esc(String(w.status || "—")) +
                "</span></div><em>" +
                esc(money(Math.round(Number(w.amount || w.amount_cents || 0)))) +
                "</em></li>"
              );
            })
            .join("") +
          "</ul>"
        : '<p class="prov-empty">Nenhum saque solicitado.</p>') +
      "</article></section>" +
      (state.withdrawOpen ? renderWithdrawModal(avail) : "") +
      "</div>"
    );
  }

  function renderWithdrawModal(avail) {
    return (
      '<div class="prov-modal open" id="provWdModal">' +
      '<div class="prov-modal-backdrop" data-act="close-withdraw"></div>' +
      '<div class="prov-modal-sheet" role="dialog" aria-modal="true">' +
      '<header><div><p class="kicker">Saque provedor</p><h2>Solicitar saque</h2></div>' +
      '<button type="button" class="x" data-act="close-withdraw" aria-label="Fechar">×</button></header>' +
      '<div class="body">' +
      "<p>Disponível: <strong>" +
      esc(money(avail)) +
      "</strong></p>" +
      '<label class="prov-label">Valor (R$)</label>' +
      '<input id="provWdAmount" class="prov-amount-input" type="text" value="' +
      esc(state.withdrawAmount) +
      '" />' +
      '<label class="prov-label">Tipo da chave</label>' +
      '<select id="provWdType" class="prov-select">' +
      ["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"]
        .map(function (t) {
          return (
            '<option value="' +
            t +
            '"' +
            (state.withdrawType === t ? " selected" : "") +
            ">" +
            t +
            "</option>"
          );
        })
        .join("") +
      "</select>" +
      '<label class="prov-label">Chave PIX</label>' +
      '<input id="provWdPix" class="prov-amount-input" type="text" value="' +
      esc(state.withdrawPix) +
      '" />' +
      '<div class="prov-row end">' +
      '<button type="button" class="prov-btn ghost" data-act="close-withdraw">Cancelar</button>' +
      '<button type="button" class="prov-btn" data-act="send-withdraw"' +
      (state.busy ? " disabled" : "") +
      ">Confirmar</button></div></div></div></div>"
    );
  }

  function paint() {
    var root = document.getElementById("provRoot");
    if (!root) return;
    // Já tem capital Provedor → painel (não forçar wizard de depósito)
    var showDash = hasProviderCapital() && !state.forceWizard;
    root.innerHTML = showDash ? renderDashboard() : renderWizard();
    bind(root);
  }

  function bind(root) {
    root.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-act");
        if (act === "to-amount") {
          state.step = 1;
          state.err = "";
          paint();
        } else if (act === "to-welcome") {
          state.step = 0;
          paint();
        } else if (act === "novo-aporte") {
          if (state.isMirror) {
            state.err = "Espelho é somente leitura para novos aportes.";
            paint();
            return;
          }
          state.forceWizard = true;
          state.step = 0;
          state.err = "";
          state.ok = "";
          paint();
        } else if (act === "gerar-pix") gerarPix();
        else if (act === "copy-pix") copyPix();
        else if (act === "send-proof") sendProof();
        else if (act === "reload") location.reload();
        else if (act === "open-withdraw") {
          state.withdrawOpen = true;
          state.withdrawAmount = formatMoneyInput(withdrawable());
          paint();
        } else if (act === "close-withdraw") {
          state.withdrawOpen = false;
          paint();
        } else if (act === "send-withdraw") sendWithdraw();
      });
    });
    root.querySelectorAll("[data-preset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = Number(btn.getAttribute("data-preset"));
        state.amountCents = c;
        state.amountText = formatMoneyInput(c);
        paint();
      });
    });
    var amount = document.getElementById("provAmount");
    if (amount) {
      amount.addEventListener("input", function () {
        state.amountCents = parseReaisToCents(amount.value);
        state.amountText = formatMoneyInput(state.amountCents);
        amount.value = state.amountText;
      });
    }
    var file = document.getElementById("provFile");
    if (file) {
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) {
          state.err = "Arquivo muito grande. Máximo 10MB.";
          paint();
          return;
        }
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.file = f;
        state.previewUrl = f.type.indexOf("image/") === 0 ? URL.createObjectURL(f) : null;
        state.err = "";
        paint();
      });
    }
    var wdA = document.getElementById("provWdAmount");
    if (wdA) {
      wdA.addEventListener("input", function () {
        state.withdrawAmount = formatMoneyInput(parseReaisToCents(wdA.value));
        wdA.value = state.withdrawAmount;
      });
    }
    var wdP = document.getElementById("provWdPix");
    if (wdP) {
      wdP.addEventListener("input", function () {
        state.withdrawPix = wdP.value;
      });
    }
    var wdT = document.getElementById("provWdType");
    if (wdT) {
      wdT.addEventListener("change", function () {
        state.withdrawType = wdT.value;
      });
    }
  }

  async function loadConfig(supa) {
    try {
      var w = await supa
        .from("platform_settings")
        .select("key, value")
        .in("key", [
          "pix_wallets",
          "pix_static_key",
          "min_provider_deposit_cents",
          "max_provider_deposit_cents",
        ]);
      var map = {};
      (w.data || []).forEach(function (row) {
        map[row.key] = row.value;
      });
      var pix = [];
      try {
        if (Array.isArray(map.pix_wallets)) pix = map.pix_wallets;
        else if (typeof map.pix_wallets === "string") pix = JSON.parse(map.pix_wallets);
      } catch (e) {}
      var active = pix.find(function (x) {
        return x && x.active;
      }) || {};
      state.pixKey =
        active.pix_key ||
        (typeof map.pix_static_key === "string"
          ? map.pix_static_key.replace(/"/g, "")
          : "") ||
        PIX_FALLBACK;
      state.pixQr = active.qr_image || PIX_QR;
      state.minCents = Number(map.min_provider_deposit_cents) || 10000;
      state.maxCents = Number(map.max_provider_deposit_cents) || 10000000;
    } catch (e) {
      /* defaults */
    }
  }

  async function loadPartner(supa, authUser) {
    var viewId = viewUserIdOf(authUser);
    state.viewUserId = viewId;
    state.isMirror = !!(authUser && viewId && String(viewId) !== String(authUser.id));
    state.err = "";

    var prof = await supa
      .from("profiles")
      .select("investor_balance_cents,demo_balance_provider_cents")
      .eq("id", viewId)
      .maybeSingle();
    if (!prof.error && prof.data) {
      state.investorBalanceCents =
        Number(prof.data.investor_balance_cents || 0) +
        Number(prof.data.demo_balance_provider_cents || 0);
    } else {
      state.investorBalanceCents = 0;
    }

    // Prefer ACTIVE (schema VPS usa maiúsculas). Fallback: qualquer rodada do user.
    var roundRes = await supa
      .from("partner_rounds")
      .select("*")
      .eq("user_id", viewId)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (roundRes.error) {
      state.err =
        "Erro ao carregar rodada Provedor: " +
        (roundRes.error.message || "falha na consulta");
    }
    state.round = roundRes.data || null;
    if (!state.round) {
      var anyRound = await supa
        .from("partner_rounds")
        .select("*")
        .eq("user_id", viewId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      state.round = anyRound.data || null;
    }

    if (state.round && state.round.id) {
      var dist = await supa
        .from("partner_distributions")
        .select("*")
        .eq("round_id", state.round.id)
        .order("created_at", { ascending: false });
      if (dist.error) {
        state.err =
          (state.err ? state.err + " · " : "") +
          "Distribuições: " +
          (dist.error.message || "erro");
      }
      state.distributions = dist.data || [];
      var wd = await supa
        .from("partner_withdraw_requests")
        .select("*")
        .eq("round_id", state.round.id)
        .order("created_at", { ascending: false });
      state.withdrawals = wd.data || [];
    } else {
      state.distributions = [];
      state.withdrawals = [];
    }

    var pend = await supa
      .from("manual_deposits")
      .select("id, status, amount_cents, created_at")
      .eq("user_id", viewId)
      .eq("deposit_type", "investor")
      .in("status", ["PENDING", "AWAITING_PROOF"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    state.pendingDeposit = pend.data || null;

    // Só manda pro wizard de comprovante se AINDA não tem capital/rodada
    if (!hasProviderCapital() && state.pendingDeposit) {
      state.forceWizard = true;
      state.step = 3;
      state.depositId = state.pendingDeposit.id;
      state.amountCents = Number(
        state.pendingDeposit.amount_cents || state.amountCents
      );
      if (state.pendingDeposit.created_at) {
        state.confirmAt = new Date(state.pendingDeposit.created_at);
      }
      if (state.pendingDeposit.status === "AWAITING_PROOF") {
        state.step = 2;
      }
    } else {
      state.forceWizard = false;
    }
  }

  async function gerarPix() {
    if (state.busy) return;
    if (state.isMirror) {
      state.err = "Espelho é somente leitura para gerar PIX.";
      paint();
      return;
    }
    if (state.amountCents < state.minCents) {
      state.err = "Investimento mínimo: " + money(state.minCents);
      paint();
      return;
    }
    if (state.amountCents > state.maxCents) {
      state.err = "Investimento máximo: " + money(state.maxCents);
      paint();
      return;
    }
    state.busy = true;
    state.err = "";
    paint();
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      var viewId = viewUserIdOf(user);
      if (String(viewId) !== String(user.id)) {
        throw new Error("Espelho é somente leitura para gerar PIX.");
      }
      var ins = await supa
        .from("manual_deposits")
        .insert({
          user_id: user.id,
          amount_cents: state.amountCents,
          network: "PIX",
          status: "AWAITING_PROOF",
          deposit_type: "investor",
        })
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      state.depositId = ins.data.id;
      state.step = 2;
      state.forceWizard = true;
      state.ok = "PIX gerado. Realize o pagamento e anexe o comprovante.";
    } catch (ex) {
      state.err = (ex && ex.message) || "Erro ao gerar PIX";
    } finally {
      state.busy = false;
      paint();
    }
  }

  function copyPix() {
    var key = state.pixKey || PIX_FALLBACK;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(key).then(function () {
        state.copied = true;
        state.ok = "Chave PIX copiada!";
        paint();
        setTimeout(function () {
          state.copied = false;
          paint();
        }, 2000);
      });
    } else {
      state.ok = "Copie a chave manualmente.";
      paint();
    }
  }

  async function sendProof() {
    if (state.isMirror) {
      state.err = "Espelho é somente leitura para enviar comprovante.";
      paint();
      return;
    }
    if (state.busy || !state.file || !state.depositId) {
      if (!state.file) state.err = "Anexe o comprovante de pagamento";
      paint();
      return;
    }
    state.busy = true;
    state.err = "";
    paint();
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      if (String(viewUserIdOf(user)) !== String(user.id)) {
        throw new Error("Espelho é somente leitura para enviar comprovante.");
      }
      var ext = (state.file.name.split(".").pop() || "jpg").toLowerCase();
      var path = user.id + "/" + Date.now() + "." + ext;
      var up = await supa.storage.from("deposit-proofs").upload(path, state.file);
      if (up.error) throw up.error;
      var upd = await supa
        .from("manual_deposits")
        .update({ proof_url: path, status: "PENDING" })
        .eq("id", state.depositId);
      if (upd.error) throw upd.error;
      state.confirmAt = new Date();
      state.step = 3;
      state.forceWizard = true;
      state.ok = "Comprovante enviado!";
      state.pendingDeposit = {
        id: state.depositId,
        amount_cents: state.amountCents,
        status: "PENDING",
        created_at: state.confirmAt.toISOString(),
      };
    } catch (ex) {
      state.err = "Erro ao enviar comprovante: " + ((ex && ex.message) || "");
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function sendWithdraw() {
    if (state.busy) return;
    if (state.isMirror) {
      state.err = "Espelho é somente leitura para saques.";
      paint();
      return;
    }
    var cents = parseReaisToCents(state.withdrawAmount);
    var avail = withdrawable();
    if (!cents || cents <= 0 || cents > avail) {
      state.err = "Valor inválido";
      paint();
      return;
    }
    if (!String(state.withdrawPix || "").trim()) {
      state.err = "Informe a chave Pix";
      paint();
      return;
    }
    if (!state.round || !state.round.id) {
      state.err = "Rodada ativa não encontrada. Recarregue a página.";
      paint();
      return;
    }
    var open = (state.withdrawals || []).find(function (w) {
      return ["PENDING", "PROCESSING", "APPROVED"].indexOf(
        String(w.status || "").toUpperCase()
      ) >= 0;
    });
    if (open) {
      state.err =
        "Você já possui uma solicitação de saque em análise. Aguarde a conclusão.";
      paint();
      return;
    }
    state.busy = true;
    state.err = "";
    paint();
    try {
      var supa = ArbiV2.client();
      var rpc = await supa.rpc("request_partner_withdrawal", {
        p_round_id: state.round.id,
        p_amount: cents,
        p_pix_key: String(state.withdrawPix).trim(),
        p_pix_key_type: state.withdrawType || "CPF",
      });
      if (rpc.error) throw rpc.error;
      state.ok = "Solicitação de saque enviada";
      state.withdrawOpen = false;
      var user = await ArbiV2.requireUser(supa);
      if (user) await loadPartner(supa, user);
    } catch (ex) {
      state.err = (ex && ex.message) || "Erro ao solicitar saque";
    } finally {
      state.busy = false;
      paint();
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!document.body || document.body.getAttribute("data-active") !== "partners") return;
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      await loadConfig(supa);
      await loadPartner(supa, user);
      state.amountText = formatMoneyInput(state.amountCents);
      paint();
    } catch (ex) {
      showErr(ex.message || "Erro ao carregar provedor");
    }
  });
})();
