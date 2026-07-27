/**
 * Override externo do preview Proteger.
 * Roda FORA do IIFE — regrava #preview depois do updatePreview legado.
 * LAY lucro fee = resp/odd (ex.: 1000@10 → 100);
 * dedução = lucro − 4,5% − 1,5% (= 80,50).
 */
(function () {
  function money(cents) {
    if (window.ArbiV2 && typeof window.ArbiV2.money === "function") {
      return window.ArbiV2.money(cents);
    }
    return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function num(v) {
    return Number(String(v == null ? "" : v).replace(",", ".")) || 0;
  }

  function fix() {
    var amountEl = document.getElementById("amount");
    var oddEl = document.getElementById("odd");
    var balEl = document.getElementById("balanceType");
    var preview = document.getElementById("preview");
    var drawer = document.getElementById("drawer");
    if (!amountEl || !oddEl || !preview) return;
    if (drawer && !drawer.classList.contains("open")) return;

    var amountReais = num(amountEl.value);
    var amountCents = Math.round(amountReais * 100);
    var odd = num(oddEl.value);
    if (!(odd > 1.01)) return;

    // Tipo: texto do título "Proteger · LAY"
    var title = document.getElementById("drawerTitle");
    var mt = "LAY";
    if (title && /BACK/i.test(title.textContent || "")) mt = "BACK";

    var layOdd = odd > 1.01 ? odd : 1.01;
    var effOdd = mt === "LAY" ? layOdd / (layOdd - 1) : layOdd;
    var retorno =
      mt === "LAY"
        ? amountCents + Math.max(0, Math.round(amountCents / layOdd))
        : Math.round(amountCents * effOdd);
    var lucroBruto =
      mt === "LAY"
        ? Math.max(0, Math.round(amountCents / layOdd))
        : Math.max(0, retorno - amountCents);
    var seuLucro = Math.round(amountCents * 0.015);
    var comissaoEx = Math.round(Math.max(0, lucroBruto) * 0.045);
    var deducao = Math.max(0, lucroBruto - comissaoEx - seuLucro);

    var availTxt = "—";
    try {
      // melhor esforço: pega o último "Saldo disponível" se profile não estiver exposto
      availTxt = preview.querySelector
        ? ""
        : "";
    } catch (e) {}

    var oddLine =
      mt === "LAY"
        ? "<div><span>Odd LAY → back equiv.</span><b>" +
          effOdd.toFixed(3).replace(".", ",") +
          "</b></div>"
        : "";

    // preserva saldo disponível se já estiver no preview
    var availHtml = "";
    var prev = preview.innerHTML || "";
    var m = prev.match(
      /<div><span>Saldo dispon[^\<]*<\/span><b>([^<]*)<\/b><\/div>/i
    );
    if (m) {
      availHtml =
        "<div><span>Saldo disponível</span><b>" + m[1] + "</b></div>";
    } else {
      availHtml =
        "<div><span>Saldo disponível</span><b>" + availTxt + "</b></div>";
    }

    preview.innerHTML =
      "<div><span>Tipo</span><b>" +
      mt +
      "</b></div>" +
      oddLine +
      "<div><span>Valor (stake)</span><b>" +
      money(amountCents) +
      "</b></div>" +
      "<div><span>Retorno casa externa</span><b>" +
      money(retorno) +
      "</b></div>" +
      "<div><span>Comissão Exchange (4,5% do lucro)</span><b>" +
      money(comissaoEx) +
      "</b></div>" +
      "<div><span>Seu lucro (1,5%)</span><b>" +
      money(seuLucro) +
      "</b></div>" +
      "<div><span>Dedução ArbiShield</span><b>" +
      money(deducao) +
      "</b></div>" +
      availHtml;

    preview.setAttribute("data-fix-preview", "1");
  }

  function schedule() {
    setTimeout(fix, 0);
    setTimeout(fix, 50);
    setTimeout(fix, 150);
  }

  document.addEventListener(
    "input",
    function (e) {
      var id = e.target && e.target.id;
      if (id === "amount" || id === "odd" || id === "balanceType") schedule();
    },
    true
  );
  document.addEventListener(
    "change",
    function (e) {
      var id = e.target && e.target.id;
      if (id === "amount" || id === "odd" || id === "balanceType") schedule();
    },
    true
  );
  document.addEventListener(
    "click",
    function () {
      schedule();
    },
    true
  );

  var obs = new MutationObserver(schedule);
  function watch() {
    var preview = document.getElementById("preview");
    if (preview) obs.observe(preview, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      watch();
      schedule();
    });
  } else {
    watch();
    schedule();
  }
})();
