import { formatGcSuperFieldDisplay, gcSuperintendentContact, icbiProjectManager, jobFullAddressOneLine, parseProjectDataBlob, projectHasWallcovering, wcTrackerJobName, wcTrackerJobNumber } from "./jobInfo";
import { paintFieldStatus, wcFieldStatus, type PaintFieldStatus, type WcFieldStatus } from "./fieldTrackerStatus";
import { normalizePaintVendor } from "./paintTrackerSync";
import { resolveDisplayCompanyName } from "./displayCompanyName";
import { loadOrgSettingsBlob } from "./orgSettings";
import { commitProjectUpdate } from "./projectActivity";
import { supabase } from "./supabase";
import { fieldViewRpcAuthArgs, loadFieldViewSession } from "./fieldViewAuth";
import type { ProjectForm, Json } from "../types/database";
import { normalizeProject } from "../types/database";
import {
  defaultWcTrackerLineFields,
  defaultWcTrackerState,
  normalizePaintTrackerState,
  normalizeWcTrackerLines,
  normalizeWcTrackerState,
  type PaintTrackerState,
  type WcTrackerLineState,
  type WcTrackerState,
} from "../types/fieldTracker";
import {
  normalizePaintSubmittal,
  normalizeWallcoveringSubmittal,
  parseProjectTradeData,
  type PaintSubmittalData,
  type ProjectTradeData,
  type WallcoveringItem,
} from "../types/tradeDocuments";
import { harmonizeTrackerRevision } from "./paintTrackerRevision";

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
  tracker: WcTrackerState;
};

function wcNameFromItem(item: WallcoveringItem): string {
  return [item.manufacturer, item.product, item.color].filter((p) => p.trim()).join(" ").trim();
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
      panels: Boolean(item.panels),
    }));
}

export function buildWcTrackerLinesFromSubmittal(items: WallcoveringItem[]): WcTrackerLineState[] {
  return linesFromSubmittal(items);
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
    division: tracker.creativeTeam.trim() || j.icbi_foreman.trim(),
    pm: icbiProjectManager(j),
    revisionNotes: tracker.revisionNotes.trim(),
    tracker,
    nightsWeekends: tracker.nightsWeekends,
  };
}

export function buildFieldWcRows(project: ProjectForm): FieldWcItemRow[] {
  if (!projectHasWallcovering(project.jobInfo)) return [];
  const trade = parseProjectTradeData(project.data as Json);
  const tracker = resolveWcTracker(trade);
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
    status: wcFieldStatus(line, tracker),
    installDate: line.installDate,
    dropbox: line.dropbox,
    imageUrl: line.imageUrl,
    panels: line.panels,
    revisionNotes: tracker.revisionNotes.trim(),
    line,
    tracker,
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
    import.meta.env.VITE_COMPANY_NAME?.trim() || "Ironwood Commercial Builders",
  );
}

async function loadProjectDataForField(projectId: string): Promise<{ data: unknown; error: string | null }> {
  const { data, error } = await supabase.rpc("field_view_get_project" as never, {
    p_project_id: projectId,
    ...fieldViewRpcAuthArgs(loadFieldViewSession()),
  } as never);
  if (error) return { data: null, error: error.message };
  const row = data as { data?: unknown } | null;
  return { data: row?.data ?? null, error: null };
}

export async function loadAllProjectsForField(): Promise<{ projects: ProjectForm[]; error: string | null }> {
  const { data, error } = await supabase.rpc(
    "field_view_list_projects" as never,
    fieldViewRpcAuthArgs(loadFieldViewSession()) as never,
  );
  if (error) return { projects: [], error: error.message };
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
  if (error || !data) return null;
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
  const normalizedTracker = { ...tracker, paintVendor: vendor };
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
  return commitProjectUpdate({
    projectId,
    mergeData: { job_info: jobInfo },
    activity: {
      action: "field_start_date_updated",
      summary: startDate.trim()
        ? `Start date set to ${startDate.trim()}`
        : "Start date cleared",
    },
  });
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
  const noPaint = row.tracker.noPaint ? " - NO PAINT" : "";
  const superLine = row.gcSuper ? `\nGC Super: ${row.gcSuper}` : "";
  return `Job #${row.jobNumber}\nJob Name: ${row.jobName}${night}${noPaint}\nAddress: ${row.jobAddress}\nGC: ${row.gcName}${superLine}`;
}
