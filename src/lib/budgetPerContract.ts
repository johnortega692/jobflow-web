import type { TransmittalContract } from "./jobInfo";
import type {
  BudgetBucket,
  BudgetContractSlice,
  BudgetMakerData,
  BudgetScanLine,
} from "../types/budgetMaker";

export function emptyBudgetContractSlice(): BudgetContractSlice {
  return {
    grand_total: "",
    scanned_pdf_name: "",
    loaded_template_name: "",
    lines: [],
    buckets: [],
  };
}

export function extractBudgetContractSlice(draft: BudgetMakerData): BudgetContractSlice {
  return {
    grand_total: draft.grand_total,
    scanned_pdf_name: draft.scanned_pdf_name,
    loaded_template_name: draft.loaded_template_name,
    lines: draft.lines,
    buckets: draft.buckets,
    saved_at: draft.saved_at,
  };
}

/** Persist the active contract tab into `by_contract` before save or tab switch. */
export function mergeActiveBudgetContractSlice(draft: BudgetMakerData): BudgetMakerData {
  const slice = extractBudgetContractSlice(draft);
  return {
    ...draft,
    by_contract: {
      ...draft.by_contract,
      [draft.contract]: slice,
    },
  };
}

export function applyBudgetContractSlice(
  storage: BudgetMakerData,
  contract: TransmittalContract,
  jobName: string,
  defaultGrandTotal: string,
): BudgetMakerData {
  const slice = storage.by_contract?.[contract] ?? emptyBudgetContractSlice();
  return {
    ...storage,
    contract,
    job_name: jobName,
    grand_total: slice.grand_total.trim() || defaultGrandTotal,
    scanned_pdf_name: slice.scanned_pdf_name,
    loaded_template_name: slice.loaded_template_name,
    lines: slice.lines.map((line) => ({ ...line })),
    buckets: slice.buckets.map((bucket) => ({ ...bucket })),
    saved_at: slice.saved_at,
  };
}

export function parseBudgetContractSlice(raw: unknown): BudgetContractSlice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const lines = parseBudgetLines(o.lines);
  const buckets = parseBudgetBuckets(o.buckets);
  return {
    grand_total: String(o.grand_total ?? ""),
    scanned_pdf_name: String(o.scanned_pdf_name ?? ""),
    loaded_template_name: String(o.loaded_template_name ?? ""),
    lines,
    buckets,
    saved_at: o.saved_at != null ? String(o.saved_at) : undefined,
  };
}

export function parseBudgetByContract(
  raw: unknown,
): Partial<Record<TransmittalContract, BudgetContractSlice>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<TransmittalContract, BudgetContractSlice>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const contract = normalizeContractKey(key);
    if (!contract) continue;
    const slice = parseBudgetContractSlice(value);
    if (slice) out[contract] = slice;
  }
  return out;
}

function normalizeContractKey(key: string): TransmittalContract | null {
  if (key === "wallcovering" || key === "frp" || key === "track") return key;
  if (key === "paint") return "paint";
  return null;
}

function parseBudgetLines(raw: unknown): BudgetScanLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => {
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
  });
}

function parseBudgetBuckets(raw: unknown): BudgetBucket[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    const row = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
    const bucket: BudgetBucket = {
      cost_code: String(row.cost_code ?? ""),
      cost_class: String(row.cost_class ?? ""),
    };
    if (row.template_type) bucket.template_type = String(row.template_type);
    if (row.notes) bucket.notes = String(row.notes);
    return bucket;
  });
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

export function contractBudgetLineCount(
  storage: BudgetMakerData,
  contract: TransmittalContract,
): number {
  if (storage.contract === contract) return storage.lines.length;
  return storage.by_contract?.[contract]?.lines.length ?? 0;
}
