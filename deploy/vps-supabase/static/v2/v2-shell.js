/**
 * Shell de layout do site legado (sidebar admin + app).
 * Uso: <body data-shell="admin|app" data-active="users"> … <aside id="v2-sidebar"></aside><main class="v2-main">
 */
(function (global) {
  var ADMIN_SECTIONS = [
    {
      title: "Operação",
      color: "#22d3ee",
      items: [
        { id: "hub", label: "Dashboard", href: "/v2/admin.html" },
        { id: "jogos", label: "Jogos", href: "/v2/admin-jogos.html" },
        { id: "desafios", label: "Desafios ArbiShield", href: "/v2/admin-desafios.html" },
        {
          id: "monitoring-protections",
          label: "Monitor de Proteções",
          href: "/v2/admin-modulo.html?to=/admin/monitoring-protections&t=Monitor%20de%20Prote%C3%A7%C3%B5es",
          legacy: true,
        },
      ],
    },
    {
      title: "Financeiro",
      color: "#34d399",
      items: [
        { id: "transactions", label: "Transações", href: "/v2/admin-modulo.html?to=/admin/transactions&t=Transa%C3%A7%C3%B5es", legacy: true },
        { id: "saques", label: "Saques", href: "/v2/admin-modulo.html?to=/admin/saques&t=Saques", legacy: true },
        { id: "manual-deposits", label: "Depósitos USDT", href: "/v2/admin-modulo.html?to=/admin/manual-deposits&t=Dep%C3%B3sitos%20USDT", legacy: true },
        { id: "refunds", label: "Reembolsos", href: "/v2/admin-modulo.html?to=/admin/refunds&t=Reembolsos", legacy: true },
        { id: "treasury", label: "Tesouraria", href: "/v2/admin-modulo.html?to=/admin/treasury&t=Tesouraria", legacy: true },
        { id: "partners-distribution", label: "Distribuição", href: "/v2/admin-modulo.html?to=/admin/partners-distribution&t=Distribui%C3%A7%C3%A3o", legacy: true },
        { id: "expenses", label: "Despesas", href: "/v2/admin-modulo.html?to=/admin/expenses&t=Despesas", legacy: true },
      ],
    },
    {
      title: "Usuários",
      color: "#a78bfa",
      items: [
        { id: "users", label: "Usuários", href: "/v2/admin-users.html" },
        { id: "partners", label: "Partners", href: "/v2/admin-modulo.html?to=/admin/partners&t=Partners", legacy: true },
        { id: "affiliates", label: "Afiliados", href: "/v2/admin-modulo.html?to=/admin/affiliates&t=Afiliados", legacy: true },
      ],
    },
    {
      title: "Compliance & Risco",
      color: "#f59e0b",
      items: [
        { id: "contestations", label: "Contestações", href: "/v2/admin-modulo.html?to=/admin/contestations&t=Contesta%C3%A7%C3%B5es", legacy: true },
        { id: "approvals", label: "Aprovações", href: "/v2/admin-modulo.html?to=/admin/approvals&t=Aprova%C3%A7%C3%B5es", legacy: true },
        { id: "proofs", label: "Comprovantes", href: "/v2/admin-modulo.html?to=/admin/proofs&t=Comprovantes", legacy: true },
        { id: "investigation", label: "Investigação", href: "/v2/admin-modulo.html?to=/admin/investigation&t=Investiga%C3%A7%C3%A3o", legacy: true },
        { id: "risk", label: "Monitor de Risco", href: "/v2/admin-modulo.html?to=/admin/risk&t=Monitor%20de%20Risco", legacy: true },
        { id: "blacklist", label: "Blacklist", href: "/v2/admin-modulo.html?to=/admin/blacklist&t=Blacklist", legacy: true },
        { id: "geo", label: "Geosegurança", href: "/v2/admin-modulo.html?to=/admin/geo&t=Geoseguran%C3%A7a", legacy: true },
        { id: "signup-attempts", label: "Tentativas de Cadastro", href: "/v2/admin-modulo.html?to=/admin/signup-attempts&t=Tentativas%20de%20Cadastro", legacy: true },
      ],
    },
    {
      title: "Conteúdo",
      color: "#c6ff00",
      items: [
        { id: "whatsapp", label: "Marketing / WhatsApp", href: "/v2/admin-modulo.html?to=/admin/whatsapp&t=Marketing%20%2F%20WhatsApp", legacy: true },
        { id: "communication-lab", label: "Communication Lab", href: "/v2/admin-modulo.html?to=/admin/communication-lab&t=Communication%20Lab", legacy: true },
        { id: "banners", label: "Banners", href: "/v2/admin-modulo.html?to=/admin/banners&t=Banners", legacy: true },
        { id: "onboarding", label: "Onboarding", href: "/v2/admin-modulo.html?to=/admin/onboarding&t=Onboarding", legacy: true },
        { id: "academia", label: "Academia", href: "/v2/admin-modulo.html?to=/admin/academia&t=Academia", legacy: true },
      ],
    },
    {
      title: "Suporte",
      color: "#f472b6",
      items: [
        { id: "support", label: "Suporte", href: "/v2/admin-modulo.html?to=/admin/support&t=Suporte", legacy: true },
        { id: "support-ai", label: "Suporte IA", href: "/v2/admin-modulo.html?to=/admin/support-ai&t=Suporte%20IA", legacy: true },
      ],
    },
    {
      title: "Sistema",
      color: "#94a3b8",
      items: [
        { id: "settings", label: "Configurações", href: "/v2/admin-modulo.html?to=/admin/settings&t=Configura%C3%A7%C3%B5es", legacy: true },
        { id: "betting-houses", label: "Casas de Aposta", href: "/v2/admin-modulo.html?to=/admin/betting-houses&t=Casas%20de%20Aposta", legacy: true },
        { id: "permissoes", label: "Permissões de Admins", href: "/v2/admin-modulo.html?to=/admin/permissoes&t=Permiss%C3%B5es", legacy: true },
        { id: "marketing-team", label: "Time de Marketing", href: "/v2/admin-modulo.html?to=/admin/marketing-team&t=Time%20de%20Marketing", legacy: true },
      ],
    },
    {
      title: "Avançado",
      color: "#71717a",
      items: [
        { id: "logs", label: "Logs / Auditoria", href: "/v2/admin-modulo.html?to=/admin/logs&t=Logs", legacy: true },
        { id: "settlements-audit", label: "Auditoria de Encerramentos", href: "/v2/admin-modulo.html?to=/admin/settlements-audit&t=Auditoria%20de%20Encerramentos", legacy: true },
        { id: "technical-audit", label: "Monitor Técnico", href: "/v2/admin-modulo.html?to=/admin/technical-audit&t=Monitor%20T%C3%A9cnico", legacy: true },
        { id: "performance", label: "Performance", href: "/v2/admin-modulo.html?to=/admin/performance&t=Performance", legacy: true },
        { id: "siem", label: "SIEM / Eventos", href: "/v2/admin-modulo.html?to=/admin/siem&t=SIEM", legacy: true },
        { id: "monitoring", label: "Monitoria Staff", href: "/v2/admin-modulo.html?to=/admin/monitoring&t=Monitoria%20Staff", legacy: true },
        { id: "app", label: "Ir para o App", href: "/v2/app.html" },
      ],
    },
  ];

  var APP_SECTIONS = [
    {
      title: "Operações",
      color: "#c9f223",
      items: [
        { id: "home", label: "Visão Geral", href: "/v2/app.html" },
        { id: "proteger", label: "Proteger Aposta", href: "/v2/app-modulo.html?to=/app/proteger&t=Proteger%20Aposta", legacy: true },
        { id: "protecoes", label: "Minhas Proteções", href: "/v2/app-modulo.html?to=/app/protecoes&t=Minhas%20Prote%C3%A7%C3%B5es", legacy: true },
        { id: "desafio", label: "Desafio ArbiShield", href: "/v2/app-modulo.html?to=/app/desafio&t=Desafio", legacy: true },
        { id: "carteira", label: "Financeiro", href: "/v2/app-modulo.html?to=/app/carteira&t=Financeiro", legacy: true },
        { id: "suporte", label: "Atendimento", href: "/v2/app-modulo.html?to=/app/suporte&t=Atendimento", legacy: true },
      ],
    },
    {
      title: "Comunidade",
      color: "#34d399",
      items: [
        { id: "afiliados", label: "Afiliados", href: "/v2/app-modulo.html?to=/app/afiliados&t=Afiliados", legacy: true },
        { id: "partners", label: "Provedor", href: "/v2/app-modulo.html?to=/app/partners&t=Provedor", legacy: true },
        { id: "baixar-app", label: "Baixar App", href: "/v2/app-modulo.html?to=/app/baixar-app&t=Baixar%20App", legacy: true },
      ],
    },
    {
      title: "Conta",
      color: "#94a3b8",
      items: [
        { id: "perfil", label: "Perfil", href: "/v2/app-modulo.html?to=/app/perfil&t=Perfil", legacy: true },
        { id: "config", label: "Configurações", href: "/v2/app-modulo.html?to=/app/configuracoes&t=Configura%C3%A7%C3%B5es", legacy: true },
        { id: "admin", label: "Admin", href: "/v2/admin.html" },
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
            var badge = item.legacy ? '<span class="badge">legado</span>' : "";
            return (
              '<a class="' +
              cls +
              '" href="' +
              esc(item.href) +
              '">' +
              esc(item.label) +
              badge +
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
        var to = new URLSearchParams(location.search).get("to") || "";
        var file = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
        if (file === "admin-jogos") active = "jogos";
        else if (file === "admin-desafios") active = "desafios";
        else if (file === "admin-users") active = "users";
        else if (file === "admin") active = "hub";
        else if (file === "app") active = "home";
        else if (to) {
          active = to.replace(/^\/(admin|app)\//, "").replace(/\//g, "-");
          if (to === "/app/configuracoes") active = "config";
        }
      } catch (e) {}
    }
    var brandHref = shell === "admin" ? "/v2/admin.html" : "/v2/app.html";
    var brandSub = shell === "admin" ? "Admin · v2" : "Área do membro · v2";
    var sections = shell === "admin" ? ADMIN_SECTIONS : APP_SECTIONS;

    if (!body.classList.contains("v2-layout")) {
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
      '<span class="mark">AS</span>' +
      "<div><strong>ArbiShield</strong><small>" +
      esc(brandSub) +
      "</small></div></a>" +
      '<div class="v2-sidebar-scroll">' +
      renderSections(sections, active) +
      "</div>" +
      '<div class="v2-sidebar-foot">' +
      '<a class="v2-nav-link" href="/v2/">Home v2</a>' +
      (shell === "admin"
        ? '<a class="v2-nav-link" href="/v2/app.html">App membro</a>'
        : '<a class="v2-nav-link" href="#" id="v2LogoutLink">Sair</a>') +
      "</div>";

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

    global.ArbiV2Shell = {
      adminSections: ADMIN_SECTIONS,
      appSections: APP_SECTIONS,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(window);
