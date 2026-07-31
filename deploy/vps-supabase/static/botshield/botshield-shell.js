/**
 * Shell BotShield — sidebar própria.
 * Nunca monta nav do app/admin ArbiShield.
 */
(function () {
  const NAV = [
    {
      label: "Bot",
      items: [
        { href: "/bots.html", id: "bots", title: "Meus bots" },
        { href: "/criar.html", id: "criar", title: "Criar bot" },
      ],
    },
    {
      label: "Modelos",
      items: [{ href: "/modelos.html", id: "modelos", title: "Modelos de Bots" }],
    },
    {
      label: "Ordens",
      items: [{ href: "/ordens.html", id: "ordens", title: "Minhas ordens" }],
    },
    {
      label: "Integrações",
      items: [
        {
          href: "/conta-betbra.html",
          id: "conta-betbra",
          title: "Conta BetBra",
        },
        { href: "/integracoes.html", id: "integracoes", title: "Minhas integrações" },
      ],
    },
  ];

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  async function mount() {
    if (!window.BotShield) return;
    if (!BotShield.hostOk()) {
      document.body.innerHTML =
        '<main style="padding:40px;font-family:sans-serif;color:#fff;background:#0b0d10">' +
        "<h1>BotShield</h1><p>Acesso somente via subdomínio " +
        "<code>botshield.arbishield.app</code>.</p></main>";
      return;
    }

    const active = document.body.getAttribute("data-active") || "bots";
    const sb = BotShield.client();
    const user = await BotShield.requireUser(sb);
    if (!user) return;

    let profile = null;
    try {
      const { data } = await sb
        .from("profiles")
        .select("full_name,email")
        .eq("id", user.id)
        .maybeSingle();
      profile = data;
    } catch {
      /* ignore */
    }

    const name =
      profile?.full_name ||
      user.user_metadata?.full_name ||
      user.email ||
      "Operador";
    const email = profile?.email || user.email || "";
    const ini = BotShield.initials(name, email);

    const layout = el('<div class="layout"></div>');
    const sidebar = el('<aside class="sidebar"></aside>');
    sidebar.appendChild(
      el(
        '<div class="brand">' +
          '<div class="brand-mark">BS</div>' +
          '<div class="brand-name">botshield</div>' +
          '<span class="brand-badge">beta</span>' +
          "</div>"
      )
    );

    NAV.forEach((group) => {
      const g = el('<div class="nav-group"></div>');
      g.appendChild(el('<div class="nav-label">' + group.label + "</div>"));
      group.items.forEach((item) => {
        const a = el(
          '<a class="nav-link' +
            (item.id === active ? " active" : "") +
            '" href="' +
            item.href +
            '">' +
            '<span class="nav-ico">▸</span><span>' +
            item.title +
            "</span></a>"
        );
        g.appendChild(a);
      });
      sidebar.appendChild(g);
    });

    const foot = el('<div class="sidebar-foot"></div>');
    foot.appendChild(
      el(
        '<div class="socials">' +
          '<div class="nav-label">Acesso</div>' +
          "<a href=\"https://arbishield.app\" target=\"_blank\" rel=\"noopener\">ArbiShield (app)</a>" +
          "<a href=\"/auth.html\">Trocar conta</a>" +
          "</div>"
      )
    );
    const chip = el(
      '<div class="user-chip">' +
        '<div class="avatar">' +
        ini +
        "</div>" +
        '<div class="user-meta"><strong></strong><span></span></div>' +
        '<button type="button" class="btn-ghost" id="bsLogout" title="Sair">⎋</button>' +
        "</div>"
    );
    chip.querySelector("strong").textContent = name;
    chip.querySelector("span").textContent = email;
    foot.appendChild(chip);
    sidebar.appendChild(foot);

    const main = el('<main class="main" id="bsMain"></main>');
    const top = el(
      '<div class="topbar">' +
        '<div class="crumbs">Dashboard · <strong></strong></div>' +
        '<div class="bal-chip" id="bsBalanceChip" title="Saldo BetBra">' +
        '<span class="bal-label">Saldo BetBra</span>' +
        '<strong class="bal-value" id="bsBalanceValue">…</strong>' +
        '<span class="bal-hint" id="bsBalanceHint" hidden></span>' +
        '<button type="button" class="btn-ghost bal-refresh" id="bsBalanceRefresh" title="Atualizar">↻</button>' +
        '<a class="bal-link" href="/conta-betbra.html">Conta</a>' +
        "</div>" +
        "</div>"
    );
    const titles = {
      bots: "Meus bots",
      criar: "Criar bot",
      modelos: "Modelos de Bots",
      ordens: "Minhas ordens",
      "conta-betbra": "Conta BetBra",
      integracoes: "Minhas integrações",
    };
    top.querySelector("strong").textContent = titles[active] || "BotShield";

    const page = document.getElementById("page");
    layout.appendChild(sidebar);
    layout.appendChild(main);
    main.appendChild(top);
    if (page) {
      main.appendChild(page);
      page.hidden = false;
    }
    document.body.prepend(layout);

    document.getElementById("bsLogout")?.addEventListener("click", async () => {
      await sb.auth.signOut();
      location.href = "/auth.html";
    });

    function formatBrl(n) {
      const v = Number(n);
      if (!Number.isFinite(v)) return "—";
      return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    async function bearer() {
      const { data } = await sb.auth.getSession();
      return data?.session?.access_token || "";
    }

    function setChipErr(shortLabel, detail) {
      const val = document.getElementById("bsBalanceValue");
      const hint = document.getElementById("bsBalanceHint");
      const chip = document.getElementById("bsBalanceChip");
      if (!val || !chip) return;
      let msg = String(detail || shortLabel || "Falha saldo");
      let short = shortLabel || "—";
      // Soft2Bet WAF: mensagem longa no chip; tooltip mantém o detalhe
      if (/api blocked|BETBRA_API_BLOCKED|bloqueou o login/i.test(msg)) {
        short = "API bloqueada";
        msg =
          "API bloqueada (WAF/VPS). Tente de novo em 1–2 min ou use Cookie da BetBra no Chrome. · Conta BetBra";
      } else if (/too many requests|BETBRA_RATE_LIMIT|Muitas tentativas/i.test(msg)) {
        short = "aguarde…";
        msg =
          "Muitas tentativas — espere 10–15 min sem Atualizar saldo. · Conta BetBra";
      }
      val.textContent = short;
      chip.classList.remove("is-ok");
      chip.classList.add("is-err");
      chip.title = msg + (msg.includes("Conta BetBra") ? "" : " · abra Conta BetBra");
      if (hint) {
        hint.hidden = false;
        const tip = /too many requests|Muitas tentativas|RATE_LIMIT/i.test(msg)
          ? "Aguarde 10–15 min (rate limit)"
          : /api blocked|bloqueou o login|WAF/i.test(msg)
            ? "API bloqueada (WAF/VPS)"
            : msg;
        hint.textContent = tip.length > 42 ? tip.slice(0, 40) + "…" : tip;
      }
    }

    function setChipOk(balance) {
      const val = document.getElementById("bsBalanceValue");
      const hint = document.getElementById("bsBalanceHint");
      const chip = document.getElementById("bsBalanceChip");
      if (!val || !chip) return;
      val.textContent = formatBrl(balance);
      chip.classList.remove("is-err");
      chip.classList.add("is-ok");
      chip.title = "Saldo BetBra";
      if (hint) {
        hint.hidden = true;
        hint.textContent = "";
      }
    }

    async function loadBalanceChip(force) {
      const val = document.getElementById("bsBalanceValue");
      const hint = document.getElementById("bsBalanceHint");
      const chip = document.getElementById("bsBalanceChip");
      if (!val || !chip) return;
      val.textContent = "…";
      chip.classList.remove("is-err", "is-ok");
      if (hint) {
        hint.hidden = true;
        hint.textContent = "";
      }
      try {
        const st = await fetch(
          "/api/arbishield/exchange-session/status?provider=betbra",
          {
            headers: {
              Accept: "application/json",
              Authorization: "Bearer " + (await bearer()),
            },
          }
        );
        const sj = await st.json().catch(() => ({}));
        if (!st.ok) {
          throw new Error(sj.error || "Status da conta indisponível");
        }
        if (!sj.connected) {
          setChipErr("sem conta", "Nenhuma Conta BetBra salva");
          return;
        }
        if (!sj.hasPassword) {
          setChipErr(
            "sem senha",
            "Salve login/senha em Conta BetBra para ler o saldo"
          );
          return;
        }
        if (!force && sj.lastBalance != null) {
          setChipOk(sj.lastBalance);
          return;
        }
        const res = await fetch(
          "/api/arbishield/exchange-session/balance?provider=betbra",
          {
            headers: {
              Accept: "application/json",
              Authorization: "Bearer " + (await bearer()),
            },
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Falha saldo");
        setChipOk(json.balance);
      } catch (ex) {
        setChipErr("—", ex instanceof Error ? ex.message : String(ex));
      }
    }

    document
      .getElementById("bsBalanceRefresh")
      ?.addEventListener("click", () => loadBalanceChip(true));

    // carrega saldo em todas as páginas (inclui Meus bots)
    loadBalanceChip(false);

    document.dispatchEvent(
      new CustomEvent("botshield:ready", { detail: { user, sb } })
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
