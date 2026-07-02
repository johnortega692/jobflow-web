import {
  catalogSeedForId,
  LEGACY_OPTIONAL_MIGRATION_IDS,
  STARTUP_CHECKLIST_CATALOG,
  STARTUP_CHECKLIST_GROUP_META,
  type StartupCatalogSeed,
} from "../config/projectStartupItemsCatalog";
import { PROJECT_STARTUP_OPTIONAL_STEPS } from "../config/projectStartupOptionalSteps";
import { parseFlexibleDate, toIsoDateValue, isoDateToDisplay } from "./dateInputUtils";
import type { JobInfoData } from "../types/jobInfo";
import { parseStartupOptional, type StartupOptionalState } from "./projectStartupOptional";
import type { ProjectForm } from "../types/database";

export type StartupChecklistGroup =
  | "contract_compliance"
  | "submittals_samples"
  | "safety"
  | "procurement_field"
  | "billing";

export type StartupChecklistSource = "manual" | "jobTracker" | "brushouts" | "sds";

export type StartupChecklistItem = {
  id: string;
  group: StartupChecklistGroup;
  label: string;
  source: StartupChecklistSource;
  blocking: boolean;
  dueDate: string | null;
  /** When true, preliminary notice dueDate is stored manually instead of derived. */
  dueDateOverride?: boolean;
  enabled: boolean;
  complete: boolean;
  completedBy: string | null;
  completedAt: string | null;
};

export type StartupItemsState = {
  version: 2;
  items: StartupChecklistItem[];
};

export const PRELIM_NOTICE_ITEM_ID = "preliminary_notice_sent";
export const PUBLIC_WORKS_ITEM_IDS = ["dir_registration", "certified_payroll"] as const;
export const WALLCOVERING_ITEM_IDS = ["submit_wc_samples", "wc_lead_times"] as const;
/** Combined brushouts/WC item replaced by submit_brushouts + submit_wc_samples. */
export const LEGACY_BRUSHOUTS_WC_SAMPLES_ID = "brushouts_wc_samples";

const GROUP_ORDER: StartupChecklistGroup[] = [
  "contract_compliance",
  "submittals_samples",
  "safety",
  "procurement_field",
  "billing",
];


function seedItem(seed: StartupCatalogSeed, patch?: Partial<StartupChecklistItem>): StartupChecklistItem {
  return {
    id: seed.id,
    group: seed.group,
    label: seed.label,
    source: seed.source,
    blocking: Boolean(seed.blocking),
    dueDate: null,
    dueDateOverride: false,
    enabled: seed.defaultEnabled !== false,
    complete: false,
    completedBy: null,
    completedAt: null,
    ...patch,
  };
}

export function defaultStartupItems(): StartupItemsState {
  return {
    version: 2,
    items: STARTUP_CHECKLIST_CATALOG.map((seed) => seedItem(seed)),
  };
}

function isCatalogItemId(id: string): boolean {
  return Boolean(catalogSeedForId(id));
}

function parseItem(raw: unknown, fallback: StartupChecklistItem): StartupChecklistItem {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : fallback.id;
  const catalogSeed = catalogSeedForId(id);
  const storedLabel = typeof o.label === "string" && o.label.trim() ? o.label.trim() : "";
  const group =
    typeof o.group === "string" && o.group in STARTUP_CHECKLIST_GROUP_META
      ? (o.group as StartupChecklistGroup)
      : fallback.group;
  const source =
    o.source === "manual" || o.source === "jobTracker" || o.source === "brushouts" || o.source === "sds"
      ? o.source
      : fallback.source;

  return {
    ...fallback,
    id,
    group,
    label: catalogSeed ? fallback.label : storedLabel || fallback.label,
    source,
    blocking: typeof o.blocking === "boolean" ? o.blocking : fallback.blocking,
    dueDate: typeof o.dueDate === "string" ? o.dueDate : o.dueDate === null ? null : fallback.dueDate,
    dueDateOverride: typeof o.dueDateOverride === "boolean" ? o.dueDateOverride : fallback.dueDateOverride,
    enabled: typeof o.enabled === "boolean" ? o.enabled : fallback.enabled,
    complete: typeof o.complete === "boolean" ? o.complete : fallback.complete,
    completedBy: typeof o.completedBy === "string" ? o.completedBy : o.completedBy === null ? null : fallback.completedBy,
    completedAt:
      typeof o.completedAt === "string" ? o.completedAt : o.completedAt === null ? null : fallback.completedAt,
  };
}

