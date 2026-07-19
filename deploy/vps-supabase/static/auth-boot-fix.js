/**
 * Corrige travamento do /auth na VPS após cutover Lovable:
 * - limpa sessão JWT inválida (segredo antigo / outro projeto)
 * - reduz animações pesadas (blur infinito) que congelam o browser
 */
(function () {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const onAuth = path === "/auth" || path.endsWith("/auth");

  // CSS: corta blur/animacoes caras
  try {
    const style = document.createElement("style");
    style.setAttribute("data-arbishield", "auth-boot-fix");
    style.textContent = `
      @media (prefers-reduced-motion: no-preference) {
        body .blur-\\[40px\\],
        body [style*="blur(40px)"] {
          filter: none !important;
          animation: none !important;
          transform: none !important;
        }
      }
      html.arbishield-reduce-motion *,
      html.arbishield-reduce-motion *::before,
      html.arbishield-reduce-motion *::after {
        animation: none !important;
        transition: none !important;
      }
    `;
    document.documentElement.classList.add("arbishield-reduce-motion");
    (document.head || document.documentElement).appendChild(style);
    // reativa motion leve depois do primeiro paint (se página ok)
    setTimeout(() => {
      document.documentElement.classList.remove("arbishield-reduce-motion");
    }, 2500);
  } catch {}

  if (!onAuth) return;

  const STORAGE_KEYS = [
    "sb-arbishield-auth-token",
    "sb-www-auth-token",
    "supabase.auth.token",
    "auth_login_pending_until",
    "admin_login_pending_until",
    "is_admin_session",
    "is_admin_session_uid",
    "is_admin_session_expires_at",
  ];

  function readStoredAccessToken() {
    for (const key of STORAGE_KEYS.slice(0, 3)) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const token =
          parsed?.access_token ||
          parsed?.currentSession?.access_token ||
          parsed?.session?.access_token;
        if (token) return { key, token, parsed };
      } catch {}
    }
    return null;
  }

  function clearAuthStorage() {
    for (const key of STORAGE_KEYS) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch {}
    }
    // limpa variantes sb-*-auth-token
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && /(^sb-.*-auth-token$|supabase\.auth)/i.test(k)) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
    console.info("[auth-boot-fix] sessão inválida limpa");
  }

  async function validateOrClear() {
    const stored = readStoredAccessToken();
    if (!stored) return;
    try {
      const res = await fetch("/auth/v1/user", {
        headers: {
          apikey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s",
          Authorization: `Bearer ${stored.token}`,
        },
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        clearAuthStorage();
        // evita loop de soft-redirect com sessão zumbi
        if (!new URLSearchParams(location.search).has("cleared")) {
          const u = new URL(location.href);
          u.searchParams.set("cleared", "1");
          location.replace(u.pathname + u.search);
        }
      }
    } catch (err) {
      console.warn("[auth-boot-fix] validate failed", err);
    }
  }

  validateOrClear();
})();
