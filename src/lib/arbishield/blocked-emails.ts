/** Contas permanentemente bloqueadas (sem login / sem admin). */
export const BLOCKED_EMAILS = new Set([
  "jefferson@arbishield.com",
  "jefferson@arbishield",
  "jeffersonboulevard@gmail.com",
  "jeffersojeffersonboulevard@gmail.com",
]);

export function isBlockedEmail(email?: string | null): boolean {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return !!e && BLOCKED_EMAILS.has(e);
}
