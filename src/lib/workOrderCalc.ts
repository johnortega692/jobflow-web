import type { MaterialLine, WorkOrderFormData } from "../types/workOrder";
import { sumOverlaySection } from "./workOrderOverlays";

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function parseMoney(value: string): number {
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function materialLineTotal(line: MaterialLine): number {
  const qty = line.quantity > 0 ? line.quantity : 1;
  const base = line.price * qty;
  const withMarkup = base * (1 + line.markup_percent / 100);
  return withMarkup * (1 + line.tax_percent / 100);
}

export function sumMaterialLines(lines: MaterialLine[]): number {
  return lines.reduce((sum, line) => sum + materialLineTotal(line), 0);
}

export type WorkOrderTotals = {
  raw_cost: number;
  indirects: number | null;
  labor_cost: number;
  material_cost: number;
  total_amount: number;
};

/** FSI budget columns — matches desktop Work Order Manager Jobs List. */
export type WorkOrderBudgetMetrics = {
  material_minus_10: number;
  indirects: number;
  raw_labor: number;
  budget_total: number;
};

export function computeBudgetFromCosts(
  material_cost: number,
  raw_cost: number,
  indirects: number | null,
): WorkOrderBudgetMetrics {
  const material_minus_10 = Math.ceil(material_cost * 0.9);
  const indirects_amt =
    indirects != null && indirects > 0 ? indirects : raw_cost > 0 ? Math.ceil(raw_cost * 0.1) : 0;
  const raw_labor = Math.ceil(raw_cost);
  const budget_total = material_minus_10 + indirects_amt + raw_labor;
  return { material_minus_10, indirects: indirects_amt, raw_labor, budget_total };
}

export function computeWorkOrderBudgetMetrics(form: WorkOrderFormData): WorkOrderBudgetMetrics {
  const t = computeWorkOrderTotals(form);
  return computeBudgetFromCosts(t.material_cost, t.raw_cost, t.indirects);
}

/** Next EWO number from existing rows (max numeric + 1). */
export function nextEwoNumber(ewoNumbers: string[]): string {
  const max = ewoNumbers.reduce((m, num) => {
    const n = parseInt(num, 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1).padStart(3, "0");
}

/** Compute EWO totals — uses overlay sums when present, else form fields. */
export function computeWorkOrderTotals(form: WorkOrderFormData): WorkOrderTotals {
  const hasOverlays = form.overlays.length > 0;
  const materialFromOverlays = hasOverlays ? sumOverlaySection(form.overlays, "material") : 0;
  const laborFromOverlays = hasOverlays ? sumOverlaySection(form.overlays, "labor") : 0;

  const hours = form.hours > 0 ? form.hours : 0;
  const rawRate = form.labor_raw_rate_per_hour > 0 ? form.labor_raw_rate_per_hour : form.labor_billing_rate;
  const raw_cost = hours > 0 && rawRate > 0 ? rawRate * hours : 0;

  const laborFromForm =
    hours > 0 && form.labor_billing_rate > 0 ? form.labor_billing_rate * hours : form.labor_cost;

  const materialFromLines = sumMaterialLines(form.material_lines);
  const materialFromForm = materialFromLines > 0 ? materialFromLines : form.material_cost;

  const labor_cost = hasOverlays && laborFromOverlays > 0 ? laborFromOverlays : laborFromForm;
  const material_cost =
    hasOverlays && materialFromOverlays > 0 ? materialFromOverlays : materialFromForm;

  const indirects = raw_cost > 0 ? Math.ceil(raw_cost * 0.1) : null;

  const total_amount = Math.ceil(material_cost + labor_cost);

  return {
    raw_cost,
    indirects,
    labor_cost,
    material_cost,
    total_amount,
  };
}

export function applyTotalsToForm(form: WorkOrderFormData): WorkOrderFormData {
  const totals = computeWorkOrderTotals(form);
  return {
    ...form,
    raw_cost: totals.raw_cost,
    indirects: totals.indirects,
    labor_cost: totals.labor_cost,
    material_cost: totals.material_cost,
    total_amount: totals.total_amount,
  };
}

/** Shape exported for COR / jobs.json compatibility. */
export function toJobsJsonEwo(form: WorkOrderFormData, ewoNumber: string, ewoDate: string, delivered: boolean) {
  const t = computeWorkOrderTotals(form);
  return {
    ewo_number: ewoNumber,
    date: ewoDate,
    hours: form.hours > 0 ? form.hours : null,
    labor_rate_name: form.labor_rate_name,
    labor_billing_rate: form.labor_billing_rate > 0 ? form.labor_billing_rate : null,
    labor_raw_rate_per_hour: form.labor_raw_rate_per_hour > 0 ? form.labor_raw_rate_per_hour : null,
    raw_cost: t.raw_cost,
    indirects: t.indirects,
    labor_cost: t.labor_cost,
    material_cost: t.material_cost,
    total_amount: t.total_amount,
    gc_checked: form.gc_checked,
    fsi_checked: form.fsi_checked,
    delivered,
    notes: form.notes,
  };
}
