import { syncProjectStartDateToManpower } from "./syncProjectStartDate.js";
import { formatGcSuperFieldDisplay, gcSuperintendentContact, icbiProjectManager, jobFullAddressOneLine, parseProjectDataBlob, projectHasWallcovering, projectTeamName, wcTrackerJobName, wcTrackerJobNumber } from "./jobInfo.js";
import { paintFieldStatus, wcFieldStatus, type PaintFieldStatus, type WcFieldStatus } from "./fieldTrackerStatus.js";
import { normalizePaintVendor } from "./paintTrackerSync.js";
import { resolveDisplayCompanyName } from "./displayCompanyName.js";
import { loadOrgSettingsBlob } from "./orgSettings.js";
import { commitProjectUpdate } from "./projectActivity.js";
import { supabase } from "./supabase.js";
import {
  fieldViewRpcAuthArgs,
  loadFieldViewSession,
  noteFieldViewSessionFailure,
} from "./fieldViewAuth.js";
import type { ProjectForm, Json } from "../types/database.js";
import { normalizeProject } from "../types/database.js";
import {
  defaultWcTrackerLineFields,
  defaultWcTrackerState,
  normalizePaintTrackerState,
  normalizeWcTrackerLines,
  normalizeWcTrackerState,
  type PaintTrackerState,
  type WcTrackerLineState,
  type WcTrackerState,
} from "../types/fieldTracker.js";
import {
  normalizePaintSubmittal,
  normalizeWallcoveringSubmittal,
  parseProjectTradeData,
  type PaintSubmittalData,
  type ProjectTradeData,
  type SubmittalHistoryEntry,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments.js";
import { harmonizeTrackerRevision } from "./paintTrackerRevision.js";

export function withSyncedPaintVendor(trade: ProjectTradeData, submittal: PaintSubmittalData): ProjectTradeData {
  const vendor = normalizePaintVendor(submittal.paint_vendor ?? "PPG");
  return {
    ...trade,
    paint_submittal: { ...submittal, paint_vendor: vendor },
    paint_tracker: { ...resolvePaintTracker(trade), paintVendor: vendor },
  };
}

export type FieldPaintRow = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  jobAddress: string;
  gcName: string;
  gcSuper: string;
  gcSuperName: string;
  gcSuperPhone: string;
  startDate: string;
  paintVendor: string;
  status: PaintFieldStatus;
  division: string;
  pm: string;
  revisionNotes: string;
  tracker: PaintTrackerState;
  nightsWeekends: boolean;
};

export type FieldWcItemRow = {
  projectId: string;
  lineId: string;
  jobNumber: string;
  jobName: string;
  gcName: string;
  pm: string;
  wallcoveringName: string;
  label: string;
  status: WcFieldStatus;
  installDate: string;
  dropbox: string;
  imageUrl: string;
  panels: boolean;
  revisionNotes: string;
  line: WcTrackerLineState;
};

function wcNameFromItem(item: WallcoveringItem): string {
  return [item.manufacturer, item.product, item.color].filter((p) => p.trim()).join(" ").trim();
}

function normalizeWcMatchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function orderFieldsFromItem(item: WallcoveringItem): Pick<
  WcTrackerLineState,
  "manufacturer" | "product" | "color" | "orderQty" | "orderUnit" | "orderNotes" | "orderSelected" | "panels"
> {
  return {
    manufacturer: item.manufacturer.trim(),
    product: item.product.trim(),
    color: item.color.trim(),
    orderQty: item.qty.trim(),
    orderUnit: item.unit?.trim() || "EA",
    orderNotes: item.notes.trim(),
    orderSelected: Boolean(item.order),
    panels: Boolean(item.panels),
  };
}

function linesFromSubmittal(items: WallcoveringItem[]): WcTrackerLineState[] {
  const defaults = defaultWcTrackerLineFields();
  return items
    .filter((i) => i.label.trim() || i.product.trim() || i.manufacturer.trim())
    .map((item, index) => ({
      id: `submittal-${index}`,
      label: item.label.trim(),
      wallcoveringName: wcNameFromItem(item) || item.product.trim(),
      ...defaults,
      ...orderFieldsFromItem(item),
    }));
}

