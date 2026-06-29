import type { TransmittalContract } from "../lib/jobInfo";
import { normalizeTransmittalContract } from "../lib/jobInfo";
import {
  emptyBudgetContractSlice,
  parseBudgetByContract,
  parseBudgetContractSlice,
} from "../lib/budgetPerContract";

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

export type ManpowerBudgetPushRecord = {
  pushed_at: string;
  hours: number;
  include_supervision?: boolean;
  manpower_job_name?: string;
  pushed_by?: string;
};

/** Line items and buckets scoped to one billing contract. */
export type BudgetContractSlice = {
  grand_total: string;
  scanned_pdf_name: string;
  loaded_template_name: string;
  lines: BudgetScanLine[];
  buckets: BudgetBucket[];
  saved_at?: string;
};

export type BudgetMakerData = {
  job_name: string;
  /** Active billing contract tab in the budget editor */
  contract: TransmittalContract;
  grand_total: string;
  hide_zero_amounts: boolean;
  scanned_pdf_name: string;
  loaded_template_name: string;
  lines: BudgetScanLine[];
  buckets: BudgetBucket[];
  saved_at?: string;
  /** Per-contract budget data (paint / wallcovering / FRP / track). */
  by_contract?: Partial<Record<TransmittalContract, BudgetContractSlice>>;
  /** Set after a one-time push to Manpower Cal hours tracker */
  manpower_budget_pushed_at?: string;
  manpower_budget_hours?: number;
  manpower_budget_pushed_by?: string;
  /** Per-contract Manpower push records (paint / wallcovering / FRP / track). */
  manpower_budget_pushes?: Partial<Record<TransmittalContract, ManpowerBudgetPushRecord>>;
  /** Preference before pushing hours to Manpower (field hours only vs incl. 990). */
  manpower_push_include_supervision?: boolean;
  manpower_budget_include_supervision?: boolean;
  /** Merge rows with the same cost code on PDF / Excel export */
  combine_cost_codes_on_export?: boolean;
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

/** Line-item columns shown in the Budget Maker table (exports still include Notes). */
export const BUDGET_LINE_TABLE_COLS = PUSH_COLS.filter((c) => c !== "Notes");

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

export function emptyCostCodeRecord(): CostCodeRecord {
  return {
    gl_account: "",
    cost_code: "",
    description: "",
    type: "LABOR",
    cost_class: "",
  };
}

export function emptyEquipmentCostCodeRecord(): CostCodeRecord {
  return {
    gl_account: "",
    cost_code: "997",
    description: "Paint Equipment Owned",
    type: "EQUIPMENT",
    cost_class: "4",
  };
}

export function emptyEquipmentRentCostCodeRecord(): CostCodeRecord {
  return {
    gl_account: "",
    cost_code: "997",
    description: "Paint Equipment Rent",
    type: "EQUIPMENT",
    cost_class: "5",
  };
}

export function emptyCostClassRecord(): CostClassRecord {
  return {
    gl_acct: "",
    cost_class: "",
    description: "",
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
    by_contract: {},
  };
}

export function normalizeBudgetMaker(raw: unknown, jobName = ""): BudgetMakerData {
  const base = defaultBudgetMaker(jobName);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const contract = normalizeTransmittalContract(o.contract);
  let byContract = parseBudgetByContract(o.by_contract);

  const legacySlice = parseBudgetContractSlice({
    grand_total: o.grand_total,
    scanned_pdf_name: o.scanned_pdf_name,
    loaded_template_name: o.loaded_template_name,
    lines: o.lines,
    buckets: o.buckets,
    saved_at: o.saved_at,
  });

  if (!Object.keys(byContract).length && legacySlice) {
    byContract = { [contract]: legacySlice };
  }

  const storage: BudgetMakerData = {
    ...base,
    contract,
    hide_zero_amounts: Boolean(o.hide_zero_amounts),
    by_contract: byContract,
    manpower_budget_pushed_at:
      o.manpower_budget_pushed_at != null ? String(o.manpower_budget_pushed_at) : undefined,
    manpower_budget_hours: numOrNull(o.manpower_budget_hours) ?? undefined,
    manpower_budget_pushed_by:
      o.manpower_budget_pushed_by != null ? String(o.manpower_budget_pushed_by) : undefined,
    manpower_budget_pushes: parseManpowerBudgetPushes(o.manpower_budget_pushes),
    manpower_push_include_supervision:
      o.manpower_push_include_supervision != null
        ? Boolean(o.manpower_push_include_supervision)
        : undefined,
    manpower_budget_include_supervision:
      o.manpower_budget_include_supervision != null
        ? Boolean(o.manpower_budget_include_supervision)
        : undefined,
    combine_cost_codes_on_export:
      o.combine_cost_codes_on_export != null ? Boolean(o.combine_cost_codes_on_export) : true,
    ...emptyBudgetContractSlice(),
  };

  const active = byContract[contract] ?? legacySlice ?? emptyBudgetContractSlice();
  return {
    ...storage,
    job_name: String(o.job_name ?? jobName),
    grand_total: String(active.grand_total ?? o.grand_total ?? ""),
    scanned_pdf_name: active.scanned_pdf_name,
    loaded_template_name: active.loaded_template_name,
    lines: active.lines,
    buckets: active.buckets,
    saved_at: active.saved_at ?? (o.saved_at != null ? String(o.saved_at) : undefined),
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

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

function parseManpowerBudgetPushes(
  raw: unknown,
): Partial<Record<TransmittalContract, ManpowerBudgetPushRecord>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Partial<Record<TransmittalContract, ManpowerBudgetPushRecord>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const contract = normalizeTransmittalContract(key);
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const pushedAt = row.pushed_at != null ? String(row.pushed_at) : "";
    if (!pushedAt) continue;
    out[contract] = {
      pushed_at: pushedAt,
      hours: numOrNull(row.hours) ?? 0,
      include_supervision:
        row.include_supervision != null ? Boolean(row.include_supervision) : undefined,
      manpower_job_name:
        row.manpower_job_name != null ? String(row.manpower_job_name) : undefined,
      pushed_by: row.pushed_by != null ? String(row.pushed_by) : undefined,
    };
  }
  return Object.keys(out).length ? out : undefined;
}
