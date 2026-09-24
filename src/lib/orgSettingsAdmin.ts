import { mergeOrgAndPersonalSettings } from "./orgSettingsKeys.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import type { Json } from "../types/database.js";
import type { TrackerEmailCronStatus } from "./trackerEmailCronStatus.js";

export async function loadOrgSettingsBlobAdmin(): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabaseAdmin()
    .from("org_settings")
    .select("settings, google_urls")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return {};

  const settings =
    data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};

  if (data.google_urls && typeof data.google_urls === "object" && !Array.isArray(data.google_urls)) {
    settings.google_urls = data.google_urls;
  }

  return settings;
}

export async function loadEffectiveUserSettingsAdmin(userId: string): Promise<Record<string, unknown>> {
  const [org, personalRes] = await Promise.all([
    loadOrgSettingsBlobAdmin(),
    getSupabaseAdmin().from("user_settings").select("settings").eq("user_id", userId).maybeSingle(),
  ]);

  const personal =
    personalRes.data?.settings &&
    typeof personalRes.data.settings === "object" &&
    !Array.isArray(personalRes.data.settings)
      ? (personalRes.data.settings as Record<string, unknown>)
      : {};

  const merged = mergeOrgAndPersonalSettings(org, personal);
  if (org.google_urls) merged.google_urls = org.google_urls;
  return merged;
}

export async function saveTrackerEmailCronStatusAdmin(status: TrackerEmailCronStatus): Promise<void> {
  const current = await loadOrgSettingsBlobAdmin();
  const settings: Record<string, unknown> = { ...current, tracker_email_cron_status: status };
  delete settings.google_urls;
  const { error } = await getSupabaseAdmin()
    .from("org_settings")
    .update({
      settings: settings as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}
