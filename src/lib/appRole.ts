import { supabase } from "./supabase";

export type AppRole = "admin" | "user";

export async function loadAppRole(userId: string): Promise<AppRole> {
  const { data, error } = await supabase
    .from("profiles")
    .select("app_role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data?.app_role) return "user";
  return data.app_role === "admin" ? "admin" : "user";
}

export function isAppAdmin(role: AppRole | null | undefined): boolean {
  return role === "admin";
}
