import {
  PAINT_VENDOR_OPTIONS,
  parseGoogleSheetsProjectFields,
  type PaintVendorLabel,
} from "./googleSheetsConfig";
import {
  buildSheetJobInfo,
  buildSheetsClipboardRow,
  jobFullAddressOneLine,
  type GoogleSheetsSyncResult,
} from "./googleSheetsSync";
import { parseProjectDataBlob } from "./jobInfo";
import { loadRawUserSettings } from "./budgetLibrary";
import { applyBrushoutPushedSnapshot, sendToBrushoutsTracker } from "./paintBrushouts";
import { commitProjectUpdate } from "./projectActivity";
import { loadPaintUserSettings } from "./paintUserSettings";
import { supabase } from "./supabase";
import {
  fieldRequestOrderUrl,
  upsertFieldRequestJob,
} from "./fieldRequestOrderSync";
import {
  normalizePaintSubmittal,
  parseProjectTradeData,
  type PaintSubmittalData,
} from "../types/tradeDocuments";
import type { ProjectForm, Json } from "../types/database";

export type GoogleSheetsActionContext = {
  googleUrls: Record<string, string>;
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
    profileName,
    paintVendor: resolvePaintVendor(trade.paint_submittal?.paint_vendor ?? savedVendor),
  };
}

export async function runAddJobToFieldRequest(
  project: ProjectForm,
  ctx: GoogleSheetsActionContext,
): Promise<GoogleSheetsSyncResult> {
  return upsertFieldRequestJob(fieldRequestOrderUrl(ctx.googleUrls), project, ctx.profileName);
}

export async function runPushFieldRequestBrushOutsSelected(
  project: ProjectForm,
  ctx: GoogleSheetsActionContext,
  projectId: string,
  vendor: string,
  selectedIndices: number[],
): Promise<GoogleSheetsSyncResult> {
  if (!project.job_number.trim() || !project.job_name.trim()) {
    return { ok: false, message: "Job number and job name are required." };
  }

  const { data, error } = await supabase.from("projects").select("data").eq("id", projectId).single();
  if (error) return { ok: false, message: error.message };

  const blob = parseProjectDataBlob(data?.data);
  const trade = parseProjectTradeData(blob as Json);
  const paintSubmittal = normalizePaintSubmittal(trade.paint_submittal);
  const items = paintSubmittal.items;

  try {
    const pushedItems = selectedIndices.map((i) => items[i]!).filter(Boolean);
    const { message } = await sendToBrushoutsTracker(
      fieldRequestOrderUrl(ctx.googleUrls),
      project.job_number,
      project.job_name,
      vendor,
      items,
      { mode: "merge", selectedIndices },
    );
    const nextPaintSubmittal: PaintSubmittalData = {
      ...paintSubmittal,
      paint_vendor: vendor,
      brushout_pushed: applyBrushoutPushedSnapshot(paintSubmittal.brushout_pushed, pushedItems),
    };
    const persistErr = await commitProjectUpdate({
      projectId,
      mergeData: { paint_submittal: nextPaintSubmittal },
      activity: {
        action: "paint_submittal_saved",
        summary: "Brush outs pushed to Field Request sheet.",
      },
    });
    if (persistErr) return { ok: false, message: persistErr };
    return { ok: true, message };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "BrushOuts push failed.",
    };
  }
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
