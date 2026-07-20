/**
 * Anti-freeze do admin SPA — versão segura.
 *
 * NÃO usa seletor universal `*` (isso congelava o admin ao focar inputs:
 * recalculo de estilo em árvore enorme a cada click/hover/focus).
 *
 * Só corta blur/backdrop/animações de overlay/dialog.
 */
(function () {
  function onAdminPath() {
    var path = (location.pathname || "/").replace(/\/$/, "") || "/";
    return path === "/admin" || path.indexOf("/admin/") === 0;
  }

  if (!onAdminPath()) return;

  var MARK = "arbishield-admin-modal-stable";

  try {
    // Remove CSS antigo nocivo (seletor *) se ainda estiver no DOM
    var old = document.querySelectorAll('style[data-arbishield="admin-modal-fix"]');
    for (var i = 0; i < old.length; i++) old[i].remove();
    document.documentElement.classList.remove(MARK);
  } catch (e0) {}

  try {
    document.documentElement.classList.add(MARK);
    var style = document.createElement("style");
    style.setAttribute("data-arbishield", "admin-modal-fix");
    style.setAttribute("data-arbishield-safe", "1");
    style.textContent =
      /* só overlays / blur — nunca html.* * */ "" +
      "html." + MARK + " [class*=\"blur-\"]," +
      "html." + MARK + " [style*=\"blur(\"]," +
      "html." + MARK + " [class*=\"backdrop-blur\"]," +
      "html." + MARK + " [data-radix-dialog-overlay]," +
      "html." + MARK + " [data-radix-sheet-overlay]," +
      "html." + MARK + " [data-vaul-drawer-wrapper]," +
      "html." + MARK + " [data-state=\"open\"][class*=\"overlay\"]{" +
      "filter:none!important;" +
      "backdrop-filter:none!important;" +
      "-webkit-backdrop-filter:none!important;" +
      "will-change:auto!important;" +
      "}" +
      "html." + MARK + " [data-radix-dialog-overlay]," +
      "html." + MARK + " [data-radix-sheet-overlay]," +
      "html." + MARK + " [data-vaul-drawer-wrapper]{" +
      "animation:none!important;" +
      "transition:none!important;" +
      "}";
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  try {
    window.__ARBISHIELD_ADMIN_MODAL_FIX__ = "safe-v2";
  } catch (e2) {}
})();