export function buildWcTrackerLinesFromSubmittal(items: WallcoveringItem[]): WcTrackerLineState[] {
  return linesFromSubmittal(items);
}

export type MergeWcTrackerFromSubmittalResult = {
  lines: WcTrackerLineState[];
  added: number;
  updated: number;
  unchanged: number;
};

export type MergeWcTrackerOptions = {
  /** Refresh matching tracker rows from this package (names, product, color). */
  updateMatches?: boolean;
  /** Append items from this package that are not already on the tracker. */
  addUnmatched?: boolean;
};

function indexOfWcTrackerMatch(
  lines: WcTrackerLineState[],
  label: string,
  name: string,
  skip: Set<number>,
): number {
  const labelKey = normalizeWcMatchKey(label);
  const nameKey = normalizeWcMatchKey(name);

  if (labelKey && nameKey) {
    const byBoth = lines.findIndex(
      (l, i) =>
        !skip.has(i) &&
        normalizeWcMatchKey(l.label) === labelKey &&
        normalizeWcMatchKey(l.wallcoveringName) === nameKey,
    );
    if (byBoth >= 0) return byBoth;
  }

  if (nameKey) {
    const byName = lines.findIndex(
      (l, i) => !skip.has(i) && normalizeWcMatchKey(l.wallcoveringName) === nameKey,
    );
    if (byName >= 0) return byName;
  }

  if (labelKey) {
    return lines.findIndex((l, i) => {
      if (skip.has(i) || normalizeWcMatchKey(l.label) !== labelKey) return false;
      const existingName = normalizeWcMatchKey(l.wallcoveringName);
      if (nameKey && existingName && nameKey !== existingName) return false;
      return true;
    });
  }
  return -1;
}

function lineFromSubmittalItem(item: WallcoveringItem, index: number): WcTrackerLineState {
  const label = item.label.trim();
  const wallcoveringName = wcNameFromItem(item) || item.product.trim();
  return {
    id: `wc-${Date.now().toString(36)}-${index}`,
    label,
    wallcoveringName,
    ...defaultWcTrackerLineFields(),
    ...orderFieldsFromItem(item),
  };
}

function updatedLineFromMatch(match: WcTrackerLineState, item: WallcoveringItem): WcTrackerLineState {
  const label = item.label.trim();
  const wallcoveringName = wcNameFromItem(item) || item.product.trim();
  const fromItem = orderFieldsFromItem(item);
  return {
    ...match,
    label: label || match.label,
    wallcoveringName: wallcoveringName || match.wallcoveringName,
    manufacturer: fromItem.manufacturer || match.manufacturer,
    product: fromItem.product || match.product,
    color: fromItem.color || match.color,
    panels: fromItem.panels,
    orderQty: match.orderQty.trim() || fromItem.orderQty,
    orderUnit: match.orderUnit.trim() || fromItem.orderUnit,
    orderNotes: match.orderNotes.trim() || fromItem.orderNotes,
    orderSelected: match.orderSelected ?? fromItem.orderSelected,
  };
}

function trackerLineChanged(before: WcTrackerLineState, after: WcTrackerLineState): boolean {
  return (
    after.label !== before.label ||
    after.wallcoveringName !== before.wallcoveringName ||
    after.manufacturer !== before.manufacturer ||
    after.product !== before.product ||
    after.color !== before.color ||
    after.panels !== before.panels ||
    after.orderQty !== before.orderQty ||
    after.orderUnit !== before.orderUnit ||
    after.orderNotes !== before.orderNotes
  );
}

/**
 * Merge submittal items into Material Tracker lines.
 * Update refreshes matching rows. Add appends unmatched items. Tracker-only rows are kept.
 */
