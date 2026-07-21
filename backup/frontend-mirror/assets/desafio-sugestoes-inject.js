/**
 * Link "Sugestão de Desafio" na Gestão de Desafios (SPA).
 * PASSIVO — não observa DOM, não preenche formulário, não move botões React.
 */
(function () {
  var BTN_ID = "arbishield-desafio-sugestao-link";
  var HEAL_KEY = "arbishield_desafio_wrap_healed";

  function onDesafiosPage() {
    var p = location.pathname.replace(/\/$/, "");
    return p === "/admin/desafios" || p.endsWith("/admin/desafios");
  }

  function healBrokenWrapOnce() {
    if (sessionStorage.getItem(HEAL_KEY) === "1") return;
    var wrap = document.getElementById("arbishield-desafio-sugestao-btn");
    if (!wrap || wrap.tagName !== "DIV") {
      sessionStorage.setItem(HEAL_KEY, "1");
      return;
    }
    var parent = wrap.parentElement;
    if (!parent) return;
    while (wrap.firstChild) {
      parent.insertBefore(wrap.firstChild, wrap);
    }
    wrap.remove();
    sessionStorage.setItem(HEAL_KEY, "1");
  }

  function ensureLinkOnce() {
    if (!onDesafiosPage()) return;
    if (document.getElementById(BTN_ID)) return;

    var launch = Array.from(document.querySelectorAll("button")).find(function (b) {
      return /lançar\s*desafio/i.test(b.textContent || "");
    });
    if (!launch || !launch.parentElement) return;

    var link = document.createElement("a");
    link.id = BTN_ID;
    link.href = "/desafio-sugestoes.html";
    link.textContent = "Sugestão de Desafio";
    link.style.cssText =
      "display:inline-flex;align-items:center;border-radius:12px;border:1px solid rgba(201,242,35,0.4);" +
      "color:#C9F223;font-weight:900;text-transform:uppercase;letter-spacing:0.12em;font-size:10px;" +
      "padding:10px 16px;text-decoration:none;background:transparent;margin-right:8px;";

    launch.parentElement.insertBefore(link, launch);
  }

  function run() {
    try {
      healBrokenWrapOnce();
      ensureLinkOnce();
    } catch (err) {
      console.warn("[desafio-sugestoes-inject]", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    run();
    if (tries >= 8 || document.getElementById(BTN_ID)) clearInterval(timer);
  }, 500);
})();
