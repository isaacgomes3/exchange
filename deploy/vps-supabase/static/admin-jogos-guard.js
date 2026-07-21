/**
 * Gestão de Jogos: força HTML VPS (BetBra) e bloqueia layout SPA manual.
 * Não depende do script $_TSR (ele se remove após o boot).
 */
(function () {
  var JOGOS = "/admin/matches";
  var redirecting = false;

  function normPath() {
    return (location.pathname || "/").replace(/\/$/, "") || "/";
  }

  function onVpsJogosPage() {
    var meta = document.querySelector('meta[name="arbishield-vps-page"]');
    if (meta && meta.getAttribute("content") === "jogos") return true;
    if (document.documentElement.getAttribute("data-vps-page") === "jogos") {
      return true;
    }
    return !!(document.body && document.body.dataset.vpsPage === "jogos");
  }

  function shouldRedirect() {
    if (normPath() !== JOGOS) return false;
    if (onVpsJogosPage()) return false;
    if (redirecting) return false;
    return true;
  }

  function hideSpaFlash() {
    if (!shouldRedirect()) return;
    try {
      document.documentElement.classList.add("arbishield-jogos-pending");
    } catch (e) {}
  }

  function goVpsJogosNow() {
    if (!shouldRedirect()) return;
    redirecting = true;
    hideSpaFlash();
    location.replace(JOGOS + "?_vps=" + Date.now());
  }

  function navTarget(ev) {
    var el =
      ev.target && ev.target.closest
        ? ev.target.closest("a[href], button, [role='menuitem'], [data-nav]")
        : null;
    if (!el) return null;
    var href = el.getAttribute("href") || "";
    var path = href.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
    var label = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    var toJogos = path === JOGOS || label === "jogos" || label.indexOf("gestão de jogos") >= 0;
    if (!toJogos) return null;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return null;
    return el;
  }

  function interceptNav(ev) {
    if (!navTarget(ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    redirecting = true;
    hideSpaFlash();
    location.href = JOGOS + "?_vps=" + Date.now();
  }

  function patchHistory() {
    if (history.__arbishieldJogosGuard) return;
    history.__arbishieldJogosGuard = true;
    var nativePush = history.pushState.bind(history);
    var nativeReplace = history.replaceState.bind(history);
    history.pushState = function () {
      var result = nativePush.apply(history, arguments);
      goVpsJogosNow();
      return result;
    };
    history.replaceState = function () {
      var result = nativeReplace.apply(history, arguments);
      goVpsJogosNow();
      return result;
    };
    window.addEventListener("popstate", goVpsJogosNow);
  }

  function ensureStyle() {
    if (document.querySelector('style[data-arbishield="jogos-guard"]')) return;
    var style = document.createElement("style");
    style.setAttribute("data-arbishield", "jogos-guard");
    style.textContent =
      "html.arbishield-jogos-pending body{visibility:hidden!important;}" +
      "html.arbishield-jogos-pending[data-vps-page=jogos] body," +
      "html.arbishield-jogos-pending body[data-vps-page=jogos]{visibility:visible!important;}";
    (document.head || document.documentElement).appendChild(style);
  }

  ensureStyle();
  document.addEventListener("pointerdown", interceptNav, true);
  document.addEventListener("click", interceptNav, true);
  patchHistory();
  hideSpaFlash();
  goVpsJogosNow();
  setInterval(function () {
    patchHistory();
    hideSpaFlash();
    goVpsJogosNow();
  }, 50);

  try {
    window.__ARBISHIELD_JOGOS_GUARD__ = true;
  } catch (e) {}
})();
