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
      '<div class="topbar"><div class="crumbs">Dashboard · <strong></strong></div></div>'
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
