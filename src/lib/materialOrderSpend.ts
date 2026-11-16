import { supabase } from "./supabase";

export type MaterialOrderSpend = {
  budget: number;
  ordered: number;
  taxPercent: number;
};

export function formatMaterialDollars(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Paint and sundry dollars ordered in Field Tools, including the company sales tax. */
export async function fetchMaterialOrderSpend(jobNumber: string): Promise<MaterialOrderSpend | null> {
  const job = jobNumber.trim();
  if (!job) return null;
  const { data, error } = await supabase.rpc("jobflow_material_order_spend" as never, {
    p_job_number: job,
  } as never);
  if (error || !data || typeof data !== "object") return null;
  const result = data as { ok?: boolean; budget?: unknown; ordered?: unknown; tax_percent?: unknown };
  if (!result.ok) return null;
  const budget = typeof result.budget === "number" ? result.budget : Number(result.budget);
  const ordered = typeof result.ordered === "number" ? result.ordered : Number(result.ordered);
  const taxPercent = typeof result.tax_percent === "number" ? result.tax_percent : Number(result.tax_percent);
  if (!Number.isFinite(budget) || !Number.isFinite(ordered)) return null;
  return { budget, ordered, taxPercent: Number.isFinite(taxPercent) ? taxPercent : 0 };
}
