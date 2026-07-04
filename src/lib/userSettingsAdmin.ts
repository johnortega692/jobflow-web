import { loadOrgSettingsBlobAdmin } from "./orgSettingsAdmin";
import { normalizeTrackerEmailSchedule } from "./trackerEmailSchedule";
import { getSupabaseAdmin } from "./supabaseAdmin";

/** Sentinel target id — cron runs once using org_settings (shared schedule + notify email). */
export const ORG_TRACKER_CRON_TARGET = "__org_tracker__";

export async function loadRawUserSettingsAdmin(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
    return {};
  }
  return data.settings as Record<string, unknown>;
}

export async function listTrackerCronTargets(): Promise<string[]> {
  const forced = (process.env.TRACKER_CRON_USER_ID ?? "").trim();
  if (forced) return [forced];

  const org = await loadOrgSettingsBlobAdmin();
  const orgEnabled = normalizeTrackerEmailSchedule(org.tracker_email_schedule).enabled;

  const targets: string[] = [];
  if (orgEnabled) targets.push(ORG_TRACKER_CRON_TARGET);

  const { data, error } = await getSupabaseAdmin().from("user_settings").select("user_id, settings");
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const settings = row.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) continue;
    const schedule = (settings as Record<string, unknown>).tracker_email_schedule;
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) continue;
    if ((schedule as Record<string, unknown>).enabled === true && !targets.includes(row.user_id)) {
      targets.push(row.user_id);
    }
  }

  return targets;
}

/** @deprecated Use listTrackerCronTargets — org schedule lives in org_settings. */
export async function listUserIdsWithTrackerScheduleEnabled(): Promise<string[]> {
  return listTrackerCronTargets();
}
