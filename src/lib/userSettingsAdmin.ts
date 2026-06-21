import { getSupabaseAdmin } from "./supabaseAdmin";

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

export async function listUserIdsWithTrackerScheduleEnabled(): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin().from("user_settings").select("user_id, settings");
  if (error) throw new Error(error.message);

  const ids: string[] = [];
  for (const row of data ?? []) {
    const settings = row.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) continue;
    const schedule = (settings as Record<string, unknown>).tracker_email_schedule;
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) continue;
    const enabled = (schedule as Record<string, unknown>).enabled;
    if (enabled === true) ids.push(row.user_id);
  }
  return ids;
}
