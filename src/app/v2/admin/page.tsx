"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { V2AdminNav } from "@/components/v2/V2AdminNav";

type Stats = {
  profiles: number | null;
  openMatches: number | null;
  activeProtections: number | null;
};

export default function V2AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    profiles: null,
    openMatches: null,
    activeProtections: null,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace("/v2/auth");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("is_super_admin")
          .eq("id", user.id)
          .maybeSingle();

        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        const admin =
          !!profile?.is_super_admin ||
          (roles || []).some(
            (r) => r.role === "admin" || r.role === "master_admin"
          );
        if (!admin) {
          setError("Sem permissão administrativa");
          setLoading(false);
          return;
        }
        if (cancelled) return;
        setIsAdmin(true);

        const [p, m, pr] = await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase
            .from("matches")
            .select("id", { count: "exact", head: true })
            .eq("status", "open"),
          supabase
            .from("protections")
            .select("id", { count: "exact", head: true })
            .eq("status", "active"),
        ]);

        if (cancelled) return;
        setStats({
          profiles: p.count,
          openMatches: m.count,
          activeProtections: pr.count,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar admin");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="v2-shell">
        <V2AdminNav />
        <p className="v2-meta">Validando permissão…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="v2-shell">
        <h1>
          Acesso <span>negado</span>
        </h1>
        <p className="v2-meta">{error || "Sem permissão"}</p>
        <Link href="/v2/app" className="v2-btn v2-btn-ghost">
          Voltar ao app
        </Link>
      </div>
    );
  }

  return (
    <div className="v2-shell">
      <V2AdminNav />
      <h1>
        Admin <span>v2</span>
      </h1>
      <p className="v2-meta">
        Hub limpo · mesmo Postgres · sem Realtime flood do SPA
      </p>
      {error ? (
        <div className="v2-err show" style={{ display: "block" }}>
          {error}
        </div>
      ) : null}
      <div className="v2-grid">
        <div className="v2-card">
          <strong>Perfis</strong>
          <b>{stats.profiles ?? "—"}</b>
        </div>
        <div className="v2-card">
          <strong>Jogos abertos</strong>
          <b>{stats.openMatches ?? "—"}</b>
        </div>
        <div className="v2-card">
          <strong>Proteções ativas</strong>
          <b>{stats.activeProtections ?? "—"}</b>
        </div>
      </div>
      <div className="v2-actions" style={{ marginTop: 28 }}>
        <Link href="/v2/admin/users" className="v2-btn v2-btn-primary">
          Usuários
        </Link>
        <Link href="/v2/admin/jogos" className="v2-btn v2-btn-ghost">
          Gestão de Jogos
        </Link>
      </div>
    </div>
  );
}
