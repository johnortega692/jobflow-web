/** Org-level default enabled flags for the Startup checklist on new jobs. */

import { STARTUP_CHECKLIST_CATALOG, type StartupCatalogSeed } from "../config/projectStartupItemsCatalog";
import { patchOrgSettings, removeUserSettingsKeys } from "./budgetLibrary";
import { loadOrgSettingsBlob } from "./orgSettings";

export const STARTUP_CHECKLIST_DEFAULT_ENABLED_KEY = "startup_checklist_default_enabled";

export type StartupChecklistDefaultEnabledMap = Record<string, boolean>;

let cachedEnabledById: StartupChecklistDefaultEnabledMap | null = null;

export function catalogDefaultEnabledMap(): StartupChecklistDefaultEnabledMap {
  return Object.fromEntries(
    STARTUP_CHECKLIST_CATALOG.map((seed) => [seed.id, seed.defaultEnabled !== false]),
  );
}

export function catalogItemDefaultEnabled(seed: Pick<StartupCatalogSeed, "id" | "defaultEnabled">): boolean {
  if (cachedEnabledById && Object.prototype.hasOwnProperty.call(cachedEnabledById, seed.id)) {
    return cachedEnabledById[seed.id] === true;
  }
  return seed.defaultEnabled !== false;
}

export function normalizeStartupChecklistDefaultEnabled(raw: unknown): StartupChecklistDefaultEnabledMap | null {
  if (raw === undefined || raw === null) return null;
  const known = new Set(STARTUP_CHECKLIST_CATALOG.map((seed) => seed.id));
  const catalog = catalogDefaultEnabledMap();

  if (Array.isArray(raw)) {
    const enabled = new Set<string>();
    for (const item of raw) {
      if (typeof item === "string" && known.has(item)) enabled.add(item);
    }
    const out: StartupChecklistDefaultEnabledMap = {};
    for (const seed of STARTUP_CHECKLIST_CATALOG) {
      out[seed.id] = enabled.has(seed.id);
    }
    return out;
  }

  if (typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const out: StartupChecklistDefaultEnabledMap = { ...catalog };
  let any = false;
  for (const seed of STARTUP_CHECKLIST_CATALOG) {
    const value = obj[seed.id];
    if (typeof value === "boolean") {
      out[seed.id] = value;
      any = true;
    }
  }
  return any ? out : null;
}

export function enabledIdsFromMap(map: StartupChecklistDefaultEnabledMap): string[] {
  return STARTUP_CHECKLIST_CATALOG.filter((seed) => map[seed.id]).map((seed) => seed.id);
}

export function mapFromEnabledIds(ids: readonly string[]): StartupChecklistDefaultEnabledMap {
  const enabled = new Set(ids);
  return Object.fromEntries(STARTUP_CHECKLIST_CATALOG.map((seed) => [seed.id, enabled.has(seed.id)]));
}

export function clearStartupChecklistDefaultsCache(): void {
  cachedEnabledById = null;
}

export async function loadStartupChecklistDefaultEnabled(): Promise<StartupChecklistDefaultEnabledMap> {
  if (cachedEnabledById) return cachedEnabledById;
  const org = await loadOrgSettingsBlob();
  const custom = normalizeStartupChecklistDefaultEnabled(org[STARTUP_CHECKLIST_DEFAULT_ENABLED_KEY]);
  const next = custom ?? catalogDefaultEnabledMap();
  cachedEnabledById = next;
  return next;
}

export async function loadStartupChecklistDefaultsDraft(_userId: string): Promise<{
  enabledIds: string[];
  usingCustom: boolean;
}> {
  const org = await loadOrgSettingsBlob();
  const custom = normalizeStartupChecklistDefaultEnabled(org[STARTUP_CHECKLIST_DEFAULT_ENABLED_KEY]);
  if (custom) {
    cachedEnabledById = custom;
    return { enabledIds: enabledIdsFromMap(custom), usingCustom: true };
  }
  const defaults = catalogDefaultEnabledMap();
  cachedEnabledById = defaults;
  return { enabledIds: enabledIdsFromMap(defaults), usingCustom: false };
}

export async function saveStartupChecklistDefaultEnabled(
  userId: string,
  enabledIds: readonly string[],
): Promise<string | null> {
  const next = mapFromEnabledIds(enabledIds);
  const err = await patchOrgSettings(userId, { [STARTUP_CHECKLIST_DEFAULT_ENABLED_KEY]: next });
  if (!err) cachedEnabledById = next;
  return err;
}

export async function resetStartupChecklistDefaultEnabled(userId: string): Promise<string | null> {
  const err = await removeUserSettingsKeys(userId, [STARTUP_CHECKLIST_DEFAULT_ENABLED_KEY]);
  if (!err) clearStartupChecklistDefaultsCache();
  return err;
}
