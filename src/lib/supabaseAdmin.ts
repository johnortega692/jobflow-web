import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

function readSupabaseUrl(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) {
    return String(import.meta.env.VITE_SUPABASE_URL).trim();
  }
  return (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
}

function readServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(readSupabaseUrl() && readServiceRoleKey());
}

let cached: SupabaseClient<Database> | null = null;

/** Service-role client for server cron jobs only. Never expose the key to the browser. */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  const url = readSupabaseUrl();
  const key = readServiceRoleKey();
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL for tracker email cron.",
    );
  }
  if (!cached) cached = createClient<Database>(url, key, { auth: { persistSession: false } });
  return cached;
}
