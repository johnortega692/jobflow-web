import { fieldViewRpcAuthArgs, loadFieldViewSession } from "./fieldViewAuth";
import { supabase } from "./supabase";
import {
  defaultProjectBilling,
  normalizeManpowerCells,
  parseProjectBilling,
  type ManpowerCell,
  type ProjectBillingData,
} from "../types/projectBilling";

export type FieldLaborProjectionSummary = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  startDate: string;
  endDate: string;
  weekCount: number;
  /** Planned hours in Labor Projection grid. */
  totalHours: number;
  /** Alias of totalHours — hours entered in the projection. */
  projectionHours: number;
  /** Field labor hours from Budget Maker (excludes cost code 990). */
  budgetHours: number;
  /** budgetHours − projectionHours (positive = hours left vs budget). */
  hoursDifference: number;
  cells: ManpowerCell[];
};

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function parseLaborProjectionPayload(raw: unknown): FieldLaborProjectionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const projectId = String(o.project_id ?? "").trim();
  if (!projectId) return null;
  const projectionHours = Math.max(0, num(o.projection_hours ?? o.total_hours, 0));
  // Whole hours only for Budget Maker display/compare (e.g. 15.7 → 15).
  const budgetHours = Math.max(0, Math.floor(num(o.budget_hours, 0)));
  const hoursDifference = budgetHours - projectionHours;
  return {
    projectId,
    jobNumber: String(o.job_number ?? "").trim(),
    jobName: String(o.job_name ?? "").trim(),
    startDate: String(o.start_date ?? "").trim(),
    endDate: String(o.end_date ?? "").trim(),
    weekCount: Math.max(1, Math.round(num(o.week_count, 8)) || 8),
    totalHours: projectionHours,
    projectionHours,
    budgetHours,
    hoursDifference,
    cells: normalizeManpowerCells(o.cells),
  };
}

/** Build a billing blob for shared plan UI helpers from a Field plan payload. */
export function billingFromLaborProjection(plan: FieldLaborProjectionSummary): ProjectBillingData {
  const base = defaultProjectBilling();
  return {
    ...base,
    manpowerWeekCount: plan.weekCount,
    manpowerCells: plan.cells,
  };
}

export function formatLaborHours(hours: number): string {
  if (!Number.isFinite(hours) || hours === 0) return "0";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** Whole hours for Budget Maker card (drops decimals). */
export function formatBudgetMakerHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0";
  return String(Math.max(0, Math.floor(hours)));
}

export async function listFieldLaborProjections(): Promise<{
  plans: FieldLaborProjectionSummary[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc(
    "field_view_list_labor_projections" as never,
    fieldViewRpcAuthArgs(loadFieldViewSession()) as never,
  );
  if (error) return { plans: [], error: error.message };
  const rows = Array.isArray(data) ? data : [];
  const plans = rows
    .map(parseLaborProjectionPayload)
    .filter((p): p is FieldLaborProjectionSummary => Boolean(p));
  return { plans, error: null };
}

export async function getFieldLaborProjection(
  projectId: string,
): Promise<{ plan: FieldLaborProjectionSummary | null; error: string | null }> {
  const { data, error } = await supabase.rpc("field_view_get_labor_projection" as never, {
    p_project_id: projectId,
    ...fieldViewRpcAuthArgs(loadFieldViewSession()),
  } as never);
  if (error) return { plan: null, error: error.message };
  return { plan: parseLaborProjectionPayload(data), error: null };
}

export async function saveFieldLaborProjectionCells(
  projectId: string,
  cells: ManpowerCell[],
  userName = "Field view",
): Promise<{ plan: FieldLaborProjectionSummary | null; error: string | null }> {
  const { data, error } = await supabase.rpc("field_view_save_labor_projection" as never, {
    p_project_id: projectId,
    p_cells: cells,
    p_user_name: userName,
    ...fieldViewRpcAuthArgs(loadFieldViewSession()),
  } as never);
  if (error) return { plan: null, error: error.message };
  return { plan: parseLaborProjectionPayload(data), error: null };
}

/** Office helper: merge cells into existing billing without touching week count. */
export function withLaborProjectionCells(
  billing: ProjectBillingData | null | undefined,
  cells: ManpowerCell[],
): ProjectBillingData {
  const base = billing ? { ...billing } : parseProjectBilling(null);
  return { ...base, manpowerCells: normalizeManpowerCells(cells) };
}
