/**
 * Shell ArbiShield v2 — 100% nativo (sem links para /app ou /admin SPA).
 */
(function (global) {
  function soon(id, label) {
    return {
      id: id,
      label: label,
      href: "/v2/em-breve.html?id=" + encodeURIComponent(id) + "&t=" + encodeURIComponent(label),
      soon: true,
    };
  }

  var ADMIN_SECTIONS = [
    {
      title: "Operação",
      color: "#22d3ee",
      items: [
        { id: "hub", label: "Dashboard", href: "/v2/admin.html" },
        { id: "jogos", label: "Jogos", href: "/v2/admin-jogos.html" },
        { id: "desafios", label: "Desafios ArbiShield", href: "/v2/admin-desafios.html" },
        soon("monitoring-protections", "Monitor de Proteções"),
      ],
    },
    {
      title: "Financeiro",
      color: "#34d399",
      items: [
        soon("transactions", "Transações"),
        soon("saques", "Saques"),
        soon("manual-deposits", "Depósitos USDT"),
        soon("refunds", "Reembolsos"),
        soon("treasury", "Tesouraria"),
        soon("partners-distribution", "Distribuição"),
        soon("expenses", "Despesas"),
      ],
    },
    {
      title: "Usuários",
      color: "#a78bfa",
      items: [
        { id: "users", label: "Usuários", href: "/v2/admin-users.html" },
        soon("partners", "Partners"),
        soon("affiliates", "Afiliados"),
      ],
    },
    {
      title: "Compliance & Risco",
      color: "#f59e0b",
      items: [
        soon("contestations", "Contestações"),
        soon("approvals", "Aprovações"),
        soon("proofs", "Comprovantes"),
        soon("investigation", "Investigação"),
        soon("risk", "Monitor de Risco"),
        soon("blacklist", "Blacklist"),
        soon("geo", "Geosegurança"),
        soon("signup-attempts", "Tentativas de Cadastro"),
      ],
    },
    {
      title: "Conteúdo",
      color: "#c6ff00",
      items: [
        soon("whatsapp", "Marketing / WhatsApp"),
        soon("communication-lab", "Communication Lab"),
        soon("banners", "Banners"),
        soon("onboarding", "Onboarding"),
        soon("academia", "Academia"),
      ],
    },
    {
      title: "Suporte",
      color: "#f472b6",
      items: [soon("support", "Suporte"), soon("support-ai", "Suporte IA")],
    },
    {
      title: "Sistema",
      color: "#94a3b8",
      items: [
        soon("settings", "Configurações"),
        soon("betting-houses", "Casas de Aposta"),
        soon("permissoes", "Permissões de Admins"),
        soon("marketing-team", "Time de Marketing"),
      ],
    },
    {
      title: "Avançado",
      color: "#71717a",
      items: [
        soon("logs", "Logs / Auditoria"),
        soon("settlements-audit", "Auditoria de Encerramentos"),
        soon("technical-audit", "Monitor Técnico"),
        soon("performance", "Performance"),
        soon("siem", "SIEM / Eventos"),
        soon("monitoring", "Monitoria Staff"),
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
        soon("proteger", "Proteger Aposta"),
        soon("protecoes", "Minhas Proteções"),
        soon("desafio", "Desafio ArbiShield"),
        soon("carteira", "Financeiro"),
        soon("suporte", "Atendimento"),
      ],
    },
    {
      title: "Comunidade",
      color: "#34d399",
      items: [
        soon("afiliados", "Afiliados"),
        soon("partners", "Provedor"),
        soon("baixar-app", "Baixar App"),
      ],
    },
    {
      title: "Conta",
      color: "#94a3b8",
      items: [
        soon("perfil", "Perfil"),
        soon("config", "Configurações"),
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
            var badge = item.soon ? '<span class="badge">em breve</span>' : "";
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
        var q = new URLSearchParams(location.search);
        active = q.get("id") || "";
        var file = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
        if (file === "admin-jogos") active = "jogos";
        else if (file === "admin-desafios") active = "desafios";
        else if (file === "admin-users") active = "users";
        else if (file === "admin") active = "hub";
        else if (file === "app") active = "home";
      } catch (e) {}
    }

    var brandHref = shell === "admin" ? "/v2/admin.html" : "/v2/app.html";
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

    global.ArbiV2Shell = { adminSections: ADMIN_SECTIONS, appSections: APP_SECTIONS };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(window);
