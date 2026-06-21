import { normalizeGoogleUrls, type GoogleUrlKey } from "./googleSheetsConfig";
import {
  mergeOrgAndPersonalSettings,
  pickOrgSettingsPatch,
  stripOrgKeysFromPersonalBlob,
} from "./orgSettingsKeys";
import { supabase } from "./supabase";
import type { Json } from "../types/database";

export async function loadOrgSettingsBlob(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("org_settings")
    .select("settings, google_urls")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.warn("org_settings load failed:", error.message);
    return {};
  }

  const settings =
    data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};

  if (data?.google_urls && typeof data.google_urls === "object" && !Array.isArray(data.google_urls)) {
    settings.google_urls = data.google_urls;
  }

  return settings;
}

export async function loadOrgGoogleUrls(): Promise<Record<GoogleUrlKey, string>> {
  const org = await loadOrgSettingsBlob();
  if (org.google_urls && typeof org.google_urls === "object" && !Array.isArray(org.google_urls)) {
    return normalizeGoogleUrls(org.google_urls as Record<string, string>);
  }
  return normalizeGoogleUrls(undefined);
}

export async function saveOrgSettingsPatch(
  patch: Record<string, unknown>,
  userId: string,
): Promise<string | null> {
  const orgPatch = pickOrgSettingsPatch(patch);
  const { google_urls: googleUrls, ...settingsPatch } = orgPatch as {
    google_urls?: Record<string, string>;
    [key: string]: unknown;
  };

  const current = await loadOrgSettingsBlob();
  const nextSettings = { ...current, ...settingsPatch };
  delete nextSettings.google_urls;

  const payload: Record<string, unknown> = {
    id: 1,
    settings: nextSettings as Json,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (googleUrls && typeof googleUrls === "object") {
    payload.google_urls = googleUrls as Json;
  } else if (current.google_urls) {
    payload.google_urls = current.google_urls as Json;
  }

  const { error } = await supabase.from("org_settings").upsert(payload, { onConflict: "id" });
  return error?.message ?? null;
}

export async function saveOrgGoogleUrls(
  urls: Record<GoogleUrlKey, string>,
  userId: string,
): Promise<string | null> {
  return saveOrgSettingsPatch({ google_urls: urls }, userId);
}

export async function removeOrgSettingsKeys(keys: string[]): Promise<string | null> {
  if (!keys.length) return null;
  const current = await loadOrgSettingsBlob();
  const next = { ...current };
  for (const key of keys) delete next[key];
  delete next.google_urls;

  const { data: row } = await supabase.from("org_settings").select("google_urls").eq("id", 1).maybeSingle();
  const googleUrls = row?.google_urls ?? {};

  const { error } = await supabase.from("org_settings").upsert(
    {
      id: 1,
      settings: next as Json,
      google_urls: googleUrls as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  return error?.message ?? null;
}

export async function loadEffectiveUserSettings(userId: string): Promise<Record<string, unknown>> {
  const [org, personalRow] = await Promise.all([loadOrgSettingsBlob(), loadPersonalUserSettingsRow(userId)]);
  const personal = stripOrgKeysFromPersonalBlob(personalRow);
  const merged = mergeOrgAndPersonalSettings(org, personal);
  if (org.google_urls) {
    merged.google_urls = org.google_urls;
  }
  return merged;
}

async function loadPersonalUserSettingsRow(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
    return {};
  }
  return data.settings as Record<string, unknown>;
}

export async function savePersonalUserSettingsPatch(
  userId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const current = await loadPersonalUserSettingsRow(userId);
  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      settings: { ...current, ...patch } as Json,
    },
    { onConflict: "user_id" },
  );
  return error?.message ?? null;
}
