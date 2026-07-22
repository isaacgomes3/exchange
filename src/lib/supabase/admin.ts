import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isSupabasePersistenceEnabled,
} from "@/lib/supabase/config";

let adminClient: SupabaseClient | null = null;

/**
 * Cliente server-side para persistência (preferência: service role).
 * Sem service role, usa a anon key — depende das políticas RLS.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabasePersistenceEnabled()) return null;

  if (adminClient) return adminClient;

  const url = getSupabaseUrl()!;
  const key = getSupabaseServiceRoleKey() || getSupabaseAnonKey()!;

  adminClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return adminClient;
}
