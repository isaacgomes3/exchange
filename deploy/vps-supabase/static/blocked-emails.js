/**
 * Contas bloqueadas — sem login app/admin.
 * Incluir antes de auth/v2-shell nas páginas de login.
 */
(function (global) {
  var BLOCKED = {
    "jefferson@arbishield.com": 1,
    "jefferson@arbishield": 1,
    "jeffersonboulevard@gmail.com": 1,
    "jeffersojeffersonboulevard@gmail.com": 1,
  };

  function isBlockedEmail(email) {
    email = String(email || "")
      .trim()
      .toLowerCase();
    return !!(email && BLOCKED[email]);
  }

  global.ArbiIsBlockedEmail = isBlockedEmail;
  global.ArbiBlockedEmails = BLOCKED;
})(typeof window !== "undefined" ? window : globalThis);
