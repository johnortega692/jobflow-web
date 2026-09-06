import { supabase } from "./supabase";
import {
  normalizeGrantableSettingsTabs,
  type GrantableSettingsTabId,
} from "../config/settingsTabs";

export type AppRole = "admin" | "user";

export type UserProfileAuth = {
  appRole: AppRole;
  isApproved: boolean;
  approvedAt: string | null;
  /** Informational office role slug — admin-assigned (profiles.job_role). */
  jobRole: string;
  /** Grantable Settings tabs. `null` means all grantable tabs (legacy default). */
  settingsTabAccess: GrantableSettingsTabId[] | null;
};

export async function loadUserProfileAuth(userId: string): Promise<UserProfileAuth> {
  const { data, error } = await supabase
    .from("profiles")
    .select("app_role, approved_at, job_role, settings_tabs")
    .eq("id", userId)
    .maybeSingle();

  const row = data as {
    app_role?: string | null;
    approved_at?: string | null;
    job_role?: string | null;
    settings_tabs?: unknown;
  } | null;
  if (error || !row) {
    return {
      appRole: "user",
      isApproved: false,
      approvedAt: null,
      jobRole: "",
      settingsTabAccess: null,
    };
  }

  return {
    appRole: row.app_role === "admin" ? "admin" : "user",
    isApproved: Boolean(row.approved_at),
    approvedAt: row.approved_at ?? null,
    jobRole: typeof row.job_role === "string" ? row.job_role.trim().toLowerCase() : "",
    settingsTabAccess: normalizeGrantableSettingsTabs(row.settings_tabs),
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