/** Map legacy combined brushouts/WC row onto submit_brushouts; submit_wc_samples seeds fresh from catalog. */
function migrateLegacyCatalogIds(byId: Map<string, StartupChecklistItem>): void {
  const legacy = byId.get(LEGACY_BRUSHOUTS_WC_SAMPLES_ID);
  if (!legacy) return;
  if (!byId.has("submit_brushouts")) {
    byId.set("submit_brushouts", { ...legacy, id: "submit_brushouts" });
  }
  byId.delete(LEGACY_BRUSHOUTS_WC_SAMPLES_ID);
}

function passthroughCustomItem(item: StartupChecklistItem): StartupChecklistItem {
  if (isCatalogItemId(item.id)) {
    const seed = catalogSeedForId(item.id)!;
    return { ...parseItem(item, seedItem(seed, item)), label: seed.label };
  }
  return item;
}

function assertCustomItemsPreserved(before: StartupChecklistItem[], after: StartupChecklistItem[]): void {
  if (import.meta.env.PROD) return;
  const catalogIds = new Set(STARTUP_CHECKLIST_CATALOG.map((s) => s.id));
  for (const orig of before) {
    if (catalogIds.has(orig.id) || orig.id === LEGACY_BRUSHOUTS_WC_SAMPLES_ID) continue;
    const found = after.find((row) => row.id === orig.id);
    if (!found) {
      console.error(`[startup] mergeCatalogItems dropped custom item "${orig.id}"`);
      continue;
    }
    if (found.label !== orig.label) {
      console.error(`[startup] mergeCatalogItems relabeled custom item "${orig.id}"`);
    }
    if (found.group !== orig.group) {
      console.error(`[startup] mergeCatalogItems regrouped custom item "${orig.id}"`);
    }
  }
}

function mergeCatalogItems(stored: StartupChecklistItem[]): StartupChecklistItem[] {
  const byId = new Map(stored.map((item) => [item.id, item]));
  migrateLegacyCatalogIds(byId);
  const catalogIds = new Set(STARTUP_CHECKLIST_CATALOG.map((s) => s.id));
  const merged: StartupChecklistItem[] = [];

  for (const seed of STARTUP_CHECKLIST_CATALOG) {
    const existing = byId.get(seed.id);
    const parsed = parseItem(existing, seedItem(seed, existing));
    merged.push({ ...parsed, label: seed.label });
    byId.delete(seed.id);
  }

  for (const item of byId.values()) {
    if (catalogIds.has(item.id)) continue;
    merged.push(passthroughCustomItem(item));
  }

  assertCustomItemsPreserved(stored, merged);
  return merged;
}

function migrateFromOptional(legacy: StartupOptionalState): StartupItemsState {
  const base = defaultStartupItems();
  const items = base.items.map((item) => {
    const wasEnabled = legacy.enabled.includes(item.id);
    const wasChecked = Boolean(legacy.checked[item.id]);
    if (LEGACY_OPTIONAL_MIGRATION_IDS.includes(item.id as (typeof LEGACY_OPTIONAL_MIGRATION_IDS)[number])) {
      return {
        ...item,
        enabled: wasEnabled || wasChecked,
        complete: wasChecked,
      };
    }
    return item;
  });

  const catalogIds = new Set(STARTUP_CHECKLIST_CATALOG.map((s) => s.id));
  for (const id of legacy.enabled) {
    if (catalogIds.has(id) || LEGACY_OPTIONAL_MIGRATION_IDS.includes(id as (typeof LEGACY_OPTIONAL_MIGRATION_IDS)[number])) {
      continue;
    }
    const label =
      PROJECT_STARTUP_OPTIONAL_STEPS.find((s) => s.id === id)?.label ??
      legacy.custom.find((c) => c.id === id)?.label ??
      id;
    if (!items.some((row) => row.id === id)) {
      items.push({
        id,
        group: "procurement_field",
        label,
        source: "manual",
        blocking: false,
        dueDate: null,
        enabled: true,
        complete: Boolean(legacy.checked[id]),
        completedBy: null,
        completedAt: null,
      });
    }
  }

  for (const custom of legacy.custom) {
    if (items.some((row) => row.id === custom.id)) continue;
    items.push({
      id: custom.id,
      group: "procurement_field",
      label: custom.label,
      source: "manual",
      blocking: false,
      dueDate: null,
      enabled: true,
      complete: Boolean(legacy.checked[custom.id]),
      completedBy: null,
      completedAt: null,
    });
  }

  return { version: 2, items: mergeCatalogItems(items) };
}

