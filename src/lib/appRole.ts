import { supabase } from "./supabase";

export type AppRole = "admin" | "user";

export type UserProfileAuth = {
  appRole: AppRole;
  isApproved: boolean;
  approvedAt: string | null;
};

export async function loadUserProfileAuth(userId: string): Promise<UserProfileAuth> {
  const { data, error } = await supabase
    .from("profiles")
    .select("app_role, approved_at")
    .eq("id", userId)
    .maybeSingle();

  const row = data as { app_role?: string | null; approved_at?: string | null } | null;
  if (error || !row) {
    return { appRole: "user", isApproved: false, approvedAt: null };
  }

  return {
    appRole: row.app_role === "admin" ? "admin" : "user",
    isApproved: Boolean(row.approved_at),
    approvedAt: row.approved_at ?? null,
  };
}

/** @deprecated Use loadUserProfileAuth */
export async function loadAppRole(userId: string): Promise<AppRole> {
  const profile = await loadUserProfileAuth(userId);
  return profile.appRole;
}

export function isAppAdmin(role: AppRole | null | undefined): boolean {
  return role === "admin";
}
