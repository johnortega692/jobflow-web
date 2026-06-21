import { mergeOrgAndPersonalSettings } from "./orgSettingsKeys";
import { getSupabaseAdmin } from "./supabaseAdmin";

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
