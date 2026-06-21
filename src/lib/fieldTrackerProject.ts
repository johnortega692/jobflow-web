import { jobFullAddressOneLine, parseProjectDataBlob, projectHasWallcovering, wcTrackerJobName, wcTrackerJobNumber } from "./jobInfo";
import { paintFieldStatus, wcFieldStatus, type PaintFieldStatus, type WcFieldStatus } from "./fieldTrackerStatus";
import { normalizePaintVendor } from "./paintTrackerSync";
import { loadOrgSettingsBlob } from "./orgSettings";
import { commitProjectUpdate } from "./projectActivity";
import { supabase } from "./supabase";
import type { ProjectForm, Json } from "../types/database";
import { normalizeProject } from "../types/database";
import {
  defaultWcTrackerLineFields,
  normalizePaintTrackerState,
  normalizeWcTrackerLines,
  type PaintTrackerState,
  type WcTrackerLineState,
} from "../types/fieldTracker";
import { parseProjectTradeData, type ProjectTradeData, type WallcoveringItem } from "../types/tradeDocuments";

export type FieldPaintRow = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  jobAddress: string;
  gcName: string;
  gcSuper: string;
  startDate: string;
  paintVendor: string;
  status: PaintFieldStatus;
  division: string;
  pm: string;
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
  line: WcTrackerLineState;
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
  if (trade.paint_submittal?.submittal_ordered && !stored.submittalOrdered) {
    stored.submittalOrdered = true;
  }
  return stored;
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
  return {
    projectId: project.id,
    jobNumber: project.job_number.trim(),
    jobName: project.job_name.trim(),
    jobAddress: jobFullAddressOneLine(project, j),
    gcName: project.contractor.trim(),
    gcSuper: j.gc_superintendent.trim(),
    startDate: j.start_date.trim(),
    paintVendor: tracker.paintVendor,
    status: paintFieldStatus(tracker),
    division: tracker.creativeTeam.trim() || j.icbi_foreman.trim(),
    pm: j.icbi_pm.trim(),
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
    pm: j.icbi_pm.trim(),
    wallcoveringName: line.wallcoveringName,
    label: line.label,
    status: wcFieldStatus(line),
    installDate: line.installDate,
    dropbox: line.dropbox,
    imageUrl: line.imageUrl,
    panels: line.panels,
    line,
  }));
}

/** Company name for public Field view (no login). */
export async function loadFieldViewCompanyName(): Promise<string> {
  try {
    const org = await loadOrgSettingsBlob();
    const name = typeof org.company_name === "string" ? org.company_name.trim() : "";
    if (name) return name;
  } catch {
    /* fall through */
  }
  return import.meta.env.VITE_COMPANY_NAME?.trim() || "Ironwood Commercial Builders";
}

export async function loadAllProjectsForField(): Promise<{ projects: ProjectForm[]; error: string | null }> {
  const { data, error } = await supabase.from("projects").select("*").order("job_number", { ascending: true });
  if (error) return { projects: [], error: error.message };
  return { projects: (data ?? []).map(normalizeProject), error: null };
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

export async function reloadProject(projectId: string): Promise<ProjectForm | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (error || !data) return null;
  return normalizeProject(data);
}

export async function savePaintTrackerState(
  projectId: string,
  tracker: PaintTrackerState,
  summary = "Paint tracker saved",
): Promise<string | null> {
  return patchProjectData(
    projectId,
    { paint_tracker: tracker },
    { action: "paint_tracker_saved", summary },
  );
}

export async function patchPaintTrackerSubmittalOrdered(
  projectId: string,
  submittalOrdered: boolean,
): Promise<string | null> {
  const { data, error } = await supabase.from("projects").select("data").eq("id", projectId).single();
  if (error) return error.message;
  const trade = parseProjectTradeData(parseProjectDataBlob(data?.data));
  const tracker = resolvePaintTracker(trade);
  return savePaintTrackerState(projectId, { ...tracker, submittalOrdered });
}

export async function saveProjectStartDate(projectId: string, startDate: string): Promise<string | null> {
  const { data, error } = await supabase.from("projects").select("data").eq("id", projectId).single();
  if (error) return error.message;
  const base = parseProjectDataBlob(data?.data);
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
  const { data, error } = await supabase.from("projects").select("data").eq("id", projectId).single();
  if (error) return error.message;
  const base = parseProjectDataBlob(data?.data);
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
  const superLine = row.gcSuper ? `\nSuper: ${row.gcSuper}` : "";
  return `Job #${row.jobNumber}\nJob Name: ${row.jobName}${night}${noPaint}\nAddress: ${row.jobAddress}\nGC: ${row.gcName}${superLine}`;
}
