/**
 * Override externo do preview Proteger.
 * Marker: proteger-sem-stake-equiv-v1
 *
 * 1) Regrava #preview sem as linhas de stake/odd equivalentes do LAY.
 * 2) Remove essas linhas se o updatePreview legado recolocá-las.
 */
(function () {
  var HIDE_RE = /stake\s*equivalente|odd\s*lay\s*→\s*back|odd\s*lay\s*->\s*back|back\s*equiv/i;
  var MARKER = "proteger-sem-stake-equiv-v1";

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

  function stripBannedRows(preview) {
    if (!preview) return;
    var kids = Array.prototype.slice.call(preview.children || []);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      var span = el.querySelector && el.querySelector("span");
      var label = ((span && span.textContent) || el.textContent || "").trim();
      if (HIDE_RE.test(label)) {
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    }
  }

  function fix() {
    var amountEl = document.getElementById("amount");
    var oddEl = document.getElementById("odd");
    var preview = document.getElementById("preview");
    var drawer = document.getElementById("drawer");
    if (!preview) return;

    // Sempre remove linhas banidas, mesmo se o drawer estiver fechando.
    stripBannedRows(preview);

    if (!amountEl || !oddEl) return;
    if (drawer && !drawer.classList.contains("open")) return;

    var amountReais = num(amountEl.value);
    var amountCents = Math.round(amountReais * 100);
    var odd = num(oddEl.value);
    if (!(odd > 1.01)) {
      stripBannedRows(preview);
      return;
    }

    var title = document.getElementById("drawerTitle");
    var mt = "LAY";
    if (title && /BACK/i.test(title.textContent || "")) mt = "BACK";

    var layOdd = odd > 1.01 ? odd : 1.01;
    var effOdd = mt === "LAY" ? layOdd / (layOdd - 1) : layOdd;
    var retorno = Math.round(amountCents * effOdd);
    var lucroBruto = Math.max(0, retorno - amountCents);
    var seuLucro = Math.round(amountCents * 0.015);
    var comissaoEx = Math.round(Math.max(0, lucroBruto) * 0.045);
    var deducao = Math.max(0, lucroBruto - comissaoEx - seuLucro);

    var availHtml = "";
    var prev = preview.innerHTML || "";
    var m = prev.match(
      /<div><span>Saldo dispon[^\<]*<\/span><b>([^<]*)<\/b><\/div>/i
    );
    if (m) {
      availHtml =
        "<div><span>Saldo disponível</span><b>" + m[1] + "</b></div>";
    }

    // Não inclui as duas linhas de stake/odd equivalentes do LAY.
    preview.innerHTML =
      "<div><span>Tipo</span><b>" +
      mt +
      "</b></div>" +
      "<div><span>Valor (responsabilidade/stake)</span><b>" +
      money(amountCents) +
      "</b></div>" +
      "<div><span>Lucro bruto (base da taxa)</span><b>" +
      money(lucroBruto) +
      "</b></div>" +
      "<div><span>Retorno casa externa</span><b>" +
      money(retorno) +
      "</b></div>" +
      "<div><span>Comissão Exchange (4,5% do lucro bruto)</span><b>" +
      money(comissaoEx) +
      "</b></div>" +
      "<div><span>Sua fatia (1,5% da cobertura)</span><b>" +
      money(seuLucro) +
      "</b></div>" +
      "<div><span>Dedução ArbiShield</span><b>" +
      money(deducao) +
      "</b></div>" +
      availHtml;

    preview.setAttribute("data-fix-preview", MARKER);
    stripBannedRows(preview);
  }

  function schedule() {
    setTimeout(fix, 0);
    setTimeout(fix, 40);
    setTimeout(fix, 120);
    setTimeout(fix, 300);
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
  document.addEventListener("click", schedule, true);

  var obs = new MutationObserver(function () {
    schedule();
  });
  function watch() {
    var preview = document.getElementById("preview");
    if (preview) {
      obs.observe(preview, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
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
