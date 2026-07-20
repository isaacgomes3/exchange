/**
 * Estabilidade global ArbiShield (VPS):
 * - remove service workers / caches zumbis
 * - reduz animações/blur caros no /app e /admin
 * - evita loop de analytics quebrado
 */
(function () {
  var path = location.pathname.replace(/\/$/, "") || "/";
  var heavy =
    path === "/app" ||
    path.indexOf("/app/") === 0 ||
    path === "/admin" ||
    path.indexOf("/admin/") === 0 ||
    path === "/auth";

  try {
    var style = document.createElement("style");
    style.setAttribute("data-arbishield", "stability");
    style.textContent = [
      "html.arbishield-stable *,",
      "html.arbishield-stable *::before,",
      "html.arbishield-stable *::after {",
      "  animation-duration: 0.001ms !important;",
      "  animation-iteration-count: 1 !important;",
      "  transition-duration: 0.001ms !important;",
      "  scroll-behavior: auto !important;",
      "}",
      "html.arbishield-stable [class*=\"blur-\"],",
      "html.arbishield-stable [style*=\"blur(\"] {",
      "  filter: none !important;",
      "  backdrop-filter: none !important;",
      "  -webkit-backdrop-filter: none !important;",
      "  will-change: auto !important;",
      "}",
    ].join("\n");
    if (heavy) document.documentElement.classList.add("arbishield-stable");
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  function nukeSW() {
    try {
      if (!("serviceWorker" in navigator)) return Promise.resolve();
      return navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(
          regs.map(function (r) {
            return r.unregister();
          })
        );
      });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function nukeCaches() {
    try {
      if (!window.caches) return Promise.resolve();
      return caches.keys().then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            return caches.delete(k);
          })
        );
      });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function run() {
    nukeSW()
      .then(nukeCaches)
      .catch(function () {});
  }

  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 200);
  }

  // Re-tenta uma vez (SW antigo pode reaparecer)
  setTimeout(run, 4000);

  // Silencia handler de erro ruidoso de analytics no console (não bloqueia UI)
  window.addEventListener(
    "unhandledrejection",
    function (ev) {
      try {
        var msg = String((ev && ev.reason && ev.reason.message) || ev.reason || "");
        if (/Tracking failed|o is not a function/i.test(msg)) {
          ev.preventDefault();
        }
      } catch (e) {}
    },
    true
  );
})();
