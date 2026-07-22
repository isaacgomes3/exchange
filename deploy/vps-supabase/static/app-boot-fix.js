/**
 * Evita travamento na área de membros (/app, /m).
 * - Não mexe em history/router
 * - Não apaga caches durante navegação no app
 * - Garante visibilidade se algum guard antigo ocultou a página
 */
(function () {
  var path = (location.pathname || "/").replace(/\/$/, "") || "/";
  var onMember =
    path === "/app" ||
    path.indexOf("/app/") === 0 ||
    path === "/m" ||
    path.indexOf("/m/") === 0;

  if (!onMember) return;

  try {
    document.documentElement.classList.remove("arbishield-jogos-pending");
    document.documentElement.style.visibility = "";
    if (document.body) document.body.style.visibility = "";
  } catch (e) {}

  try {
    window.__ARBISHIELD_APP_BOOT__ = true;
  } catch (e2) {}
})();
