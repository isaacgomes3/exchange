/**
 * Mantém o layout SPA de /auth estável na VPS:
 * - limpa JWT inválido (segredo antigo / cutover)
 * - desliga blur/animações pesadas que congelam o input
 * - remove service workers/caches zumbis
 */
(function () {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const onAuth = path === "/auth" || path.endsWith("/auth");

  // CSS: corta efeitos caros (permanece em /auth)
  try {
    const style = document.createElement("style");
    style.setAttribute("data-arbishield", "auth-boot-fix");
    style.textContent = `
      html.arbishield-auth-stable *,
      html.arbishield-auth-stable *::before,
      html.arbishield-auth-stable *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
      html.arbishield-auth-stable .blur-\\[40px\\],
      html.arbishield-auth-stable .blur-\\[60px\\],
      html.arbishield-auth-stable .blur-\\[80px\\],
      html.arbishield-auth-stable .blur-3xl,
      html.arbishield-auth-stable .blur-2xl,
      html.arbishield-auth-stable .blur-xl,
      html.arbishield-auth-stable [class*="blur-["],
      html.arbishield-auth-stable [style*="blur("] {
        filter: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        transform: none !important;
        will-change: auto !important;
      }
    `;
    if (onAuth) {
      document.documentElement.classList.add("arbishield-auth-stable");
    }
    (document.head || document.documentElement).appendChild(style);
  } catch {}

  async function nukeServiceWorkers() {
    try {
      if (!("serviceWorker" in navigator)) return;
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {}
    try {
      if (!window.caches) return;
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
  }

  // Limpeza agressiva só no /auth (no /app apagar cache quebra o boot da SPA)
  if (!onAuth) return;

  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => {
      nukeServiceWorkers();
    }, { timeout: 1500 });
  } else {
    setTimeout(nukeServiceWorkers, 300);
  }

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
          apikey:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NDc5OTk4LCJleHAiOjE5NDIxNTk5OTh9.mxLqs20sCUNn58jWlsD0sznclCOr8rbksjTEAuQee3s",
          Authorization: `Bearer ${stored.token}`,
        },
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        clearAuthStorage();
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

  // não bloqueia digitação
  setTimeout(() => {
    validateOrClear();
  }, 0);
})();
