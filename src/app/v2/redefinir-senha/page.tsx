"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function V2RedefinirSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setReady(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled) return;
      const again = await supabase.auth.getSession();
      if (again.data.session) setReady(true);
      else {
        setError(
          "Abra o link do e-mail de recuperação (válido por tempo limitado) ou solicite um novo em Esqueci minha senha."
        );
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
        setError("");
      }
    });

    void boot();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError("");
    setOk("");
    setLoading(true);
    try {
      if (password.length < 8) throw new Error("Senha mínima: 8 caracteres.");
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new Error("Senha precisa ter letras e números.");
      }
      if (password !== confirm) throw new Error("Confirmação de senha não confere.");
      const supabase = createClient();
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setOk("Senha atualizada. Redirecionando para o login…");
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        router.replace("/v2/auth?reset=1");
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao redefinir senha");
      setLoading(false);
    }
  }

  return (
    <div className="v2-panel">
      <div className="v2-brand" style={{ marginBottom: 10, fontSize: 12 }}>
        Arbi<span>Shield</span>
      </div>
      <h1>Redefinir senha</h1>
      <p className="sub">
        {ready
          ? "Defina a nova senha da sua conta"
          : "Aguarde a validação do link…"}
      </p>
      <div className={`v2-err${error ? " show" : ""}`} role="alert">
        {error}
      </div>
      {ok ? (
        <p className="sub" style={{ color: "var(--lime, #c9f223)" }} role="status">
          {ok}
        </p>
      ) : null}
      {ready && !ok ? (
        <form onSubmit={onSubmit}>
          <p className="sub">Mínimo 8 caracteres, com letras e números.</p>
          <label htmlFor="password">Nova senha</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
          />
          <label htmlFor="confirm">Confirmar senha</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={confirm}
            onChange={(ev) => setConfirm(ev.target.value)}
          />
          <button
            type="submit"
            className="v2-btn v2-btn-primary"
            style={{ width: "100%" }}
            disabled={loading}
          >
            {loading ? "Salvando…" : "Salvar nova senha"}
          </button>
        </form>
      ) : null}
      <p className="sub" style={{ marginTop: 14 }}>
        <a href="/v2/auth">Voltar ao login</a>
      </p>
    </div>
  );
}
