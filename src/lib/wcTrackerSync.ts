import { googleSheetsGet, googleSheetsPost } from "./googleSheetsApi";
import { wcTrackerJobName, wcTrackerJobNumber } from "./jobInfo";
import { paintTrackerBaseUrl } from "./paintTrackerSync";
import type { ProjectForm } from "../types/database";

function sheetBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1";
  }
  return false;
}

function sheetStr(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export type WcTrackerRow = {
  rowNumber: number;
  jobNumber: string;
  jobName: string;
  gcName: string;
  startDate: string;
  super: string;
  wallcoveringName: string;
  label: string;
  panels: boolean;
  ordered: boolean;
  sentForApproval: boolean;
  approved: boolean;
  fieldMeasurement: boolean;
  shops: boolean;
  materialOrder: boolean;
  delivered: boolean;
  installDate: string;
  followUp: string;
  esdFollowUp: string;
  packageQty: string;
  leadTime: string;
  approvalReceived: string;
  dateOrdered: string;
  shipDate: string;
  tracking: string;
  notesDelivered: string;
};

function parseWcTrackerRow(raw: unknown): WcTrackerRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const rowNumber = Number(o.rowNumber);
  if (!Number.isFinite(rowNumber) || rowNumber < 2) return null;
  return {
    rowNumber,
    jobNumber: sheetStr(o.jobNumber),
    jobName: sheetStr(o.jobName),
    gcName: sheetStr(o.gcName),
    startDate: sheetStr(o.startDate),
    super: sheetStr(o.super),
    wallcoveringName: sheetStr(o.wallcoveringName),
    label: sheetStr(o.label),
    panels: sheetBool(o.panels),
    ordered: sheetBool(o.ordered),
    sentForApproval: sheetBool(o.sentForApproval),
    approved: sheetBool(o.approved),
    fieldMeasurement: sheetBool(o.fieldMeasurement),
    shops: sheetBool(o.shops),
    materialOrder: sheetBool(o.materialOrder),
    delivered: sheetBool(o.delivered),
    installDate: sheetStr(o.installDate),
    followUp: sheetStr(o.followUp),
    esdFollowUp: sheetStr(o.esdFollowUp),
    packageQty: sheetStr(o.packageQty),
    leadTime: sheetStr(o.leadTime),
    approvalReceived: sheetStr(o.approvalReceived),
    dateOrdered: sheetStr(o.dateOrdered),
    shipDate: sheetStr(o.shipDate),
    tracking: sheetStr(o.tracking),
    notesDelivered: sheetStr(o.notesDelivered),
  };
}

export { paintTrackerBaseUrl as wcTrackerBaseUrl };

export async function fetchWcTrackerRows(
  baseUrl: string | undefined,
  jobNumber: string,
): Promise<{ rows: WcTrackerRow[]; error: string | null }> {
  const url = baseUrl?.trim();
  const num = jobNumber.trim();
  if (!url) return { rows: [], error: "Job Manager URL not configured in Settings." };
  if (!num) return { rows: [], error: "Enter a wallcovering job number in job setup." };

  try {
    const { status, json } = await googleSheetsGet(url, {
      action: "getJobs",
      sheet: "wallcovering",
      jobNumber: num,
    });
    if (status !== 200) return { rows: [], error: `Could not load Wallcovering Tracker (${status}).` };
    const data = json as { status?: string; message?: string; jobs?: unknown[]; data?: unknown[] };
    if (data.status !== "success") {
      return { rows: [], error: data.message ?? "Wallcovering Tracker request failed." };
    }
    const list = data.jobs ?? data.data ?? [];
    const rows = list.map(parseWcTrackerRow).filter((r): r is WcTrackerRow => r !== null);
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "Could not load Wallcovering Tracker." };
  }
}

export async function saveWcTrackerRow(
  baseUrl: string | undefined,
  row: WcTrackerRow,
): Promise<string | null> {
  const url = baseUrl?.trim();
  if (!url) return "Job Manager URL not configured in Settings.";
  if (!row.rowNumber) return "Wallcovering Tracker row number missing.";

  const payload = {
    action: "update",
    sheet: "wallcovering",
    rowNumber: row.rowNumber,
    jobName: row.jobName,
    gcName: row.gcName,
    startDate: row.startDate,
    super: row.super,
    wallcoveringName: row.wallcoveringName,
    label: row.label,
    panels: row.panels,
    ordered: row.ordered,
    sentForApproval: row.sentForApproval,
    approved: row.approved,
    fieldMeasurement: row.fieldMeasurement,
    shops: row.shops,
    materialOrder: row.materialOrder,
    delivered: row.delivered,
    installDate: row.installDate,
    followUp: row.followUp,
    esdFollowUp: row.esdFollowUp,
    packageQty: row.packageQty,
    leadTime: row.leadTime,
    approvalReceived: row.approvalReceived,
    dateOrdered: row.dateOrdered,
    shipDate: row.shipDate,
    tracking: row.tracking,
    notesDelivered: row.notesDelivered,
  };

  const { status, json } = await googleSheetsPost(url, payload);
  if (status !== 200) return `Sheets update failed (${status}).`;
  const data = json as { status?: string; message?: string };
  if (data.status !== "success") return data.message ?? "Sheets update was not successful.";
  return null;
}

export function wcRowWithProjectFields(row: WcTrackerRow, project: ProjectForm): WcTrackerRow {
  const j = project.jobInfo;
  return {
    ...row,
    jobNumber: wcTrackerJobNumber(project),
    jobName: wcTrackerJobName(project),
    gcName: project.contractor.trim(),
    startDate: j.start_date.trim(),
    super: j.gc_superintendent.trim(),
  };
}

export function wcRowSummary(row: WcTrackerRow): string {
  if (row.label.trim() && row.wallcoveringName.trim()) {
    return `${row.label} · ${row.wallcoveringName}`;
  }
  return row.label.trim() || row.wallcoveringName.trim() || `Row ${row.rowNumber}`;
}
