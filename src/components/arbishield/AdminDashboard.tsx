"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type DashboardData = {
  me: {
    id: string;
    email?: string;
    full_name?: string | null;
    is_super_admin?: boolean;
  };
  stats: {
    profiles: number;
    protections: number;
    pendingDeposits: number;
    pendingWithdrawals: number;
    openTickets: number;
  };
  recentProfiles: Array<{
    id: string;
    full_name: string | null;
    account_status: string | null;
    created_at: string;
    balance_cents: number | null;
    is_super_admin: boolean | null;
  }>;
  approvalQueue: Array<Record<string, unknown>>;
  errors?: Record<string, string | undefined>;
};

function money(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

export function ArbiShieldAdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/arbishield/dashboard", {
        cache: "no-store",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });
      const json = await res.json();
      if (res.status === 401 || res.status === 403) {
        router.replace("/arbishield");
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Erro ao carregar dashboard");
        return;
      }
      setData(json as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/arbishield");
    router.refresh();
  }

  if (loading) {
    return <p className="as-muted">Carregando painel…</p>;
  }

  if (error) {
    return (
      <div className="as-panel">
        <p className="as-error">{error}</p>
        <button className="as-btn" type="button" onClick={() => void load()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!data) return null;

  const stats = [
    { label: "Usuários", value: data.stats.profiles },
    { label: "Proteções", value: data.stats.protections },
    { label: "Depósitos pendentes", value: data.stats.pendingDeposits },
    { label: "Saques pendentes", value: data.stats.pendingWithdrawals },
    { label: "Tickets abertos", value: data.stats.openTickets },
  ];

  return (
    <div className="as-admin">
      <header className="as-admin-head">
        <div>
          <p className="as-kicker">Back-office</p>
          <h1 className="as-title">ArbiShield</h1>
          <p className="as-muted">
            {data.me.full_name || data.me.email}
            {data.me.is_super_admin ? " · super admin" : " · admin"}
          </p>
        </div>
        <div className="as-actions">
          <button className="as-btn as-btn-ghost" type="button" onClick={() => void load()}>
            Atualizar
          </button>
          <button className="as-btn as-btn-ghost" type="button" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>

      <section className="as-stats">
        {stats.map((s) => (
          <article key={s.label} className="as-stat">
            <p className="as-stat-label">{s.label}</p>
            <p className="as-stat-value">{s.value}</p>
          </article>
        ))}
      </section>

      <section className="as-grid">
        <div className="as-panel">
          <h2>Usuários recentes</h2>
          <div className="as-table-wrap">
            <table className="as-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Status</th>
                  <th>Saldo</th>
                  <th>Criado</th>
                </tr>
              </thead>
              <tbody>
                {data.recentProfiles.map((p) => (
                  <tr key={p.id}>
                    <td>{p.full_name || p.id.slice(0, 8)}</td>
                    <td>{p.account_status ?? "—"}</td>
                    <td>{money(p.balance_cents)}</td>
                    <td>{new Date(p.created_at).toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="as-panel">
          <h2>Fila de aprovação</h2>
          {data.approvalQueue.length === 0 ? (
            <p className="as-muted">Nenhum item na fila.</p>
          ) : (
            <ul className="as-list">
              {data.approvalQueue.map((item, idx) => (
                <li key={String(item.id ?? idx)}>
                  <code>{JSON.stringify(item)}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
