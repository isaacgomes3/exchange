/**
 * Anti-freeze ArbiShield — v4 (resolve travamento no clique)
 *
 * O botão LANÇAR DESAFIO da SPA React congela a página.
 * Este script:
 *  - intercepta esse clique e manda para /admin/desafios (página VPS estável)
 *  - força hard-navigation em qualquer rota/link de Desafios
 *  - NÃO usa MutationObserver e NÃO move nós React
 */
(function () {
  var FLAG = "arbishield_af_v4";

  function path() {
    return (location.pathname || "/").replace(/\/$/, "") || "/";
  }

  function isDesafiosRoute() {
    return /\/admin\/desafios$/.test(path()) || path() === "/admin/desafios";
  }

  function isVpsPage() {
    return Boolean(document.getElementById("btnLaunch"));
  }

  function isSpaShell() {
    return Boolean(
      document.getElementById("root") ||
        document.getElementById("app") ||
        document.querySelector("[data-reactroot]")
    );
  }

  function goVps(extraQuery) {
    var q = location.search || "";
    if (extraQuery) {
      var u = new URL(location.href);
      Object.keys(extraQuery).forEach(function (k) {
        u.searchParams.set(k, extraQuery[k]);
      });
      q = u.search;
    }
    try {
      sessionStorage.setItem(FLAG, String(Date.now()));
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

  function textOf(el) {
    return ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  }

  // 1) Clique em LANÇAR DESAFIO da SPA → não deixa o React processar (trava)
  document.addEventListener(
    "click",
    function (e) {
      // Página VPS: deixa o botão nativo funcionar
      if (isVpsPage()) return;

      var el = e.target && e.target.closest ? e.target.closest("button, a, [role='button']") : null;
      if (!el) return;
      var t = textOf(el);
      if (!/lan[cç]ar\s*desafio/i.test(t)) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      goVps({ sugestao: "1" });
    },
    true
  );

  // 2) Links / botões "Desafios" → hard navigation
  document.addEventListener(
    "click",
    function (e) {
      if (isVpsPage()) return;
      var el = e.target && e.target.closest ? e.target.closest("a, button, [role='link'], [role='button']") : null;
      if (!el) return;

      var href = (el.getAttribute && el.getAttribute("href")) || "";
      var t = textOf(el);

      var toDesafios =
        href.indexOf("/admin/desafios") !== -1 ||
        /^desafios$/i.test(t) ||
        /gest[aã]o de desafios/i.test(t);

      if (!toDesafios) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      location.href = "/admin/desafios";
    },
    true
  );

  function enforce() {
    healLegacyWrap();
    if (isDesafiosRoute() && !isVpsPage() && isSpaShell()) {
      goVps();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enforce);
  } else {
    enforce();
  }
  setTimeout(enforce, 500);
  setTimeout(enforce, 1500);
  setInterval(function () {
    try {
      if (isDesafiosRoute() && !isVpsPage() && isSpaShell()) goVps();
    } catch (e) {}
  }, 2000);
})();
