/**
 * Anti-freeze ArbiShield — versão final.
 *
 * NÃO observa o DOM, NÃO altera history, NÃO move botões React.
 * Única função: se a SPA cair em /admin/desafios, força a página VPS estável
 * (admin-desafios-vps.html), que tem LANÇAR DESAFIO nativo.
 */
(function () {
  var FLAG = "arbishield_force_desafios_vps";

  function path() {
    return (location.pathname || "/").replace(/\/$/, "") || "/";
  }

  function isDesafiosRoute() {
    var p = path();
    return p === "/admin/desafios" || p.slice(-14) === "/admin/desafios";
  }

  /** Página VPS estável já montada */
  function isVpsDesafiosPage() {
    return Boolean(document.getElementById("btnLaunch"));
  }

  /** Shell React (index.html) — é aqui que o travamento acontecia */
  function isSpaShell() {
    return Boolean(
      document.getElementById("root") ||
        document.getElementById("app") ||
        document.querySelector("[data-reactroot]")
    );
  }

  function healLegacyWrapOnce() {
    var wrap = document.getElementById("arbishield-desafio-sugestao-btn");
    if (!wrap || wrap.tagName !== "DIV") return;
    var parent = wrap.parentElement;
    if (!parent) return;
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  }

  function forceStableDesafiosPage() {
    if (!isDesafiosRoute()) {
      try {
        sessionStorage.removeItem(FLAG);
      } catch (e) {}
      return;
    }
    if (isVpsDesafiosPage()) return;
    if (!isSpaShell()) return;

    // Evita loop de reload
    try {
      if (sessionStorage.getItem(FLAG) === "1") return;
      sessionStorage.setItem(FLAG, "1");
    } catch (e) {}

    // Hard navigation → nginx serve admin-desafios-vps.html
    location.replace("/admin/desafios" + location.search + location.hash);
  }

  function boot() {
    try {
      healLegacyWrapOnce();
      forceStableDesafiosPage();
    } catch (err) {
      console.warn("[arbishield-anti-freeze]", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Um único retry curto (SPA pode hidratar depois) — sem setInterval eterno
  setTimeout(boot, 800);
  setTimeout(function () {
    try {
      sessionStorage.removeItem(FLAG);
    } catch (e) {}
  }, 5000);
})();