export function mergeWcTrackerLinesFromSubmittal(
  existing: WcTrackerLineState[],
  items: WallcoveringItem[],
  options: MergeWcTrackerOptions = {},
): MergeWcTrackerFromSubmittalResult {
  const updateMatches = options.updateMatches !== false;
  const addUnmatched = options.addUnmatched !== false;
  const submittable = items.filter(
    (i) => i.label.trim() || i.product.trim() || i.manufacturer.trim(),
  );
  if (!submittable.length) {
    return { lines: existing, added: 0, updated: 0, unchanged: existing.length };
  }

  if (!updateMatches && addUnmatched) {
    const skip = new Set<number>();
    const appended: WcTrackerLineState[] = [];
    for (let index = 0; index < submittable.length; index += 1) {
      const item = submittable[index]!;
      const label = item.label.trim();
      const name = wcNameFromItem(item) || item.product.trim();
      const matchAt = indexOfWcTrackerMatch(existing, label, name, skip);
      if (matchAt >= 0) {
        skip.add(matchAt);
        continue;
      }
      appended.push(lineFromSubmittalItem(item, index));
    }
    return {
      lines: [...existing, ...appended],
      added: appended.length,
      updated: 0,
      unchanged: existing.length,
    };
  }

  const used = new Set<number>();
  const merged: WcTrackerLineState[] = [];
  let added = 0;
  let updated = 0;

  for (let index = 0; index < submittable.length; index += 1) {
    const item = submittable[index]!;
    const label = item.label.trim();
    const wallcoveringName = wcNameFromItem(item) || item.product.trim();
    const matchAt = indexOfWcTrackerMatch(existing, label, wallcoveringName, used);
    if (matchAt >= 0) {
      used.add(matchAt);
      const match = existing[matchAt]!;
      if (updateMatches) {
        const next = updatedLineFromMatch(match, item);
        if (trackerLineChanged(match, next)) updated += 1;
        merged.push(next);
      } else {
        merged.push(match);
      }
    } else if (addUnmatched) {
      added += 1;
      merged.push(lineFromSubmittalItem(item, index));
    }
  }

  const unused = existing.filter((_, i) => !used.has(i));
  return {
    lines: [...merged, ...unused],
    added,
    updated,
    unchanged: unused.length,
  };
}

/** Load existing WC tracker lines, merge from submittal items, and save. */
export async function updateWcTrackerFromSubmittalItems(
  projectId: string,
  items: WallcoveringItem[],
  options: MergeWcTrackerOptions = {},
): Promise<{ error: string | null; added: number; updated: number; total: number }> {
  const submittable = items.filter(
    (i) => i.label.trim() || i.product.trim() || i.manufacturer.trim(),
  );
  if (!submittable.length) {
    return { error: null, added: 0, updated: 0, total: 0 };
  }

  const { data, error } = await loadProjectDataForField(projectId);
  if (error) return { error, added: 0, updated: 0, total: 0 };

  const trade = parseProjectTradeData(parseProjectDataBlob(data as Json) as Json);
  const existing = normalizeWcTrackerLines(trade.wc_tracker_lines);
  const addUnmatched =
    options.addUnmatched !== undefined ? options.addUnmatched : existing.length === 0;
  const mergeOptions: MergeWcTrackerOptions = {
    updateMatches: options.updateMatches !== false,
    addUnmatched,
  };
  const { lines, added, updated } = mergeWcTrackerLinesFromSubmittal(existing, items, mergeOptions);

  if (added === 0 && updated === 0) {
    return { error: null, added: 0, updated: 0, total: lines.length };
  }

  const summaryParts = [
    added ? `added ${added}` : null,
    updated ? `updated ${updated}` : null,
  ].filter(Boolean);
  const summary = summaryParts.length
    ? `Material Tracker ${mergeOptions.updateMatches === false ? "items added" : "updated"} from submittal (${summaryParts.join(", ")})`
    : "Material Tracker updated from submittal";

  const saveErr = await saveWcTrackerLines(projectId, lines, summary);
  return { error: saveErr, added, updated, total: lines.length };
}

