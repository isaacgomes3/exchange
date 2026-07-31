"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ArbiShieldLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined") return "/redefinir-senha.html";
    return `${window.location.origin}/redefinir-senha.html`;
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setOk(null);

    try {
      const supabase = createClient();
      if (forgotMode) {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo }
        );
        if (resetError) {
          setError(resetError.message || "Falha ao enviar recuperação");
          return;
        }
        setOk(
          "Se o e-mail existir, enviamos o link de recuperação. Confira a caixa de entrada e o spam."
        );
        return;
      }

      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signError) {
        const msg = signError.message || "Falha no login";
        setError(
          /failed to fetch|networkerror|fetch failed/i.test(msg)
            ? "Não foi possível falar com o Auth (rede). Confirme que /auth/v1 responde em arbishield.app e rode de novo o deploy Next."
            : msg
        );
        return;
      }

      router.replace("/arbishield/admin");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha no login";
      setError(
        /failed to fetch|networkerror|fetch failed/i.test(msg)
          ? "Não foi possível falar com o Auth (rede). Confirme que /auth/v1 responde em arbishield.app e rode de novo o deploy Next."
          : msg
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="as-form" onSubmit={onSubmit}>
      <label className="as-label">
        E-mail
        <input
          className="as-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      {!forgotMode ? (
        <label className="as-label">
          Senha
          <input
            className="as-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
      ) : null}
      {error && <p className="as-error">{error}</p>}
      {ok && <p className="as-error" style={{ color: "#c9f223" }}>{ok}</p>}
      {!forgotMode ? (
        <button
          type="button"
          className="as-btn"
          style={{ background: "transparent", border: "1px solid currentColor", marginBottom: 8 }}
          onClick={() => {
            setForgotMode(true);
            setError(null);
            setOk(null);
          }}
        >
          Esqueci minha senha
        </button>
      ) : (
        <button
          type="button"
          className="as-btn"
          style={{ background: "transparent", border: "1px solid currentColor", marginBottom: 8 }}
          onClick={() => {
            setForgotMode(false);
            setError(null);
            setOk(null);
          }}
        >
          Voltar ao login
        </button>
      )}
      <button className="as-btn" type="submit" disabled={loading}>
        {loading
          ? forgotMode
            ? "Enviando…"
            : "Entrando…"
          : forgotMode
            ? "Enviar link de recuperação"
            : "Entrar no painel"}
      </button>
    </form>
  );
}
