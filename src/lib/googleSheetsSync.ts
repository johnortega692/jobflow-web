import type { JobInfoData } from "../types/jobInfo";
import type { ProjectForm } from "../types/database";
import { jobCityZipCountyLine } from "./jobInfo";
import { googleSheetsGet, googleSheetsPost } from "./googleSheetsApi";
import { PAINT_VENDOR_CODES, type PaintVendorLabel } from "./googleSheetsConfig";

export function jobFullAddressOneLine(
  project: Pick<ProjectForm, "job_address" | "job_address2">,
  info: JobInfoData,
): string {
  const line = jobCityZipCountyLine(info);
  return [project.job_address.trim(), line].filter(Boolean).join(", ");
}

export function buildSheetJobInfo(jobNumber: string, jobName: string): string {
  const n = jobNumber.trim();
  const name = jobName.trim();
  if (n && name) return `${n} - ${name}`;
  return n || name;
}

export function buildSheetsClipboardRow(
  sheetJobInfo: string,
  startDate: string,
  gc: string,
  location: string,
): string {
  return [sheetJobInfo, startDate, gc, location].join("\t");
}

export async function updateManpowerSchedule(
  url: string | undefined,
  fields: {
    jobNumber: string;
    jobName: string;
    startDate: string;
    gcName: string;
    jobAddress: string;
    submittedBy: string;
  },
): Promise<string> {
  if (!url?.trim()) return "Manpower Schedule URL not configured in Settings.";
  const payload = {
    jobNumber: `${fields.jobNumber} ${fields.jobName}`.trim(),
    startDate: fields.startDate,
    gcName: fields.gcName,
    jobAddress: fields.jobAddress,
    submittedBy: fields.submittedBy,
  };
  const { status, json } = await googleSheetsPost(url, payload);
  if (status !== 200) return `Manpower update failed (${status}).`;
  const data = json as { status?: string; message?: string; sheetName?: string };
  if (data.status === "success") {
    return data.sheetName ? `Added to sheet: ${data.sheetName}` : "Added to Manpower Schedule.";
  }
  return data.message ?? "Manpower update was not successful.";
}

export async function testManpowerUserName(
  url: string | undefined,
  userName: string,
): Promise<string> {
  if (!userName.trim()) return "Enter a user name first.";
  return updateManpowerSchedule(url, {
    jobNumber: `TEST-${userName}-001`,
    jobName: "Test Job",
    startDate: "Test Date",
    gcName: "Test GC",
    jobAddress: "Test Address",
    submittedBy: userName.trim(),
  });
}

export async function copyToPaintTracker(
  url: string | undefined,
  fields: {
    jobNumber: string;
    jobName: string;
    jobAddress: string;
    gcName: string;
    gcSuper: string;
    startDate: string;
    paintVendor: PaintVendorLabel;
    userName: string;
  },
): Promise<string> {
  if (!url?.trim()) return "Paint Tracker URL not configured in Settings.";
  if (!fields.jobNumber.trim() || !fields.jobName.trim()) {
    return "Job number and job name are required.";
  }
  if (!fields.jobAddress.trim() || !fields.gcName.trim()) {
    return "Job address and GC name are required.";
  }

  const payload = {
    jobNumber: fields.jobNumber.trim(),
    jobName: fields.jobName.trim(),
    jobAddress: fields.jobAddress.trim(),
    gcName: fields.gcName.trim(),
    gcSuper: fields.gcSuper.trim(),
    startDate: fields.startDate.trim(),
    paintVendor: PAINT_VENDOR_CODES[fields.paintVendor] ?? fields.paintVendor,
    userName: fields.userName.trim(),
  };

  const { status, json } = await googleSheetsPost(url, payload);
  if (status !== 200) return `Paint Tracker update failed (${status}).`;
  const data = json as { status?: string; message?: string };
  if (data.status === "success") return data.message ?? "Added to Paint Tracker.";
  return data.message ?? "Paint Tracker update was not successful.";
}

export async function findPaintTrackerRow(
  baseUrl: string,
  jobNumber: string,
): Promise<number | null> {
  const { status, json } = await googleSheetsGet(baseUrl, {
    action: "getJobs",
    sheet: "paint",
    jobNumber: jobNumber.trim(),
  });
  if (status !== 200) return null;
  const data = json as { data?: { rowNumber?: number }[]; jobs?: { rowNumber?: number }[] };
  const rows = data.data ?? data.jobs ?? [];
  return rows[0]?.rowNumber ?? null;
}

export async function updatePaintTrackerFlags(
  baseUrl: string | undefined,
  jobNumber: string,
  flags: { submittalOrdered?: boolean; nightsWeekends?: boolean },
): Promise<string | null> {
  if (!baseUrl?.trim()) return "Google Sheets URL not configured in Settings.";
  const rowNumber = await findPaintTrackerRow(baseUrl, jobNumber);
  if (!rowNumber) return "Job not found in Paint Tracker sheet.";

  const { status, json } = await googleSheetsPost(baseUrl, {
    action: "update",
    sheet: "paint",
    rowNumber,
    ...(flags.submittalOrdered !== undefined ? { submittalOrdered: flags.submittalOrdered } : {}),
    ...(flags.nightsWeekends !== undefined ? { nightsWeekends: flags.nightsWeekends } : {}),
  });
  if (status !== 200) return `Sheets update failed (${status}).`;
  const data = json as { status?: string; message?: string };
  if (data.status !== "success") return data.message ?? "Sheets update was not successful.";
  return null;
}
