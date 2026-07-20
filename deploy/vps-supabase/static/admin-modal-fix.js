/**
 * Evita freeze ao abrir Sheet/Dialog no admin SPA (/admin/matches, /admin/desafios).
 * Mesma estratégia do auth-boot-fix: corta blur, backdrop e animações pesadas.
 */
(function () {
  var path = location.pathname.replace(/\/$/, "") || "/";
  var onAdmin =
    path === "/admin/matches" ||
    path.endsWith("/admin/matches") ||
    path === "/admin/desafios" ||
    path.endsWith("/admin/desafios") ||
    path === "/admin/users" ||
    path.endsWith("/admin/users");

  if (!onAdmin) return;

  var MARK = "arbishield-admin-modal-stable";

  try {
    if (document.documentElement.classList.contains(MARK)) return;
    document.documentElement.classList.add(MARK);

    var style = document.createElement("style");
    style.setAttribute("data-arbishield", "admin-modal-fix");
    style.textContent =
      "html." +
      MARK +
      " *,html." +
      MARK +
      " *::before,html." +
      MARK +
      " *::after{" +
      "animation:none!important;transition:none!important;scroll-behavior:auto!important;" +
      "}" +
      "html." +
      MARK +
      " [class*=\"blur-\"],html." +
      MARK +
      " [style*=\"blur(\"]," +
      "html." +
      MARK +
      " [data-radix-dialog-overlay]," +
      "html." +
      MARK +
      " [data-radix-sheet-overlay]," +
      "html." +
      MARK +
      " [data-vaul-drawer-wrapper]," +
      "html." +
      MARK +
      " [role=\"dialog\"]," +
      "html." +
      MARK +
      " [data-state=\"open\"][class*=\"overlay\"]" +
      "{filter:none!important;backdrop-filter:none!important;" +
      "-webkit-backdrop-filter:none!important;will-change:auto!important;transform:none!important;}";
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  try {
    window.__ARBISHIELD_ADMIN_MODAL_FIX__ = true;
  } catch (e2) {}
})();
