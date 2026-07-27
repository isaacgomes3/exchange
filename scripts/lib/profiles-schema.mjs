/**
 * Schema real da VPS: `profiles` NÃO tem coluna `email`.
 * Email fica em `auth.users`. Qualquer SELECT/filtro em profiles.email
 * quebra com: column profiles.email does not exist (42703).
 *
 * Use estes helpers em scripts/API. Teste CI: scripts/profiles-schema.test.mjs
 */
export const PROFILES_HAS_EMAIL_COLUMN = false;

/** Marker — hotfixes/testes devem conter esta string. */
export const PROFILES_NO_EMAIL_RULE = "profiles-sem-coluna-email-v1";

/** Campos seguros para SELECT em profiles (sem email). */
export const PROFILES_SAFE_SELECT_BASE =
  "id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,deduction_balance_cents,demo_balance_cents,investor_balance_cents,desafio_balance_cents,updated_at";

export const PROFILES_SAFE_SELECT_MIN = "id,full_name";

/**
 * Monta select list sem email.
 * @param {string[]} [extra]
 */
export function profilesSafeSelect(extra = []) {
  void PROFILES_NO_EMAIL_RULE;
  const parts = String(PROFILES_SAFE_SELECT_MIN)
    .split(",")
    .concat(Array.isArray(extra) ? extra : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .filter((s) => s.toLowerCase() !== "email");
  return [...new Set(parts)].join(",");
}

/**
 * Remove `,email` / `email,` / filtro email de um path PostgREST de profiles.
 * @param {string} path
 */
export function stripProfilesEmailFromPath(path) {
  let p = String(path || "");
  // select=...email...
  p = p.replace(/([?&]select=)([^&]*)/gi, (_, key, sel) => {
    const cleaned = String(sel)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== "email" && !/\.email$/i.test(s))
      .join(",");
    return `${key}${cleaned || "id,full_name"}`;
  });
  // email=eq....&  ou &email=eq...
  p = p.replace(/([?&])email=eq\.[^&]*/gi, "$1");
  // embed: profiles(full_name,email) → profiles(full_name)
  p = p.replace(/profiles\(([^)]*)\)/gi, (_, inner) => {
    const cleaned = String(inner)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== "email")
      .join(",");
    return `profiles(${cleaned || "full_name"})`;
  });
  p = p.replace(/\?&/g, "?").replace(/&&+/g, "&").replace(/[?&]$/g, "");
  return p;
}
