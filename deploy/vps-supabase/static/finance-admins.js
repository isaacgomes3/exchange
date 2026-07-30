/**
 * Allowlist do menu Financeiro (admin).
 * Incluir antes de v2.js / v2-shell nas páginas admin se quiser override.
 */
(function (global) {
  var ALLOW = {
    "isaacgomes3@gmail.com": 1,
    "financeiro@arbishield.com": 1,
  };
  global.ArbiCanAccessFinance = function (email) {
    email = String(email || "")
      .trim()
      .toLowerCase();
    return !!(email && ALLOW[email]);
  };
  global.ArbiFinanceAdminEmails = ALLOW;
})(typeof window !== "undefined" ? window : globalThis);
