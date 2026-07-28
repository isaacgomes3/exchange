import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
} from "@/lib/supabase/config";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type GateOk = {
  user: User;
  profile: {
    id: string;
    full_name: string | null;
    is_super_admin: boolean | null;
    account_status: string | null;
  } | null;
  admin: SupabaseClient;
};

async function resolveUser(request: Request): Promise<User | null> {
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (bearer) {
    const url = getSupabaseUrl();
    const anon = getSupabaseAnonKey();
    if (!url || !anon) return null;
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(bearer);
    if (!error && data.user) return data.user;
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

async function requireAdmin(request: Request): Promise<GateOk | NextResponse> {
  const user = await resolveUser(request);

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Supabase admin indisponível" }, { status: 503 });
  }

  const [{ data: roles }, { data: profile }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", user.id),
    admin
      .from("profiles")
      .select("id,full_name,is_super_admin,account_status")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const isAdmin =
    Boolean(profile?.is_super_admin) ||
    (roles ?? []).some((r) => r.role === "admin" || r.role === "master_admin");

  if (!isAdmin) {
    return NextResponse.json({ error: "Sem permissão admin" }, { status: 403 });
  }

  return { user, profile, admin };
}

export async function GET(request: Request) {
  const gate = await requireAdmin(request);
  if (gate instanceof NextResponse) return gate;

  const { user, profile, admin } = gate;

  const [
    profilesCount,
    protectionsCount,
    pendingDeposits,
    pendingWithdrawals,
    openTickets,
    recentProfiles,
    approvalQueue,
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("protections").select("id", { count: "exact", head: true }),
    admin
      .from("manual_deposits")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("withdrawals")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "pending", "in_progress"]),
    admin
      .from("profiles")
      .select("id,full_name,account_status,created_at,balance_cents,is_super_admin")
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("admin_approval_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  return NextResponse.json({
    me: {
      id: user.id,
      email: user.email,
      full_name: profile?.full_name,
      is_super_admin: profile?.is_super_admin,
    },
    stats: {
      profiles: profilesCount.count ?? 0,
      protections: protectionsCount.count ?? 0,
      pendingDeposits: pendingDeposits.count ?? 0,
      pendingWithdrawals: pendingWithdrawals.count ?? 0,
      openTickets: openTickets.count ?? 0,
    },
    recentProfiles: recentProfiles.data ?? [],
    approvalQueue: approvalQueue.data ?? [],
    errors: {
      profiles: profilesCount.error?.message,
      protections: protectionsCount.error?.message,
      deposits: pendingDeposits.error?.message,
      withdrawals: pendingWithdrawals.error?.message,
      tickets: openTickets.error?.message,
      recent: recentProfiles.error?.message,
      queue: approvalQueue.error?.message,
    },
  });
}
