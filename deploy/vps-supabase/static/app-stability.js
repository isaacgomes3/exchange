/**
 * Estabilidade global ArbiShield (VPS).
 * Não altera history/router — só CSS + limpeza de SW/cache.
 */
(function () {
  var MARK = "arbishield-stable";

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

  function cleanup() {
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