export function resolvePaintTracker(trade: ProjectTradeData): PaintTrackerState {
  const stored = normalizePaintTrackerState(trade.paint_tracker);
  const vendor = trade.paint_submittal?.paint_vendor?.trim();
  if (vendor) stored.paintVendor = normalizePaintVendor(vendor);
  if (trade.paint_submittal && "submittal_ordered" in trade.paint_submittal) {
    stored.submittalOrdered = Boolean(trade.paint_submittal.submittal_ordered);
  } else if (trade.paint_submittal?.submittal_ordered) {
    stored.submittalOrdered = true;
  }
  return harmonizeTrackerRevision(stored);
}

function wcTrackerFromLegacyLines(lines: WcTrackerLineState[]): Partial<WcTrackerState> {
  if (!lines.length) return {};
  return {
    submittalOrdered: lines.some((l) => l.ordered),
    submittedForApproval: lines.some((l) => l.sentForApproval),
    approved: lines.some((l) => l.approved),
  };
}

export function resolveWcTracker(trade: ProjectTradeData): WcTrackerState {
  if (trade.wc_tracker) {
    return harmonizeTrackerRevision(normalizeWcTrackerState(trade.wc_tracker));
  }

  const base = defaultWcTrackerState();
  const legacy = wcTrackerFromLegacyLines(normalizeWcTrackerLines(trade.wc_tracker_lines));
  const wcSubmittal = normalizeWallcoveringSubmittal(trade.wallcovering_submittal);
  const merged: WcTrackerState = {
    ...base,
    ...legacy,
    submittalOrdered: legacy.submittalOrdered || Boolean(wcSubmittal.submittal_ordered),
  };
  return harmonizeTrackerRevision(merged);
}

export function resolveWcTrackerLines(trade: ProjectTradeData): WcTrackerLineState[] {
  const stored = normalizeWcTrackerLines(trade.wc_tracker_lines);
  if (stored.length) return stored;
  return linesFromSubmittal(trade.wallcovering_submittal?.items ?? []);
}

export function hasStoredWcTrackerLines(trade: ProjectTradeData): boolean {
  return normalizeWcTrackerLines(trade.wc_tracker_lines).length > 0;
}

export function collectWallcoveringItemsFromPackages(
  current: WallcoveringSubmittalData | undefined,
  history: SubmittalHistoryEntry[] | undefined,
): WallcoveringItem[] {
  const items: WallcoveringItem[] = [];
  if (current?.items) items.push(...current.items);
  for (const entry of history ?? []) {
    if ((entry.scope ?? "wallcovering") !== "wallcovering") continue;
    for (const raw of entry.items ?? []) {
      items.push(raw as WallcoveringItem);
    }
  }
  return items;
}

export function findWcItemForTrackerLine(
  line: WcTrackerLineState,
  items: WallcoveringItem[],
): WallcoveringItem | undefined {
  const labelKey = normalizeWcMatchKey(line.label);
  const nameKey = normalizeWcMatchKey(line.wallcoveringName);

  const named = items.filter((item) => {
    const n = normalizeWcMatchKey(wcNameFromItem(item) || item.product);
    return Boolean(nameKey && n && n === nameKey);
  });
  if (named.length === 1) return named[0];

  if (labelKey) {
    const pool = named.length ? named : items;
    const byLabel = pool.find((item) => normalizeWcMatchKey(item.label) === labelKey);
    if (byLabel) {
      const itemName = normalizeWcMatchKey(wcNameFromItem(byLabel) || byLabel.product);
      if (!nameKey || !itemName || itemName === nameKey) return byLabel;
    }
  }
  return named[0];
}

export function wallcoveringItemMatchesTrackerLine(
  item: WallcoveringItem,
  line: WcTrackerLineState,
): boolean {
  return findWcItemForTrackerLine(line, [item]) === item;
}

