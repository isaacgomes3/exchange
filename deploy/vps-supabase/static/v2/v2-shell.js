/**
 * Shell ArbiShield v2 — 100% nativo (sem links para /app ou /admin SPA).
 */
(function (global) {
  function p(id, label, href) {
    return { id: id, label: label, href: href };
  }

  var ADMIN_SECTIONS = [
    {
      title: "Operação",
      color: "#22d3ee",
      items: [
        p("hub", "Dashboard", "/admin.html"),
        p("jogos", "Jogos", "/admin-jogos.html"),
        p("desafios", "Desafios ArbiShield", "/admin-desafios.html"),
        p("monitoring-protections", "Monitor de Proteções", "/admin-monitoring-protections.html"),
      ],
    },
    {
      title: "Financeiro",
      color: "#34d399",
      items: [
        p("transactions", "Transações", "/admin-transactions.html"),
        p("saques", "Saques", "/admin-saques.html"),
        p("manual-deposits", "Depósitos USDT", "/admin-manual-deposits.html"),
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
        p("contestations", "Contestações", "/admin-contestations.html"),
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

  var APP_SECTIONS = [
    {
      title: "Operações",
      color: "#c9f223",
      items: [
        p("home", "Visão Geral", "/app.html"),
        p("proteger", "Proteger Aposta", "/app-proteger.html"),
        p("protecoes", "Minhas Proteções", "/app-protecoes.html"),
        p("desafio", "Desafio ArbiShield", "/app-desafio.html"),
        p("carteira", "Financeiro", "/app-carteira.html"),
        p("suporte", "Atendimento", "/app-suporte.html"),
      ],
    },
    {
      title: "Comunidade",
      color: "#34d399",
      items: [
        p("afiliados", "Afiliados", "/app-afiliados.html"),
        p("partners", "Provedor", "/app-partners.html"),
        p("baixar-app", "Baixar App", "/app-baixar-app.html"),
      ],
    },
    {
      title: "Conta",
      color: "#94a3b8",
      items: [
        p("perfil", "Perfil", "/app-perfil.html"),
        p("config", "Configurações", "/app-config.html"),
        p("admin", "Admin", "/admin.html"),
      ],
    },
  ];

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function renderSections(sections, active) {
    return sections
      .map(function (sec) {
        var links = sec.items
          .map(function (item) {
            var cls = "v2-nav-link" + (item.id === active ? " is-active" : "");
            return (
              '<a class="' +
              cls +
              '" href="' +
              esc(item.href) +
              '">' +
              esc(item.label) +
              "</a>"
            );
          })
          .join("");
        return (
          '<div class="v2-nav-section"><span class="dot" style="background:' +
          esc(sec.color) +
          '"></span>' +
          esc(sec.title) +
          "</div>" +
          links
        );
      })
      .join("");
  }

  function mount() {
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
    var brandSub = shell === "admin" ? "Admin · v2" : "Área do membro · v2";
    var sections = shell === "admin" ? ADMIN_SECTIONS : APP_SECTIONS;

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
      children.forEach(function (n) {
        if (n.nodeType === 1 && (n.id === "v2-sidebar" || n.classList.contains("v2-sidebar"))) return;
        main.appendChild(n);
      });
      layout.appendChild(aside);
      layout.appendChild(main);
      body.appendChild(layout);
      body.classList.add("v2-layout-ready");
    }

    var sidebar = document.getElementById("v2-sidebar");
    if (!sidebar) return;

    sidebar.innerHTML =
      '<a class="v2-sidebar-brand" href="' +
      brandHref +
      '">' +
      '<img class="mark-img" src="/brand/icon-64.png" width="36" height="36" alt="" decoding="async" />' +
      "<div><strong>ArbiShield</strong><small>" +
      esc(brandSub) +
      "</small></div></a>" +
      '<div class="v2-sidebar-scroll">' +
      renderSections(sections, active) +
      "</div>" +
      '<div class="v2-sidebar-foot">' +
      '<a class="v2-nav-link" href="/">Home</a>' +
      (shell === "admin"
        ? '<a class="v2-nav-link" href="/app.html">App membro</a><a class="v2-nav-link" href="https://legado.arbishield.app/" target="_blank" rel="noopener">SPA legado</a>'
        : '<a class="v2-nav-link" href="#" id="v2LogoutLink">Sair</a><a class="v2-nav-link" href="https://legado.arbishield.app/" target="_blank" rel="noopener">SPA legado</a>') +
      "</div>";

    if (!document.querySelector('link[data-v2-favicon]')) {
      var fav = document.createElement("link");
      fav.rel = "icon";
      fav.type = "image/png";
      fav.href = "/brand/favicon-192.png";
      fav.setAttribute("data-v2-favicon", "1");
      document.head.appendChild(fav);
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
    backdrop.addEventListener("click", closeNav);
    var btn = document.getElementById("v2MenuBtn");
    if (btn) {
      btn.addEventListener("click", function () {
        body.classList.toggle("v2-nav-open");
      });
    }

    global.ArbiV2Shell = { adminSections: ADMIN_SECTIONS, appSections: APP_SECTIONS };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(window);
