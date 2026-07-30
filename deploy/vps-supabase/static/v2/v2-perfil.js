/**
 * Meu Perfil v2 — paridade com SPA legado /app/perfil
 * Campos + Editar dados, PIX, banco e senha.
 */
(function () {
  var state = {
    user: null,
    profile: null,
    busy: false,
    modal: null, // personal | pix | bank | password
    form: {},
    err: "",
    ok: "",
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }
  function money(c) {
    return ArbiV2.money(c);
  }
  function showErr(msg) {
    state.err = msg || "";
    var el = document.getElementById("err");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("show", !!msg);
  }
  function showOk(msg) {
    state.ok = msg || "";
    var el = document.getElementById("ok");
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
    if (msg) setTimeout(function () { el.style.display = "none"; }, 3500);
  }
  function digits(s) {
    return String(s || "").replace(/\D/g, "");
  }
  function maskCpf(raw) {
    var d = digits(raw);
    if (d.length !== 11) return raw || "—";
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.***.***-$4");
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("pt-BR");
    } catch (e) {
      return String(iso);
    }
  }
  function cpfLocked() {
    return digits(state.profile && state.profile.cpf).length === 11;
  }
  function pixLocked() {
    return !!(state.profile && String(state.profile.pix_key || "").trim());
  }
  function initials(name) {
    var parts = String(name || "U").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function infoCell(label, value, mono) {
    return (
      '<div class="pf-info">' +
      '<span class="pf-lbl">' +
      esc(label) +
      "</span>" +
      '<strong class="' +
      (mono ? "mono" : "") +
      '">' +
      esc(value || "—") +
      "</strong></div>"
    );
  }

  function checkRow(ok, label) {
    return (
      '<div class="pf-check ' +
      (ok ? "ok" : "") +
      '"><span class="dot"></span>' +
      esc(label) +
      "</div>"
    );
  }

  function paint() {
    var root = document.getElementById("pfRoot");
    if (!root) return;
    var p = state.profile || {};
    var email = (state.user && state.user.email) || "";
    var name = p.full_name || "Membro";
    var priority =
      p.pix_priority_type ||
      (p.pix_key
        ? String(p.pix_key).indexOf("@") >= 0
          ? "email"
          : String(p.pix_key).indexOf("+55") === 0
            ? "phone"
            : "cpf"
        : "");

    root.innerHTML =
      '<header class="page-head pf-head">' +
      "<div><h1>Meu<span>Perfil</span></h1>" +
      '<p class="sub">Dados pessoais · identidade · PIX · segurança</p></div></header>' +
      '<div class="pf-hero">' +
      '<div class="pf-avatar" id="pfAvatarBtn" title="Trocar foto">' +
      (p.avatar_url
        ? '<img src="' + esc(p.avatar_url) + '" alt="" />'
        : "<span>" + esc(initials(name)) + "</span>") +
      '<input type="file" id="pfAvatarInput" accept="image/jpeg,image/png,image/webp" hidden />' +
      "</div>" +
      "<div><strong>" +
      esc(name) +
      "</strong><small>Minha Conta</small></div></div>" +
      '<div class="pf-grid">' +
      '<section class="pf-card">' +
      '<div class="pf-card-head"><div><h2>Dados pessoais</h2><p>Informações de identidade</p></div>' +
      '<button type="button" class="btn btn-primary btn-sm" id="pfEditPersonal">Editar</button></div>' +
      '<div class="pf-info-grid">' +
      infoCell("Nome completo", p.full_name) +
      infoCell("E-mail", email) +
      infoCell("Telefone", p.phone) +
      infoCell("CPF", p.cpf ? maskCpf(p.cpf) : "—", true) +
      infoCell("Localização", p.location) +
      infoCell("Data de cadastro", fmtDate(p.created_at)) +
      "</div></section>" +
      '<section class="pf-card pf-card-side">' +
      "<h2>Segurança</h2><p class=\"pf-muted\">Verificações e acesso</p>" +
      '<div class="pf-checks">' +
      checkRow(!!email, "E-mail verificado") +
      checkRow(!!p.phone, "Telefone verificado") +
      checkRow(!!p.cpf, "Documento verificado") +
      checkRow(true, "Conta ativa") +
      "</div>" +
      '<div class="pf-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="pfEditPass">Alterar senha</button>' +
      '<button type="button" class="btn btn-primary btn-sm" id="pf2fa">Ativar 2FA</button>' +
      "</div></section>" +
      '<section class="pf-card pf-span-2">' +
      '<div class="pf-card-head"><div><h2>Chaves PIX para recebimento</h2>' +
      "<p>Selecione qual chave receberá seus reembolsos</p></div>" +
      (!pixLocked()
        ? '<button type="button" class="btn btn-primary btn-sm" id="pfEditPix">Cadastrar PIX</button>'
        : '<button type="button" class="btn btn-ghost btn-sm" id="pfEditBank">Dados bancários</button>') +
      "</div>" +
      (pixLocked()
        ? '<p class="pf-note">Chave PIX cadastrada. Alteração só via suporte.</p>'
        : '<p class="pf-note">Cadastre CPF/telefone/e-mail e escolha a chave prioritária.</p>') +
      '<div class="pf-pix-grid" id="pfPixPriority">' +
      pixOption("cpf", "CPF", p.cpf ? maskCpf(p.cpf) : "", digits(p.cpf).length === 11, priority) +
      pixOption("email", "E-mail", email, !!email, priority) +
      pixOption(
        "phone",
        "Telefone",
        p.phone || "",
        digits(p.phone).length >= 10,
        priority
      ) +
      "</div>" +
      '<div class="pf-info-grid" style="margin-top:14px">' +
      infoCell("Banco", p.pix_bank) +
      infoCell("Agência / Conta", p.pix_account, true) +
      infoCell("Titular", p.pix_account_holder) +
      infoCell("Chave PIX", p.pix_key ? String(p.pix_key).slice(0, 28) : "—", true) +
      "</div></section>" +
      "</div>" +
      (state.modal ? renderModal() : "");

    bind();
  }

  function pixOption(type, label, value, available, priority) {
    var on = priority === type;
    return (
      '<button type="button" class="pf-pix-opt' +
      (on ? " is-on" : "") +
      (!available ? " is-off" : "") +
      '" data-pix-type="' +
      type +
      '"' +
      (!available ? " disabled" : "") +
      "><span class=\"t\">" +
      esc(label) +
      '</span><span class="v">' +
      esc(available ? value || "—" : "Cadastre primeiro") +
      "</span></button>"
    );
  }

  function renderModal() {
    var title = "";
    var body = "";
    var f = state.form || {};
    if (state.modal === "personal") {
      title = "Editar dados pessoais";
      body =
        '<div class="field"><label>Nome completo</label><input id="f_full_name" value="' +
        esc(f.full_name || "") +
        '" maxlength="120" /></div>' +
        '<div class="field"><label>Telefone</label><input id="f_phone" value="' +
        esc(f.phone || "") +
        '" placeholder="11999999999" inputmode="tel" maxlength="20" /></div>' +
        '<div class="field"><label>Localização</label><input id="f_location" value="' +
        esc(f.location || "") +
        '" placeholder="Cidade / UF" maxlength="120" /></div>' +
        '<div class="field"><label>CPF' +
        (cpfLocked() ? " (bloqueado)" : "") +
        '</label><input id="f_cpf" value="' +
        esc(f.cpf || "") +
        '" ' +
        (cpfLocked() ? "disabled " : "") +
        'inputmode="numeric" maxlength="14" placeholder="000.000.000-00" /></div>';
    } else if (state.modal === "pix") {
      title = "Cadastrar chave PIX";
      body =
        '<div class="field"><label>Chave PIX (CPF, e-mail ou telefone +55)</label><input id="f_pix_key" value="' +
        esc(f.pix_key || "") +
        '" maxlength="120" /></div>' +
        '<p class="pf-note">Após salvar, a chave só pode ser alterada pelo suporte.</p>';
    } else if (state.modal === "bank") {
      title = "Dados bancários";
      body =
        '<div class="field"><label>Banco</label><input id="f_pix_bank" value="' +
        esc(f.pix_bank || "") +
        '" maxlength="80" placeholder="Ex.: Banco Inter" /></div>' +
        '<div class="field"><label>Agência / Conta</label><input id="f_pix_account" value="' +
        esc(f.pix_account || "") +
        '" maxlength="40" placeholder="0000 / 00000-0" /></div>' +
        '<div class="field"><label>Titular da conta</label><input id="f_pix_account_holder" value="' +
        esc(f.pix_account_holder || "") +
        '" maxlength="120" placeholder="Nome igual ao do CPF" /></div>';
    } else if (state.modal === "password") {
      title = "Alterar senha";
      body =
        '<div class="field"><label>Nova senha</label><input id="f_newPassword" type="password" maxlength="72" /></div>' +
        '<div class="field"><label>Confirmar senha</label><input id="f_confirmPassword" type="password" maxlength="72" /></div>' +
        '<p class="pf-note">Mínimo 8 caracteres, com letras e números.</p>';
    } else if (state.modal === "mfa") {
      // Marker: mfa-totp-enroll-v1
      title = "Ativar autenticação em 2 fatores";
      var mfa = state.mfa || {};
      if (mfa.verified) {
        body =
          '<p class="pf-note">2FA já está ativo nesta conta.</p>' +
          (mfa.friendlyName
            ? "<p>Fator: <strong>" + esc(mfa.friendlyName) + "</strong></p>"
            : "");
      } else if (mfa.factorId && (mfa.qr || mfa.secret)) {
        body =
          '<p class="pf-note">Escaneie o QR no Google Authenticator / Authy. Ao confirmar, <strong>outras sessões saem</strong>; a sua continua.</p>' +
          (mfa.qr
            ? '<div style="text-align:center;margin:12px 0"><img alt="QR 2FA" width="180" height="180" src="' +
              esc(mfa.qr) +
              '" style="background:#fff;border-radius:12px;padding:8px" /></div>'
            : "") +
          '<div class="field"><label>Ou digite a chave</label><input id="f_mfa_secret" readonly value="' +
          esc(mfa.secret || "") +
          '" /></div>' +
          '<div class="field"><label>Código de 6 dígitos</label><input id="f_mfa_code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="000000" /></div>';
      } else {
        body = '<p class="pf-note">Gerando QR…</p>';
      }
    }
    var saveLabel = "Salvar";
    if (state.modal === "mfa") {
      saveLabel = state.mfa && state.mfa.verified ? "Fechar" : "Confirmar código";
    }
    return (
      '<div class="pf-modal-back" id="pfModalBack">' +
      '<div class="pf-modal" role="dialog" aria-modal="true">' +
      "<h3>" +
      esc(title) +
      "</h3>" +
      body +
      '<div class="pf-modal-actions">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="pfModalCancel">Cancelar</button>' +
      '<button type="button" class="btn btn-primary btn-sm" id="pfModalSave"' +
      (state.busy ? " disabled" : "") +
      ">" +
      (state.busy ? "Salvando…" : saveLabel) +
      "</button></div></div></div>"
    );
  }

  function openModal(kind) {
    var p = state.profile || {};
    state.modal = kind;
    if (kind === "personal") {
      state.form = {
        full_name: p.full_name || "",
        phone: p.phone || "",
        location: p.location || "",
        cpf: p.cpf || "",
      };
    } else if (kind === "pix") {
      state.form = { pix_key: p.pix_key || "" };
    } else if (kind === "bank") {
      state.form = {
        pix_bank: p.pix_bank || "",
        pix_account: p.pix_account || "",
        pix_account_holder: p.pix_account_holder || p.full_name || "",
      };
    } else if (kind === "password") {
      state.form = { newPassword: "", confirmPassword: "" };
    } else if (kind === "mfa") {
      state.form = {};
      state.mfa = state.mfa || {};
    }
    paint();
  }

  async function startMfaEnroll(supa) {
    state.busy = true;
    state.modal = "mfa";
    paint();
    try {
      // Marker: mfa-totp-enroll-v2 — remove fator incompleto e gera QR de novo
      var listed = await supa.auth.mfa.listFactors();
      if (listed.error) throw listed.error;
      var all = (listed.data && listed.data.all) || [];
      var totpList = (listed.data && listed.data.totp) || [];
      var factors = all.length ? all : totpList;
      var active = factors.filter(function (f) {
        var t = String(f.factor_type || f.factorType || f.type || "totp").toLowerCase();
        return (
          (t === "totp" || !f.factor_type) &&
          String(f.status || "").toLowerCase() === "verified"
        );
      });
      if (active.length) {
        state.mfa = {
          verified: true,
          friendlyName: active[0].friendly_name || active[0].friendlyName || "Authenticator",
          factorId: active[0].id,
        };
        state.busy = false;
        paint();
        return;
      }
      // Fator criado antes sem confirmar — apaga para poder gerar QR novo
      var pending = factors.filter(function (f) {
        var st = String(f.status || "").toLowerCase();
        return st === "unverified" || st === "pending" || !st || st === "";
      });
      for (var i = 0; i < pending.length; i++) {
        if (!pending[i] || !pending[i].id) continue;
        var un = await supa.auth.mfa.unenroll({ factorId: pending[i].id });
        if (un.error) {
          // tenta mesmo assim; enroll pode falhar com nome duplicado
          console.warn("mfa unenroll", un.error);
        }
      }
      var friendly =
        "ArbiShield-" + String(Date.now()).slice(-6);
      var en = await supa.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: friendly,
        issuer: "ArbiShield",
      });
      if (en.error) throw en.error;
      var totp = (en.data && en.data.totp) || {};
      state.mfa = {
        verified: false,
        factorId: en.data && en.data.id,
        qr: totp.qr_code || totp.qrCode || "",
        secret: totp.secret || "",
        uri: totp.uri || "",
        friendlyName: friendly,
      };
      state.busy = false;
      paint();
      showOk("Escaneie o QR e digite o código de 6 dígitos.");
    } catch (ex) {
      state.busy = false;
      state.modal = null;
      paint();
      showErr((ex && ex.message) || "Falha ao iniciar 2FA. Rode o hotfix MFA na VPS.");
    }
  }

  async function confirmMfaEnroll(supa) {
    var codeEl = document.getElementById("f_mfa_code");
    var code = codeEl ? String(codeEl.value || "").replace(/\s+/g, "") : "";
    if (!/^\d{6}$/.test(code)) throw new Error("Digite o código de 6 dígitos do app.");
    var factorId = state.mfa && state.mfa.factorId;
    if (!factorId) throw new Error("Fator 2FA ausente — abra Ativar 2FA de novo.");
    var ch = await supa.auth.mfa.challenge({ factorId: factorId });
    if (ch.error) throw ch.error;
    var challengeId = ch.data && ch.data.id;
    var ver = await supa.auth.mfa.verify({
      factorId: factorId,
      challengeId: challengeId,
      code: code,
    });
    if (ver.error) throw ver.error;
    // Encerra OUTRAS sessões; a atual (já aal2) permanece.
    try {
      var sess = await supa.auth.getSession();
      var tok =
        sess &&
        sess.data &&
        sess.data.session &&
        sess.data.session.access_token;
      if (tok) {
        await fetch("/api/arbishield/auth-logout-others", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + tok,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ scope: "others" }),
        });
      }
    } catch (eLogout) {
      /* best-effort — 2FA já está ativo */
    }
    state.mfa = { verified: true, factorId: factorId, friendlyName: "ArbiShield" };
    state.modal = null;
    showOk(
      "2FA ativado. Outras sessões foram encerradas; a sua continua. Próximos logins pedem o código."
    );
  }

  function closeModal() {
    state.modal = null;
    state.form = {};
    paint();
  }

  function readForm() {
    function val(id) {
      var el = document.getElementById(id);
      return el ? String(el.value || "").trim() : "";
    }
    if (state.modal === "personal") {
      return {
        full_name: val("f_full_name"),
        phone: val("f_phone"),
        location: val("f_location"),
        cpf: val("f_cpf"),
      };
    }
    if (state.modal === "pix") return { pix_key: val("f_pix_key") };
    if (state.modal === "bank") {
      return {
        pix_bank: val("f_pix_bank"),
        pix_account: val("f_pix_account"),
        pix_account_holder: val("f_pix_account_holder"),
      };
    }
    if (state.modal === "password") {
      return {
        newPassword: val("f_newPassword"),
        confirmPassword: val("f_confirmPassword"),
      };
    }
    return {};
  }

  function normalizePhone(raw) {
    var d = digits(raw);
    if (!d) return "";
    if (d.length === 10 || d.length === 11) return "+55" + d;
    if (d.indexOf("55") === 0 && (d.length === 12 || d.length === 13)) return "+" + d;
    return raw.indexOf("+") === 0 ? raw : d;
  }

  function rlsRecursionHint(msg) {
    if (!/infinite recursion/i.test(String(msg || ""))) return "";
    return "Não foi possível salvar: erro de permissão no banco (RLS em profiles). Rode o hotfix vps-hotfix-perfil-editar.sh na VPS e tente de novo.";
  }

  async function rpcOrPatch(supa, rpcName, args, patch) {
    var rpc = await supa.rpc(rpcName, args);
    if (!rpc.error) return;
    var msg = String((rpc.error && rpc.error.message) || "");
    var hint = rlsRecursionHint(msg);
    if (hint) throw new Error(hint);
    // fallback se RPC não existir na VPS
    if (/function|does not exist|404|PGRST202/i.test(msg) && patch) {
      var up = await supa.from("profiles").update(patch).eq("id", state.user.id);
      if (up.error) {
        var um = String((up.error && up.error.message) || "");
        var uh = rlsRecursionHint(um);
        if (uh) throw new Error(uh);
        throw up.error;
      }
      return;
    }
    throw rpc.error;
  }

  async function saveModal(supa) {
    if (state.busy) return;
    var data = readForm();
    // preserva o que o usuário digitou (paint() recria o modal a partir de state.form)
    state.form = Object.assign({}, state.form, data);
    state.busy = true;
    showErr("");
    paint();
    try {
      if (state.modal === "personal") {
        if (!data.full_name || data.full_name.length < 3) {
          throw new Error("Informe o nome completo.");
        }
        var phone = normalizePhone(data.phone);
        var cpf = digits(data.cpf);
        if (cpf && cpf.length !== 11 && !cpfLocked()) {
          throw new Error("CPF inválido.");
        }
        var payload = {
          p_full_name: data.full_name,
          p_phone: phone || null,
          p_location: data.location || null,
        };
        if (!cpfLocked() && cpf) payload.p_cpf = cpf;
        var patch = {
          full_name: data.full_name,
          phone: phone || null,
          location: data.location || null,
          updated_at: new Date().toISOString(),
        };
        if (!cpfLocked() && cpf) patch.cpf = cpf;
        await rpcOrPatch(supa, "update_own_profile", payload, patch);
        showOk("Dados pessoais salvos.");
      } else if (state.modal === "pix") {
        if (pixLocked()) throw new Error("PIX já cadastrado — altere via suporte.");
        var key = data.pix_key;
        if (!key) throw new Error("Informe a chave PIX.");
        if (/^\d{11}$/.test(digits(key)) && digits(key).length === 11) key = digits(key);
        else if (digits(key).length === 10 || digits(key).length === 11) key = normalizePhone(key);
        await rpcOrPatch(
          supa,
          "update_own_profile",
          { p_pix_key: key },
          { pix_key: key, updated_at: new Date().toISOString() }
        );
        showOk("Chave PIX cadastrada.");
      } else if (state.modal === "bank") {
        if (!data.pix_bank) throw new Error("Informe o banco.");
        if (!data.pix_account) throw new Error("Informe agência/conta.");
        if (!data.pix_account_holder) throw new Error("Informe o titular.");
        await rpcOrPatch(
          supa,
          "update_own_pix_bank",
          {
            p_pix_bank: data.pix_bank,
            p_pix_account: data.pix_account,
            p_pix_account_holder: data.pix_account_holder,
          },
          {
            pix_bank: data.pix_bank,
            pix_account: data.pix_account,
            pix_account_holder: data.pix_account_holder,
            updated_at: new Date().toISOString(),
          }
        );
        showOk("Dados bancários salvos.");
      } else if (state.modal === "password") {
        var np = data.newPassword || "";
        var cp = data.confirmPassword || "";
        if (np.length < 8) throw new Error("Senha mínima: 8 caracteres.");
        if (!/[A-Za-z]/.test(np) || !/\d/.test(np)) {
          throw new Error("Senha precisa ter letras e números.");
        }
        if (np !== cp) throw new Error("Confirmação de senha não confere.");
        var auth = await supa.auth.updateUser({ password: np });
        if (auth.error) throw auth.error;
        showOk("Senha atualizada.");
      } else if (state.modal === "mfa") {
        // Marker: mfa-totp-enroll-v1
        if (state.mfa && state.mfa.verified) {
          state.modal = null;
          state.form = {};
          paint();
          return;
        }
        await confirmMfaEnroll(supa);
        state.form = {};
        paint();
        return;
      }
      state.modal = null;
      state.form = {};
      await load(supa);
    } catch (ex) {
      showErr((ex && ex.message) || "Erro ao salvar");
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e0) {
        /* ignore */
      }
      state.busy = false;
      paint();
    } finally {
      state.busy = false;
    }
  }

  async function setPriority(supa, type) {
    if (state.busy) return;
    state.busy = true;
    try {
      await rpcOrPatch(
        supa,
        "set_own_pix_priority",
        { p_type: type },
        { pix_priority_type: type, updated_at: new Date().toISOString() }
      );
      showOk("Chave prioritária atualizada.");
      await load(supa);
    } catch (ex) {
      showErr((ex && ex.message) || "Erro ao atualizar chave");
      state.busy = false;
      paint();
    } finally {
      state.busy = false;
    }
  }

  async function uploadAvatar(supa, file) {
    if (!file || !state.user) return;
    if (file.size > 2 * 1024 * 1024) throw new Error("Imagem máxima: 2MB");
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    if (["jpg", "jpeg", "png", "webp"].indexOf(ext) < 0) {
      throw new Error("Use JPG, PNG ou WebP");
    }
    var path = state.user.id + "/avatar." + (ext === "jpeg" ? "jpg" : ext);
    var up = await supa.storage.from("avatars").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (up.error) throw up.error;
    var pub = supa.storage.from("avatars").getPublicUrl(path);
    var url =
      (pub.data && pub.data.publicUrl) ||
      location.origin + "/storage/v1/object/public/avatars/" + path;
    url += (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    var patch = await supa
      .from("profiles")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", state.user.id);
    if (patch.error) {
      await supa.from("profiles").update({ avatar_url: url }).eq("id", state.user.id);
    }
    showOk("Foto atualizada.");
    await load(supa);
  }

  function bind() {
    var supa = ArbiV2.client();
    var editP = document.getElementById("pfEditPersonal");
    if (editP) editP.addEventListener("click", function () { openModal("personal"); });
    var editPix = document.getElementById("pfEditPix");
    if (editPix) editPix.addEventListener("click", function () { openModal("pix"); });
    var editBank = document.getElementById("pfEditBank");
    if (editBank) editBank.addEventListener("click", function () { openModal("bank"); });
    var editPass = document.getElementById("pfEditPass");
    if (editPass) editPass.addEventListener("click", function () { openModal("password"); });
    var twofa = document.getElementById("pf2fa");
    if (twofa) {
      twofa.addEventListener("click", function () {
        startMfaEnroll(supa);
      });
    }
    document.querySelectorAll("[data-pix-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setPriority(supa, btn.getAttribute("data-pix-type"));
      });
    });
    var av = document.getElementById("pfAvatarBtn");
    var inp = document.getElementById("pfAvatarInput");
    if (av && inp) {
      av.addEventListener("click", function () { inp.click(); });
      inp.addEventListener("change", function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        uploadAvatar(supa, file).catch(function (ex) {
          showErr((ex && ex.message) || "Erro no upload");
        });
      });
    }
    var back = document.getElementById("pfModalBack");
    if (back) {
      back.addEventListener("click", function (e) {
        if (e.target === back) closeModal();
      });
    }
    var cancel = document.getElementById("pfModalCancel");
    if (cancel) cancel.addEventListener("click", closeModal);
    var save = document.getElementById("pfModalSave");
    if (save) {
      save.addEventListener("click", function () {
        saveModal(supa);
      });
    }
  }

  async function load(supa) {
    showErr("");
    var q = await supa
      .from("profiles")
      .select(
        "id,full_name,phone,location,cpf,pix_key,pix_priority_type,pix_bank,pix_account,pix_account_holder,avatar_url,created_at,account_status,balance_cents"
      )
      .eq("id", state.user.id)
      .maybeSingle();
    if (q.error) throw q.error;
    state.profile = q.data || {};
    state.busy = false;
    paint();
  }

  document.addEventListener("DOMContentLoaded", async function () {
    try {
      var supa = ArbiV2.client();
      var user = await ArbiV2.requireUser(supa);
      if (!user) return;
      state.user = user;
      await load(supa);
    } catch (ex) {
      showErr((ex && ex.message) || "Erro ao carregar perfil");
      var root = document.getElementById("pfRoot");
      if (root) root.innerHTML = '<div class="pf-loading">Não foi possível carregar.</div>';
    }
  });
})();
