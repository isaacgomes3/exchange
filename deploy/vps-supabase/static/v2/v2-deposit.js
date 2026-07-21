/**
 * Modal de depósito ArbiShield v2 — mesmo fluxo do SPA:
 * destino → instruções → valor → rede → pagamento → comprovante → sucesso
 */
(function (global) {
  var PIX_FALLBACK = "35.163.917/0001-91";
  var PIX_QR = "/brand/pix-qr-inter.png";
  var NETWORKS = [
    { id: "PIX", label: "PIX (Banco Inter)", tone: "pix" },
    { id: "ETH", label: "Ethereum (ERC-20)", tone: "eth" },
    { id: "SOL", label: "Solana (SOL)", tone: "sol" },
    { id: "BNB", label: "BNB Chain (BEP-20)", tone: "bnb" },
  ];

  var state = {
    open: false,
    step: "destination",
    dest: null,
    amountCents: 50000,
    network: null,
    depositId: null,
    file: null,
    previewUrl: null,
    busy: false,
    err: "",
    ok: "",
    wallets: null,
    limits: { userMin: 2000, userMax: 1000000, providerMin: 50000, providerMax: 10000000 },
    pending: null,
  };

  function money(cents) {
    if (global.ArbiV2 && global.ArbiV2.money) return global.ArbiV2.money(cents);
    var n = Number(cents || 0) / 100;
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }
  function formatReais(cents) {
    return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function parseReaisToCents(raw) {
    var digits = String(raw || "").replace(/\D/g, "");
    return Number(digits || 0);
  }
  function client() {
    return global.ArbiV2.client();
  }

  function ensureDom() {
    if (document.getElementById("v2DepositModal")) return;
    var el = document.createElement("div");
    el.id = "v2DepositModal";
    el.className = "dep-modal";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<div class="dep-backdrop" data-dep-close="1"></div>' +
      '<div class="dep-sheet" role="dialog" aria-modal="true" aria-labelledby="depTitle">' +
      '<header class="dep-head">' +
      '<div><p class="dep-kicker">ArbiShield</p><h2 id="depTitle">Depósito</h2></div>' +
      '<button type="button" class="dep-x" data-dep-close="1" aria-label="Fechar">×</button>' +
      "</header>" +
      '<div class="dep-body" id="depBody"></div>' +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-dep-close") === "1") {
        if (state.step === "payment" || state.step === "proof") {
          flash("Anexe e envie o comprovante para concluir o depósito.");
          return;
        }
        close();
      }
    });
  }

  function flash(msg, ok) {
    state.err = ok ? "" : msg || "";
    state.ok = ok ? msg || "" : "";
    paint();
  }

  async function loadConfig() {
    var supa = client();
    try {
      var w = await supa
        .from("platform_settings")
        .select("key, value")
        .in("key", [
          "crypto_wallets",
          "pix_wallets",
          "usdt_eth_address",
          "usdt_sol_address",
          "usdt_bnb_address",
          "min_deposit_cents",
          "max_deposit_cents",
          "min_provider_deposit_cents",
          "max_provider_deposit_cents",
        ]);
      var map = {};
      (w.data || []).forEach(function (row) {
        map[row.key] = row.value;
      });
      function asArr(v) {
        try {
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return JSON.parse(v);
        } catch (e) {}
        return [];
      }
      function asStr(v) {
        if (typeof v === "string") return v.replace(/"/g, "");
        return v != null ? String(v) : "";
      }
      var crypto = asArr(map.crypto_wallets);
      var pix = asArr(map.pix_wallets);
      function findNet(net) {
        return crypto.find(function (x) {
          return x.network === net && x.active;
        });
      }
      state.wallets = {
        pixKey: (pix.find(function (x) { return x.active; }) || {}).pix_key || PIX_FALLBACK,
        pixQr: (pix.find(function (x) { return x.active; }) || {}).qr_image || PIX_QR,
        eth: (findNet("ETH") && findNet("ETH").address) || asStr(map.usdt_eth_address),
        sol: (findNet("SOL") && findNet("SOL").address) || asStr(map.usdt_sol_address),
        bnb: (findNet("BNB") && findNet("BNB").address) || asStr(map.usdt_bnb_address),
        ethQr: (findNet("ETH") && findNet("ETH").qr_image) || "",
        solQr: (findNet("SOL") && findNet("SOL").qr_image) || "",
        bnbQr: (findNet("BNB") && findNet("BNB").qr_image) || "",
      };
      state.limits = {
        userMin: Number(map.min_deposit_cents) || 2000,
        userMax: Number(map.max_deposit_cents) || 1000000,
        providerMin: Number(map.min_provider_deposit_cents) || 50000,
        providerMax: Number(map.max_provider_deposit_cents) || 10000000,
      };
    } catch (e) {
      state.wallets = {
        pixKey: PIX_FALLBACK,
        pixQr: PIX_QR,
        eth: "",
        sol: "",
        bnb: "",
        ethQr: "",
        solQr: "",
        bnbQr: "",
      };
    }
  }

  async function loadPending() {
    try {
      var supa = client();
      var sess = await supa.auth.getUser();
      var uid = sess.data && sess.data.user && sess.data.user.id;
      if (!uid) return;
      var res = await supa
        .from("manual_deposits")
        .select("id, amount_cents, network, status, created_at")
        .eq("user_id", uid)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      state.pending = res.data || null;
    } catch (e) {
      state.pending = null;
    }
  }

  function minMax() {
    if (state.dest === "investor") {
      return { min: state.limits.providerMin, max: state.limits.providerMax };
    }
    return { min: state.limits.userMin, max: state.limits.userMax };
  }

  function payAddress() {
    var w = state.wallets || {};
    if (state.network === "PIX") return w.pixKey || PIX_FALLBACK;
    if (state.network === "ETH") return w.eth || "";
    if (state.network === "SOL") return w.sol || "";
    if (state.network === "BNB") return w.bnb || "";
    return "";
  }
  function payQr() {
    var w = state.wallets || {};
    if (state.network === "PIX") return w.pixQr || PIX_QR;
    if (state.network === "ETH") return w.ethQr || "";
    if (state.network === "SOL") return w.solQr || "";
    if (state.network === "BNB") return w.bnbQr || "";
    return "";
  }

  function paint() {
    ensureDom();
    var modal = document.getElementById("v2DepositModal");
    var body = document.getElementById("depBody");
    if (!modal || !body) return;
    modal.classList.toggle("open", state.open);
    modal.setAttribute("aria-hidden", state.open ? "false" : "true");
    if (!state.open) return;

    var html = "";
    if (state.err) html += '<div class="dep-alert bad">' + esc(state.err) + "</div>";
    if (state.ok) html += '<div class="dep-alert ok">' + esc(state.ok) + "</div>";

    if (state.pending && state.step === "destination") {
      html +=
        '<div class="dep-pending">' +
        "<h3>Depósito em análise</h3>" +
        "<p>" +
        money(state.pending.amount_cents) +
        " · " +
        esc(state.pending.network) +
        "</p>" +
        '<span class="dep-badge">Em análise</span>' +
        '<button type="button" class="dep-btn" data-act="close">Entendi</button></div>';
      body.innerHTML = html;
      bind(body);
      return;
    }

    if (state.step === "destination") {
      html +=
        '<div class="dep-center"><h3>Onde deseja <em>depositar?</em></h3>' +
        '<p class="dep-sub">Escolha o destino do seu aporte</p></div>' +
        destBtn("user_balance", "Saldo do Apostador", "Crédito para proteger suas apostas e receber reembolsos.", "lime") +
        destBtn("investor", "Saldo do Provedor", "Aporte como parceiro. Financia proteções e gera retorno.", "emerald") +
        destBtn("desafio", "Desafio ArbiShield", "Crédito exclusivo para desafios, separado do apostador.", "lime");
    } else if (state.step === "instructions") {
      html +=
        '<div class="dep-center"><h3>Como <em>depositar</em></h3>' +
        '<p class="dep-sub">Siga o passo a passo para garantir seu saldo</p></div>' +
        '<ol class="dep-steps">' +
        "<li><strong>1. Digite o valor</strong><span>Informe o montante que deseja carregar na sua conta.</span></li>" +
        "<li><strong>2. Escolha a forma</strong><span>Selecione PIX, Ethereum, Solana ou BNB.</span></li>" +
        "<li><strong>3. Escaneie o código</strong><span>Aponte a câmera para o QR Code ou copie a chave.</span></li>" +
        "<li><strong>4. Envie o comprovante</strong><span>Após pagar, você DEVE enviar o comprovante.</span></li>" +
        "<li><strong>5. Saldo liberado</strong><span>Nossa equipe validará e creditará seu saldo.</span></li>" +
        "</ol>" +
        '<button type="button" class="dep-btn" data-act="to-amount">Entendi, continuar</button>' +
        '<button type="button" class="dep-btn ghost" data-act="back-dest">Voltar</button>';
    } else if (state.step === "amount") {
      var mm = minMax();
      html +=
        '<label class="dep-label">Valor do depósito</label>' +
        '<div class="dep-amount"><span>R$</span>' +
        '<input id="depAmount" type="text" inputmode="numeric" value="' +
        esc(formatReais(state.amountCents)) +
        '" /></div>' +
        '<div class="dep-limits">Mínimo: <b>' +
        money(mm.min) +
        "</b> · Máximo: <b>" +
        money(mm.max) +
        "</b></div>" +
        '<button type="button" class="dep-btn" data-act="to-network">Continuar</button>' +
        '<button type="button" class="dep-btn ghost" data-act="back-instructions">Voltar</button>';
    } else if (state.step === "network") {
      html += '<p class="dep-sub center">Selecione a rede para depósito</p><div class="dep-nets">';
      NETWORKS.forEach(function (n) {
        html +=
          '<button type="button" class="dep-net ' +
          n.tone +
          '" data-net="' +
          n.id +
          '"><span>' +
          esc(n.label) +
          "</span><i>→</i></button>";
      });
      html +=
        '</div><button type="button" class="dep-btn ghost" data-act="back-amount">Voltar</button>';
    } else if (state.step === "payment") {
      var addr = payAddress();
      var qr = payQr();
      html +=
        '<div class="dep-center"><h3>Pague <em>' +
        money(state.amountCents) +
        "</em></h3>" +
        '<p class="dep-sub">' +
        esc(state.network === "PIX" ? "PIX · copie a chave (CNPJ) e pague o valor exato" : state.network + " · copie o endereço e pague o valor exato") +
        "</p></div>";
      if (qr) {
        html += '<div class="dep-qr"><img src="' + esc(qr) + '" alt="QR Code PIX" /></div>';
      }
      html +=
        '<div class="dep-addr"><code id="depAddr">' +
        esc(addr || "Chave/endereço não configurado — use platform_settings") +
        "</code>" +
        '<button type="button" class="dep-btn sm" data-act="copy">' +
        (state.network === "PIX" ? "Copiar chave PIX" : "Copiar") +
        "</button></div>" +
        '<button type="button" class="dep-btn" data-act="paid"' +
        (state.busy ? " disabled" : "") +
        '>Já realizei o pagamento</button>' +
        '<button type="button" class="dep-btn ghost" data-act="back-network">Voltar</button>';
    } else if (state.step === "proof") {
      html +=
        '<div class="dep-center"><h3>Envie o <em>comprovante</em></h3>' +
        '<p class="dep-sub">JPG, PNG ou PDF · máx. 10MB</p></div>' +
        '<label class="dep-file">' +
        '<input id="depFile" type="file" accept="image/*,application/pdf" />' +
        "<span>" +
        (state.file ? esc(state.file.name) : "Selecionar arquivo") +
        "</span></label>";
      if (state.previewUrl) {
        html += '<img class="dep-preview" src="' + esc(state.previewUrl) + '" alt="Prévia" />';
      }
      html +=
        '<button type="button" class="dep-btn" data-act="submit-proof"' +
        (state.busy || !state.file ? " disabled" : "") +
        ">Enviar comprovante</button>";
    } else if (state.step === "success") {
      html +=
        '<div class="dep-success">' +
        "<h3>Comprovante enviado!</h3>" +
        "<p>Seu depósito entrou em análise. O saldo será creditado após validação.</p>" +
        '<button type="button" class="dep-btn" data-act="close">Concluir</button>' +
        '<a class="dep-btn ghost" href="/app-carteira.html">Ver carteira</a></div>';
    }

    body.innerHTML = html;
    bind(body);
  }

  function destBtn(id, title, desc, tone) {
    return (
      '<button type="button" class="dep-dest ' +
      tone +
      '" data-dest="' +
      id +
      '"><strong>' +
      esc(title) +
      "</strong><span>" +
      esc(desc) +
      "</span></button>"
    );
  }

  function bind(root) {
    root.querySelectorAll("[data-dest]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.dest = btn.getAttribute("data-dest");
        state.step = "instructions";
        state.err = "";
        paint();
      });
    });
    root.querySelectorAll("[data-net]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.network = btn.getAttribute("data-net");
        state.step = "payment";
        state.err = "";
        paint();
      });
    });
    var amount = document.getElementById("depAmount");
    if (amount) {
      amount.addEventListener("input", function () {
        state.amountCents = parseReaisToCents(amount.value);
        amount.value = formatReais(state.amountCents);
      });
    }
    var file = document.getElementById("depFile");
    if (file) {
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) {
          flash("Arquivo muito grande. Máximo 10MB.");
          return;
        }
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.file = f;
        state.previewUrl = f.type.indexOf("image/") === 0 ? URL.createObjectURL(f) : null;
        state.err = "";
        paint();
      });
    }
    root.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.getAttribute("data-act");
        if (act === "close") close();
        else if (act === "to-amount") {
          state.step = "amount";
          paint();
        } else if (act === "back-dest") {
          state.step = "destination";
          paint();
        } else if (act === "back-instructions") {
          state.step = "instructions";
          paint();
        } else if (act === "back-amount") {
          state.step = "amount";
          paint();
        } else if (act === "back-network") {
          state.step = "network";
          paint();
        } else if (act === "to-network") {
          var mm = minMax();
          if (state.amountCents < mm.min) {
            flash(
              (state.dest === "investor" ? "Aporte mínimo: " : "Depósito mínimo: ") +
                money(mm.min)
            );
            return;
          }
          if (state.amountCents > mm.max) {
            flash(
              (state.dest === "investor" ? "Aporte máximo: " : "Depósito máximo: ") +
                money(mm.max)
            );
            return;
          }
          state.step = "network";
          state.err = "";
          paint();
        } else if (act === "copy") {
          var addr = payAddress();
          if (!addr) return;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(addr).then(function () {
              flash(
                state.network === "PIX" ? "Chave PIX copiada!" : "Endereço copiado!",
                true
              );
            });
          } else {
            flash("Copie manualmente a chave/endereço.");
          }
        } else if (act === "paid") {
          registerPaid();
        } else if (act === "submit-proof") {
          submitProof();
        }
      });
    });
  }

  async function registerPaid() {
    if (state.busy || !state.network) return;
    state.busy = true;
    state.err = "";
    paint();
    try {
      var supa = client();
      var sess = await supa.auth.getUser();
      var uid = sess.data && sess.data.user && sess.data.user.id;
      if (!uid) throw new Error("Sessão expirada. Faça login novamente.");

      var existing = await supa
        .from("manual_deposits")
        .select("id")
        .eq("user_id", uid)
        .eq("status", "AWAITING_PROOF")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.data && existing.data.id) {
        state.depositId = existing.data.id;
        state.step = "proof";
        flash("Continue de onde parou: envie o comprovante.", true);
        return;
      }

      var ins = await supa
        .from("manual_deposits")
        .insert({
          user_id: uid,
          amount_cents: state.amountCents,
          network: state.network,
          status: "AWAITING_PROOF",
          proof_url: null,
          deposit_type: state.dest || "user_balance",
        })
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      state.depositId = ins.data.id;
      state.step = "proof";
      flash("Pagamento registrado! Agora envie o comprovante.", true);
    } catch (ex) {
      var msg = (ex && ex.message) || "Erro ao registrar pagamento";
      if (String(msg).indexOf("já possui um depósito") >= 0) {
        flash("Você já possui um depósito em análise.");
        await loadPending();
        state.step = "destination";
      } else {
        flash(msg);
      }
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = function () { reject(new Error("Falha ao ler arquivo")); };
      reader.readAsDataURL(file);
    });
  }

  async function uploadProofViaServer(pathHint, file, uid) {
    var tokenRes = await client().auth.getSession();
    var token = tokenRes.data.session && tokenRes.data.session.access_token;
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    var b64 = await fileToBase64(file);
    var payload = {
      depositId: state.depositId || null,
      fileName: file.name || "comprovante.jpg",
      contentType: file.type || "image/jpeg",
      base64: b64,
      amountCents: state.amountCents,
      network: state.network,
      depositType: state.dest || "user_balance",
    };
    var FN_UPLOAD = "a8c4e21f0b7d9e6a5f3c2d1b0a99887766554433221100ffeeddccbbaa997788";
    async function readJson(res) {
      var text = await res.text();
      var data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text.slice(0, 180) }; }
      if (data && data.result != null && data.error == null) data = data.result;
      return data;
    }
    // 1) /_serverFn (já proxyado no nginx → :3101)
    var res = await fetch("/_serverFn/" + FN_UPLOAD, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-arbishield-plain": "1",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ data: payload }),
    });
    var data = await readJson(res);
    if (res.ok && data && data.ok) return data;
    // 2) REST dedicado (se nginx tiver location)
    var res2 = await fetch("/api/arbishield/deposit-proof", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });
    var data2 = await readJson(res2);
    if (res2.ok && data2 && data2.ok) return data2;
    throw new Error(
      (data && data.error) ||
      (data2 && data2.error) ||
      "Falha no upload pelo servidor. Rode o hotfix de depósito na VPS."
    );
  }

  async function submitProof() {
    if (state.busy || !state.file || !state.network) return;
    state.busy = true;
    state.err = "";
    paint();
    try {
      var supa = client();
      var sess = await supa.auth.getUser();
      var uid = sess.data && sess.data.user && sess.data.user.id;
      if (!uid) throw new Error("Sessão expirada. Faça login novamente.");

      var ext = (state.file.name.split(".").pop() || "jpg").toLowerCase();
      var path = uid + "/" + Math.random().toString(36).slice(2) + "." + ext;
      var usedServer = false;
      try {
        var up = await supa.storage.from("deposit-proofs").upload(path, state.file);
        if (up.error) throw up.error;
      } catch (upErr) {
        var umsg = (upErr && upErr.message) || String(upErr);
        if (/bucket not found/i.test(umsg) || /not found/i.test(umsg) || /row-level security/i.test(umsg)) {
          var serverUp = await uploadProofViaServer(path, state.file, uid);
          usedServer = true;
          if (serverUp.depositId) state.depositId = serverUp.depositId;
        } else {
          throw upErr;
        }
      }

      if (!usedServer) {
        if (state.depositId) {
          var upd = await supa
            .from("manual_deposits")
            .update({ proof_url: path, status: "PENDING" })
            .eq("id", state.depositId);
          if (upd.error) throw upd.error;
        } else {
          var ins = await supa.from("manual_deposits").insert({
            user_id: uid,
            amount_cents: state.amountCents,
            network: state.network,
            proof_url: path,
            status: "PENDING",
            deposit_type: state.dest || "user_balance",
          });
          if (ins.error) throw ins.error;
        }
      }
      state.step = "success";
      state.ok = "Comprovante enviado com sucesso!";
      state.err = "";
    } catch (ex) {
      var msg = (ex && ex.message) || "Erro ao enviar comprovante. Tente novamente.";
      if (/bucket not found/i.test(msg)) {
        msg =
          "Bucket deposit-proofs ausente. Rode na VPS: bash <(curl -fsSL \"https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-deposito-comprovante-723d/scripts/vps-hotfix-deposit-proofs.sh?v=2\")";
      }
      flash(msg);
    } finally {
      state.busy = false;
      paint();
    }
  }

  async function open(opts) {
    opts = opts || {};
    ensureDom();
    state.open = true;
    state.step = "destination";
    state.dest = opts.dest || null;
    state.amountCents = 50000;
    state.network = null;
    state.depositId = null;
    state.file = null;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    state.busy = false;
    state.err = "";
    state.ok = "";
    await loadConfig();
    await loadPending();
    if (state.dest) state.step = "instructions";
    paint();
    document.body.classList.add("dep-open");
  }

  function close() {
    state.open = false;
    paint();
    document.body.classList.remove("dep-open");
  }

  function wireTriggers() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-open-deposit], .v2-deposit-btn");
      if (!t) return;
      if (t.tagName === "A" && t.getAttribute("href") && !t.hasAttribute("data-open-deposit")) {
        // convert header deposit link
      }
      if (t.classList.contains("v2-deposit-btn") || t.hasAttribute("data-open-deposit")) {
        e.preventDefault();
        open({ dest: t.getAttribute("data-deposit-dest") || null });
      }
    });
    window.addEventListener("open-deposit", function () {
      open();
    });
  }

  function boot() {
    ensureDom();
    wireTriggers();
    // rewrite header deposit anchors after shell mounts
    var tries = 0;
    var iv = setInterval(function () {
      tries += 1;
      document.querySelectorAll("a.v2-deposit-btn").forEach(function (a) {
        a.setAttribute("href", "#deposito");
        a.setAttribute("data-open-deposit", "1");
      });
      if (tries > 20) clearInterval(iv);
    }, 200);
  }

  global.ArbiV2Deposit = { open: open, close: close };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