export function parseStartupItems(raw: unknown, legacyOptional?: unknown): StartupItemsState {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.version === 2 && Array.isArray(o.items)) {
      const defaultsById = new Map(defaultStartupItems().items.map((item) => [item.id, item]));
      const parsed = o.items.map((row) => {
        const rowObj = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
        const id = typeof rowObj.id === "string" ? rowObj.id.trim() : "";
        const storedLabel = typeof rowObj.label === "string" ? rowObj.label.trim() : "";
        const storedGroup =
          typeof rowObj.group === "string" && rowObj.group in STARTUP_CHECKLIST_GROUP_META
            ? (rowObj.group as StartupChecklistGroup)
            : "procurement_field";
        const fallback =
          defaultsById.get(id) ??
          ({
            id: id || newCustomStartupItemId("item"),
            group: storedGroup,
            label: storedLabel || id || "Custom item",
            source: "manual",
            blocking: false,
            dueDate: null,
            enabled: true,
            complete: false,
            completedBy: null,
            completedAt: null,
          } satisfies StartupChecklistItem);
        return parseItem(row, fallback);
      });
      return { version: 2, items: mergeCatalogItems(parsed) };
    }
  }

  if (legacyOptional !== undefined) {
    return migrateFromOptional(parseStartupOptional(legacyOptional));
  }

  return defaultStartupItems();
}

export function parseDashboardStartupItems(project: ProjectForm): StartupItemsState {
  const blob =
    project.data && typeof project.data === "object" && !Array.isArray(project.data)
      ? (project.data as Record<string, unknown>)
      : {};
  return parseStartupItems(blob.startup_items, blob.startup_optional);
}

export function enabledStartupItems(state: StartupItemsState): StartupChecklistItem[] {
  return state.items.filter((item) => item.enabled || item.complete);
}

export function startupItemsProgress(state: StartupItemsState): { done: number; total: number } {
  const rows = state.items.filter((item) => item.enabled);
  const done = rows.filter((item) => item.complete).length;
  return { done, total: rows.length };
}

export function startupGroupsWithEnabledItems(state: StartupItemsState): StartupChecklistGroup[] {
  return GROUP_ORDER.filter((group) =>
    state.items.some((item) => item.group === group && (item.enabled || item.complete)),
  );
}

export function itemsForGroup(state: StartupItemsState, group: StartupChecklistGroup): StartupChecklistItem[] {
  return state.items.filter((item) => item.group === group && (item.enabled || item.complete));
}

export function groupProgress(state: StartupItemsState, group: StartupChecklistGroup): { done: number; total: number } {
  const rows = itemsForGroup(state, group);
  return { done: rows.filter((item) => item.complete).length, total: rows.length };
}

export function prelimReferenceIso(jobInfo: JobInfoData): string | null {
  const furnishing = jobInfo.first_furnishing_date.trim();
  if (furnishing) {
    const iso = toIsoDateValue(furnishing);
    if (iso) return iso;
  }
  const start = jobInfo.start_date.trim();
  if (start) {
    const iso = toIsoDateValue(start);
    if (iso) return iso;
  }
  return null;
}

export function addCalendarDaysIso(iso: string, days: number): string | null {
  const base = parseFlexibleDate(iso);
  if (!base) return null;
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  next.setDate(next.getDate() + days);
  return toIsoDateValue(`${next.getMonth() + 1}/${next.getDate()}/${next.getFullYear()}`);
}

export function effectiveDueDateIso(item: StartupChecklistItem, jobInfo: JobInfoData): string | null {
  if (item.id === PRELIM_NOTICE_ITEM_ID && !item.dueDateOverride) {
    const ref = prelimReferenceIso(jobInfo);
    return ref ? addCalendarDaysIso(ref, 20) : null;
  }
  return item.dueDate;
}

export function prelimNeedsStartDate(item: StartupChecklistItem, jobInfo: JobInfoData): boolean {
  return item.id === PRELIM_NOTICE_ITEM_ID && !item.complete && !prelimReferenceIso(jobInfo);
}

