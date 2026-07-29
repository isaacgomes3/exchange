/**
 * Stub do chunk SPA /auth (auth-DorSjXn4.js).
 * O formulário SPA trava; força reload para auth-vps.html via nginx.
 */
export function component() {
  if (typeof window !== "undefined") {
    const u = new URL("/auth", window.location.origin);
    const cur = new URLSearchParams(window.location.search);
    cur.forEach((v, k) => {
      if (k !== "stable") u.searchParams.set(k, v);
    });
    u.searchParams.set("stable", "1");
    if (!window.__arbishieldAuthRedirect) {
      window.__arbishieldAuthRedirect = true;
      window.location.replace(u.pathname + "?" + u.searchParams.toString());
    }
  }
  return null;
}

export default { component };
