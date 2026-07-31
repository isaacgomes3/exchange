/**
 * Estabilidade global ArbiShield (VPS).
 * No /admin: corta blur sem seletor universal (evita freeze em focus/click).
 */
(function () {
  var MARK = "arbishield-stable";

  function normPath() {
    return (location.pathname || "/").replace(/\/$/, "") || "/";
  }

  function isHeavyPath() {
    var path = normPath();
    return (
      path === "/app" ||
      path.indexOf("/app/") === 0 ||
      path === "/m" ||
      path.indexOf("/m/") === 0 ||
      path === "/admin" ||
      path.indexOf("/admin/") === 0 ||
      path === "/auth"
    );
  }

  function isAuthPath() {
    var path = normPath();
    return path === "/auth" || path.endsWith("/auth");
  }

  function ensureStyle() {
    var existing = document.querySelector('style[data-arbishield="stability"]');
    if (existing && existing.getAttribute("data-arbishield-safe") === "1") return;
    if (existing) existing.remove();

    var style = document.createElement("style");
    style.setAttribute("data-arbishield", "stability");
    style.setAttribute("data-arbishield-safe", "1");
    style.textContent =
      "html." + MARK + " [class*=\"blur-\"]," +
      "html." + MARK + " [style*=\"blur(\"]," +
      "html." + MARK + " [class*=\"backdrop-blur\"]," +
      "html." + MARK + " [data-radix-dialog-overlay]," +
      "html." + MARK + " [data-radix-sheet-overlay]," +
      "html." + MARK + " [data-vaul-drawer-wrapper]," +
      "html." + MARK + " [data-state=\"open\"][class*=\"overlay\"]{" +
      "filter:none!important;backdrop-filter:none!important;" +
      "-webkit-backdrop-filter:none!important;will-change:auto!important;}" +
      "html." + MARK + " [data-radix-dialog-overlay]," +
      "html." + MARK + " [data-radix-sheet-overlay]," +
      "html." + MARK + " [data-vaul-drawer-wrapper]{" +
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
    if (!isAuthPath()) return;
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

  if (isAuthPath()) {
    setTimeout(clearCorruptDashCache, 100);
  }

  try {
    window.__ARBISHIELD_STABILITY__ = "safe-v2";
  } catch (e) {}
})();
