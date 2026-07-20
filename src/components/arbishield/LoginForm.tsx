"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ArbiShieldLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("isaacgomes3@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
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
      {error && <p className="as-error">{error}</p>}
      <button className="as-btn" type="submit" disabled={loading}>
        {loading ? "Entrando…" : "Entrar no painel"}
      </button>
    </form>
  );
}