export function wcOrderDisplayFromTrackerLine(
  line: WcTrackerLineState,
  items: WallcoveringItem[],
): {
  manufacturer: string;
  product: string;
  color: string;
  qty: string;
  unit: string;
  notes: string;
  order: boolean;
} {
  const item = findWcItemForTrackerLine(line, items);
  const manufacturer = line.manufacturer.trim() || item?.manufacturer.trim() || "";
  const color = line.color.trim() || item?.color.trim() || "";
  const product =
    line.product.trim() ||
    item?.product.trim() ||
    (!manufacturer && !color ? line.wallcoveringName.trim() : "");
  return {
    manufacturer,
    product,
    color,
    qty: line.orderQty.trim() || item?.qty.trim() || line.packageQty.trim() || "",
    unit: line.orderUnit.trim() || item?.unit?.trim() || "EA",
    notes: line.orderNotes.trim() || item?.notes.trim() || "",
    order: line.orderSelected ?? Boolean(item?.order),
  };
}

export function buildFieldPaintRow(project: ProjectForm): FieldPaintRow {
  const trade = parseProjectTradeData(project.data as Json);
  const tracker = resolvePaintTracker(trade);
  const j = project.jobInfo;
  const gcSuper = gcSuperintendentContact(j);
  return {
    projectId: project.id,
    jobNumber: project.job_number.trim(),
    jobName: project.job_name.trim(),
    jobAddress: jobFullAddressOneLine(project, j),
    gcName: project.contractor.trim(),
    gcSuper: formatGcSuperFieldDisplay(gcSuper),
    gcSuperName: gcSuper.name,
    gcSuperPhone: gcSuper.phone,
    startDate: j.start_date.trim(),
    paintVendor: tracker.paintVendor,
    status: paintFieldStatus(tracker),
    division: projectTeamName(j, tracker),
    pm: icbiProjectManager(j),
    revisionNotes: tracker.revisionNotes.trim(),
    tracker,
    nightsWeekends: tracker.nightsWeekends,
  };
}

export function buildFieldWcRows(project: ProjectForm): FieldWcItemRow[] {
  if (!projectHasWallcovering(project.jobInfo)) return [];
  const trade = parseProjectTradeData(project.data as Json);
  const lines = resolveWcTrackerLines(trade);
  const j = project.jobInfo;
  const jobNumber = wcTrackerJobNumber(project);
  const jobName = wcTrackerJobName(project);
  return lines.map((line) => ({
    projectId: project.id,
    lineId: line.id,
    jobNumber,
    jobName,
    gcName: project.contractor.trim(),
    pm: icbiProjectManager(j),
    wallcoveringName: line.wallcoveringName,
    label: line.label,
    status: wcFieldStatus(line),
    installDate: line.installDate,
    dropbox: line.dropbox,
    imageUrl: line.imageUrl,
    panels: line.panels,
    revisionNotes: line.revisionNotes.trim(),
    line,
  }));
}

/** Company name for public Field view (no login). */
export async function loadFieldViewCompanyName(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc(
      "field_view_company_name" as never,
      fieldViewRpcAuthArgs(loadFieldViewSession()) as never,
    );
    const rpcName = typeof data === "string" ? (data as string).trim() : "";
    if (!error && rpcName) return resolveDisplayCompanyName(rpcName);
  } catch {
    /* fall through */
  }
  try {
    const org = await loadOrgSettingsBlob();
    const name = typeof org.company_name === "string" ? org.company_name.trim() : "";
    if (name) return resolveDisplayCompanyName(name);
  } catch {
    /* fall through */
  }
  return resolveDisplayCompanyName(
    process.env.VITE_COMPANY_NAME?.trim() || "Ironwood Commercial Builders",
  );
}

async function loadProjectDataForField(projectId: string): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await supabase.rpc("field_view_get_project" as never, {
    p_project_id: projectId,
    ...fieldViewRpcAuthArgs(loadFieldViewSession()),
  } as never);
  if (error) {
    noteFieldViewSessionFailure(error.message);
    return { data: null, error: error.message };
  }
  const row = data as { data?: unknown } | null;
  return { data: row?.data ?? null, error: null };
}

