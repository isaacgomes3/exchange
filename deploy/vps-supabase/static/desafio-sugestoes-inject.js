/**
 * Injeta o botão "Sugestão de Desafio" na Gestão de Desafios sem alterar o bundle React.
 * Também aplica sugestão salva no localStorage ao abrir "Lançar Desafio".
 */
(function () {
  const BTN_ID = "arbishield-desafio-sugestao-btn";
  const APPLIED_FLAG = "arbishield_desafio_suggestion_applied";

  function onDesafiosPage() {
    const p = location.pathname.replace(/\/$/, "");
    return p === "/admin/desafios" || p.endsWith("/admin/desafios");
  }

  function findLaunchButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find((b) => /lançar\s*desafio/i.test(b.textContent || ""));
  }

  function ensureButton() {
    if (!onDesafiosPage()) return;
    if (document.getElementById(BTN_ID)) return;
    const launch = findLaunchButton();
    if (!launch || !launch.parentElement) return;

    const wrap = document.createElement("div");
    wrap.id = BTN_ID;
    wrap.style.cssText = "display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;";

    const link = document.createElement("a");
    link.href = "/desafio-sugestoes.html";
    link.textContent = "Sugestão de Desafio";
    link.style.cssText =
      "display:inline-flex;align-items:center;border-radius:12px;border:1px solid rgba(201,242,35,0.4);" +
      "color:#C9F223;font-weight:900;text-transform:uppercase;letter-spacing:0.12em;font-size:10px;" +
      "padding:10px 16px;text-decoration:none;background:transparent;";

    // Move launch into wrap next to suggestion
    const parent = launch.parentElement;
    parent.insertBefore(wrap, launch);
    wrap.appendChild(link);
    wrap.appendChild(launch);
  }

  function fillInput(el, value) {
    if (!el || value == null || value === "") return;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, String(value));
    else el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applySuggestionToOpenForm() {
    if (!onDesafiosPage()) return;
    if (sessionStorage.getItem(APPLIED_FLAG) === "1") return;
    const want =
      new URLSearchParams(location.search).get("sugestao") === "1" ||
      Boolean(localStorage.getItem("arbishield_desafio_suggestion"));
    if (!want) return;

    let raw = localStorage.getItem("arbishield_desafio_suggestion");
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const step = (data.steps && data.steps[0]) || {};

    // Heurística: preencher inputs visíveis do formulário de lançamento
    const labels = Array.from(document.querySelectorAll("label, span, p, div"));
    const map = [
      ["title", data.title],
      ["subtitle", data.subtitle],
      ["home", step.home_team],
      ["casa", step.home_team],
      ["away", step.away_team],
      ["fora", step.away_team],
      ["match", step.match_label],
      ["partida", step.match_label],
      ["mercado.*casa|market_name_casa|betbra", step.market_name_casa],
      ["mercado.*arbi|market_name_arbishield|arbishield", step.market_name_arbishield],
      ["odd.*casa|casa_odd", step.casa_odd],
      ["odd.*arbi|arbi_odd", step.arbi_odd],
      ["stake|casa_stake", step.casa_stake_cents],
      ["liquidez|liquidity", step.liquidity_cents],
      ["link|external|betbra", step.external_bet_link],
      ["in[ií]cio|starts|data", step.starts_at],
    ];

    const inputs = Array.from(
      document.querySelectorAll('input:not([type="hidden"]), textarea')
    ).filter((el) => el.offsetParent !== null);

    if (inputs.length < 3) return; // formulário ainda não aberto

    let filled = 0;
    for (const input of inputs) {
      const ctx = (
        (input.getAttribute("name") || "") +
        " " +
        (input.getAttribute("placeholder") || "") +
        " " +
        (input.id || "") +
        " " +
        (input.closest("label")?.textContent || "") +
        " " +
        (input.previousElementSibling?.textContent || "")
      ).toLowerCase();

      for (const [pattern, value] of map) {
        if (value == null || value === "") continue;
        if (new RegExp(pattern, "i").test(ctx)) {
          fillInput(input, value);
          filled++;
          break;
        }
      }
    }

    if (filled > 0) {
      sessionStorage.setItem(APPLIED_FLAG, "1");
      localStorage.removeItem("arbishield_desafio_suggestion");
      // limpa query
      try {
        const u = new URL(location.href);
        if (u.searchParams.has("sugestao")) {
          u.searchParams.delete("sugestao");
          history.replaceState({}, "", u.pathname + u.search);
        }
      } catch {}
    }
  }

  function tick() {
    try {
      ensureButton();
      applySuggestionToOpenForm();
    } catch (err) {
      console.warn("[desafio-sugestoes-inject]", err);
    }
  }

  const obs = new MutationObserver(() => tick());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick);
  } else {
    tick();
  }
  setInterval(tick, 1500);
})();