export function daysUntilIso(iso: string): number | null {
  const target = parseFlexibleDate(iso);
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export type DueBadge = {
  tone: "amber" | "red";
  label: string;
};

export function dueBadgeForItem(item: StartupChecklistItem, jobInfo: JobInfoData): DueBadge | null {
  if (item.complete) return null;
  if (prelimNeedsStartDate(item, jobInfo)) {
    return { tone: "amber", label: "set start date" };
  }
  const due = effectiveDueDateIso(item, jobInfo);
  if (!due) return null;
  const days = daysUntilIso(due);
  if (days === null) return null;
  if (days < 0) return { tone: "red", label: "overdue" };
  if (days <= 7) return { tone: "red", label: `${days} day${days === 1 ? "" : "s"} left` };
  return { tone: "amber", label: `${days} days left` };
}

export function shortAttentionLabel(item: StartupChecklistItem, jobInfo: JobInfoData): string {
  if (prelimNeedsStartDate(item, jobInfo)) return `${item.label} · set start date`;
  const due = effectiveDueDateIso(item, jobInfo);
  if (due) {
    const days = daysUntilIso(due);
    if (days !== null) {
      if (days < 0) return `${item.label} · overdue`;
      return `${item.label} · ${days} day${days === 1 ? "" : "s"} left`;
    }
  }
  return item.label;
}

export function itemNeedsAttention(item: StartupChecklistItem, jobInfo: JobInfoData): boolean {
  if (!item.enabled || item.complete) return false;
  if (item.blocking) return true;
  if (prelimNeedsStartDate(item, jobInfo)) return true;
  return Boolean(effectiveDueDateIso(item, jobInfo));
}

export function applyPublicWorksFlag(
  state: StartupItemsState,
  publicWorks: boolean,
  prevPublicWorks: boolean,
): { state: StartupItemsState; activityNotes: string[] } {
  if (publicWorks === prevPublicWorks) return { state, activityNotes: [] };

  const activityNotes: string[] = [];
  const items = state.items.map((item) => {
    if (!PUBLIC_WORKS_ITEM_IDS.includes(item.id as (typeof PUBLIC_WORKS_ITEM_IDS)[number])) return item;

    if (publicWorks) {
      if (!item.enabled) {
        activityNotes.push(`${item.label} enabled (public works)`);
        return { ...item, enabled: true };
      }
      return item;
    }

    if (item.complete) return item;
    if (item.enabled) {
      return { ...item, enabled: false };
    }
    return item;
  });

  return { state: { ...state, items }, activityNotes };
}

export function applyWallcoveringScope(
  state: StartupItemsState,
  hasWallcovering: boolean,
  prevHasWallcovering: boolean,
): { state: StartupItemsState; activityNotes: string[] } {
  if (hasWallcovering === prevHasWallcovering) return { state, activityNotes: [] };

  const activityNotes: string[] = [];
  const items = state.items.map((item) => {
    if (!WALLCOVERING_ITEM_IDS.includes(item.id as (typeof WALLCOVERING_ITEM_IDS)[number])) return item;

    if (hasWallcovering) {
      if (!item.enabled && !item.complete) {
        activityNotes.push(`${item.label} enabled (wallcovering contract)`);
        return { ...item, enabled: true };
      }
      return item;
    }

    if (item.complete) return item;
    if (item.enabled) {
      return { ...item, enabled: false };
    }
    return item;
  });

  return { state: { ...state, items }, activityNotes };
}

export function prelimReferenceLabel(jobInfo: JobInfoData): string {
  if (jobInfo.first_furnishing_date.trim()) return "First furnishing date";
  if (jobInfo.start_date.trim()) return "Start date";
  return "Start or first furnishing date";
}

export function prelimDeadlineExplanation(jobInfo: JobInfoData): string | null {
  const refIso = prelimReferenceIso(jobInfo);
  if (!refIso) return null;
  const dueIso = addCalendarDaysIso(refIso, 20);
  if (!dueIso) return null;
  const refDisplay = isoDateToDisplay(refIso);
  const dueDisplay = isoDateToDisplay(dueIso);
  const refName = prelimReferenceLabel(jobInfo);
  return `${refName} ${refDisplay} + 20 calendar days = ${dueDisplay}`;
}

export function isPublicWorksCatalogItem(id: string): boolean {
  return PUBLIC_WORKS_ITEM_IDS.includes(id as (typeof PUBLIC_WORKS_ITEM_IDS)[number]);
}

export function isWallcoveringCatalogItem(id: string): boolean {
  return Boolean(catalogSeedForId(id)?.requiresWallcovering);
}

export function newCustomStartupItemId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return `custom_${slug || "item"}_${crypto.randomUUID().slice(0, 8)}`;
}

export function toggleStartupItemComplete(
  state: StartupItemsState,
  itemId: string,
  complete: boolean,
  actorName: string,
): StartupItemsState {
  return {
    ...state,
    items: state.items.map((item) => {
      if (item.id !== itemId) return item;
      if (item.source !== "manual") return item;
      return {
        ...item,
        complete,
        completedBy: complete ? actorName : null,
        completedAt: complete ? new Date().toISOString() : null,
      };
    }),
  };
}