export async function loadAllProjectsForField(): Promise<{ projects: ProjectForm[]; error: string | null }> {
  const { data, error } = await supabase.rpc(
    "field_view_list_projects" as never,
    fieldViewRpcAuthArgs(loadFieldViewSession()) as never,
  );
  if (error) {
    noteFieldViewSessionFailure(error.message);
    return { projects: [], error: error.message };
  }
  const rows = (Array.isArray(data) ? data : []) as ProjectForm[];
  return { projects: rows.map(normalizeProject), error: null };
}

export async function patchProjectData(
  projectId: string,
  patch: Record<string, unknown>,
  activity: { action: Parameters<typeof commitProjectUpdate>[0]["activity"]["action"]; summary: string },
): Promise<string | null> {
  return commitProjectUpdate({
    projectId,
    mergeData: patch,
    activity,
  });
}

export function wcLineSummary(line: WcTrackerLineState): string {
  if (line.label.trim() && line.wallcoveringName.trim()) {
    return `${line.label} · ${line.wallcoveringName}`;
  }
  return line.label.trim() || line.wallcoveringName.trim() || "Line item";
}

export async function saveWcTrackerLines(
  projectId: string,
  lines: WcTrackerLineState[],
  summary = "Wallcovering tracker updated",
): Promise<string | null> {
  return patchProjectData(
    projectId,
    { wc_tracker_lines: lines },
    { action: "wc_tracker_saved", summary },
  );
}

export async function saveWcTrackerState(
  projectId: string,
  tracker: WcTrackerState,
  summary = "Wallcovering tracker saved",
): Promise<string | null> {
  const { data, error } = await loadProjectDataForField(projectId);
  if (error) return error;
  const trade = parseProjectTradeData(parseProjectDataBlob(data as Json) as Json);
  const wcSubmittal = normalizeWallcoveringSubmittal(trade.wallcovering_submittal);
  const mergeData: Record<string, unknown> = { wc_tracker: tracker };
  if (Boolean(wcSubmittal.submittal_ordered) !== tracker.submittalOrdered) {
    mergeData.wallcovering_submittal = { ...wcSubmittal, submittal_ordered: tracker.submittalOrdered };
  }
  return patchProjectData(projectId, mergeData, { action: "wc_tracker_saved", summary });
}

/** Keep wallcovering tab Ordered checkbox and wc_tracker in one write. */
export async function syncWcSubmittalOrdered(
  projectId: string,
  submittalOrdered: boolean,
): Promise<string | null> {
  const { data, error } = await loadProjectDataForField(projectId);
  if (error) return error;
  const trade = parseProjectTradeData(parseProjectDataBlob(data as Json) as Json);
  const tracker = { ...resolveWcTracker(trade), submittalOrdered };
  const wcSubmittal = { ...normalizeWallcoveringSubmittal(trade.wallcovering_submittal), submittal_ordered: submittalOrdered };
  return patchProjectData(
    projectId,
    { wc_tracker: tracker, wallcovering_submittal: wcSubmittal },
    {
      action: "wc_tracker_saved",
      summary: submittalOrdered ? "Submittal marked ordered" : "Submittal ordered cleared",
    },
  );
}

export async function reloadProject(projectId: string): Promise<ProjectForm | null> {
  const { data, error } = await supabase.rpc("field_view_get_project" as never, {
    p_project_id: projectId,
    ...fieldViewRpcAuthArgs(loadFieldViewSession()),
  } as never);
  if (error) {
    noteFieldViewSessionFailure(error.message);
    return null;
  }
  if (!data) return null;
  return normalizeProject(data as ProjectForm);
}

