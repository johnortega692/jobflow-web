import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

// This module is shared by browser helpers and server-side Vercel functions.
// `import.meta.env` exists in Vite's browser bundle but not in Node.
const isBrowser = typeof window !== "undefined";
const url = isBrowser
  ? import.meta.env.VITE_SUPABASE_URL
  : process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = isBrowser
  ? import.meta.env.VITE_SUPABASE_ANON_KEY
  : process.env.VITE_SUPABASE_ANON_KEY;

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
