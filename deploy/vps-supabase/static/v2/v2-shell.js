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
    };
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
      title: "Aprenda",
      color: "#c6ff00",
      items: [p("academia", "Academia", "/app-academia.html", { badge: "Novo" })],
    },
    {
      title: "Operações",
      color: "#c9f223",
      items: [
        p("home", "Visão Geral", "/app.html"),
        p("proteger", "Proteger Aposta", "/app-proteger.html"),
        p("protecoes", "Minhas Proteções", "/app-protecoes.html"),
        p("desafio", "Desafio", "/app-desafio.html", { badge: "Novo" }),
        p("carteira", "Financeiro", "/app-carteira.html"),
        p("suporte", "Atendimento", "/app-suporte.html"),
      ],
    },
    {
      title: "Comunidade",
      color: "#34d399",
      items: [p("afiliados", "Afiliados", "/app-afiliados.html", { badge: "Novo" })],
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
            var badge = item.badge
              ? '<span class="badge">' + esc(item.badge) + "</span>"
              : "";
            return (
              '<a class="' +
              cls +
              '" href="' +
              esc(item.href) +
              '"><span class="lbl">' +
              esc(item.label) +
              "</span>" +
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
          '<button type="button" class="v2-search-chip" id="v2SearchPages">Buscar página <kbd>⌘K</kbd></button>' +
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
          '<div class="v2-app-balances" aria-label="Saldos">' +
          '<a class="v2-bal-chip v2-bal-apostador" href="/app-carteira.html"><span class="l">Apostador</span><span class="v" id="v2BalApostador">—</span></a>' +
          '<a class="v2-bal-chip v2-bal-desafio" href="/app-desafio.html"><span class="l">Desafio</span><span class="v" id="v2BalDesafio">—</span></a>' +
          '<a class="v2-bal-chip v2-bal-afiliado" href="/app-afiliados.html"><span class="l">Afiliado</span><span class="v" id="v2BalAfiliado">—</span></a>' +
          '<a class="v2-bal-chip v2-bal-provedor" href="/app-partners.html"><span class="l">Provedor</span><span class="v" id="v2BalProvedor">—</span></a>' +
          "</div>" +
          '<div class="v2-app-header-actions">' +
          '<a class="v2-deposit-btn" href="/app-carteira.html"><span aria-hidden="true">+</span> Depósito</a>' +
          '<a class="v2-icon-btn" href="/app-suporte.html" aria-label="Notificações" title="Notificações">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 3.5 1.5 5 2 6H4c.5-1 2-2.5 2-6zM10 19a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          "</a>" +
          '<a class="v2-avatar-btn" href="/app-perfil.html" id="v2AppAvatar" aria-label="Perfil">U</a>' +
          "</div>";
        main.appendChild(appHeader);
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
      (shell === "app"
        ? '<div class="v2-sidebar-foot v2-app-foot">' +
          '<a class="v2-app-user" href="/app-perfil.html">' +
          '<div class="v2-avatar-btn sm" id="v2SideAvatar">U</div>' +
          "<div><strong id=\"v2SideName\">Membro</strong>" +
          '<small id="v2SideMeta">Área do membro</small></div></a>' +
          '<a class="v2-nav-link v2-logout" href="#" id="v2LogoutLink">Sair</a>' +
          "</div>"
        : '<div class="v2-sidebar-foot">' +
          '<a class="v2-nav-link" href="#" id="v2LogoutLink">Sair</a>' +
          "</div>");

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
    function bindMenu(el) {
      if (!el) return;
      el.addEventListener("click", function () {
        body.classList.toggle("v2-nav-open");
      });
    }
    bindMenu(document.getElementById("v2MenuBtn"));
    bindMenu(document.getElementById("v2MenuBtnHeader"));

    if (shell === "app") {
      var bottomNav = document.getElementById("v2BottomNav");
      if (bottomNav) {
        bottomNav.querySelectorAll("a[data-nav]").forEach(function (a) {
          if (a.getAttribute("data-nav") === active) a.classList.add("is-active");
        });
      }
    }

    async function doLogout(e) {
      if (e) e.preventDefault();
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

    if (shell === "app") {
      try {
        if (global.ArbiV2 && global.ArbiV2.client) {
          var appSupa = global.ArbiV2.client();
          var appUserRes = await appSupa.auth.getUser();
          var appUser = appUserRes.data && appUserRes.data.user;
          if (appUser) {
            var balRes = await appSupa
              .from("profiles")
              .select(
                "balance_cents,reusable_balance_cents,demo_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,full_name,avatar_url"
              )
              .eq("id", appUser.id)
              .maybeSingle();
            var p = balRes.data || {};
            var money = global.ArbiV2.money;
            var apostador =
              Number(p.balance_cents || 0) +
              Number(p.reusable_balance_cents || 0) +
              Number(p.demo_balance_cents || 0);
            var provedor =
              Number(p.investor_balance_cents || 0) +
              Number(p.demo_balance_provider_cents || 0);
            var desafio = Number(p.desafio_balance_cents || 0);
            var afiliado = 0;
            try {
              var aff = await appSupa
                .from("affiliate_stats")
                .select("pending_cents,pendingCents,available_cents,balance_cents")
                .eq("profile_id", appUser.id)
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
              (appUser.email ? appUser.email.split("@")[0] : "Membro");
            var initials = String(displayName)
              .split(/\s+/)
              .slice(0, 2)
              .map(function (w) {
                return w[0] || "";
              })
              .join("")
              .toUpperCase() || "U";
            var av = document.getElementById("v2AppAvatar");
            if (av) av.textContent = initials;
            var sideAv = document.getElementById("v2SideAvatar");
            if (sideAv) sideAv.textContent = initials;
            var sideName = document.getElementById("v2SideName");
            if (sideName) sideName.textContent = displayName;
            var sideMeta = document.getElementById("v2SideMeta");
            if (sideMeta) {
              sideMeta.textContent =
                money(apostador) + " · apostador";
            }
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
          ADMIN_SECTIONS.forEach(function (sec) {
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
    }

    global.ArbiV2Shell = { adminSections: ADMIN_SECTIONS, appSections: APP_SECTIONS };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})(window);