export async function savePaintTrackerState(
  projectId: string,
  tracker: PaintTrackerState,
  summary = "Paint tracker saved",
): Promise<string | null> {
  const { data, error } = await loadProjectDataForField(projectId);
  if (error) return error;
  const trade = parseProjectTradeData(parseProjectDataBlob(data as Json) as Json);
  const vendor = normalizePaintVendor(tracker.paintVendor);
  const normalizedTracker = normalizePaintTrackerState({ ...tracker, paintVendor: vendor });
  const paintSubmittal = normalizePaintSubmittal(trade.paint_submittal);
  const vendorChanged = normalizePaintVendor(paintSubmittal.paint_vendor ?? "") !== vendor;
  const orderedChanged = Boolean(paintSubmittal.submittal_ordered) !== tracker.submittalOrdered;
  const mergeData: Record<string, unknown> = { paint_tracker: normalizedTracker };
  if (vendorChanged || orderedChanged) {
    mergeData.paint_submittal = {
      ...paintSubmittal,
      ...(vendorChanged ? { paint_vendor: vendor } : {}),
      ...(orderedChanged ? { submittal_ordered: tracker.submittalOrdered } : {}),
    };
  }
  return patchProjectData(projectId, mergeData, { action: "paint_tracker_saved", summary });
}

/** Keep paint tab Ordered checkbox and paint_tracker in one write. */
export async function syncPaintSubmittalOrdered(
  projectId: string,
  submittalOrdered: boolean,
): Promise<string | null> {
  const { data, error } = await loadProjectDataForField(projectId);
  if (error) return error;
  const trade = parseProjectTradeData(parseProjectDataBlob(data as Json) as Json);
  const tracker = { ...resolvePaintTracker(trade), submittalOrdered };
  const paintSubmittal = { ...normalizePaintSubmittal(trade.paint_submittal), submittal_ordered: submittalOrdered };
  return patchProjectData(
    projectId,
    { paint_tracker: tracker, paint_submittal: paintSubmittal },
    {
      action: "paint_tracker_saved",
      summary: submittalOrdered ? "Submittal marked ordered" : "Submittal ordered cleared",
    },
  );
}

/** @deprecated Use syncPaintSubmittalOrdered */
export async function patchPaintTrackerSubmittalOrdered(
  projectId: string,
  submittalOrdered: boolean,
): Promise<string | null> {
  return syncPaintSubmittalOrdered(projectId, submittalOrdered);
}

export async function saveProjectStartDate(projectId: string, startDate: string): Promise<string | null> {
  const { data, error } = await loadProjectDataForField(projectId);
  if (error) return error;
  const base = parseProjectDataBlob(data);
  const jobInfo = { ...(base.job_info as Record<string, unknown>), start_date: startDate };
  const errMsg = await commitProjectUpdate({
    projectId,
    mergeData: { job_info: jobInfo },
    activity: {
      action: "field_start_date_updated",
      summary: startDate.trim()
        ? `Start date set to ${startDate.trim()}`
        : "Start date cleared",
    },
  });
  if (errMsg) return errMsg;

  try {
    await syncProjectStartDateToManpower(projectId);
  } catch {
    // Manpower sync is best-effort; Field View start date is already saved in JobFlow.
  }

  return null;
}

export async function saveWcInstallDate(
  projectId: string,
  lineId: string,
  installDate: string,
): Promise<string | null> {
  const { data, error } = await loadProjectDataForField(projectId);
  if (error) return error;
  const base = parseProjectDataBlob(data);
  const trade = parseProjectTradeData(base as Json);
  const lines = resolveWcTrackerLines(trade);
  const next = lines.map((line) => (line.id === lineId ? { ...line, installDate } : line));
  const summary = installDate.trim()
    ? `Install date set to ${installDate.trim()}`
    : "Install date cleared";
  return patchProjectData(
    projectId,
    { wc_tracker_lines: next },
    { action: "field_wc_install_date_updated", summary },
  );
}

export function paintJobSmsText(row: FieldPaintRow): string {
  const night = row.nightsWeekends ? " - Nights/Weekends" : "";
  const noPaint = row.tracker.noPaint ? " - NOT NEEDED" : "";
  const superLine = row.gcSuper ? `\nGC Super: ${row.gcSuper}` : "";
  return `Job #${row.jobNumber}\nJob Name: ${row.jobName}${night}${noPaint}\nAddress: ${row.jobAddress}\nGC: ${row.gcName}${superLine}`;
}
