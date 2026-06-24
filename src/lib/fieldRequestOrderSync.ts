import { googleSheetsGet, googleSheetsPost } from "./googleSheetsApi";
import { jobFullAddressOneLine } from "./jobInfo";
import { collectBrushoutColors } from "./paintBrushouts";
import type { GoogleSheetsSyncResult } from "./googleSheetsSync";
import type { ProjectForm } from "../types/database";
import type { JobInfoData } from "../types/jobInfo";
import type { PaintItem } from "../types/tradeDocuments";

export type FieldRequestStaffLists = {
  pms: string[];
  supers: string[];
};

/** PM / Super sent to Field Request Jobs sheet — must match PMs / Supers tabs exactly. */
export function fieldRequestPm(jobInfo: JobInfoData, profileName = ""): string {
  return jobInfo.field_request_pm.trim() || jobInfo.icbi_pm.trim() || profileName.trim();
}

export function fieldRequestSuper(jobInfo: JobInfoData): string {
  return jobInfo.field_request_super.trim();
}

/** Field Request Order web app — falls back to legacy brushouts URL. */
export function fieldRequestOrderUrl(urls: Record<string, string>): string {
  return (urls.field_request_order || urls.brushouts_tracker || "").trim();
}

export async function fetchFieldRequestStaffLists(
  webAppUrl: string | undefined,
): Promise<{ lists: FieldRequestStaffLists; error: string | null }> {
  const url = webAppUrl?.trim();
  if (!url) {
    return { lists: { pms: [], supers: [] }, error: "Field Request Order URL not configured in Settings." };
  }
  try {
    const { status, json } = await googleSheetsGet(url, { action: "getStaffLists" });
    if (status !== 200) {
      return { lists: { pms: [], supers: [] }, error: `Could not load PM/Super lists (${status}).` };
    }
    const data = json as { success?: boolean; pms?: unknown; supers?: unknown; error?: string };
    if (data.success === false) {
      return { lists: { pms: [], supers: [] }, error: data.error ?? "Staff list request failed." };
    }
    const pms = Array.isArray(data.pms)
      ? data.pms.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const supers = Array.isArray(data.supers)
      ? data.supers.map((v) => String(v).trim()).filter(Boolean)
      : [];
    return { lists: { pms, supers }, error: null };
  } catch (e) {
    return {
      lists: { pms: [], supers: [] },
      error: e instanceof Error ? e.message : "Could not load PM/Super lists.",
    };
  }
}

export async function upsertFieldRequestJob(
  webAppUrl: string | undefined,
  project: ProjectForm,
  profileName = "",
): Promise<GoogleSheetsSyncResult> {
  const url = webAppUrl?.trim();
  if (!url) {
    return { ok: false, message: "Field Request Order URL not configured in Settings." };
  }

  const jobCode = project.job_number.trim();
  const jobName = project.job_name.trim();
  if (!jobCode || !jobName) {
    return { ok: false, message: "Job number and job name are required." };
  }

  const j = project.jobInfo;
  const pm = fieldRequestPm(j, profileName);
  const superName = fieldRequestSuper(j);
  if (!pm) {
    return {
      ok: false,
      message: "Select a Field Request PM in job setup (must match the PMs sheet exactly).",
    };
  }
  if (!superName || superName.toUpperCase() === "TBD") {
    return {
      ok: false,
      message: "Select a Field Request Super in job setup (must match the Supers sheet exactly).",
    };
  }

  const payload = {
    jobCode,
    jobName,
    pm,
    super: superName,
    address: jobFullAddressOneLine(project, j),
  };

  try {
    const { status, json } = await googleSheetsPost(url, payload, { action: "upsertJob" });
    if (status !== 200) {
      return { ok: false, message: `Field Request job sync failed (${status}).` };
    }
    const data = json as { success?: boolean; message?: string; error?: string };
    if (data.success === false) {
      return { ok: false, message: data.error ?? data.message ?? "Field Request job sync failed." };
    }
    return {
      ok: true,
      message: data.message ?? `Job ${jobCode} added to Field Request Jobs sheet.`,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Field Request job sync failed.",
    };
  }
}

export async function pushFieldRequestBrushOuts(
  webAppUrl: string | undefined,
  project: ProjectForm,
  paintVendor: string,
  items: PaintItem[],
): Promise<GoogleSheetsSyncResult> {
  const url = webAppUrl?.trim();
  if (!url) {
    return { ok: false, message: "Field Request Order URL not configured in Settings." };
  }

  const jobNumber = project.job_number.trim();
  const jobName = project.job_name.trim();
  if (!jobNumber || !jobName) {
    return { ok: false, message: "Job number and job name are required." };
  }

  const paintItems = collectBrushoutColors(items);
  if (!paintItems.length) {
    return {
      ok: false,
      message: "No paint colors on the submittal. Add paint lines with colors on the Paint tab first.",
    };
  }

  const formData = {
    job_number: `${jobNumber} ${jobName}`.trim(),
    paint_vendor: paintVendor.trim() || "PPG",
    paint_items: paintItems,
    mode: "merge" as const,
  };

  try {
    const res = await fetch("/api/brushouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, payload: formData }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; body?: string };
    if (!res.ok) {
      return { ok: false, message: body.error ?? `BrushOuts push failed (${res.status}).` };
    }

    let message = `Brush outs pushed for ${formData.job_number} (${paintItems.length} color(s)).`;
    if (body.body) {
      try {
        const parsed = JSON.parse(body.body) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        /* use default message */
      }
    }
    return { ok: true, message };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "BrushOuts push failed.",
    };
  }
}
