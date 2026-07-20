/**
 * Estabilidade global ArbiShield (VPS).
 * Não altera history/router — só CSS + limpeza de SW/cache.
 */
(function () {
  var MARK = "arbishield-stable";

  /** Rotas servidas por HTML VPS (nginx). Evita SPA client-side que quebra ao voltar do /admin. */
  function forceVpsAdminHardLoad() {
    var VPS = { "/admin/matches": 1, "/admin/desafios": 1 };
    var path = location.pathname.replace(/\/$/, "") || "/";
    if (!VPS[path]) return;
    if (document.body && document.body.dataset.vpsPage) return;
    var isSpa = !!document.querySelector(
      'script[id="$tsr-stream-barrier"], script[class="$tsr"]'
    );
    if (!isSpa) return;
    location.replace(path + location.search + location.hash);
  }

  forceVpsAdminHardLoad();

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
    style.textContent =
      "html." + MARK + " [class*=\"blur-\"]," +
      "html." + MARK + " [style*=\"blur(\"]{" +
      "filter:none!important;backdrop-filter:none!important;" +
      "-webkit-backdrop-filter:none!important;will-change:auto!important;}";
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
