import { supabase } from "./supabase.js";

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  let token = data.session?.access_token?.trim() ?? "";
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token?.trim() ?? "";
  }
  if (!token) {
    throw new Error("Sign in required. Open the https site, sign out, and sign in again.");
  }
  return token;
}

/** Attach the current Supabase session token for protected /api/* routes. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
