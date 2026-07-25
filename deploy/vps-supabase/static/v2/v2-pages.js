/**
 * Páginas de lista/detalhe nativas do v2 (layout tipo Gestão de Jogos).
 * Uso: ArbiV2Page.mountAdmin({...}) ou ArbiV2Page.mountApp({...})
 */
(function (global) {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtVal(v) {
    if (v == null || v === "") return "—";
    if (typeof v === "boolean") return v ? "sim" : "não";
    if (typeof v === "object") {
      try {
        return esc(JSON.stringify(v).slice(0, 120));
      } catch (e) {
        return "—";
      }
    }
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      var d = new Date(s);
      if (!isNaN(d.getTime())) return d.toLocaleString("pt-BR");
    }
    return esc(s);
  }

  function moneyMaybe(key, v) {
    if (typeof v !== "number") return fmtVal(v);
    if (/cent|amount|balance|value|liquidity|price/i.test(key) && Math.abs(v) >= 1) {
      if (/cent/i.test(key) || (Number.isInteger(v) && Math.abs(v) >= 100)) {
        return ArbiV2.money(v);
      }
    }
    return fmtVal(v);
  }

  function pickCols(rows, preferred) {
    if (!rows.length) return preferred && preferred.length ? preferred : [];
    var keys = Object.keys(rows[0]);
    if (preferred && preferred.length) {
      var ok = preferred.filter(function (k) {
        return keys.indexOf(k) >= 0;
      });
      if (ok.length) return ok;
    }
    var skip = { raw: 1, metadata: 1, meta: 1, payload: 1 };
    return keys
      .filter(function (k) {
        return !skip[k];
      })
      .slice(0, 7);
  }

  function statusClass(v) {
    var s = String(v || "").toLowerCase();
    if (/active|aprov|paid|open|success|publicado|published/.test(s)) return "ok";
    if (/pend|review|draft|aguard/.test(s)) return "warn";
    if (/cancel|reject|block|fail|denied|exclu/.test(s)) return "bad";
    return "";
  }

  var COL_LABELS = {
    user_name: "nome",
    user_id: "user id",
    amount_cents: "valor",
    created_at: "criado em",
  };

  function colLabel(c) {
    return COL_LABELS[c] || c.replace(/_/g, " ");
  }

  function renderTable(cols, rows) {
    var head =
      "<tr>" +
      cols
        .map(function (c) {
          return "<th>" + esc(colLabel(c)) + "</th>";
        })
        .join("") +
      "</tr>";
    var body = rows
      .map(function (r) {
        var cells = cols
          .map(function (c) {
            var val = moneyMaybe(c, r[c]);
            if (/status/i.test(c)) {
              var sc = statusClass(r[c]);
              return (
                '<td><span class="ops-badge' +
                (sc ? " " + sc : "") +
                '">' +
                val +
                "</span></td>"
              );
            }
            return "<td>" + val + "</td>";
          })
          .join("");
        return "<tr>" + cells + "</tr>";
      })
      .join("");
    return (
      '<div class="ops-panel"><div class="ops-table-wrap"><table class="ops-table"><thead>' +
      head +
      "</thead><tbody>" +
      (body ||
        '<tr><td colspan="' +
          cols.length +
          '" class="ops-empty">Nenhum registro</td></tr>') +
      "</tbody></table></div></div>"
    );
  }

  function renderShell(host, opts) {
    opts = opts || {};
    host.innerHTML =
      '<div class="ops-stats" id="opsStats"></div>' +
      '<div class="ops-toolbar">' +
      '<div class="ops-tabs" id="opsTabs"></div>' +
      '<input class="ops-search" id="q" type="search" placeholder="' +
      esc(opts.searchPlaceholder || "Buscar…") +
      '" autocomplete="off" />' +
      '<button type="button" class="btn btn-ghost btn-sm" id="opsRefresh">Atualizar</button>' +
      "</div>" +
      '<div class="meta" id="opsMeta">Carregando…</div>' +
      '<div id="tableHost"></div>';
  }

  function renderStats(total, filtered, extra) {
    var el = document.getElementById("opsStats");
    if (!el) return;
    var items = [
      { l: "Total", v: total, c: "" },
      { l: "Visíveis", v: filtered, c: "lime" },
      { l: "Tabela", v: extra || "—", c: "" },
    ];
    el.innerHTML = items
      .map(function (it) {
        return (
          '<div class="ops-stat"><div class="l">' +
          esc(it.l) +
          '</div><div class="v ' +
          esc(it.c) +
          '">' +
          esc(it.v) +
          "</div></div>"
        );
      })
      .join("");
  }

  async function loadTable(supa, table, opts) {
    opts = opts || {};
    function build(withOrder) {
      var q = supa.from(table).select(opts.select || "*");
      if (opts.eq) {
        Object.keys(opts.eq).forEach(function (k) {
          q = q.eq(k, opts.eq[k]);
        });
      }
      if (withOrder) {
        if (opts.order) {
          q = q.order(opts.order.col || "created_at", {
            ascending: !!opts.order.asc,
            nullsFirst: false,
          });
        } else {
          q = q.order("created_at", { ascending: false, nullsFirst: false });
        }
      }
      return q.limit(opts.limit || 200);
    }
    var res = await build(true);
    if (res.error && /created_at|column/i.test(res.error.message || "")) {
      res = await build(false);
    }
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function tryTables(supa, specs) {
    var lastErr = null;
    for (var i = 0; i < specs.length; i++) {
      try {
        var rows = await loadTable(supa, specs[i].table, specs[i]);
        return { spec: specs[i], rows: rows };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Nenhuma tabela disponível");
  }

  /** Anexa profiles.full_name em cada linha com user_id → campo user_name */
  async function enrichUserNames(supa, rows) {
    if (!rows || !rows.length) return rows || [];
    var ids = {};
    rows.forEach(function (r) {
      if (r && r.user_id) ids[String(r.user_id)] = 1;
    });
    var list = Object.keys(ids);
    if (!list.length) return rows;

    var map = {};
    for (var i = 0; i < list.length; i += 80) {
      var chunk = list.slice(i, i + 80);
      var res = await supa.from("profiles").select("id,full_name").in("id", chunk);
      if (res.error) break;
      (res.data || []).forEach(function (p) {
        var name = p.full_name && String(p.full_name).trim();
        map[String(p.id)] = name || "—";
      });
    }

    return rows.map(function (r) {
      var copy = Object.assign({}, r);
      copy.user_name = map[String(r.user_id)] || "—";
      return copy;
    });
  }

  function uniqueStatuses(rows) {
    var set = {};
    rows.forEach(function (r) {
      if (r.status != null && r.status !== "") set[String(r.status)] = 1;
    });
    return Object.keys(set).slice(0, 8);
  }

  function bindFilters(rows, cols, tableName, onReload) {
    var input = document.getElementById("q");
    var tabs = document.getElementById("opsTabs");
    var meta = document.getElementById("opsMeta");
    var tableHost = document.getElementById("tableHost");
    var refresh = document.getElementById("opsRefresh");
    var statusFilter = "all";
    var statuses = uniqueStatuses(rows);

    if (tabs) {
      tabs.innerHTML =
        '<button type="button" class="ops-tab active" data-s="all">Todos</button>' +
        statuses
          .map(function (s) {
            return (
              '<button type="button" class="ops-tab" data-s="' +
              esc(s) +
              '">' +
              esc(s) +
              "</button>"
            );
          })
          .join("");
      tabs.querySelectorAll(".ops-tab").forEach(function (btn) {
        btn.addEventListener("click", function () {
          tabs.querySelectorAll(".ops-tab").forEach(function (b) {
            b.classList.remove("active");
          });
          btn.classList.add("active");
          statusFilter = btn.getAttribute("data-s") || "all";
          go();
        });
      });
    }

    function norm(s) {
      return String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    }

    function go() {
      var parts = norm(input && input.value).split(/\s+/).filter(Boolean);
      var filtered = rows.filter(function (r) {
        if (statusFilter !== "all" && String(r.status) !== statusFilter) return false;
        if (!parts.length) return true;
        var hay = norm(
          cols
            .map(function (c) {
              return r[c];
            })
            .join(" ")
        );
        return parts.every(function (p) {
          return hay.indexOf(p) >= 0;
        });
      });
      renderStats(rows.length, filtered.length, tableName);
      if (meta) {
        meta.textContent =
          filtered.length +
          " registro(s) · layout Jogos · sem SPA";
      }
      tableHost.innerHTML = renderTable(cols, filtered.slice(0, 150));
    }

    if (input) {
      var timer = null;
      input.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(go, 280);
      });
    }
    if (refresh && onReload) {
      refresh.addEventListener("click", function () {
        onReload();
      });
    }
    go();
  }

  async function mountAdmin(cfg) {
    var err = document.getElementById("err");
    var host = document.getElementById("pageBody");
    var supa = ArbiV2.client();
    var user = await ArbiV2.requireUser(supa);
    if (!user) return;
    if (!(await ArbiV2.requireAdmin(supa, user))) {
      if (err) {
        err.textContent = "Sem permissão administrativa";
        err.classList.add("show");
      }
      if (host) host.innerHTML = "";
      return;
    }

    var active =
      (cfg && cfg.id) ||
      (document.body && document.body.getAttribute("data-active")) ||
      "";
    if (
      typeof ArbiV2.isFinancePageId === "function" &&
      ArbiV2.isFinancePageId(active)
    ) {
      if (!(await ArbiV2.requireFinanceAdmin(supa, user))) {
        if (err) {
          err.textContent = "Sem permissão para a área Financeiro";
          err.classList.add("show");
        }
        if (host) host.innerHTML = "";
        location.replace("/admin.html");
        return;
      }
    }

    async function run() {
      if (err) err.classList.remove("show");
      renderShell(host, {
        searchPlaceholder: cfg.searchPlaceholder || "Buscar na lista…",
      });
      try {
        var loaded = await tryTables(supa, cfg.sources);
        var rows = loaded.rows;
        var wantName =
          cfg.enrichUserNames === true ||
          (cfg.cols || []).indexOf("user_name") >= 0;
        if (wantName) {
          rows = await enrichUserNames(supa, rows);
        }
        var cols = pickCols(rows, cfg.cols || loaded.spec.cols);
        bindFilters(rows, cols, loaded.spec.table, run);
      } catch (ex) {
        if (err) {
          err.textContent = (ex && ex.message) || "Erro ao carregar";
          err.classList.add("show");
        }
        if (host) {
          host.innerHTML =
            '<div class="ops-panel"><div class="ops-empty"><h2>Sem dados nesta tabela</h2><p>' +
            esc((ex && ex.message) || "Erro") +
            "</p><p class=\"meta\">Página 100% v2 — layout Jogos · sem SPA.</p></div></div>";
        }
      }
    }

    await run();
  }

  async function mountApp(cfg) {
    var err = document.getElementById("err");
    var host = document.getElementById("pageBody");
    var supa = ArbiV2.client();
    var user = await ArbiV2.requireUser(supa);
    if (!user) return;

    async function run() {
      if (err) err.classList.remove("show");
      try {
        var sources = (cfg.sources || []).map(function (s) {
          var copy = Object.assign({}, s);
          copy.eq = Object.assign({}, s.eq || {});
          if (cfg.scopeUser !== false) {
            if (!copy.eq.user_id && !copy.eq.id) copy.eq.user_id = user.id;
          }
          return copy;
        });
        if (cfg.id === "perfil") {
          sources = [{ table: "profiles", eq: { id: user.id }, select: "*", limit: 1 }];
        }
        var loaded = await tryTables(supa, sources);
        var cols = pickCols(loaded.rows, cfg.cols || loaded.spec.cols);
        if (cfg.render === "cards" && loaded.rows[0]) {
          var r = loaded.rows[0];
          host.innerHTML =
            '<div class="ops-stats">' +
            cols
              .slice(0, 6)
              .map(function (c) {
                return (
                  '<div class="ops-stat"><div class="l">' +
                  esc(c.replace(/_/g, " ")) +
                  '</div><div class="v">' +
                  moneyMaybe(c, r[c]) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>";
          return;
        }
        renderShell(host, {
          searchPlaceholder: cfg.searchPlaceholder || "Buscar…",
        });
        bindFilters(loaded.rows, cols, loaded.spec.table, run);
      } catch (ex) {
        if (err) {
          err.textContent = (ex && ex.message) || "Erro";
          err.classList.add("show");
        }
        if (host) {
          host.innerHTML =
            '<div class="ops-panel"><div class="ops-empty"><h2>Sem dados</h2><p>' +
            esc((ex && ex.message) || "Erro") +
            "</p></div></div>";
        }
      }
    }

    await run();
  }

  global.ArbiV2Page = {
    mountAdmin: mountAdmin,
    mountApp: mountApp,
    moneyMaybe: moneyMaybe,
    esc: esc,
  };
})(window);
