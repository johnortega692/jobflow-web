import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.js";

// This module is shared by browser helpers and server-side Vercel functions.
// Vite replaces these process.env expressions in the browser bundle; Node reads
// the same values from the server environment without importing `import.meta`.
const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local",
  );
}

export const supabase = createClient<Database>(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder",
);

export const isSupabaseConfigured =
  Boolean(url && anonKey && !url.includes("your-project-id"));
