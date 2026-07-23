"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { V2AdminNav } from "@/components/v2/V2AdminNav";

type UserRow = {
  id: string;
  full_name: string | null;
  email?: string | null;
  account_status: string | null;
  balance_cents: number | null;
  created_at: string | null;
};

function money(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

function norm(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export default function V2AdminUsersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);

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
        const ok =
          !!profile?.is_super_admin ||
          (roles || []).some(
            (r) => r.role === "admin" || r.role === "master_admin"
          );
        if (!ok) {
          setError("Sem permissão administrativa");
          setLoading(false);
          return;
        }

        const { data, error: err } = await supabase
          .from("profiles")
          .select(
            "id,full_name,account_status,balance_cents,created_at"
          )
          .order("created_at", { ascending: false })
          .limit(500);
        if (err) throw err;
        if (!cancelled) setRows((data as UserRow[]) || []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao listar");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filtered = useMemo(() => {
    const needle = norm(qDebounced.trim());
    if (!needle) return rows;
    const parts = needle.split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      const hay = norm([r.full_name, r.id, r.account_status].filter(Boolean).join(" "));
      return parts.every((p) => hay.includes(p));
    });
  }, [rows, qDebounced]);

  return (
    <div className="v2-shell">
      <V2AdminNav />
      <h1>
        Gestão de <span>usuários</span>
      </h1>
      <p className="v2-meta">
        Lista leve · debounce na busca · sem Realtime · máx. 500
      </p>
      {error ? (
        <div className="v2-err show" style={{ display: "block" }}>
          {error}
        </div>
      ) : null}

      <div className="v2-search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar por nome ou ID…"
          autoComplete="off"
        />
        <span>
          {loading ? "…" : `${filtered.length} / ${rows.length}`}
        </span>
      </div>

      <div className="v2-table-wrap">
        <table className="v2-table">
          <thead>
            <tr>
              <th>Perfil</th>
              <th>Status</th>
              <th>Saldo</th>
              <th>Criado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.full_name || "—"}</strong>
                  <small>{r.id.slice(0, 8)}…</small>
                </td>
                <td>{r.account_status || "—"}</td>
                <td>{money(r.balance_cents)}</td>
                <td>
                  {r.created_at
                    ? new Date(r.created_at).toLocaleString("pt-BR")
                    : "—"}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={4}>Nenhum usuário</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
