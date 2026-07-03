import { supabase } from "./supabase";

/** Attach the current Supabase session token for protected /api/* routes. */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in required.");

  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
