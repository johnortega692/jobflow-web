import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { parseSheenSelection } from "./paintCatalog";
import { isStandalonePrimerBrushout, type ApprovedBrushoutDraft } from "./approvedBrushouts";

export type PaintEstimateRole = "finish" | "primer" | "custom";

export type PaintEstimateDraft = {
  key: string;
  product: string;
  sheen: string;
  role: PaintEstimateRole;
  /** Typed value. Blank means no estimate yet. */
  gallons: string;
  notes: string;
  orderedGallons: number;
  /** Saved before, but the product is no longer on the brush-out list. */
  offList: boolean;
};

type SavedEstimate = {
  id: string;
  product: string;
  sheen: string;
  estimated_gallons: number | string;
  notes: string;
  ordered_gallons: number | string;
};

/** Not in the generated Database types yet. */
function estimatesTable() {
  return (supabase as unknown as SupabaseClient).from("project_paint_estimates");
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function paintEstimateKey(product: string, sheen: string): string {
  return `${fold(product)}|${fold(sheen)}`;
}

function formatGallons(value: number): string {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function gallonsLabel(value: number): string {
  return `${formatGallons(value)} gal`;
}

export function parseEstimateGallons(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** One row per product and sheen on the brush-outs, then their primers. */
function brushoutEstimateTargets(rows: ApprovedBrushoutDraft[]): Omit<PaintEstimateDraft, "gallons" | "notes" | "orderedGallons" | "offList">[] {
  const finishes: Omit<PaintEstimateDraft, "gallons" | "notes" | "orderedGallons" | "offList">[] = [];
  const primers: typeof finishes = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (isStandalonePrimerBrushout(row)) continue;
    const product = row.product.trim();
    if (!product) continue;
    const sheens = parseSheenSelection(row.sheen);
    for (const sheen of sheens.length ? sheens : [""]) {
      const key = paintEstimateKey(product, sheen);
      if (seen.has(key)) continue;
      seen.add(key);
      finishes.push({ key, product, sheen, role: "finish" });
    }
  }
  for (const row of rows) {
    if (row.self_priming) continue;
    const primer = row.primer_name?.trim() ?? "";
    if (!primer) continue;
    const key = paintEstimateKey(primer, "");
    if (seen.has(key)) continue;
    seen.add(key);
    primers.push({ key, product: primer, sheen: "", role: "primer" });
  }
  return [...finishes, ...primers];
}

/** Brush-out products with any saved gallons. Saved rows no longer on the list stay so nothing is lost. */
export function mergePaintEstimates(
  brushoutRows: ApprovedBrushoutDraft[],
  saved: SavedEstimate[],
): PaintEstimateDraft[] {
  const savedByKey = new Map(saved.map((row) => [paintEstimateKey(row.product, row.sheen), row]));
  const targets = brushoutEstimateTargets(brushoutRows);
  const out: PaintEstimateDraft[] = targets.map((target) => {
    const match = savedByKey.get(target.key);
    savedByKey.delete(target.key);
    return {
      ...target,
      gallons: match ? formatGallons(Number(match.estimated_gallons)) : "",
      notes: match?.notes ?? "",
      orderedGallons: match ? Number(match.ordered_gallons) || 0 : 0,
      offList: false,
    };
  });
  for (const row of savedByKey.values()) {
    out.push({
      key: paintEstimateKey(row.product, row.sheen),
      product: row.product,
      sheen: row.sheen,
      role: "custom",
      gallons: formatGallons(Number(row.estimated_gallons)),
      notes: row.notes ?? "",
      orderedGallons: Number(row.ordered_gallons) || 0,
      offList: true,
    });
  }
  return out;
}

export async function loadPaintEstimates(projectId: string, jobNumber: string): Promise<SavedEstimate[]> {
  const { data, error } = await estimatesTable()
    .select("id, product, sheen, estimated_gallons, notes")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Omit<SavedEstimate, "ordered_gallons">[];

  const ordered = new Map<string, number>();
  if (jobNumber.trim()) {
    const { data: progress, error: progressError } = await supabase.rpc(
      "job_paint_estimate_progress" as never,
      { p_job_number: jobNumber.trim() } as never,
    );
    if (progressError) throw new Error(progressError.message);
    for (const item of (Array.isArray(progress) ? progress : []) as SavedEstimate[]) {
      ordered.set(item.id, Number(item.ordered_gallons) || 0);
    }
  }
  return rows.map((row) => ({ ...row, ordered_gallons: ordered.get(row.id) ?? 0 }));
}

export type LastMinUncounted = { count: number; amount: number };

/** Last-min receipts on the job with no paint lines. Their gallons are not in ordered. */
export async function loadLastMinUncounted(jobNumber: string): Promise<LastMinUncounted> {
  if (!jobNumber.trim()) return { count: 0, amount: 0 };
  const { data, error } = await supabase.rpc(
    "job_last_min_uncounted" as never,
    { p_job_number: jobNumber.trim() } as never,
  );
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { count?: number | string; amount?: number | string };
  return { count: Number(result.count) || 0, amount: Number(result.amount) || 0 };
}

export function lastMinUncountedLabel(value: LastMinUncounted, jobNumber: string): string {
  if (!value.count) return "";
  const amount = `$${value.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const job = jobNumber.trim() ? ` on job ${jobNumber.trim()}` : "";
  return value.count === 1
    ? `1 last-min receipt${job} (${amount}) has no gallons and isn't counted in Ordered.`
    : `${value.count} last-min receipts${job} (${amount}) have no gallons and aren't counted in Ordered.`;
}

/** Rows with gallons or a note are kept. Everything else for this project is cleared. */
export async function savePaintEstimates(
  projectId: string,
  jobNumber: string,
  rows: PaintEstimateDraft[],
  updatedByName: string,
): Promise<void> {
  const now = new Date().toISOString();
  const keep = new Map<string, PaintEstimateDraft>();
  for (const row of rows) {
    const gallons = parseEstimateGallons(row.gallons);
    if (!row.product.trim() || (gallons === null && !row.notes.trim())) continue;
    keep.set(paintEstimateKey(row.product, row.sheen), row);
  }

  const { error: deleteError } = await estimatesTable()
    .delete()
    .eq("project_id", projectId);
  if (deleteError) throw new Error(deleteError.message);
  if (!keep.size) return;

  const payload = [...keep.values()].map((row) => ({
    project_id: projectId,
    job_number: jobNumber.trim(),
    product: row.product.trim(),
    sheen: row.sheen.trim(),
    estimated_gallons: parseEstimateGallons(row.gallons) ?? 0,
    notes: row.notes.trim(),
    updated_by_name: updatedByName.trim(),
    updated_at: now,
  }));
  const { error: insertError } = await estimatesTable().insert(payload);
  if (insertError) throw new Error(insertError.message);
}
