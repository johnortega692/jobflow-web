import type { JobInfoData } from "../types/jobInfo";
import { fetchProjectIsDone } from "./projectDone";
import { supabase } from "./supabase";

export type PaintWcReassignMode = "reassign" | "swap";

export type PaintWcProjectSlice = {
  job_number: string;
  job_name: string;
  jobInfo: JobInfoData;
};

export function normalizeJobNumberKey(value: string): string {
  return value.trim().toLowerCase();
}

/** True when wallcovering is on and has its own job #, different from paint. */
export function paintAndWallcoveringNumbersAreSplit(project: PaintWcProjectSlice): boolean {
  if (!project.jobInfo.has_wallcovering) return false;
  const paint = project.job_number.trim();
  const wc = project.jobInfo.wc_job_number.trim();
  return Boolean(paint) && Boolean(wc) && normalizeJobNumberKey(paint) !== normalizeJobNumberKey(wc);
}

export function paintWcReassignMode(project: PaintWcProjectSlice): PaintWcReassignMode {
  return paintAndWallcoveringNumbersAreSplit(project) ? "swap" : "reassign";
}

export type ApplyPaintWcReassignResult =
  | {
      ok: true;
      mode: PaintWcReassignMode;
      job_number: string;
      job_name: string;
      jobInfo: JobInfoData;
      previousPaintJobNumber: string;
      wallcoveringJobNumber: string;
      summary: string;
    }
  | { ok: false; error: string };

/** Current paint job # becomes wallcovering; `newPaintJobNumber` becomes the parent paint job #. */
export function reassignCurrentJobNumberToWallcovering(
  project: PaintWcProjectSlice,
  newPaintJobNumber: string,
): ApplyPaintWcReassignResult {
  const currentPaint = project.job_number.trim();
  const newPaint = newPaintJobNumber.trim();
  if (!currentPaint) return { ok: false, error: "This project has no job number yet." };
  if (!newPaint) return { ok: false, error: "Enter the real paint job number." };
  if (normalizeJobNumberKey(newPaint) === normalizeJobNumberKey(currentPaint)) {
    return { ok: false, error: "That is already this project's job number." };
  }
  if (paintAndWallcoveringNumbersAreSplit(project)) {
    const wc = project.jobInfo.wc_job_number.trim();
    return {
      ok: false,
      error: `Wallcovering already uses job # ${wc}. Swap paint and wallcovering, or change the wallcovering job # first.`,
    };
  }

  return {
    ok: true,
    mode: "reassign",
    job_number: newPaint,
    job_name: project.job_name,
    jobInfo: {
      ...project.jobInfo,
      has_wallcovering: true,
      wc_job_number: currentPaint,
    },
    previousPaintJobNumber: currentPaint,
    wallcoveringJobNumber: currentPaint,
    summary: `Paint job # set to ${newPaint}; ${currentPaint} moved to wallcovering`,
  };
}

/** Exchange the paint and wallcovering job numbers (and names / amounts when filled). */
export function swapPaintAndWallcoveringJobNumbers(project: PaintWcProjectSlice): ApplyPaintWcReassignResult {
  if (!paintAndWallcoveringNumbersAreSplit(project)) {
    return { ok: false, error: "Turn on wallcovering and enter a different wallcovering job # first." };
  }

  const currentPaint = project.job_number.trim();
  const currentWc = project.jobInfo.wc_job_number.trim();
  const currentPaintName = project.job_name.trim();
  const currentWcName = project.jobInfo.wc_job_name.trim();
  const paintAmt = project.jobInfo.contract_amount.trim();
  const wcAmt = project.jobInfo.wc_contract_amount.trim();
  const swapAmounts = Boolean(paintAmt && wcAmt);

  return {
    ok: true,
    mode: "swap",
    job_number: currentWc,
    job_name: currentWcName || currentPaintName,
    jobInfo: {
      ...project.jobInfo,
      has_wallcovering: true,
      wc_job_number: currentPaint,
      wc_job_name: currentPaintName,
      ...(swapAmounts
        ? { contract_amount: wcAmt, wc_contract_amount: paintAmt }
        : {}),
    },
    previousPaintJobNumber: currentPaint,
    wallcoveringJobNumber: currentPaint,
    summary: `Swapped job numbers: paint ${currentWc}, wallcovering ${currentPaint}`,
  };
}

export async function findOtherProjectWithJobNumber(
  jobNumber: string,
  excludeProjectId: string,
): Promise<{ id: string; job_number: string; job_name: string; isDone: boolean } | null> {
  const needle = normalizeJobNumberKey(jobNumber);
  if (!needle) return null;
  const { data, error } = await supabase.from("projects").select("id, job_number, job_name");
  if (error || !data?.length) return null;
  const match = data.find(
    (row) =>
      row.id !== excludeProjectId && normalizeJobNumberKey(row.job_number ?? "") === needle,
  );
  if (!match) return null;
  const { isDone } = await fetchProjectIsDone(match.id);
  return {
    id: match.id,
    job_number: match.job_number ?? "",
    job_name: match.job_name ?? "",
    isDone,
  };
}
