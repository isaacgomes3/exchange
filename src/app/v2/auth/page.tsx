"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isBlockedEmail } from "@/lib/arbishield/blocked-emails";

export default function V2AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isBlockedEmail(email)) {
        setError("Esta conta está bloqueada. Contate o suporte.");
        return;
      }
      const supabase = createClient();
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(
          /banned/i.test(err.message)
            ? "Esta conta está bloqueada. Contate o suporte."
            : err.message
        );
        return;
      }
      if (isBlockedEmail(data.user?.email)) {
        await supabase.auth.signOut();
        setError("Esta conta está bloqueada. Contate o suporte.");
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
      <h1>Entrar</h1>
      <p className="sub">Mesmo Auth / mesmo banco de arbishield.app</p>
      <div className={`v2-err${error ? " show" : ""}`} role="alert">
        {error}
      </div>
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
        <button
          type="submit"
          className="v2-btn v2-btn-primary"
          style={{ width: "100%" }}
          disabled={loading}
        >
          {loading ? "Entrando…" : "Acessar"}
        </button>
      </form>
    </div>
  );
}
