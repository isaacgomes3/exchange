"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ProfileRow = {
  full_name: string | null;
  balance_cents: number | null;
  account_status: string | null;
};

function money(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

export default function V2AppPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) {
          router.replace("/v2/auth");
          return;
        }
        if (cancelled) return;
        setEmail(user.email ?? null);

        const { data, error: profErr } = await supabase
          .from("profiles")
          .select("full_name,balance_cents,account_status")
          .eq("id", user.id)
          .maybeSingle();
        if (profErr) {
          setError(profErr.message);
        } else {
          setProfile((data as ProfileRow) ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/v2/auth");
  }

  if (loading) {
    return (
      <div className="v2-shell">
        <p className="v2-meta">Carregando sessão…</p>
      </div>
    );
  }

  return (
    <div className="v2-shell">
      <h1>
        Área do <span>membro</span>
      </h1>
      <p className="v2-meta">
        {email || "—"} · banco vivo arbishield.app
      </p>
      {error ? (
        <div className="v2-err show" style={{ display: "block" }}>
          {error}
        </div>
      ) : null}
      <div className="v2-grid">
        <div className="v2-card">
          <strong>Nome</strong>
          <b>{profile?.full_name || "—"}</b>
        </div>
        <div className="v2-card">
          <strong>Saldo</strong>
          <b>{money(profile?.balance_cents)}</b>
        </div>
        <div className="v2-card">
          <strong>Status</strong>
          <b style={{ fontSize: "1.1rem" }}>
            {profile?.account_status || "—"}
          </b>
        </div>
      </div>
      <div className="v2-actions" style={{ marginTop: 28 }}>
        <button type="button" className="v2-btn v2-btn-ghost" onClick={signOut}>
          Sair
        </button>
        <Link href="/v2/admin" className="v2-btn v2-btn-primary">
          Ir ao admin
        </Link>
      </div>
    </div>
  );
}
