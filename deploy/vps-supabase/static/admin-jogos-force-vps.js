/**
 * Gestão de Jogos: bloqueia layout SPA (Novo Evento manual).
 * Sempre recarrega /admin/matches para servir admin-jogos-vps.html (BetBra).
 */
(function () {
  var JOGOS = "/admin/matches";

  function normPath() {
    return (location.pathname || "/").replace(/\/$/, "") || "/";
  }

  function onVpsJogosPage() {
    return !!(document.body && document.body.dataset.vpsPage === "jogos");
  }

  function looksLikeSpaJogos() {
    if (onVpsJogosPage()) return false;
    if (normPath() !== JOGOS) return false;
    var t = (document.body && document.body.innerText) || "";
    if (/próximos jogos/i.test(t) && /eventos arbishield/i.test(t)) return false;
    if (/novo evento/i.test(t) || /sincronizar api/i.test(t)) return true;
    return !!(
      document.querySelector('script[id="$tsr-stream-barrier"], script[class="$tsr"]') ||
      document.querySelector('script[type="module"][src*="main-"]')
    );
  }

  function goVps() {
    if (!looksLikeSpaJogos()) return;
    var q = location.search || "";
    if (q.indexOf("_vps=") >= 0) return;
    var sep = q ? "&" : "?";
    location.replace(JOGOS + q + sep + "_vps=" + Date.now());
  }

  goVps();

  document.addEventListener(
    "click",
    function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("a[href], button, [role='menuitem']") : null;
      if (!el) return;
      var href = el.getAttribute("href") || "";
      var path = href.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
      var label = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      var toJogos = path === JOGOS || label === "jogos";
      if (!toJogos) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      location.href = JOGOS + "?_vps=" + Date.now();
    },
    true
  );

  var _push = history.pushState;
  var _replace = history.replaceState;
  history.pushState = function () {
    var r = _push.apply(this, arguments);
    goVps();
    return r;
  };
  history.replaceState = function () {
    var r = _replace.apply(this, arguments);
    goVps();
    return r;
  };
  window.addEventListener("popstate", goVps);

  var n = 0;
  var poll = setInterval(function () {
    n += 1;
    goVps();
    if (n >= 120 || onVpsJogosPage()) clearInterval(poll);
  }, 500);
})();
