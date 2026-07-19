/**
 * Injeta link "Sugestão de Desafio" SEM mover nós gerenciados pelo React
 * (mover o botão "Lançar Desafio" quebrava a rota → Falha no Terminal).
 */
(function () {
  const BTN_ID = "arbishield-desafio-sugestao-btn";

  function onDesafiosPage() {
    const p = location.pathname.replace(/\/$/, "");
    return p === "/admin/desafios" || p.endsWith("/admin/desafios");
  }

  function findLaunchButton() {
    return Array.from(document.querySelectorAll("button")).find((b) =>
      /lançar\s*desafio/i.test(b.textContent || "")
    );
  }

  function ensureButton() {
    if (!onDesafiosPage()) return;
    if (document.getElementById(BTN_ID)) return;

    const launch = findLaunchButton();
    if (!launch || !launch.parentElement) return;

    const link = document.createElement("a");
    link.id = BTN_ID;
    link.href = "/desafio-sugestoes.html";
    link.textContent = "Sugestão de Desafio";
    link.style.cssText =
      "display:inline-flex;align-items:center;margin-right:8px;border-radius:12px;" +
      "border:1px solid rgba(201,242,35,0.4);color:#C9F223;font-weight:900;" +
      "text-transform:uppercase;letter-spacing:0.12em;font-size:10px;" +
      "padding:10px 16px;text-decoration:none;background:transparent;";

    // Apenas inserir o link como irmão — NÃO mover o botão React
    launch.parentElement.insertBefore(link, launch);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        ensureButton();
      } catch (err) {
        console.warn("[desafio-sugestoes-inject]", err);
      }
    });
  }

  const obs = new MutationObserver(schedule);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule);
  } else {
    schedule();
  }
})();
