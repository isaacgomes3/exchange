/**
 * URL pública do Supabase (Kong via nginx em arbishield.app).
 * Nunca exponha 127.0.0.1 / localhost no cliente do browser.
 */

function trimUrl(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return v.replace(/\/+$/, "").replace(/\/auth\/v1$/i, "");
}

function isLoopbackOrInternal(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".internal") ||
      host === "kong" ||
      host === "auth"
    );
  } catch {
    return true;
  }
}

export function getSupabaseUrl(): string | undefined {
  const fromEnv = trimUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const fallback = trimUrl(process.env.ARBISHIELD_SUPABASE_URL);
  const publicFallback = trimUrl(process.env.NEXT_PUBLIC_SITE_URL) || "https://arbishield.app";

  const candidate = fromEnv || fallback;
  if (!candidate) return publicFallback;

  // No browser: sempre same-origin (nginx → Kong). Evita Failed to fetch
  // quando o build embutiu http://127.0.0.1:8000.
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  // No servidor Next (mesma VPS), loopback até o Kong é ok.
  if (isLoopbackOrInternal(candidate)) {
    return candidate;
  }

  return candidate || publicFallback;
}

export function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || undefined;
}

export function getSupabaseServiceRoleKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.ARBISHIELD_SERVICE_ROLE_KEY?.trim() ||
    undefined
  );
}

/** Cliente público (URL + anon key) configurado. */
export function isSupabaseConfigured(): boolean {
  if (typeof window !== "undefined") {
    return Boolean(getSupabaseAnonKey());
  }
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** Persistência server-side disponível (service role ou anon). */
export function isSupabasePersistenceEnabled(): boolean {
  return Boolean(
    getSupabaseUrl() && (getSupabaseServiceRoleKey() || getSupabaseAnonKey())
  );
}
