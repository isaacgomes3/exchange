/**
 * Área de Afiliados v2 — paridade com SPA /app/afiliados (trt).
 */
(function () {
  var AFF_OK = { approved: 1, available: 1, pending_payout: 1, paid: 1 };
  var WD_OPEN = { pending: 1, approved: 1, paid: 1, processing: 1 };
  var AFF_WD = {
    AFFILIATE_WITHDRAWAL: 1,
    AFFILIATE_COMMISSION_WITHDRAWAL: 1,
    AFFILIATE_PAYOUT_REQUEST: 1,
  };
  var PERIODS = [
    ["today", "Hoje"],
    ["yesterday", "Ontem"],
    ["7d", "7 dias"],
    ["30d", "30 dias"],
    ["thisMonth", "Este mês"],
    ["lastMonth", "Mês passado"],
  ];

  var state = {
    period: "thisMonth",
    dateFrom: "",
    dateTo: "",
    chartRange: "30d",
    search: "",
    typeFilter: "all",
    levelFilter: "all",
    netPage: 1,
    netPageSize: 5,
    wdPage: 1,
    wdPageSize: 10,
    profile: null,
    referralCode: "",
    commissions: [],
    network: [],
    withdrawals: [],
    stats: null,
    err: "",
    ok: "",
    busy: false,
    withdrawOpen: false,
    withdrawAmount: "",
    withdrawPix: "",
  };

  function money(c) {
    return ArbiV2.money(c);
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
  function ymd(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  function setPeriod(id) {
    state.period = id;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (id === "today") {
      state.dateFrom = ymd(today);
      state.dateTo = ymd(today);
    } else if (id === "yesterday") {
      var y = new Date(today);
      y.setDate(y.getDate() - 1);
      state.dateFrom = ymd(y);
      state.dateTo = ymd(y);
    } else if (id === "7d") {
      var a = new Date(today);
      a.setDate(a.getDate() - 6);
      state.dateFrom = ymd(a);
      state.dateTo = ymd(today);
    } else if (id === "30d") {
      var b = new Date(today);
      b.setDate(b.getDate() - 29);
      state.dateFrom = ymd(b);
      state.dateTo = ymd(today);
    } else if (id === "thisMonth") {
      state.dateFrom = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
      state.dateTo = ymd(today);
    } else if (id === "lastMonth") {
      state.dateFrom = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      state.dateTo = ymd(new Date(now.getFullYear(), now.getMonth(), 0));
    } else {
      state.period = "custom";
    }
  }
  function isAffWd(row) {
    var meta = (row && row.metadata) || {};
    var n = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
    return !!AFF_WD[n];
  }
  function withdrawWindow() {
    var d = new Date();
    var day = d.getDate();
    var open = day === 15 || day === 30;
    var next;
    if (day < 15) next = new Date(d.getFullYear(), d.getMonth(), 15);
    else if (day < 30) next = new Date(d.getFullYear(), d.getMonth(), 30);
    else next = new Date(d.getFullYear(), d.getMonth() + 1, 15);
    return {
      isOpen: open,
      nextLabel: next.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
    };
  }
  function periodBounds() {
    var parts = String(state.dateFrom || "").split("-").map(Number);
    var parts2 = String(state.dateTo || "").split("-").map(Number);
    var start = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1).getTime();
    var end = new Date(
      parts2[0],
      (parts2[1] || 1) - 1,
      parts2[2] || 1,
      23,
      59,
      59,
      999
    ).getTime();
    return { start: start, end: end };
  }
  function commissionType(row) {
    var t = String(row.commission_type || row.type || "").toLowerCase();
    if (t === "cpa") return "cpa";
    if (t === "revshare" || t === "rev_share" || t === "revenue_share") return "revshare";
    return "deposit";
  }
  function availableCents() {
    var earned = (state.commissions || [])
      .filter(function (c) {
        return AFF_OK[String(c.status || "").toLowerCase()];
      })
      .reduce(function (a, c) {
        return a + Number(c.amount_cents || 0);
      }, 0);
    var out = (state.withdrawals || [])
      .filter(function (w) {
        return isAffWd(w) && WD_OPEN[String(w.status || "").toLowerCase()];
      })
      .reduce(function (a, w) {
        return a + Number(w.amount_cents || 0);
      }, 0);
    if (state.stats && state.stats.pendingCents != null) {
      return Math.max(0, Number(state.stats.pendingCents));
    }
    return Math.max(0, earned - out);
  }
  function breakdown() {
    var b = periodBounds();
    var items = (state.commissions || []).filter(function (c) {
      var t = new Date(c.created_at).getTime();
      return t >= b.start && t <= b.end;
    });
    var deposit = 0,
      cpa = 0,
      revshare = 0;
    items.forEach(function (c) {
      var v = Number(c.amount_cents || 0);
      var t = commissionType(c);
      if (t === "cpa") cpa += v;
      else if (t === "revshare") revshare += v;
      else deposit += v;
    });
    var totals = { deposit: 0, cpa: 0, revshare: 0 };
    (state.commissions || []).forEach(function (c) {
      if (!AFF_OK[String(c.status || "").toLowerCase()] && String(c.status || "") !== "") {
        /* count all for totals like SPA if present on breakdown */
      }
      var v = Number(c.amount_cents || 0);
      var t = commissionType(c);
      if (t === "cpa") totals.cpa += v;
      else if (t === "revshare") totals.revshare += v;
      else totals.deposit += v;
    });
    return {
      items: items,
      deposit: deposit,
      cpa: cpa,
      revshare: revshare,
      total: deposit + cpa + revshare,
      totals: totals,
    };
  }
  function todayCents() {
    var t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    return (state.commissions || [])
      .filter(function (c) {
        return new Date(c.created_at) >= t0;
      })
      .reduce(function (a, c) {
        return a + Number(c.amount_cents || 0);
      }, 0);
  }
  function referralUrl() {
    var code = state.referralCode;
    if (!code) return "";
    return location.origin + "/auth.html?ref=" + encodeURIComponent(code);
  }
  function openWd() {
    return (state.withdrawals || []).find(function (w) {
      return (
        isAffWd(w) &&
        ["pending", "approved", "processing"].indexOf(String(w.status || "").toLowerCase()) >= 0
      );
    });
  }
  function filteredNetwork() {
    var q = state.search.trim().toLowerCase();
    return (state.network || []).filter(function (n) {
      if (state.typeFilter === "Apostador" && n.is_provider) return false;
      if (state.typeFilter === "Provedor" && !n.is_provider) return false;
      if (state.levelFilter !== "all" && String(n.level) !== state.levelFilter) return false;
      if (!q) return true;
      return (
        String(n.full_name || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String((n.upline && n.upline.full_name) || "")
          .toLowerCase()
          .indexOf(q) >= 0
      );
    });
  }
  function chartPoints() {
    var days = state.chartRange === "today" ? 1 : state.chartRange === "7d" ? 7 : state.chartRange === "90d" ? 90 : 30;
    var map = {};
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      var key = ymd(d);
      map[key] = { name: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), deposit: 0, cpa: 0, revshare: 0 };
    }
    (state.commissions || []).forEach(function (c) {
      var d = new Date(c.created_at);
      d.setHours(0, 0, 0, 0);
      var key = ymd(d);
      if (!map[key]) return;
      var v = Number(c.amount_cents || 0) / 100;
      var t = commissionType(c);
      map[key][t] += v;
    });
    return Object.keys(map)
      .sort()
      .map(function (k) {
        return map[k];
      });
  }

  function alertHtml() {
    var h = "";
    if (state.err) h += '<div class="aff-alert bad">' + esc(state.err) + "</div>";
    if (state.ok) h += '<div class="aff-alert ok">' + esc(state.ok) + "</div>";
    return h;
  }

  function levelRow(level, pct, color) {
    return (
      '<div class="aff-level"><span>' +
      esc(level) +
      '</span><strong style="color:' +
      color +
      '">' +
      esc(pct) +
      "</strong></div>"
    );
  }

  function render() {
    var root = document.getElementById("affRoot");
    if (!root) return;
    var bd = breakdown();
    var avail = availableCents();
    var win = withdrawWindow();
    var pendingWd = openWd();
    var url = referralUrl();
    var net = filteredNetwork();
    var netPages = Math.max(1, Math.ceil(net.length / state.netPageSize));
    if (state.netPage > netPages) state.netPage = netPages;
    var netSlice = net.slice(
      (state.netPage - 1) * state.netPageSize,
      state.netPage * state.netPageSize
    );
    var recent = bd.items.slice().sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    }).slice(0, 8);
    var chart = chartPoints();

    root.innerHTML =
      '<div class="aff-wrap">' +
      alertHtml() +
      '<header class="aff-head">' +
      "<div><h1>Arbi<span>Shield</span></h1>" +
      '<p class="sub">Ganhe com indicações diretas e participação nos rendimentos da sua rede.</p></div>' +
      '<div class="aff-balance-card">' +
      '<div class="aff-bal-ico" aria-hidden="true">◉</div>' +
      "<div><div class=\"aff-bal-top\"><span class=\"l\">Saldo Disponível</span>" +
      (pendingWd
        ? '<span class="aff-pill warn">' + esc(String(pendingWd.status)) + "</span>"
        : "") +
      "</div><strong>" +
      esc(money(avail)) +
      "</strong></div>" +
      '<div class="aff-bal-actions">' +
      '<button type="button" class="aff-btn" data-act="open-wd"' +
      (pendingWd || !win.isOpen ? " disabled" : "") +
      ">Solicitar Saque</button>" +
      (!pendingWd
        ? '<span class="hint">' +
          (win.isOpen ? "Janela aberta hoje" : "Próx. saque: " + esc(win.nextLabel)) +
          "</span>"
        : "") +
      "</div></div></header>" +
      '<section class="aff-period">' +
      '<div class="aff-period-label"><span class="dot"></span><strong>Período</strong>' +
      '<em>filtra métricas e ganhos recentes</em></div>' +
      '<div class="aff-period-btns">' +
      PERIODS.map(function (p) {
        return (
          '<button type="button" class="aff-chip' +
          (state.period === p[0] ? " active" : "") +
          '" data-period="' +
          p[0] +
          '">' +
          esc(p[1]) +
          "</button>"
        );
      }).join("") +
      '<label class="aff-date"><input type="date" id="affFrom" value="' +
      esc(state.dateFrom) +
      '" /> <span>até</span> <input type="date" id="affTo" value="' +
      esc(state.dateTo) +
      '" /></label></div></section>' +
      '<section class="aff-kpis">' +
      kpi("Ganho Hoje", money(todayCents()), "Atualizado em tempo real") +
      kpi("Ganho no Período", money(bd.total), state.dateFrom + " → " + state.dateTo) +
      kpi("Total de Indicados", String(state.network.length), "Rede completa") +
      kpi("CPA no Período", money(bd.cpa), "Comissão por aquisição") +
      kpi("Rev Share no Período", money(bd.revshare), "Participação nos rendimentos") +
      "</section>" +
      '<section class="aff-grid-4">' +
      '<article class="aff-card">' +
      '<h3 class="aff-sec">Seus Links de Afiliado</h3>' +
      '<div class="aff-link-box">' +
      "<h4>Seu Link de Indicação</h4>" +
      "<p>Um único link, duas formas de ganhar. Compartilhe e seja remunerado pela atividade da sua rede.</p>" +
      '<ul class="aff-benefits">' +
      "<li><span>Apostadores indicados</span><strong>3% sobre cada depósito</strong></li>" +
      "<li><span>Novos Provedores</span><strong>CPA até o 5º nível</strong></li>" +
      "<li><span>Novos Provedores</span><strong>Revenue Share até o 5º nível</strong></li>" +
      "</ul>" +
      (url
        ? '<code class="aff-url">' +
          esc(url) +
          "</code>" +
          '<div class="aff-link-actions">' +
          '<button type="button" class="aff-btn sm" data-act="copy-link">Copiar</button>' +
          '<button type="button" class="aff-btn ghost sm" data-act="share-link">Compartilhar</button>' +
          "</div>"
        : '<button type="button" class="aff-btn" data-act="gen-link"' +
          (state.busy ? " disabled" : "") +
          ">Gerar meu link</button>") +
      "</div></article>" +
      sourceCard(
        "Depósitos — Apostador",
        "Recorrente por depósito",
        "#2997FF",
        [levelRow("Indicação Direta", "3%", "#2997FF")],
        "A cada depósito do seu indicado, <strong>3% caem na sua conta</strong>. Sem limite, sem teto.",
        "Total de Depósitos",
        money(bd.deposit),
        "Acumulado: " + money(bd.totals.deposit)
      ) +
      sourceCard(
        "Comissões CPA — Provedor",
        "Indicação direta",
        "#FFD60A",
        [
          ["Nível 1", "7%"],
          ["Nível 2", "5%"],
          ["Nível 3", "3%"],
          ["Nível 4", "1%"],
          ["Nível 5", "1%"],
        ]
          .map(function (x) {
            return levelRow(x[0], x[1], "#C8F31D");
          })
          .join(""),
        "CPA único por novo Provedor qualificado na rede (até 5 níveis).",
        "Total CPA Acumulado",
        money(bd.cpa),
        "Acumulado: " + money(bd.totals.cpa)
      ) +
      sourceCard(
        "Revenue Share — Provedor",
        "Participação nos rendimentos",
        "#FFD60A",
        [
          ["Nível 1", "10%"],
          ["Nível 2", "5%"],
          ["Nível 3", "5%"],
          ["Nível 4", "3%"],
          ["Nível 5", "1%"],
        ]
          .map(function (x) {
            return levelRow(x[0], x[1], "#C8F31D");
          })
          .join(""),
        "Participação recorrente enquanto os Provedores da rede operarem.",
        "Total Revenue Share",
        money(bd.revshare),
        "Acumulado: " + money(bd.totals.revshare),
        true
      ) +
      "</section>" +
      '<section class="aff-mid">' +
      '<article class="aff-card aff-chart-card">' +
      '<div class="aff-card-head"><h3>Evolução de Ganhos</h3>' +
      '<div class="aff-period-btns">' +
      ["today", "7d", "30d", "90d"]
        .map(function (r) {
          return (
            '<button type="button" class="aff-chip' +
            (state.chartRange === r ? " active" : "") +
            '" data-chart="' +
            r +
            '">' +
            (r === "today" ? "Hoje" : r) +
            "</button>"
          );
        })
        .join("") +
      "</div></div>" +
      '<div class="aff-chart" id="affChart"></div>' +
      '<div class="aff-legend"><span><i style="background:#2997FF"></i>Depósitos</span>' +
      '<span><i style="background:#C8F31D"></i>CPA</span>' +
      '<span><i style="background:#FFB020"></i>Rev Share</span></div></article>' +
      '<article class="aff-card">' +
      '<div class="aff-card-head"><h3>Ganhos Recentes</h3>' +
      '<span class="live"><i></i> Ao vivo</span></div>' +
      (recent.length
        ? '<ul class="aff-recent">' +
          recent
            .map(function (c) {
              var t = commissionType(c);
              var label = t === "cpa" ? "CPA" : t === "revshare" ? "Rev Share" : "Depósito";
              var color = t === "cpa" ? "#C8F31D" : t === "revshare" ? "#FFB020" : "#2997FF";
              return (
                "<li><div><i style=\"background:" +
                color +
                '"></i><div><strong>' +
                esc(label) +
                "</strong><span>" +
                esc(new Date(c.created_at).toLocaleString("pt-BR")) +
                "</span></div></div><em>" +
                esc(money(c.amount_cents)) +
                "</em></li>"
              );
            })
            .join("") +
          "</ul>"
        : '<p class="aff-empty">Nenhum ganho no período.</p>') +
      "</article></section>" +
      '<section class="aff-card">' +
      '<div class="aff-card-head col">' +
      "<div><h3>Minha Rede</h3><p>Todos os indicados da sua estrutura</p></div>" +
      '<div class="aff-filters">' +
      '<input id="affSearch" type="search" placeholder="Buscar..." value="' +
      esc(state.search) +
      '" />' +
      '<select id="affType"><option value="all">Todos os tipos</option>' +
      '<option value="Apostador"' +
      (state.typeFilter === "Apostador" ? " selected" : "") +
      ">Apostador</option>" +
      '<option value="Provedor"' +
      (state.typeFilter === "Provedor" ? " selected" : "") +
      ">Provedor</option></select>" +
      '<select id="affLevel"><option value="all">Todos níveis</option>' +
      [1, 2, 3, 4, 5]
        .map(function (n) {
          return (
            '<option value="' +
            n +
            '"' +
            (state.levelFilter === String(n) ? " selected" : "") +
            ">Nível " +
            n +
            "</option>"
          );
        })
        .join("") +
      "</select></div></div>" +
      '<div class="aff-table-wrap"><table class="aff-table"><thead><tr>' +
      ["Usuário", "Tipo", "Indicado por", "Nível", "Depósitos (3%)", "CPA", "Revenue Share", "Sua comissão"]
        .map(function (h) {
          return "<th>" + h + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      (netSlice.length
        ? netSlice
            .map(function (n) {
              var src = n.sources || {
                deposit: { commission: 0 },
                cpa: { commission: 0 },
                revshare: { commission: 0 },
              };
              var total =
                Number(src.deposit.commission || 0) +
                Number(src.cpa.commission || 0) +
                Number(src.revshare.commission || 0);
              return (
                "<tr><td><strong>" +
                esc(n.full_name || "Sem nome") +
                "</strong></td><td>" +
                (n.is_provider ? "Provedor" : "Apostador") +
                "</td><td>" +
                esc((n.upline && n.upline.full_name) || (n.level === 1 ? "Você (direto)" : "—")) +
                "</td><td>N" +
                esc(n.level) +
                "</td><td>" +
                esc(money(src.deposit.commission)) +
                "</td><td>" +
                esc(money(src.cpa.commission)) +
                "</td><td>" +
                esc(money(src.revshare.commission)) +
                "</td><td class=\"lime\">" +
                esc(money(total)) +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="8" class="aff-empty">Sua rede ainda está vazia. Comece compartilhando seus links.</td></tr>') +
      "</tbody></table></div>" +
      '<div class="aff-pager">' +
      '<button type="button" class="aff-btn ghost sm" data-act="net-prev">Anterior</button>' +
      "<span>" +
      state.netPage +
      " / " +
      netPages +
      "</span>" +
      '<button type="button" class="aff-btn ghost sm" data-act="net-next">Próximo</button></div></section>' +
      '<section class="aff-summary">' +
      '<article class="aff-card"><h3>Resumo por Fonte</h3>' +
      '<ul class="aff-summary-list">' +
      summaryRow("#2997FF", "Depósitos (3%)", bd.deposit, bd.total) +
      summaryRow("#C8F31D", "CPA", bd.cpa, bd.total) +
      summaryRow("#FFB020", "Rev Share", bd.revshare, bd.total) +
      "</ul></article>" +
      '<article class="aff-card"><h3>Distribuição dos seus ganhos</h3>' +
      '<div class="aff-donut" id="affDonut"></div></article></section>' +
      (state.withdrawOpen ? withdrawModal(avail) : "") +
      "</div>";

    paintChart(chart);
    paintDonut(bd);
    bind(root);
  }

  function kpi(label, value, sub) {
    return (
      '<article class="aff-kpi"><span class="l">' +
      esc(label) +
      "</span><strong>" +
      esc(value) +
      "</strong><em>" +
      esc(sub) +
      "</em></article>"
    );
  }
  function sourceCard(title, sub, accent, levelsHtml, how, footLabel, footValue, footAcc, limeFoot) {
    return (
      '<article class="aff-card">' +
      "<h3>" +
      esc(title) +
      "</h3><p class=\"muted\">" +
      esc(sub) +
      "</p><div class=\"aff-levels\">" +
      levelsHtml +
      '</div><div class="aff-how"><span>Como funciona</span><p>' +
      how +
      "</p></div><div class=\"aff-foot\"><span>" +
      esc(footLabel) +
      '</span><strong class="' +
      (limeFoot ? "lime" : "") +
      '">' +
      esc(footValue) +
      "</strong><em>" +
      esc(footAcc) +
      "</em></div></article>"
    );
  }
  function summaryRow(color, label, value, total) {
    var pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
    return (
      "<li><i style=\"background:" +
      color +
      '"></i><span>' +
      esc(label) +
      "</span><strong>" +
      esc(money(value)) +
      "</strong><em>" +
      pct +
      "%</em></li>"
    );
  }
  function withdrawModal(avail) {
    return (
      '<div class="aff-modal open"><div class="aff-modal-backdrop" data-act="close-wd"></div>' +
      '<div class="aff-modal-sheet"><header><div><p class="kicker">Saque afiliado</p><h2>Solicitar saque</h2></div>' +
      '<button type="button" class="x" data-act="close-wd">×</button></header>' +
      '<div class="body"><p>Disponível: <strong>' +
      esc(money(avail)) +
      '</strong></p><label>Valor (R$)</label>' +
      '<input id="affWdAmount" type="text" value="' +
      esc(state.withdrawAmount || money(avail)) +
      '" />' +
      "<label>Chave PIX</label>" +
      '<input id="affWdPix" type="text" value="' +
      esc(state.withdrawPix || (state.profile && state.profile.pix_key) || "") +
      '" />' +
      '<div class="row"><button type="button" class="aff-btn ghost" data-act="close-wd">Cancelar</button>' +
      '<button type="button" class="aff-btn" data-act="send-wd"' +
      (state.busy ? " disabled" : "") +
      ">Confirmar</button></div></div></div></div>"
    );
  }

  function paintChart(points) {
    var host = document.getElementById("affChart");
    if (!host) return;
    var w = 640,
      h = 220,
      pad = 16;
    if (!points.length) points = [{ name: "-", deposit: 0, cpa: 0, revshare: 0 }];
    var max = 1;
    points.forEach(function (p) {
      max = Math.max(max, p.deposit + p.cpa + p.revshare);
    });
    function y(v) {
      return h - pad - (v / max) * (h - pad * 2);
    }
    function x(i) {
      return pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    }
    function line(key, color) {
      var coords = points
        .map(function (p, i) {
          var stack =
            key === "deposit"
              ? p.deposit
              : key === "cpa"
                ? p.deposit + p.cpa
                : p.deposit + p.cpa + p.revshare;
          return x(i).toFixed(1) + "," + y(stack).toFixed(1);
        })
        .join(" ");
      return (
        '<polyline fill="none" stroke="' +
        color +
        '" stroke-width="2.5" stroke-linecap="round" points="' +
        coords +
        '"/>'
      );
    }
    host.innerHTML =
      '<svg viewBox="0 0 ' +
      w +
      " " +
      h +
      '" preserveAspectRatio="none">' +
      line("revshare", "#FFB020") +
      line("cpa", "#C8F31D") +
      line("deposit", "#2997FF") +
      "</svg>";
  }

  function paintDonut(bd) {
    var host = document.getElementById("affDonut");
    if (!host) return;
    var parts = [
      { v: bd.deposit, c: "#2997FF" },
      { v: bd.cpa, c: "#C8F31D" },
      { v: bd.revshare, c: "#FFB020" },
    ];
    var total = parts.reduce(function (a, p) {
      return a + p.v;
    }, 0) || 1;
    var acc = 0;
    var segs = parts
      .map(function (p) {
        var start = acc;
        acc += (p.v / total) * 100;
        return p.c + " " + start.toFixed(2) + "% " + acc.toFixed(2) + "%";
      })
      .join(", ");
    host.style.background =
      "conic-gradient(" +
      (bd.total ? segs : "#1a1a1a 0% 100%") +
      ")";
    host.innerHTML =
      "<span>Total<br/><strong>" + esc(money(bd.total)) + "</strong></span>";
  }

  function bind(root) {
    root.querySelectorAll("[data-period]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setPeriod(btn.getAttribute("data-period"));
        render();
      });
    });
    root.querySelectorAll("[data-chart]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.chartRange = btn.getAttribute("data-chart");
        render();
      });
    });
    root.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-act");
        if (act === "copy-link") copyLink();
        else if (act === "share-link") shareLink();
        else if (act === "gen-link") genLink();
        else if (act === "open-wd") {
          var win = withdrawWindow();
          if (openWd()) {
            state.err = "Você já tem um saque em análise.";
            render();
            return;
          }
          if (!win.isOpen) {
            state.err = "Saques só nos dias 15 e 30. Próxima janela: " + win.nextLabel + ".";
            render();
            return;
          }
          state.withdrawOpen = true;
          state.withdrawAmount = money(availableCents());
          state.withdrawPix = (state.profile && state.profile.pix_key) || "";
          state.err = "";
          render();
        } else if (act === "close-wd") {
          state.withdrawOpen = false;
          render();
        } else if (act === "send-wd") sendWithdraw();
        else if (act === "net-prev") {
          state.netPage = Math.max(1, state.netPage - 1);
          render();
        } else if (act === "net-next") {
          state.netPage += 1;
          render();
        }
      });
    });
    var from = document.getElementById("affFrom");
    var to = document.getElementById("affTo");
    if (from)
      from.addEventListener("change", function () {
        state.dateFrom = from.value;
        state.period = "custom";
        render();
      });
    if (to)
      to.addEventListener("change", function () {
        state.dateTo = to.value;
        state.period = "custom";
        render();
      });
    var search = document.getElementById("affSearch");
    if (search)
      search.addEventListener("input", function () {
        state.search = search.value || "";
        state.netPage = 1;
        render();
      });
    var type = document.getElementById("affType");
    if (type)
      type.addEventListener("change", function () {
        state.typeFilter = type.value;
        state.netPage = 1;
        render();
      });
    var level = document.getElementById("affLevel");
    if (level)
      level.addEventListener("change", function () {
        state.levelFilter = level.value;
        state.netPage = 1;
        render();
      });
    var wdA = document.getElementById("affWdAmount");
    if (wdA)
      wdA.addEventListener("input", function () {
        state.withdrawAmount = wdA.value;
      });
    var wdP = document.getElementById("affWdPix");
    if (wdP)
      wdP.addEventListener("input", function () {
        state.withdrawPix = wdP.value;
      });
  }

  function copyLink() {
    var url = referralUrl();
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        state.ok = "Link copiado!";
        render();
      });
    } else {
      state.ok = "Copie o link manualmente.";
      render();
    }
  }
  function shareLink() {
    var url = referralUrl();
    if (!url) return;
    if (navigator.share) {
      navigator.share({ title: "ArbiShield", text: "Entre na ArbiShield com meu link", url: url }).catch(function () {});
    } else copyLink();
  }

  async function authToken(supa) {
    var sess = await supa.auth.getSession();
    return sess && sess.data && sess.data.session && sess.data.session.access_token;
  }

  async function genLink() {
    if (state.busy) return;
    state.busy = true;
    state.err = "";
    render();
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      var token = await authToken(supa);
      var res = await fetch("/api/arbishield/affiliate-ensure-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: "{}",
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || "Falha ao gerar link");
      state.referralCode = data.referral_code || data.code || "";
      state.ok = "Link gerado com sucesso!";
      if (!state.referralCode) {
        // fallback local
        var code =
          Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
        code = code.toUpperCase();
        var upd = await supa
          .from("profiles")
          .update({ referral_code: code })
          .eq("id", user.id)
          .select("referral_code")
          .maybeSingle();
        if (!upd.error && upd.data) state.referralCode = upd.data.referral_code;
      }
    } catch (ex) {
      // fallback direto no profiles
      try {
        var supa2 = ArbiV2.client();
        var user2 = await ArbiV2.requireUser(supa2);
        var code2 =
          Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
        code2 = code2.toUpperCase();
        var upd2 = await supa2
          .from("profiles")
          .update({ referral_code: code2 })
          .eq("id", user2.id)
          .select("referral_code")
          .maybeSingle();
        if (upd2.error) throw upd2.error;
        state.referralCode = upd2.data.referral_code;
        state.ok = "Link gerado!";
        state.err = "";
      } catch (ex2) {
        state.err = (ex && ex.message) || (ex2 && ex2.message) || "Erro ao gerar link";
      }
    } finally {
      state.busy = false;
      render();
    }
  }

  async function sendWithdraw() {
    if (state.busy) return;
    var digits = String(state.withdrawAmount || "").replace(/\D/g, "");
    var cents = Number(digits || 0);
    var avail = availableCents();
    if (!cents || cents <= 0 || cents > avail) {
      state.err = "Valor inválido";
      render();
      return;
    }
    if (!String(state.withdrawPix || "").trim()) {
      state.err = "Informe a chave Pix";
      render();
      return;
    }
    state.busy = true;
    state.err = "";
    render();
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      var token = await authToken(supa);
      var res = await fetch("/api/arbishield/affiliate-withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          amount_cents: cents,
          pix_key: String(state.withdrawPix).trim(),
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        // fallback insert
        var ins = await supa.from("withdrawals").insert({
          user_id: user.id,
          amount_cents: cents,
          pix_key: String(state.withdrawPix).trim(),
          status: "pending",
          metadata: { origin: "AFFILIATE_WITHDRAWAL" },
        });
        if (ins.error) throw new Error(data.error || ins.error.message);
      }
      state.ok = "Saque solicitado! Acompanhe o status no histórico.";
      state.withdrawOpen = false;
      await loadAll(supa, user.id);
    } catch (ex) {
      state.err = (ex && ex.message) || "Erro ao solicitar saque";
    } finally {
      state.busy = false;
      render();
    }
  }

  async function safe(supa, table, select, filterFn) {
    try {
      var q = supa.from(table).select(select);
      if (filterFn) q = filterFn(q);
      var res = await q;
      if (res.error) return [];
      return res.data || [];
    } catch (e) {
      return [];
    }
  }

  async function buildNetwork(supa, userId) {
    var byReferrer = {};
    var all = await safe(
      supa,
      "profiles",
      "id,full_name,avatar_url,referred_by,referral_code,investor_balance_cents,is_affiliate",
      function (q) {
        return q.not("referred_by", "is", null).limit(2000);
      }
    );
    all.forEach(function (p) {
      var key = String(p.referred_by || "");
      if (!byReferrer[key]) byReferrer[key] = [];
      byReferrer[key].push(p);
    });
    var network = [];
    var queue = (byReferrer[userId] || []).map(function (p) {
      return { profile: p, level: 1, uplineId: userId };
    });
    var seen = {};
    while (queue.length) {
      var cur = queue.shift();
      if (!cur || !cur.profile || seen[cur.profile.id]) continue;
      if (cur.level > 5) continue;
      seen[cur.profile.id] = 1;
      var upline = all.find(function (x) {
        return x.id === cur.uplineId;
      });
      network.push({
        id: cur.profile.id,
        full_name: cur.profile.full_name,
        avatar_url: cur.profile.avatar_url,
        level: cur.level,
        is_provider: Number(cur.profile.investor_balance_cents || 0) > 0,
        upline: upline
          ? { full_name: upline.full_name }
          : cur.level === 1
            ? { full_name: "Você (direto)" }
            : null,
        sources: {
          deposit: { volume: 0, commission: 0 },
          cpa: { volume: 0, commission: 0 },
          revshare: { volume: 0, commission: 0 },
        },
      });
      (byReferrer[cur.profile.id] || []).forEach(function (child) {
        queue.push({ profile: child, level: cur.level + 1, uplineId: cur.profile.id });
      });
    }
    var byId = {};
    network.forEach(function (n) {
      byId[n.id] = n;
    });
    (state.commissions || []).forEach(function (c) {
      var rid = c.referred_id || c.user_id;
      var node = byId[rid];
      if (!node) return;
      var t = commissionType(c);
      var v = Number(c.amount_cents || 0);
      node.sources[t].commission += v;
    });
    return network;
  }

  async function loadAll(supa, userId) {
    var pr = await supa
      .from("profiles")
      .select("id,full_name,pix_key,referral_code,referred_by,avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (pr.error) throw pr.error;
    state.profile = pr.data || {};
    state.referralCode = state.profile.referral_code || "";

    state.commissions = await safe(
      supa,
      "affiliate_commissions",
      "id,affiliate_id,referred_id,amount_cents,commission_type,type,status,created_at,protection_id",
      function (q) {
        return q.eq("affiliate_id", userId).order("created_at", { ascending: false }).limit(2000);
      }
    );

    var stats = await safe(supa, "affiliate_stats", "*", function (q) {
      return q.eq("profile_id", userId).limit(1);
    });
    state.stats = stats[0] || null;

    state.withdrawals = await safe(
      supa,
      "withdrawals",
      "id,user_id,amount_cents,status,pix_key,metadata,created_at,updated_at",
      function (q) {
        return q.eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
      }
    );

    state.network = await buildNetwork(supa, userId);
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!document.body || document.body.getAttribute("data-active") !== "afiliados") return;
    setPeriod("thisMonth");
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      await loadAll(supa, user.id);
      render();
    } catch (ex) {
      showErr(ex.message || "Erro ao carregar afiliados");
    }
  });
})();
