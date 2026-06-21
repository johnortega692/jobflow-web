import type { TransmittalContract } from "../lib/jobInfo";
import { normalizeTransmittalContract } from "../lib/jobInfo";

export type CostCodeRecord = {
  gl_account: string;
  cost_code: string;
  description: string;
  type: string;
  cost_class: string;
};

export type CostClassRecord = {
  gl_acct: string;
  cost_class: string;
  description: string;
};

export type BudgetBucket = {
  cost_code: string;
  cost_class: string;
  template_type?: string;
  notes?: string;
};

export type BucketTemplate = {
  name: string;
  buckets: BudgetBucket[];
};

export type BudgetLibrary = {
  cost_codes: CostCodeRecord[];
  cost_classes: CostClassRecord[];
  bucket_templates: BucketTemplate[];
  default_bucket_template: string;
};

export type BudgetScanLine = {
  id: string;
  Bucket: string;
  Category: string;
  "PDF Code": string;
  Description: string;
  Quantity: number | null;
  UoM: string;
  "Unit Cost": number | null;
  Amount: number | null;
  "Man Hours": number | null;
  Notes: string;
  Hidden: boolean;
};

export type BudgetMakerData = {
  job_name: string;
  /** Billing contract identity for exports */
  contract: TransmittalContract;
  grand_total: string;
  hide_zero_amounts: boolean;
  scanned_pdf_name: string;
  loaded_template_name: string;
  lines: BudgetScanLine[];
  buckets: BudgetBucket[];
  saved_at?: string;
};

export const CODE_TYPES = ["LABOR", "MATERIALS", "EQUIPMENT", "SUBCONTRACTOR", "MISC"] as const;

export const TYPE_DEFAULT_CLASS: Record<string, string> = {
  LABOR: "1",
  MATERIALS: "2",
  SUBCONTRACTOR: "3",
  EQUIPMENT: "4",
  EQUIPMENT_RENTED: "5",
  MISC: "7",
};

export const TEMPLATE_OPTIONS: { label: string; key: string | null }[] = [
  { label: "Custom", key: null },
  { label: "Labor (class 1)", key: "LABOR" },
  { label: "Materials (class 2)", key: "MATERIALS" },
  { label: "Subcontractor (class 3)", key: "SUBCONTRACTOR" },
  { label: "Equipment – owned (class 4)", key: "EQUIPMENT" },
  { label: "Equipment – rented (class 5)", key: "EQUIPMENT_RENTED" },
  { label: "Misc/Other (class 7)", key: "MISC" },
];

export const TEMPLATE_LABELS: Record<string, string> = Object.fromEntries(
  TEMPLATE_OPTIONS.filter((o) => o.key).map((o) => [o.key!, o.label]),
);

export const PUSH_COLS = [
  "Bucket",
  "Category",
  "PDF Code",
  "Description",
  "Quantity",
  "UoM",
  "Unit Cost",
  "Amount",
  "Man Hours",
  "Notes",
] as const;

export const SUMMARY_COLS = [
  "Work Item",
  "Cost Code",
  "Cost Class",
  "GL Acct",
  "Hours",
  "Amount",
  "%",
  "Notes",
] as const;

export function defaultBudgetLibrary(): BudgetLibrary {
  return {
    cost_codes: [],
    cost_classes: [],
    bucket_templates: [],
    default_bucket_template: "",
  };
}

export function defaultBudgetMaker(jobName = ""): BudgetMakerData {
  return {
    job_name: jobName,
    contract: "paint",
    grand_total: "",
    hide_zero_amounts: false,
    scanned_pdf_name: "",
    loaded_template_name: "",
    lines: [],
    buckets: [],
  };
}

export function emptyBudgetScanLine(): BudgetScanLine {
  return {
    id: crypto.randomUUID(),
    Bucket: "",
    Category: "",
    "PDF Code": "",
    Description: "",
    Quantity: null,
    UoM: "",
    "Unit Cost": null,
    Amount: null,
    "Man Hours": null,
    Notes: "",
    Hidden: false,
  };
}

export const BUDGET_LINE_CATEGORIES = [
  "Material",
  "Labor",
  "Equipment",
  "Other",
  "Subcontractor",
] as const;

export const BUDGET_UOM_OPTIONS = ["EA", "LF", "SF", "LY", "SY", "CY", "HR", "MO", "LS", "GAL"] as const;

export function parseBudgetNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(/[$,]/g, ""));
  return Number.isNaN(n) ? null : n;
}

export function normalizeBudgetMaker(raw: unknown, jobName = ""): BudgetMakerData {
  const base = defaultBudgetMaker(jobName);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const lines = Array.isArray(o.lines)
    ? o.lines.map((r, i) => {
        const row = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
        return {
          id: String(row.id ?? `line-${i}`),
          Bucket: String(row.Bucket ?? ""),
          Category: String(row.Category ?? ""),
          "PDF Code": String(row["PDF Code"] ?? row.pdf_code ?? ""),
          Description: String(row.Description ?? ""),
          Quantity: numOrNull(row.Quantity),
          UoM: String(row.UoM ?? ""),
          "Unit Cost": numOrNull(row["Unit Cost"] ?? row.unit_cost),
          Amount: numOrNull(row.Amount),
          "Man Hours": numOrNull(row["Man Hours"] ?? row.man_hours),
          Notes: String(row.Notes ?? ""),
          Hidden: Boolean(row.Hidden),
        };
      })
    : base.lines;
  const buckets = Array.isArray(o.buckets)
    ? o.buckets.map((b) => {
        const row = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
        const bucket: BudgetBucket = {
          cost_code: String(row.cost_code ?? ""),
          cost_class: String(row.cost_class ?? ""),
        };
        if (row.template_type) bucket.template_type = String(row.template_type);
        if (row.notes) bucket.notes = String(row.notes);
        return bucket;
      })
    : base.buckets;
  return {
    job_name: String(o.job_name ?? jobName),
    contract: normalizeTransmittalContract(o.contract),
    grand_total: String(o.grand_total ?? ""),
    hide_zero_amounts: Boolean(o.hide_zero_amounts),
    scanned_pdf_name: String(o.scanned_pdf_name ?? ""),
    loaded_template_name: String(o.loaded_template_name ?? ""),
    lines,
    buckets,
    saved_at: o.saved_at != null ? String(o.saved_at) : undefined,
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}
