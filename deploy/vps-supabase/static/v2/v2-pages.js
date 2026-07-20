/**
 * Páginas de lista/detalhe nativas do v2 (sem SPA).
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
    if (typeof v === "number") {
      if (Math.abs(v) >= 100 && String(v).endsWith("00") === false && /_cents$|amount|balance|value|liquidity/i.test("")) {
        /* handled by callers */
      }
      return String(v);
    }
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
      // valores em centavos costumam ser inteiros grandes
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
    return keys.filter(function (k) {
      return !skip[k];
    }).slice(0, 6);
  }

  function renderTable(cols, rows, mapRow) {
    var head =
      "<tr>" +
      cols
        .map(function (c) {
          return "<th>" + esc(c.replace(/_/g, " ")) + "</th>";
        })
        .join("") +
      "</tr>";
    var body = rows
      .map(function (r) {
        var cells = (mapRow ? mapRow(r, cols) : cols.map(function (c) {
          return "<td>" + moneyMaybe(c, r[c]) + "</td>";
        })).join("");
        return "<tr>" + cells + "</tr>";
      })
      .join("");
    return (
      '<div class="table-wrap"><table><thead>' +
      head +
      "</thead><tbody>" +
      (body || '<tr><td colspan="' + cols.length + '">Nenhum registro</td></tr>') +
      "</tbody></table></div>"
    );
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

  function bindSearch(rows, cols, render) {
    var input = document.getElementById("q");
    var count = document.getElementById("count");
    if (!input) {
      render(rows);
      return;
    }
    var timer = null;
    function norm(s) {
      return String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    }
    function go() {
      var parts = norm(input.value).split(/\s+/).filter(Boolean);
      var filtered = !parts.length
        ? rows
        : rows.filter(function (r) {
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
      if (count) count.textContent = filtered.length + " / " + rows.length;
      render(filtered);
    }
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(go, 280);
    });
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
    try {
      var loaded = await tryTables(supa, cfg.sources);
      var cols = pickCols(loaded.rows, cfg.cols || loaded.spec.cols);
      if (host) {
        host.innerHTML =
          '<div class="search"><input id="q" type="search" placeholder="Pesquisar…" autocomplete="off" /><span id="count">—</span></div><div id="tableHost"></div>';
      }
      var tableHost = document.getElementById("tableHost");
      bindSearch(loaded.rows, cols, function (filtered) {
        tableHost.innerHTML = renderTable(cols, filtered.slice(0, 150));
      });
    } catch (ex) {
      if (err) {
        err.textContent = (ex && ex.message) || "Erro ao carregar";
        err.classList.add("show");
      }
      if (host) {
        host.innerHTML =
          '<div class="bridge-box"><h2>Sem dados nesta tabela</h2><p>' +
          esc((ex && ex.message) || "Erro") +
          "</p><p class=\"meta\">Página 100% v2 — sem abrir o SPA.</p></div>";
      }
    }
  }

  async function mountApp(cfg) {
    var err = document.getElementById("err");
    var host = document.getElementById("pageBody");
    var supa = ArbiV2.client();
    var user = await ArbiV2.requireUser(supa);
    if (!user) return;
    try {
      var sources = (cfg.sources || []).map(function (s) {
        var copy = Object.assign({}, s);
        copy.eq = Object.assign({}, s.eq || {});
        if (cfg.scopeUser !== false) {
          if (!copy.eq.user_id && !copy.eq.id) copy.eq.user_id = user.id;
        }
        return copy;
      });
      // perfil: profiles by id
      if (cfg.id === "perfil") {
        sources = [{ table: "profiles", eq: { id: user.id }, select: "*", limit: 1 }];
      }
      var loaded = await tryTables(supa, sources);
      var cols = pickCols(loaded.rows, cfg.cols || loaded.spec.cols);
      if (cfg.render === "cards" && loaded.rows[0]) {
        var r = loaded.rows[0];
        host.innerHTML =
          '<div class="grid">' +
          cols
            .map(function (c) {
              return (
                '<div class="card"><strong>' +
                esc(c.replace(/_/g, " ")) +
                "</strong><b style=\"font-size:1.05rem\">" +
                moneyMaybe(c, r[c]) +
                "</b></div>"
              );
            })
            .join("") +
          "</div>";
        return;
      }
      host.innerHTML =
        '<div class="search"><input id="q" type="search" placeholder="Pesquisar…" autocomplete="off" /><span id="count">—</span></div><div id="tableHost"></div>';
      var tableHost = document.getElementById("tableHost");
      bindSearch(loaded.rows, cols, function (filtered) {
        tableHost.innerHTML = renderTable(cols, filtered.slice(0, 150));
      });
    } catch (ex) {
      if (err) {
        err.textContent = (ex && ex.message) || "Erro";
        err.classList.add("show");
      }
      if (host) {
        host.innerHTML =
          '<div class="bridge-box"><h2>Sem dados</h2><p>' +
          esc((ex && ex.message) || "Erro") +
          "</p></div>";
      }
    }
  }

  global.ArbiV2Page = { mountAdmin: mountAdmin, mountApp: mountApp, moneyMaybe: moneyMaybe, esc: esc };
})(window);
