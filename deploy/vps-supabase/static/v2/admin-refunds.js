/**
 * Gestão de Reembolsos — pedidos + saques Saldo Reembolso (aprovar / excluir).
 * Marker: admin-refunds-actions-v2
 */
(async function () {
  var errEl = document.getElementById("err");
  var msgEl = document.getElementById("rfMsg");
  var host = document.getElementById("pageBody");
  if (!host) return;

  function showBootError(t) {
    host.innerHTML =
      '<div class="ops-panel"><div class="ops-empty"><h2>Erro</h2><p>' +
      String(t || "Falha") +
      "</p></div></div>";
    if (errEl) {
      errEl.textContent = String(t || "Falha");
      errEl.classList.add("show");
    }
  }

  if (!window.ArbiV2 || !window.ArbiV2Page) {
    showBootError("Scripts v2 não carregaram. Atualize a página (Ctrl+Shift+R).");
    return;
  }

  var money = ArbiV2.money;
  var esc = ArbiV2Page.esc;

  var SALDO_ORIGINS = {
    SALDO_REEMBOLSO_WITHDRAWAL: 1,
    DEDUCTION_WITHDRAWAL: 1,
    SALDO_DEDUCAO_WITHDRAWAL: 1,
    REFUND_BALANCE_WITHDRAWAL: 1,
  };

  function isSaldoReembolsoWithdrawal(row) {
    if (ArbiV2Page.isSaldoReembolsoWithdrawal) {
      return ArbiV2Page.isSaldoReembolsoWithdrawal(row);
    }
    var meta = (row && row.metadata) || {};
    var o = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
    return !!SALDO_ORIGINS[o];
  }

  function showErr(t) {
    if (!errEl) return;
    if (!t) {
      errEl.textContent = "";
      errEl.classList.remove("show");
      return;
    }
    errEl.textContent = t;
    errEl.classList.add("show");
  }

  function showOk(t) {
    if (!msgEl) return;
    if (!t) {
      msgEl.hidden = true;
      msgEl.textContent = "";
      return;
    }
    msgEl.hidden = false;
    msgEl.textContent = t;
  }

  function statusClass(v) {
    var s = String(v || "").toLowerCase();
    if (/conclu|aprov|paid|ok|sucesso|liberado|enviado/.test(s)) return "ok";
    if (/pend|an[aá]lise|aguard|pending|processing/.test(s)) return "warn";
    if (/rejeit|cancel|fail|denied|reject/.test(s)) return "bad";
    return "";
  }

  function canApprove(r) {
    var st = String(r.status || "").toUpperCase();
    if (r._source_table === "refund_requests") {
      return st !== "CONCLUÍDO" && st !== "CONCLUIDO" && st !== "REJEITADO";
    }
    if (r._source_table === "back_refund_requests") return st === "PENDING";
    if (r._source_table === "withdrawals") return st === "PENDING";
    return false;
  }

  var state = {
    supa: null,
    adminId: null,
    rows: [],
    statusFilter: "all",
    q: "",
    _view: [],
  };

  async function loadRows() {
    var specs = [
      { table: "refund_requests", tag: "Pedido reembolso", limit: 200 },
      { table: "back_refund_requests", tag: "Back reembolso", limit: 200 },
      {
        table: "withdrawals",
        tag: "Saldo Reembolso",
        limit: 200,
        keep: isSaldoReembolsoWithdrawal,
      },
    ];
    var all = [];
    var errors = [];
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      try {
        var res = await state.supa
          .from(spec.table)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(spec.limit || 200);
        if (res.error) {
          errors.push(spec.table + ": " + res.error.message);
          continue;
        }
        var rows = res.data || [];
        if (typeof spec.keep === "function") rows = rows.filter(spec.keep);
        rows.forEach(function (r) {
          var copy = Object.assign({}, r);
          copy.origem = spec.tag;
          copy._source_table = spec.table;
          all.push(copy);
        });
      } catch (e) {
        errors.push(spec.table + ": " + ((e && e.message) || e));
      }
    }
    all.sort(function (a, b) {
      return (
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
      );
    });

    var ids = {};
    all.forEach(function (r) {
      if (r.user_id) ids[String(r.user_id)] = 1;
    });
    var idList = Object.keys(ids);
    var nameMap = {};
    for (var j = 0; j < idList.length; j += 80) {
      var chunk = idList.slice(j, j + 80);
      var pr = await state.supa
        .from("profiles")
        .select("id,full_name")
        .in("id", chunk);
      (pr.data || []).forEach(function (p) {
        nameMap[String(p.id)] =
          (p.full_name && String(p.full_name).trim()) || "—";
      });
    }
    all.forEach(function (r) {
      r.user_name = nameMap[String(r.user_id)] || "—";
    });
    state.rows = all;
    if (!all.length && errors.length) {
      throw new Error(errors.join(" · "));
    }
  }

  function filtered() {
    var parts = String(state.q || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return state.rows.filter(function (r) {
      if (
        state.statusFilter !== "all" &&
        String(r.status) !== state.statusFilter
      ) {
        return false;
      }
      if (!parts.length) return true;
      var hay = [r.id, r.user_name, r.origem, r.status, r.amount_cents]
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return parts.every(function (p) {
        return hay.indexOf(p) >= 0;
      });
    });
  }

  function uniqueStatuses() {
    var set = {};
    state.rows.forEach(function (r) {
      if (r.status != null && r.status !== "") set[String(r.status)] = 1;
    });
    return Object.keys(set).slice(0, 10);
  }

  function render() {
    var rows = filtered();
    var statuses = uniqueStatuses();
    var tabsHtml =
      '<button type="button" class="ops-tab' +
      (state.statusFilter === "all" ? " active" : "") +
      '" data-s="all">Todos</button>';
    statuses.forEach(function (s) {
      tabsHtml +=
        '<button type="button" class="ops-tab' +
        (state.statusFilter === s ? " active" : "") +
        '" data-s="' +
        esc(s) +
        '">' +
        esc(s) +
        "</button>";
    });

    host.innerHTML =
      '<div class="ops-stats">' +
      '<div class="ops-stat"><div class="l">Total</div><div class="v">' +
      state.rows.length +
      "</div></div>" +
      '<div class="ops-stat"><div class="l">Visíveis</div><div class="v lime">' +
      rows.length +
      "</div></div>" +
      '<div class="ops-stat"><div class="l">Fontes</div><div class="v">reembolsos + saldo</div></div>' +
      "</div>" +
      '<div class="ops-toolbar">' +
      '<div class="ops-tabs" id="opsTabs">' +
      tabsHtml +
      "</div>" +
      '<input class="ops-search" id="q" type="search" placeholder="Buscar por nome, origem, status…" />' +
      '<button type="button" class="btn btn-ghost btn-sm" id="opsRefresh">Atualizar</button>' +
      "</div>" +
      '<div class="meta">' +
      rows.length +
      " registro(s)</div>" +
      '<div class="ops-panel"><div class="ops-table-wrap"><table class="ops-table">' +
      "<thead><tr><th>nome</th><th>origem</th><th>valor</th><th>status</th><th>criado em</th><th>ações</th></tr></thead>" +
      '<tbody id="rfBody"></tbody></table></div></div>';

    var qInput = document.getElementById("q");
    if (qInput) qInput.value = state.q || "";

    var tbody = document.getElementById("rfBody");
    if (!tbody) {
      showBootError("Falha ao montar tabela (rfBody).");
      return;
    }

    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="ops-empty">Nenhum registro</td></tr>';
    } else {
      tbody.innerHTML = rows
        .slice(0, 150)
        .map(function (r, idx) {
          var sc = statusClass(r.status);
          var when = r.created_at
            ? new Date(r.created_at).toLocaleString("pt-BR")
            : "—";
          var approveBtn = canApprove(r)
            ? '<button type="button" class="btn btn-primary btn-sm" data-approve="' +
              idx +
              '">Aprovar</button>'
            : "";
          var delBtn =
            '<button type="button" class="btn btn-ghost btn-sm" data-del="' +
            idx +
            '">Excluir</button>';
          return (
            "<tr>" +
            "<td><strong style=\"color:var(--text)\">" +
            esc(r.user_name || "—") +
            '</strong><div class="meta" style="font-size:10px;margin-top:4px">' +
            esc(String(r.id || "").slice(0, 8)) +
            "…</div></td>" +
            "<td>" +
            esc(r.origem || "—") +
            "</td>" +
            "<td>" +
            money(Number(r.amount_cents || 0)) +
            "</td>" +
            '<td><span class="ops-badge' +
            (sc ? " " + sc : "") +
            '">' +
            esc(r.status || "—") +
            "</span></td>" +
            "<td>" +
            esc(when) +
            '</td><td><div class="rf-actions">' +
            approveBtn +
            delBtn +
            "</div></td></tr>"
          );
        })
        .join("");
    }

    state._view = rows.slice(0, 150);

    document.querySelectorAll("#opsTabs .ops-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.statusFilter = btn.getAttribute("data-s") || "all";
        render();
      });
    });
    if (qInput) {
      var timer = null;
      qInput.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.q = qInput.value || "";
          render();
        }, 220);
      });
    }
    document.getElementById("opsRefresh").addEventListener("click", function () {
      reload();
    });
    tbody.querySelectorAll("[data-approve]").forEach(function (b) {
      b.addEventListener("click", function () {
        approve(Number(b.getAttribute("data-approve")));
      });
    });
    tbody.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        remove(Number(b.getAttribute("data-del")));
      });
    });
  }

  async function approve(idx) {
    var r = state._view && state._view[idx];
    if (!r || !canApprove(r)) return;
    var label =
      (r.user_name || "cliente") +
      " · " +
      money(Number(r.amount_cents || 0)) +
      " · " +
      (r.origem || "");
    if (!window.confirm("Aprovar este reembolso?\n\n" + label)) return;
    showErr("");
    showOk("");
    try {
      var table = r._source_table;
      var patch = { updated_at: new Date().toISOString() };
      if (table === "refund_requests") {
        patch.status = "CONCLUÍDO";
        patch.processed_at = new Date().toISOString();
        patch.processed_by = state.adminId;
      } else if (table === "back_refund_requests") {
        patch.status = "approved";
      } else if (table === "withdrawals") {
        patch.status = "approved";
      } else {
        throw new Error("Origem desconhecida");
      }
      var up = await state.supa.from(table).update(patch).eq("id", r.id);
      if (up.error) throw up.error;
      showOk("Aprovado: " + label);
      await reload();
    } catch (ex) {
      showErr((ex && ex.message) || "Falha ao aprovar");
    }
  }

  async function remove(idx) {
    var r = state._view && state._view[idx];
    if (!r) return;
    var label =
      (r.user_name || "cliente") +
      " · " +
      money(Number(r.amount_cents || 0)) +
      " · " +
      (r.origem || "");
    var extra =
      r._source_table === "withdrawals" &&
      isSaldoReembolsoWithdrawal(r) &&
      String(r.status).toLowerCase() === "pending"
        ? "\n\nO valor será devolvido ao Saldo Reembolso do cliente."
        : "";
    if (
      !window.confirm(
        "Excluir este registro?\n\n" +
          label +
          extra +
          "\n\nEsta ação não pode ser desfeita."
      )
    ) {
      return;
    }
    showErr("");
    showOk("");
    try {
      var table = r._source_table;
      if (
        table === "withdrawals" &&
        isSaldoReembolsoWithdrawal(r) &&
        String(r.status).toLowerCase() === "pending"
      ) {
        var cents = Math.round(Number(r.amount_cents || 0));
        if (cents > 0 && r.user_id) {
          var prof = await state.supa
            .from("profiles")
            .select("deduction_balance_cents")
            .eq("id", r.user_id)
            .maybeSingle();
          if (prof.error) throw prof.error;
          var cur = Number(
            (prof.data && prof.data.deduction_balance_cents) || 0
          );
          var rest = await state.supa
            .from("profiles")
            .update({
              deduction_balance_cents: cur + cents,
              updated_at: new Date().toISOString(),
            })
            .eq("id", r.user_id);
          if (rest.error) throw rest.error;
        }
      }
      var del = await state.supa.from(table).delete().eq("id", r.id);
      if (del.error) throw del.error;
      showOk("Excluído: " + label);
      await reload();
    } catch (ex) {
      showErr((ex && ex.message) || "Falha ao excluir");
    }
  }

  async function reload() {
    showErr("");
    host.innerHTML = '<div class="meta">Carregando…</div>';
    await loadRows();
    render();
  }

  try {
    state.supa = ArbiV2.client();
    var user = await ArbiV2.requireUser(state.supa);
    if (!user) return;
    if (!(await ArbiV2.requireAdmin(state.supa, user))) {
      showErr("Sem permissão administrativa");
      host.innerHTML = "";
      return;
    }
    if (!(await ArbiV2.requireFinanceAdmin(state.supa, user))) {
      showErr("Sem permissão para a área Financeiro");
      host.innerHTML = "";
      location.replace("/admin.html");
      return;
    }
    state.adminId = user.id;
    await reload();
  } catch (ex) {
    showBootError((ex && ex.message) || "Erro ao carregar");
  }
})();
