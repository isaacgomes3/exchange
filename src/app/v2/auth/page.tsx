"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function V2AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.get("forgot") === "1") setForgotMode(true);
      if (qs.get("reset") === "1") {
        setOk("Senha redefinida com sucesso. Entre com a nova senha.");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined") return "/v2/redefinir-senha";
    return `${window.location.origin}/v2/redefinir-senha`;
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    setLoading(true);
    try {
      const supabase = createClient();
      if (forgotMode) {
        const { error: err } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo }
        );
        if (err) {
          setError(err.message);
          return;
        }
        setOk(
          "Se o e-mail existir, enviamos o link de recuperação. Confira a caixa de entrada e o spam."
        );
        return;
      }
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(err.message);
        return;
      }
      router.replace("/v2/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="v2-panel">
      <div className="v2-brand" style={{ marginBottom: 10, fontSize: 12 }}>
        Arbi<span>Shield</span>
      </div>
      <h1>{forgotMode ? "Esqueci minha senha" : "Entrar"}</h1>
      <p className="sub">
        {forgotMode
          ? "Informe o e-mail da conta para receber o link de redefinição."
          : "Mesmo Auth / mesmo banco de arbishield.app"}
      </p>
      <div className={`v2-err${error ? " show" : ""}`} role="alert">
        {error}
      </div>
      {ok ? (
        <p className="sub" style={{ color: "var(--lime, #c9f223)" }} role="status">
          {ok}
        </p>
      ) : null}
      <form onSubmit={onSubmit}>
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="seu@email.com"
        />
        {!forgotMode ? (
          <>
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              placeholder="••••••••"
            />
            <p className="sub" style={{ marginTop: -4, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setForgotMode(true);
                  setError("");
                  setOk("");
                }}
                style={{
                  background: "none",
                  border: 0,
                  padding: 0,
                  color: "inherit",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Esqueci minha senha
              </button>
            </p>
          </>
        ) : null}
        <button
          type="submit"
          className="v2-btn v2-btn-primary"
          style={{ width: "100%" }}
          disabled={loading}
        >
          {loading
            ? forgotMode
              ? "Enviando…"
              : "Entrando…"
            : forgotMode
              ? "Enviar link de recuperação"
              : "Acessar"}
        </button>
      </form>
      {forgotMode ? (
        <p className="sub" style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={() => {
              setForgotMode(false);
              setError("");
              setOk("");
            }}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              color: "inherit",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Voltar ao login
          </button>
        </p>
      ) : null}
    </div>
  );
}
