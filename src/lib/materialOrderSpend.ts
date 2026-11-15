import { supabase } from "./supabase";

export type MaterialOrderSpend = {
  ordered: number;
  taxPercent: number;
};

/** Paint and sundry dollars ordered in Field Tools, including the company sales tax. */
export async function fetchMaterialOrderSpend(jobNumber: string): Promise<MaterialOrderSpend | null> {
  const job = jobNumber.trim();
  if (!job) return null;
  const { data, error } = await supabase.rpc("jobflow_material_order_spend" as never, {
    p_job_number: job,
  } as never);
  if (error || !data || typeof data !== "object") return null;
  const result = data as { ok?: boolean; ordered?: unknown; tax_percent?: unknown };
  if (!result.ok) return null;
  const ordered = typeof result.ordered === "number" ? result.ordered : Number(result.ordered);
  const taxPercent = typeof result.tax_percent === "number" ? result.tax_percent : Number(result.tax_percent);
  if (!Number.isFinite(ordered)) return null;
  return { ordered, taxPercent: Number.isFinite(taxPercent) ? taxPercent : 0 };
}
