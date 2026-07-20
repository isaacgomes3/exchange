/**
 * Estabilidade global ArbiShield (VPS).
 * Não altera history/router — só CSS + limpeza de SW/cache.
 */
(function () {
  var MARK = "arbishield-stable";

  /** Gestão de Jogos: sempre HTML VPS (BetBra), nunca SPA com formulário manual. */
  var JOGOS = "/admin/matches";

  function isSpaBoot() {
    return !!document.querySelector(
      'script[id="$tsr-stream-barrier"], script[class="$tsr"]'
    );
  }

  function forceVpsJogosHardLoad() {
    var path = location.pathname.replace(/\/$/, "") || "/";
    if (path !== JOGOS) return;
    if (document.body && document.body.dataset.vpsPage === "jogos") return;
    if (!isSpaBoot()) return;
    location.replace(location.pathname + location.search + location.hash);
  }

  function hookJogosNavigation() {
    forceVpsJogosHardLoad();

    document.addEventListener(
      "click",
      function (ev) {
        var node = ev.target;
        var a = node && node.closest ? node.closest("a[href]") : null;
        if (!a) return;
        var href = a.getAttribute("href") || "";
        var path = href.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
        if (path !== JOGOS) return;
        if (a.target === "_blank") return;
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        location.href = href;
      },
      true
    );

    var _push = history.pushState;
    var _replace = history.replaceState;
    history.pushState = function () {
      var r = _push.apply(this, arguments);
      setTimeout(forceVpsJogosHardLoad, 0);
      return r;
    };
    history.replaceState = function () {
      var r = _replace.apply(this, arguments);
      setTimeout(forceVpsJogosHardLoad, 0);
      return r;
    };
    window.addEventListener("popstate", function () {
      setTimeout(forceVpsJogosHardLoad, 0);
    });
  }

  hookJogosNavigation();

  function isHeavyPath() {
    var path = location.pathname.replace(/\/$/, "") || "/";
    return (
      path === "/app" ||
      path.indexOf("/app/") === 0 ||
      path === "/admin" ||
      path.indexOf("/admin/") === 0 ||
      path === "/auth"
    );
  }

  function ensureStyle() {
    if (document.querySelector('style[data-arbishield="stability"]')) return;
    var style = document.createElement("style");
    style.setAttribute("data-arbishield", "stability");
    var adminModal =
      "html." + MARK + " [data-radix-dialog-overlay]," +
      "html." + MARK + " [data-radix-sheet-overlay]," +
      "html." + MARK + " [data-vaul-drawer-wrapper]," +
      "html." + MARK + " [role=\"dialog\"],";
    style.textContent =
      "html." + MARK + " [class*=\"blur-\"]," +
      "html." + MARK + " [style*=\"blur(\"]," +
      adminModal +
      "html." + MARK + " [data-state=\"open\"][class*=\"overlay\"]{" +
      "filter:none!important;backdrop-filter:none!important;" +
      "-webkit-backdrop-filter:none!important;will-change:auto!important;}" +
      "html." + MARK + " [data-radix-dialog-overlay]," +
      "html." + MARK + " [data-radix-sheet-overlay]," +
      "html." + MARK + " [data-vaul-drawer-wrapper]," +
      "html." + MARK + " [role=\"dialog\"] *{" +
      "animation:none!important;transition:none!important;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function apply() {
    if (!isHeavyPath()) return;
    try {
      ensureStyle();
      document.documentElement.classList.add(MARK);
    } catch (e) {}
  }

  apply();
  var n = 0;
  var timer = setInterval(function () {
    n += 1;
    apply();
    if (n >= 20) clearInterval(timer);
  }, 500);

  function clearCorruptDashCache() {
    try {
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (
          k.indexOf("dash:critical:") !== 0 &&
          k.indexOf("dash:secondary:") !== 0
        ) {
          continue;
        }
        try {
          var raw = localStorage.getItem(k);
          if (!raw || raw === "[]" || raw === "null" || raw === "{}") {
            localStorage.removeItem(k);
            continue;
          }
          var parsed = JSON.parse(raw);
          // Stubs antigos gravavam [] (truthy) e quebravam o dashboard
          if (Array.isArray(parsed) || typeof parsed !== "object") {
            localStorage.removeItem(k);
          } else if (!parsed.profile && !parsed.protections && !parsed.metrics) {
            localStorage.removeItem(k);
          }
        } catch (e2) {
          try {
            localStorage.removeItem(k);
          } catch (e3) {}
        }
      }
    } catch (e) {}
  }

  function cleanup() {
    clearCorruptDashCache();
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          regs.forEach(function (r) {
            r.unregister();
          });
        });
      }
    } catch (e) {}
    try {
      if (window.caches) {
        caches.keys().then(function (keys) {
          keys.forEach(function (k) {
            caches.delete(k);
          });
        });
      }
    } catch (e) {}
  }

  setTimeout(cleanup, 100);
  setTimeout(cleanup, 3000);

  try {
    window.__ARBISHIELD_STABILITY__ = true;
  } catch (e) {}
})();
