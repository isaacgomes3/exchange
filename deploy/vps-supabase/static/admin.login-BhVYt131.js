/**
 * Stub do chunk ausente admin.login-*.js
 * Redireciona para a página de login VPS (evita "Falha no Terminal").
 */
export function component() {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect") || "/admin";
    const u = new URL("/admin/login", window.location.origin);
    // Full navigation → nginx serves admin-login-vps.html
    u.searchParams.set("redirect", redirect);
    // Avoid loop if somehow still on SPA shell
    if (!window.__arbishieldAdminLoginRedirect) {
      window.__arbishieldAdminLoginRedirect = true;
      window.location.replace(u.pathname + u.search);
    }
  }
  return null;
}

export default { component };
