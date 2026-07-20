/**
 * Estabilidade global ArbiShield (VPS).
 * O SPA pode limpar classes do <html> — por isso reaplicamos em loop curto.
 */
(function () {
  var MARK = "arbishield-stable";
  var applied = false;

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
    style.textContent = [
      "html." + MARK + " *,",
      "html." + MARK + " *::before,",
      "html." + MARK + " *::after {",
      "  animation-duration: 0.001ms !important;",
      "  animation-iteration-count: 1 !important;",
      "  transition-duration: 0.001ms !important;",
      "  scroll-behavior: auto !important;",
      "}",
      "html." + MARK + " [class*=\"blur-\"],",
      "html." + MARK + " [style*=\"blur(\"] {",
      "  filter: none !important;",
      "  backdrop-filter: none !important;",
      "  -webkit-backdrop-filter: none !important;",
      "  will-change: auto !important;",
      "}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  function apply() {
    if (!isHeavyPath()) return;
    ensureStyle();
    try {
      document.documentElement.classList.add(MARK);
      applied = true;
    } catch (e) {}
  }

  apply();

  // Reaplica se o SPA limpar o <html>
  var n = 0;
  var timer = setInterval(function () {
    n += 1;
    apply();
    if (n >= 40) clearInterval(timer); // ~20s
  }, 500);

  // Também em navegações SPA
  try {
    var _push = history.pushState;
    history.pushState = function () {
      var r = _push.apply(this, arguments);
      setTimeout(apply, 0);
      return r;
    };
    window.addEventListener("popstate", function () {
      setTimeout(apply, 0);
    });
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

  function cleanup() {
    nukeSW()
      .then(nukeCaches)
      .catch(function () {});
  }

  if ("requestIdleCallback" in window) {
    requestIdleCallback(cleanup, { timeout: 1200 });
  } else {
    setTimeout(cleanup, 200);
  }
  setTimeout(cleanup, 4000);

  window.addEventListener(
    "unhandledrejection",
    function (ev) {
      try {
        var msg = String((ev && ev.reason && ev.reason.message) || ev.reason || "");
        if (/Tracking failed|o is not a function/i.test(msg)) ev.preventDefault();
      } catch (e) {}
    },
    true
  );

  // marcador de debug
  try {
    window.__ARBISHIELD_STABILITY__ = true;
  } catch (e) {}
})();
