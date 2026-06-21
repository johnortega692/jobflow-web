import {
  PAINT_VENDOR_OPTIONS,
  parseGoogleSheetsProjectFields,
  type PaintVendorLabel,
} from "./googleSheetsConfig";
import {
  buildSheetJobInfo,
  buildSheetsClipboardRow,
  jobFullAddressOneLine,
  updateManpowerSchedule,
  type GoogleSheetsSyncResult,
} from "./googleSheetsSync";
import { parseProjectDataBlob } from "./jobInfo";
import { loadRawUserSettings } from "./budgetLibrary";
import { loadPaintUserSettings } from "./paintUserSettings";
import { supabase } from "./supabase";
import {
  fieldRequestOrderUrl,
  pushFieldRequestBrushOuts,
  upsertFieldRequestJob,
} from "./fieldRequestOrderSync";
import { parseProjectTradeData } from "../types/tradeDocuments";
import type { ProjectForm, Json } from "../types/database";

export type GoogleSheetsActionContext = {
  googleUrls: Record<string, string>;
  userName: string;
  profileName: string;
  paintVendor: PaintVendorLabel;
};

function resolvePaintVendor(raw: string | undefined): PaintVendorLabel {
  const vendor = (raw ?? "").trim();
  return PAINT_VENDOR_OPTIONS.includes(vendor as PaintVendorLabel)
    ? (vendor as PaintVendorLabel)
    : "PPG";
}

export async function loadGoogleSheetsActionContext(
  userId: string,
  projectId: string,
): Promise<GoogleSheetsActionContext> {
  const [settings, { data, error }] = await Promise.all([
    loadPaintUserSettings(userId),
    supabase.from("projects").select("data").eq("id", projectId).single(),
  ]);
  if (error) throw new Error(error.message);

  const raw = await loadRawUserSettings(userId);
  const profileName =
    typeof raw.signer_name === "string" && raw.signer_name.trim()
      ? raw.signer_name.trim()
      : settings.user_name.trim();

  const blob = parseProjectDataBlob(data?.data);
  const trade = parseProjectTradeData(blob as Json);
  const savedVendor = parseGoogleSheetsProjectFields(blob.google_sheets).paint_vendor;

  return {
    googleUrls: settings.google_urls,
    userName: settings.user_name.trim(),
    profileName,
    paintVendor: resolvePaintVendor(trade.paint_submittal?.paint_vendor ?? savedVendor),
  };
}

export async function runUpdateManpower(
  project: ProjectForm,
  ctx: GoogleSheetsActionContext,
): Promise<GoogleSheetsSyncResult> {
  return updateManpowerSchedule(ctx.googleUrls.manpower_schedule, {
    jobNumber: project.job_number,
    jobName: project.job_name,
    startDate: project.jobInfo.start_date,
    gcName: project.contractor,
    jobAddress: jobFullAddressOneLine(project, project.jobInfo),
    submittedBy: ctx.userName,
  });
}

export async function runAddJobToFieldRequest(
  project: ProjectForm,
  ctx: GoogleSheetsActionContext,
): Promise<GoogleSheetsSyncResult> {
  return upsertFieldRequestJob(fieldRequestOrderUrl(ctx.googleUrls), project, ctx.profileName);
}

export async function runPushFieldRequestBrushOuts(
  project: ProjectForm,
  ctx: GoogleSheetsActionContext,
  projectId: string,
): Promise<GoogleSheetsSyncResult> {
  const { data, error } = await supabase.from("projects").select("data").eq("id", projectId).single();
  if (error) return { ok: false, message: error.message };
  const trade = parseProjectTradeData(parseProjectDataBlob(data?.data) as Json);
  const items = trade.paint_submittal?.items ?? [];
  return pushFieldRequestBrushOuts(
    fieldRequestOrderUrl(ctx.googleUrls),
    project,
    ctx.paintVendor,
    items,
  );
}

export function buildSheetsClipboardRowFromProject(project: ProjectForm): string {
  return buildSheetsClipboardRow(
    buildSheetJobInfo(project.job_number, project.job_name),
    project.jobInfo.start_date,
    project.contractor,
    jobFullAddressOneLine(project, project.jobInfo),
  );
}

export async function copySheetsRowToClipboard(project: ProjectForm): Promise<void> {
  await navigator.clipboard.writeText(buildSheetsClipboardRowFromProject(project));
}
