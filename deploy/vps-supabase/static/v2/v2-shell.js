/**
 * Shell ArbiShield v2 — 100% nativo (sem links para /app ou /admin SPA).
 */
(function (global) {
  function p(id, label, href, opts) {
    opts = opts || {};
    return {
      id: id,
      label: label,
      href: href,
      badge: opts.badge || "",
      glow: !!opts.glow || !!opts.badge,
      icon: opts.icon || id,
    };
  }

  var APP_ICONS = {
    academia:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5L12 15 3 9.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 12v4.5c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5V12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M21 10v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    home:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.8"/></svg>',
    proteger:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 9 4.2-1.2 7-4.5 7-9V6l-7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m9.2 12 1.8 1.8 3.8-3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    protecoes:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 7h12M8 12h12M8 17h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="4.5" cy="7" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="17" r="1" fill="currentColor"/></svg>',
    desafio:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4h8v3a4 4 0 0 1-8 0V4z" stroke="currentColor" stroke-width="1.8"/><path d="M8 6H5.5A2.5 2.5 0 0 0 5 11c1.2 1.2 2.8 1.7 4 2M16 6h2.5A2.5 2.5 0 0 1 19 11c-1.2 1.2-2.8 1.7-4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 15h4v2l-2 3-2-3v-2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    carteira:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 8.5h15A2.5 2.5 0 0 1 21 11v7.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-10A2 2 0 0 1 5 6.5h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 14.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    suporte:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12a7 7 0 0 1 14 0v4.5A2.5 2.5 0 0 1 16.5 19H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 13.5H4A1.5 1.5 0 0 0 2.5 15v1A1.5 1.5 0 0 0 4 17.5h1V13.5zM19 13.5h1A1.5 1.5 0 0 1 21.5 15v1A1.5 1.5 0 0 1 20 17.5h-1V13.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    afiliados:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 18.5c.8-2.8 2.8-4.2 5.5-4.2s4.7 1.4 5.5 4.2M14.5 18.5c.4-1.5 1.4-2.6 3-2.6 1.2 0 2.1.6 2.7 1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    partners:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 9.5 8.5 3.5 9l4.5 4-1.3 5.8L12 16.2l5.3 2.6-1.3-5.8 4.5-4-6-.5L12 3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    "baixar-app":
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 16.5V18A2 2 0 0 0 7 20h10a2 2 0 0 0 2-2v-1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  var ADMIN_SECTIONS = [
    {
      title: "Operação",
      color: "#22d3ee",
      items: [
        p("hub", "Dashboard", "/admin.html"),
        p("jogos", "Jogos", "/admin-jogos.html"),
        p("desafios", "Desafios ArbiShield", "/admin-desafios.html"),
        p("balanco-desafio", "Balanço Desafio", "/admin-balanco-desafio.html"),
        p("monitoring-protections", "Monitor de Proteções", "/admin-monitoring-protections.html"),
        p("monitoring-desafios", "Monitor de Desafios", "/admin-monitoring-desafios.html"),
      ],
    },
    {
      title: "Financeiro",
      color: "#34d399",
      items: [
        p("transactions", "Transações", "/admin-transactions.html"),
        p("saques", "Saques", "/admin-saques.html"),
        p("manual-deposits", "Depósitos", "/admin-manual-deposits.html"),
        p("refunds", "Reembolsos", "/admin-refunds.html"),
        p("treasury", "Tesouraria", "/admin-treasury.html"),
        p("partners-distribution", "Distribuição", "/admin-partners-distribution.html"),
        p("expenses", "Despesas", "/admin-expenses.html"),
      ],
    },
    {
      title: "Usuários",
      color: "#a78bfa",
      items: [
        p("users", "Usuários", "/admin-users.html"),
        p("partners", "Partners", "/admin-partners.html"),
        p("affiliates", "Afiliados", "/admin-affiliates.html"),
      ],
    },
    {
      title: "Compliance & Risco",
      color: "#f59e0b",
      items: [
        p("contestations", "Contestações de Apostas", "/admin-contestations.html"),
        p("approvals", "Aprovações", "/admin-approvals.html"),
        p("proofs", "Comprovantes", "/admin-proofs.html"),
        p("investigation", "Investigação", "/admin-investigation.html"),
        p("risk", "Monitor de Risco", "/admin-risk.html"),
        p("blacklist", "Blacklist", "/admin-blacklist.html"),
        p("geo", "Geosegurança", "/admin-geo.html"),
        p("signup-attempts", "Tentativas de Cadastro", "/admin-signup-attempts.html"),
      ],
    },
    {
      title: "Conteúdo",
      color: "#c6ff00",
      items: [
        p("whatsapp", "Marketing / WhatsApp", "/admin-whatsapp.html"),
        p("communication-lab", "Communication Lab", "/admin-communication-lab.html"),
        p("banners", "Banners", "/admin-banners.html"),
        p("onboarding", "Onboarding", "/admin-onboarding.html"),
        p("academia", "Academia", "/admin-academia.html"),
      ],
    },
    {
      title: "Suporte",
      color: "#f472b6",
      items: [
        p("support", "Suporte", "/admin-support.html"),
        p("support-ai", "Suporte IA", "/admin-support-ai.html"),
      ],
    },
    {
      title: "Sistema",
      color: "#94a3b8",
      items: [
        p("settings", "Configurações", "/admin-settings.html"),
        p("betting-houses", "Casas de Aposta", "/admin-betting-houses.html"),
        p("permissoes", "Permissões de Admins", "/admin-permissoes.html"),
        p("marketing-team", "Time de Marketing", "/admin-marketing-team.html"),
      ],
    },
    {
      title: "Avançado",
      color: "#71717a",
      items: [
        p("logs", "Logs / Auditoria", "/admin-logs.html"),
        p("settlements-audit", "Auditoria de Encerramentos", "/admin-settlements-audit.html"),
        p("technical-audit", "Monitor Técnico", "/admin-technical-audit.html"),
        p("performance", "Performance", "/admin-performance.html"),
        p("siem", "SIEM / Eventos", "/admin-siem.html"),
        p("monitoring", "Monitoria Staff", "/admin-monitoring.html"),
        p("app", "Ir para o App", "/app.html"),
      ],
    },
  ];

  // Aba Academia oculta no menu do cliente (pedido 2026-08-01).
  // Marker: hide-app-academia-nav-v1 — rota /app-academia.html permanece.
  var APP_SECTIONS = [
    {
      title: "Operações",
      color: "#9ca36a",
      items: [
        p("home", "Visão Geral", "/app.html"),
        p("proteger", "Proteger Aposta", "/app-proteger.html"),
        p("protecoes", "Minhas Proteções", "/app-protecoes.html"),
        p("desafio", "Desafio", "/app-desafio.html", { glow: true }),
        p("carteira", "Financeiro", "/app-carteira.html"),
        p("suporte", "Atendimento", "/app-suporte.html"),
      ],
    },
    {
      title: "Comunidade",
      color: "#9ca36a",
      items: [
        p("afiliados", "Afiliados", "/app-afiliados.html", { badge: "Novo", glow: true }),
        p("partners", "Provedor", "/app-partners.html", { badge: "Novo", glow: true }),
        p("baixar-app", "Baixar App", "/app-baixar-app.html"),
      ],
    },
  ];

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function renderSections(sections, active, opts) {
    opts = opts || {};
    var withIcons = !!opts.withIcons;
    var accordion = !!opts.accordion;
    return sections
      .map(function (sec) {
        var hasActive = sec.items.some(function (item) {
          return item.id === active;
        });
        var open = !accordion || hasActive;
        var links = sec.items
          .map(function (item) {
            var cls =
              "v2-nav-link" +
              (item.id === active ? " is-active" : "") +
              (item.glow ? " is-novo" : "");
            var badge = item.badge
              ? '<span class="badge">' + esc(item.badge) + "</span>"
              : "";
            var icon = "";
            if (withIcons) {
              icon =
                '<span class="nav-ico">' +
                (APP_ICONS[item.icon] || APP_ICONS.home) +
                "</span>";
            }
            return (
              '<a class="' +
              cls +
              '" href="' +
              esc(item.href) +
              '" title="' +
              esc(item.label) +
              '">' +
              icon +
              '<span class="lbl">' +
              esc(item.label) +
              "</span>" +
              badge +
              "</a>"
            );
          })
          .join("");

        var secHead =
          (opts.hideDots
            ? ""
            : '<span class="dot" style="background:' +
              esc(sec.color) +
              '"></span>') +
          '<span class="sec-lbl">' +
          esc(sec.title) +
          "</span>";

        if (!accordion) {
          return (
            '<div class="v2-nav-section">' + secHead + "</div>" + links
          );
        }

        var sid = String(sec.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "");
        return (
          '<div class="v2-nav-group' +
          (open ? " is-open" : "") +
          '" data-nav-group="' +
          esc(sid) +
          '">' +
          '<button type="button" class="v2-nav-section v2-nav-accordion-btn" aria-expanded="' +
          (open ? "true" : "false") +
          '" aria-controls="v2-nav-items-' +
          esc(sid) +
          '">' +
          secHead +
          '<span class="sec-chevron" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          "</span>" +
          "</button>" +
          '<div class="v2-nav-group-items" id="v2-nav-items-' +
          esc(sid) +
          '"' +
          (open ? "" : " hidden") +
          ">" +
          links +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function bindAdminNavAccordion(root) {
    if (!root) return;
    root.querySelectorAll(".v2-nav-accordion-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.closest(".v2-nav-group");
        if (!group) return;
        var willOpen = !group.classList.contains("is-open");
        group.classList.toggle("is-open", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
        var panel = group.querySelector(".v2-nav-group-items");
        if (panel) {
          if (willOpen) panel.removeAttribute("hidden");
          else panel.setAttribute("hidden", "");
        }
      });
    });
  }

  async function mount() {
    var body = document.body;
    var shell = body.getAttribute("data-shell");
    if (!shell || (shell !== "admin" && shell !== "app")) return;

    var active = body.getAttribute("data-active") || "";
    if (!active) {
      try {
        var file = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
        if (file === "admin-jogos") active = "jogos";
        else if (file === "admin-desafios") active = "desafios";
        else if (file === "admin-users") active = "users";
        else if (file === "admin") active = "hub";
        else if (file === "app") active = "home";
        else if (file.indexOf("admin-") === 0) active = file.slice(6);
        else if (file.indexOf("app-") === 0) active = file.slice(4);
      } catch (e) {}
    }

    var brandHref = shell === "admin" ? "/admin.html" : "/app.html";
    var brandSub =
      shell === "admin"
        ? "Admin · v2"
        : "Líder global em proteção de apostas";

    // Área Financeiro: só isaacgomes3@gmail.com e financeiro@arbishield.com
    // Marker: admin-mfa-required-v1 — admin sem 2FA não entra no painel
    var canFinance = false;
    if (shell === "admin" && global.ArbiV2 && global.ArbiV2.client) {
      try {
        var earlySupa = global.ArbiV2.client();
        var earlySess = await earlySupa.auth.getUser();
        var earlyUser = earlySess.data && earlySess.data.user;
        if (!earlyUser) {
          location.replace("/auth.html");
          return;
        }
        if (typeof global.ArbiV2.ensureAdminMfa === "function") {
          var mfaGate = await global.ArbiV2.ensureAdminMfa(earlySupa, earlyUser);
          if (!mfaGate.ok) return;
        } else if (typeof global.ArbiV2.requireAdmin === "function") {
          if (!(await global.ArbiV2.requireAdmin(earlySupa, earlyUser))) {
            location.replace("/auth.html");
            return;
          }
        }
        canFinance =
          typeof global.ArbiV2.canAccessFinance === "function" &&
          !!global.ArbiV2.canAccessFinance(earlyUser.email);
      } catch (earlyErr) {}
      if (
        !canFinance &&
        typeof global.ArbiV2.isFinancePageId === "function" &&
        global.ArbiV2.isFinancePageId(active)
      ) {
        location.replace("/admin.html");
        return;
      }
    }

    var sections =
      shell === "admin"
        ? ADMIN_SECTIONS.filter(function (sec) {
            if (String(sec.title || "").trim().toLowerCase() !== "financeiro") {
              return true;
            }
            return canFinance;
          })
        : APP_SECTIONS;

    if (!body.classList.contains("v2-layout-ready")) {
      var children = Array.prototype.slice.call(body.childNodes);
      var layout = document.createElement("div");
      layout.className = "v2-layout";
      var aside = document.createElement("aside");
      aside.className = "v2-sidebar";
      aside.id = "v2-sidebar";
      var main = document.createElement("div");
      main.className = "v2-main";
      var top = document.createElement("div");
      top.className = "v2-topbar";
      top.innerHTML =
        '<button type="button" class="v2-menu-btn" id="v2MenuBtn">Menu</button>' +
        '<a class="brand" href="' +
        brandHref +
        '">Arbi<span>Shield</span></a>';
      main.appendChild(top);
      if (shell === "admin") {
        var adminHeader = document.createElement("header");
        adminHeader.className = "v2-admin-header";
        adminHeader.id = "v2AdminHeader";
        adminHeader.innerHTML =
          '<div class="v2-admin-header-left">' +
          '<span class="v2-status-pill"><span class="v2-status-dot" aria-hidden="true"></span>Terminal de Segurança Ativo</span>' +
          '<div class="v2-user-chip" id="v2UserChip">' +
          '<div class="avatar">AD</div>' +
          "<div><strong id=\"v2UserName\">Admin</strong><small>Acesso Master</small></div>" +
          "</div></div>" +
          '<div class="v2-admin-header-right">' +
          '<a class="v2-mode-switch" id="v2ModeSwitch" href="/app.html" title="Abrir área do usuário">Modo usuário</a>' +
          '<button type="button" class="v2-search-chip" id="v2SearchPages">Buscar página <kbd>⌘K</kbd></button>' +
          // Marker: auth-logout-others-v1
          '<button type="button" class="v2-search-chip" id="v2EndOtherSessions" title="Encerra sessões em outros PCs/navegadores">Encerrar outras sessões</button>' +
          '<button type="button" class="v2-logout-btn" id="v2AdminLogout">Sair do Sistema</button>' +
          "</div>";
        main.appendChild(adminHeader);
      }
      if (shell === "app") {
        var appHeader = document.createElement("header");
        appHeader.className = "v2-app-header";
        appHeader.id = "v2AppHeader";
        appHeader.innerHTML =
          '<button type="button" class="v2-menu-btn" id="v2MenuBtnHeader" aria-label="Menu">Menu</button>' +
          '<div class="v2-app-header-actions">' +
          '<a class="v2-mode-switch" id="v2ModeSwitch" href="/admin.html" hidden title="Abrir painel administrativo">Modo ADM</a>' +
          '<a class="v2-deposit-btn" href="#deposito" data-open-deposit="1"><span aria-hidden="true">+</span> Depósito</a>' +
          '<a class="v2-icon-btn" href="/app-suporte.html" aria-label="Notificações" title="Notificações">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 3.5 1.5 5 2 6H4c.5-1 2-2.5 2-6zM10 19a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          "</a>" +
          '<a class="v2-avatar-btn" href="/app-perfil.html" id="v2AppAvatar" aria-label="Perfil">U</a>' +
          "</div>";
        main.appendChild(appHeader);

        // Contadores fora do header sticky — rolam com a página
        var balBar = document.createElement("div");
        balBar.className = "v2-app-balances-bar";
        balBar.id = "v2AppBalancesBar";
        balBar.innerHTML =
          '<div class="v2-app-balances" aria-label="Saldos">' +
          '<a class="v2-bal-chip v2-bal-apostador" href="/app-carteira.html"><span class="l">Apostador</span><span class="v" id="v2BalApostador">—</span></a>' +
          '<a class="v2-bal-chip v2-bal-afiliado" href="/app-afiliados.html"><span class="l">Afiliado</span><span class="v" id="v2BalAfiliado">—</span></a>' +
          '<a class="v2-bal-chip v2-bal-desafio" href="/app-desafio.html"><span class="l">Desafio</span><span class="v" id="v2BalDesafio">—</span></a>' +
          // Marker: hide-congelado-visor-v1 — trava stake_lock continua no backend;
          // o chip "Congelado" foi removido (fallback somava proteções ativas e
          // divergia de locked_balance → anomalia visual / Espelho).
          '<a class="v2-bal-chip v2-bal-provedor" href="/app-partners.html"><span class="l">Provedor</span><span class="v" id="v2BalProvedor">—</span></a>' +
          "</div>";
        main.appendChild(balBar);
      }
      var page = document.createElement("div");
      page.className = "v2-page";
      children.forEach(function (n) {
        if (n.nodeType === 1 && (n.id === "v2-sidebar" || n.classList.contains("v2-sidebar"))) return;
        page.appendChild(n);
      });
      main.appendChild(page);
      layout.appendChild(aside);
      layout.appendChild(main);
      body.appendChild(layout);
      if (shell === "app") {
        var bottom = document.createElement("nav");
        bottom.className = "v2-bottom-nav";
        bottom.id = "v2BottomNav";
        bottom.setAttribute("aria-label", "Navegação principal");
        bottom.innerHTML =
          '<a href="/app.html" data-nav="home"><span class="ico">⌂</span>Início</a>' +
          '<a href="/app-protecoes.html" data-nav="protecoes"><span class="ico">◉</span>Proteções</a>' +
          '<a class="is-primary" href="/app-proteger.html" data-nav="proteger"><span class="ico">⚡</span>Proteger</a>' +
          '<a href="/app-desafio.html" data-nav="desafio"><span class="ico">★</span>Desafio</a>' +
          '<a href="/app-perfil.html" data-nav="perfil"><span class="ico">◎</span>Perfil</a>';
        body.appendChild(bottom);
      }
      body.classList.add("v2-layout-ready");
    }

    var sidebar = document.getElementById("v2-sidebar");
    if (!sidebar) return;

    // Cliente e ADM compartilham o mesmo chrome de sidebar
    sidebar.classList.add("v2-sidebar-app");
    try {
      var collapseKey =
        shell === "admin"
          ? "arbishield.adminSidebarCollapsed"
          : "arbishield.sidebarCollapsed";
      if (localStorage.getItem(collapseKey) === "1") {
        body.classList.add("v2-sidebar-collapsed");
      }
    } catch (e) {}

    var brandRowHtml =
      '<div class="v2-sidebar-brand-row">' +
      '<a class="v2-sidebar-brand" href="' +
      brandHref +
      '">' +
      '<img class="mark-img" src="/brand/icon-64.png" width="40" height="40" alt="" decoding="async" />' +
      "<div><strong>Arbi<span>Shield</span></strong><small>" +
      esc(brandSub) +
      "</small></div></a>" +
      '<button type="button" class="v2-collapse-btn" id="v2CollapseBtn" aria-label="Recolher menu" title="Recolher menu">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 6 8 12l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</button></div>";

    var footHtml =
      shell === "app"
        ? '<div class="v2-sidebar-foot v2-app-foot">' +
          '<a class="v2-app-user" href="/app-perfil.html">' +
          '<div class="v2-avatar-btn sm" id="v2SideAvatar">U</div>' +
          '<div class="v2-app-user-meta"><strong id="v2SideName">Membro</strong>' +
          '<span class="v2-side-bals">' +
          '<span class="d">D: <b id="v2SideBalD">R$ 0,00</b></span>' +
          '<span class="i">I: <b id="v2SideBalI">R$ 0,00</b></span>' +
          "</span></div></a>" +
          '<a class="v2-nav-link v2-logout" href="#" id="v2LogoutLink">' +
          '<span class="lbl">Sair</span>' +
          '<span class="nav-ico out" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6.5A1.5 1.5 0 0 1 10 18.5V17M4 12h10m0 0-3-3m3 3-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
          "</a></div>"
        : '<div class="v2-sidebar-foot v2-app-foot">' +
          '<div class="v2-app-user" style="cursor:default">' +
          '<div class="v2-avatar-btn sm" id="v2SideAvatar">AD</div>' +
          '<div class="v2-app-user-meta"><strong id="v2SideName">Admin</strong>' +
          "<small>Painel · v2</small></div></div>" +
          '<a class="v2-nav-link v2-logout" href="#" id="v2LogoutLink">' +
          '<span class="lbl">Sair</span>' +
          '<span class="nav-ico out" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6.5A1.5 1.5 0 0 1 10 18.5V17M4 12h10m0 0-3-3m3 3-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
          "</a></div>";

    sidebar.innerHTML =
      brandRowHtml +
      '<div class="v2-sidebar-scroll">' +
      renderSections(sections, active, {
        withIcons: true,
        hideDots: true,
        accordion: shell === "admin",
      }) +
      "</div>" +
      footHtml;

    if (shell === "admin") bindAdminNavAccordion(sidebar);

    var collapseBtn = document.getElementById("v2CollapseBtn");

    if (!document.querySelector('link[data-v2-favicon]')) {
      var fav = document.createElement("link");
      fav.rel = "icon";
      fav.type = "image/png";
      fav.href = "/brand/favicon-192.png";
      fav.setAttribute("data-v2-favicon", "1");
      document.head.appendChild(fav);
    }

    if (shell === "app" && !document.querySelector("script[data-v2-deposit]")) {
      var dep = document.createElement("script");
      dep.src = "/v2-deposit.js";
      dep.defer = true;
      dep.setAttribute("data-v2-deposit", "1");
      document.head.appendChild(dep);
    }

    var backdrop = document.querySelector(".v2-sidebar-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "v2-sidebar-backdrop";
      body.insertBefore(backdrop, body.firstChild);
    }
    function closeNav() {
      body.classList.remove("v2-nav-open");
    }
    function toggleNav() {
      body.classList.toggle("v2-nav-open");
    }
    function isMobileShell() {
      return window.matchMedia && window.matchMedia("(max-width: 960px)").matches;
    }
    backdrop.addEventListener("click", closeNav);
    function bindMenu(el) {
      if (!el) return;
      el.addEventListener("click", function () {
        toggleNav();
      });
    }
    bindMenu(document.getElementById("v2MenuBtn"));
    bindMenu(document.getElementById("v2MenuBtnHeader"));

    // Fecha o drawer ao navegar / Escape (cliente + ADM)
    sidebar.querySelectorAll("a.v2-nav-link, a.v2-sidebar-brand, #v2LogoutLink, #v2AdminLogout").forEach(function (a) {
      a.addEventListener("click", closeNav);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeNav();
    });
    window.addEventListener("resize", function () {
      if (!isMobileShell()) closeNav();
    });

    if (collapseBtn) {
      collapseBtn.addEventListener("click", function () {
        if (isMobileShell()) return;
        body.classList.toggle("v2-sidebar-collapsed");
        try {
          var key =
            shell === "admin"
              ? "arbishield.adminSidebarCollapsed"
              : "arbishield.sidebarCollapsed";
          localStorage.setItem(
            key,
            body.classList.contains("v2-sidebar-collapsed") ? "1" : "0"
          );
        } catch (e2) {}
      });
    }

    if (shell === "app") {
      var bottomNav = document.getElementById("v2BottomNav");
      if (bottomNav) {
        bottomNav.querySelectorAll("a[data-nav]").forEach(function (a) {
          if (a.getAttribute("data-nav") === active) a.classList.add("is-active");
          a.addEventListener("click", closeNav);
        });
      }
    }

    async function doLogout(e) {
      if (e) e.preventDefault();
      try {
        if (global.ArbiV2 && global.ArbiV2.clearImpersonation) {
          global.ArbiV2.clearImpersonation();
        }
      } catch (clearImpErr) {}
      try {
        if (global.ArbiV2 && global.ArbiV2.client) {
          await global.ArbiV2.client().auth.signOut();
        }
      } catch (err) {}
      location.replace("/auth.html");
    }
    var logoutLinks = document.querySelectorAll("#v2LogoutLink, #v2AdminLogout");
    logoutLinks.forEach(function (el) {
      el.addEventListener("click", doLogout);
    });

    // Marker: auth-logout-others-v1
    var endOthersBtn = document.getElementById("v2EndOtherSessions");
    if (endOthersBtn) {
      endOthersBtn.addEventListener("click", async function () {
        if (
          !confirm(
            "Encerrar sessões em OUTROS dispositivos/navegadores?\n\n" +
              "Use se alguém estiver logado na sua conta em outra rede.\n" +
              "Esta aba pode pedir login de novo em alguns segundos."
          )
        ) {
          return;
        }
        endOthersBtn.disabled = true;
        try {
          var supa = global.ArbiV2 && global.ArbiV2.client && global.ArbiV2.client();
          var sess = await supa.auth.getSession();
          var token =
            sess &&
            sess.data &&
            sess.data.session &&
            sess.data.session.access_token;
          if (!token) throw new Error("Sessão não encontrada — faça login.");
          var res = await fetch("/api/arbishield/auth-logout-others", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({ scope: "others" }),
          });
          var data = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error((data && data.error) || "Falha ao encerrar sessões");
          alert(
            "Outras sessões encerradas.\n" +
              (data.note || "Se esta tela travar, faça login novamente.")
          );
        } catch (err) {
          alert((err && err.message) || "Erro ao encerrar sessões");
        } finally {
          endOthersBtn.disabled = false;
        }
      });
    }

    if (shell === "app") {
      try {
        if (global.ArbiV2 && global.ArbiV2.client) {
          var appSupa = global.ArbiV2.client();
          var appUserRes = await appSupa.auth.getUser();
          var appUser = appUserRes.data && appUserRes.data.user;
          if (appUser) {
            // Botão Modo ADM só para administradores (barra superior)
            try {
              var modeBtn = document.getElementById("v2ModeSwitch");
              if (
                modeBtn &&
                global.ArbiV2.isAdminUser &&
                (await global.ArbiV2.isAdminUser(appSupa, appUser))
              ) {
                modeBtn.hidden = false;
              }
            } catch (modeErr) {}
            var imp = global.ArbiV2.getImpersonation
              ? global.ArbiV2.getImpersonation()
              : null;
            var viewUserId =
              global.ArbiV2.getEffectiveUserId
                ? global.ArbiV2.getEffectiveUserId(appUser)
                : appUser.id;
            if (imp && imp.id) {
              var banner = document.getElementById("v2ImpersonateBanner");
              if (!banner) {
                banner = document.createElement("div");
                banner.id = "v2ImpersonateBanner";
                banner.setAttribute("role", "status");
                banner.style.cssText =
                  "position:sticky;top:0;z-index:90;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:10px 14px;background:#1a1400;border-bottom:1px solid rgba(245,158,11,0.45);color:#fde68a;font-size:12px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase";
                banner.innerHTML =
                  '<span>Espelho · visualizando conta do cliente' +
                  (imp.name ? ": " + String(imp.name) : "") +
                  '</span><button type="button" id="v2ImpersonateExit" style="border:0;border-radius:10px;padding:8px 12px;background:#c9f223;color:#000;font-weight:900;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer">Sair do espelho</button>';
                var first = document.body.firstChild;
                document.body.insertBefore(banner, first);
                var exitBtn = document.getElementById("v2ImpersonateExit");
                if (exitBtn) {
                  exitBtn.addEventListener("click", function () {
                    global.ArbiV2.clearImpersonation({
                      redirect: "/admin-users.html",
                    });
                  });
                }
              }
            }
            var balRes = await appSupa
              .from("profiles")
              .select(
                "balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,locked_balance_cents,full_name,avatar_url"
              )
              .eq("id", viewUserId)
              .maybeSingle();
            var p = balRes.data || {};
            var money = global.ArbiV2.money;
            var apostador =
              Number(p.balance_cents || 0) +
              Number(p.reusable_balance_cents || 0) +
              Number(p.deduction_balance_cents || 0) +
              Number(p.demo_balance_cents || 0);
            var provedor =
              Number(p.investor_balance_cents || 0) +
              Number(p.demo_balance_provider_cents || 0);
            var desafio = Number(p.desafio_balance_cents || 0);
            // Congelado: NÃO exibir no header (hide-congelado-visor-v1).
            // locked_balance_cents continua atualizado pelo settle/create.
            var afiliado = 0;
            try {
              var aff = await appSupa
                .from("affiliate_stats")
                .select("pending_cents,pendingCents,available_cents,balance_cents")
                .eq("profile_id", viewUserId)
                .maybeSingle();
              var a = (aff && aff.data) || {};
              afiliado = Number(
                a.pending_cents || a.pendingCents || a.available_cents || a.balance_cents || 0
              );
            } catch (affErr) {}
            function setTxt(id, val) {
              var el = document.getElementById(id);
              if (el) el.textContent = money(val);
            }
            setTxt("v2BalApostador", apostador);
            setTxt("v2BalDesafio", desafio);
            setTxt("v2BalAfiliado", afiliado);
            setTxt("v2BalProvedor", provedor);
            var displayName =
              p.full_name ||
              (imp && imp.name) ||
              (appUser.email ? appUser.email.split("@")[0] : "Membro");
            var initials = String(displayName)
              .split(/\s+/)
              .slice(0, 2)
              .map(function (w) {
                return w[0] || "";
              })
              .join("")
              .toUpperCase() || "U";
            var first = initials.charAt(0) || "U";
            var av = document.getElementById("v2AppAvatar");
            if (av) av.textContent = initials;
            var sideAv = document.getElementById("v2SideAvatar");
            if (sideAv) sideAv.textContent = first;
            var sideName = document.getElementById("v2SideName");
            if (sideName) sideName.textContent = displayName;
            var sideD = document.getElementById("v2SideBalD");
            if (sideD) sideD.textContent = money(desafio);
            var sideI = document.getElementById("v2SideBalI");
            if (sideI) sideI.textContent = money(provedor);
          }
        }
      } catch (err) {}
    }

    if (shell === "admin") {
      try {
        if (global.ArbiV2 && global.ArbiV2.client) {
          var supa = global.ArbiV2.client();
          var sess = await supa.auth.getUser();
          var u = sess.data && sess.data.user;
          if (u) {
            var pr = await supa
              .from("profiles")
              .select("full_name,is_super_admin")
              .eq("id", u.id)
              .maybeSingle();
            var name =
              (pr.data && pr.data.full_name) ||
              (u.email ? u.email.split("@")[0] : "Admin");
            var nameEl = document.getElementById("v2UserName");
            if (nameEl) nameEl.textContent = name;
            var av = document.querySelector("#v2UserChip .avatar");
            if (av) {
              av.textContent = String(name)
                .split(/\s+/)
                .slice(0, 2)
                .map(function (p) {
                  return p[0] || "";
                })
                .join("")
                .toUpperCase() || "AD";
            }
          }
        }
      } catch (err) {}

      var searchBtn = document.getElementById("v2SearchPages");
      if (searchBtn) {
        searchBtn.addEventListener("click", function () {
          var q = window.prompt("Buscar página admin (ex: jogos, desafios, saques)");
          if (!q) return;
          var needle = q.trim().toLowerCase();
          var hit = null;
          sections.forEach(function (sec) {
            (sec.items || []).forEach(function (it) {
              if (hit) return;
              if (
                String(it.label).toLowerCase().indexOf(needle) >= 0 ||
                String(it.id).toLowerCase().indexOf(needle) >= 0
              ) {
                hit = it;
              }
            });
          });
          if (hit) location.href = hit.href;
          else window.alert("Página não encontrada");
        });
      }

      // Badge de contestações pendentes no menu lateral
      (async function refreshContestationBadge() {
        try {
          if (!(global.ArbiV2 && global.ArbiV2.client)) return;
          var badgeSupa = global.ArbiV2.client();
          var session = await badgeSupa.auth.getSession();
          var tok = session.data.session && session.data.session.access_token;
          if (!tok) return;
          var res = await fetch("/api/arbishield/contestations/pending-count", {
            headers: { Authorization: "Bearer " + tok },
          });
          var data = await res.json().catch(function () { return {}; });
          var n = Number(data.pending || 0);
          var link = document.querySelector('.v2-sidebar a[href="/admin-contestations.html"]');
          if (!link) return;
          var badge = link.querySelector(".badge");
          if (n > 0) {
            if (!badge) {
              badge = document.createElement("span");
              badge.className = "badge";
              link.appendChild(badge);
            }
            badge.textContent = String(n);
            link.classList.add("glow");
          } else if (badge) {
            badge.remove();
          }
        } catch (e) {}
      })();
    }

    global.ArbiV2Shell = {
      adminSections: sections,
      appSections: APP_SECTIONS,
      canAccessFinance: canFinance,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(window);
