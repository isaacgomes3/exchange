/**
 * Anti-freeze ArbiShield — v3
 *
 * Problema: a SPA em /admin navega client-side para /admin/desafios e o React
 * trava ao clicar em LANÇAR DESAFIO. Nginx só serve a página VPS em reload.
 *
 * Solução:
 * 1) Qualquer clique em link para /admin/desafios → navegação completa
 * 2) Se a URL já for /admin/desafios dentro do shell React → reload forçado
 * 3) Sem observer de DOM e sem patch de history
 */
(function () {
  var FLAG = "arbishield_force_desafios_vps_v3";

  function path() {
    return (location.pathname || "/").replace(/\/$/, "") || "/";
  }

  function isDesafiosRoute() {
    var p = path();
    return p === "/admin/desafios" || /\/admin\/desafios$/.test(p);
  }

  function isVpsPage() {
    return Boolean(document.getElementById("btnLaunch"));
  }

  function isSpaShell() {
    return Boolean(
      document.getElementById("root") ||
        document.getElementById("app") ||
        document.querySelector("#root, [data-reactroot], [data-tanstack-router]")
    );
  }

  function goVpsDesafios(search) {
    var q = typeof search === "string" ? search : location.search || "";
    if (q && q.charAt(0) !== "?") q = "?" + q;
    try {
      if (sessionStorage.getItem(FLAG) === location.href) return;
      sessionStorage.setItem(FLAG, location.href);
    } catch (e) {}
    location.replace("/admin/desafios" + q);
  }

  function healLegacyWrap() {
    var wrap = document.getElementById("arbishield-desafio-sugestao-btn");
    if (!wrap || wrap.tagName !== "DIV") return;
    var parent = wrap.parentElement;
    if (!parent) return;
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  }

  function enforceVpsRoute() {
    healLegacyWrap();
    if (!isDesafiosRoute()) {
      try {
        sessionStorage.removeItem(FLAG);
      } catch (e) {}
      return;
    }
    if (isVpsPage()) return;
    if (!isSpaShell()) return;
    goVpsDesafios(location.search);
  }

  // Captura cliques em links /admin/desafios ANTES do React Router
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target;
      if (!el || !el.closest) return;
      var a = el.closest("a[href]");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.indexOf("/admin/desafios") === -1) return;
      // deixa abrir em nova aba
      if (e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank") return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      var u;
      try {
        u = new URL(href, location.origin);
      } catch (err) {
        location.href = "/admin/desafios";
        return;
      }
      location.href = "/admin/desafios" + (u.search || "") + (u.hash || "");
    },
    true
  );

  // Botões SPA que navegam via router (texto "Desafios")
  document.addEventListener(
    "click",
    function (e) {
      if (isVpsPage()) return;
      var el = e.target;
      if (!el || !el.closest) return;
      var btn = el.closest("button, a, [role='link'], [role='button']");
      if (!btn) return;
      var t = (btn.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^desafios$/i.test(t) && !/gest[aã]o de desafios/i.test(t)) return;
      // Se já estamos indo para desafios via link tratado acima, ok
      if (btn.tagName === "A" && (btn.getAttribute("href") || "").indexOf("/admin/desafios") !== -1) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      location.href = "/admin/desafios";
    },
    true
  );

  function boot() {
    try {
      enforceVpsRoute();
    } catch (err) {
      console.warn("[arbishield-anti-freeze]", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  setTimeout(boot, 600);
  setTimeout(boot, 2000);

  // Poll leve: se a SPA mudou a URL sem reload, corrige
  setInterval(function () {
    try {
      if (isDesafiosRoute() && !isVpsPage() && isSpaShell()) {
        goVpsDesafios(location.search);
      }
    } catch (e) {}
  }, 1500);

  setTimeout(function () {
    try {
      sessionStorage.removeItem(FLAG);
    } catch (e) {}
  }, 8000);
})();
