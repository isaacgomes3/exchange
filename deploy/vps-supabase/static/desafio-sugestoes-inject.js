/**
 * Link "Sugestão de Desafio" + preencher formulário a partir do localStorage.
 *
 * IMPORTANTE: NÃO usa MutationObserver no documento inteiro — isso + React
 * gerava loop (mutation → fill → re-render → mutation) e congelava o admin.
 */
(function () {
  const BTN_ID = "arbishield-desafio-sugestao-btn";
  const APPLIED_FLAG = "arbishield_desafio_suggestion_applied";
  const SEEN_SUGESTAO = "arbishield_desafio_sugestao_seen";

  function onDesafiosPage() {
    const p = location.pathname.replace(/\/$/, "");
    return p === "/admin/desafios" || p.endsWith("/admin/desafios");
  }

  function findLaunchButton() {
    return Array.from(document.querySelectorAll("button")).find((b) =>
      /lançar\s*desafio/i.test(b.textContent || "")
    );
  }

  /** Insere o link ao lado do botão, sem mover o nó React. */
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
      "display:inline-flex;align-items:center;border-radius:12px;border:1px solid rgba(201,242,35,0.4);" +
      "color:#C9F223;font-weight:900;text-transform:uppercase;letter-spacing:0.12em;font-size:10px;" +
      "padding:10px 16px;text-decoration:none;background:transparent;margin-right:8px;";

    launch.parentElement.insertBefore(link, launch);
  }

  function fillInput(el, value) {
    if (!el || value == null || value === "") return;
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, String(value));
    else el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** Só limpa o flag UMA vez quando a URL traz sugestao=1 (evita loop). */
  function acceptNewSuggestionOnce() {
    const qs = new URLSearchParams(location.search);
    if (qs.get("sugestao") !== "1") return;
    if (sessionStorage.getItem(SEEN_SUGESTAO) === location.href) return;
    sessionStorage.setItem(SEEN_SUGESTAO, location.href);
    sessionStorage.removeItem(APPLIED_FLAG);
  }

  function applySuggestionToOpenForm() {
    if (!onDesafiosPage()) return;
    acceptNewSuggestionOnce();

    if (sessionStorage.getItem(APPLIED_FLAG) === "1") return;
    if (!localStorage.getItem("arbishield_desafio_suggestion")) return;

    const raw = localStorage.getItem("arbishield_desafio_suggestion");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const step = (data.steps && data.steps[0]) || {};

    const map = [
      ["title", data.title],
      ["subtitle", data.subtitle],
      ["home", step.home_team],
      ["casa(?!_odd|_stake|_commission)", step.home_team],
      ["away", step.away_team],
      ["fora", step.away_team],
      ["match", step.match_label],
      ["partida", step.match_label],
      ["mercado.*casa|market_name_casa", step.market_name_casa],
      ["mercado.*arbi|market_name_arbishield|arbishield", step.market_name_arbishield],
      ["odd.*casa|casa_odd", step.casa_odd],
      ["odd.*arbi|arbi_odd", step.arbi_odd],
      ["stake|casa_stake", step.casa_stake_cents],
      ["liquidez|liquidity", step.liquidity_cents],
      ["link|external|betbra", step.external_bet_link],
      ["in[ií]cio|starts|data", step.starts_at],
      ["release|libera|minutos.?antes", step.release_minutes_before],
    ];

    const inputs = Array.from(
      document.querySelectorAll('input:not([type="hidden"]), textarea')
    ).filter((el) => el.offsetParent !== null);

    if (inputs.length < 3) return;

    // Marca ANTES de preencher — senão o re-render do React reentra e trava
    sessionStorage.setItem(APPLIED_FLAG, "1");

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

    if (filled === 0) {
      // Formulário ainda não é o de lançamento — tenta de novo depois
      sessionStorage.removeItem(APPLIED_FLAG);
      return;
    }

    localStorage.removeItem("arbishield_desafio_suggestion");
    try {
      const u = new URL(location.href);
      if (u.searchParams.has("sugestao")) {
        u.searchParams.delete("sugestao");
        history.replaceState({}, "", u.pathname + u.search);
      }
    } catch {}
  }

  function tick() {
    if (!onDesafiosPage()) return;
    try {
      ensureButton();
      applySuggestionToOpenForm();
    } catch (err) {
      console.warn("[desafio-sugestoes-inject]", err);
    }
  }

  // Polling leve — sem MutationObserver (causava freeze no admin)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick);
  } else {
    tick();
  }
  setInterval(tick, 2000);

  // Reage a navegação SPA (pushState/replaceState) sem observar o DOM
  const _push = history.pushState;
  const _replace = history.replaceState;
  history.pushState = function () {
    const r = _push.apply(this, arguments);
    setTimeout(tick, 50);
    return r;
  };
  history.replaceState = function () {
    const r = _replace.apply(this, arguments);
    setTimeout(tick, 50);
    return r;
  };
  window.addEventListener("popstate", () => setTimeout(tick, 50));
})();
