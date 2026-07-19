import type { Database, Json } from "./database.generated";
export type { Database, Json };
import type { JobInfoData } from "./jobInfo";
import { normalizeJobInfo, normalizeTransmittalContract, type TransmittalContract } from "../lib/jobInfo";
import { normalizeRfiImpactFields } from "../lib/rfiFormLabels";

export type RfiAttachedFile = {
  id: string;
  filename: string;
  storage_path: string;
};

export interface RfiFormData {
  rfi_date: string;
  due_date: string;
  to_name: string;
  attn_name: string;
  from_name: string;
  spec_ref: string;
  drawing_ref: string;
  detail_no: string;
  cost_change: string;
  sched_change: string;
  question: string;
  solution_text: string;
  impact_notes: string;
  pdf_show_solution: boolean;
  pdf_show_response: boolean;
  reason_insufficient: boolean;
  reason_conflict: boolean;
  reason_alternate: boolean;
  action_clarification: boolean;
  action_direction: boolean;
  action_approval: boolean;
  effect_increase_cost: boolean;
  effect_decrease_cost: boolean;
  effect_unknown_cost: boolean;
  effect_increase_time: boolean;
  effect_decrease_time: boolean;
  effect_unknown_time: boolean;
  attach_photos: boolean;
  attach_markup: boolean;
  attach_submittal: boolean;
  attach_other: string;
  attached_files: RfiAttachedFile[];
  /** Set when status is Closed; cleared on reopen. Used by the RFI log. */
  closed_date: string;
  /** Billing contract identity for this RFI */
  contract: TransmittalContract;
}

export const defaultRfiFormData = (): RfiFormData => {
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 7);
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  return {
    rfi_date: fmt(today),
    due_date: fmt(due),
    to_name: "",
    attn_name: "",
    from_name: "",
    spec_ref: "",
    drawing_ref: "",
    detail_no: "",
    cost_change: "",
    sched_change: "",
    question: "",
    solution_text: "",
    impact_notes: "",
    pdf_show_solution: false,
    pdf_show_response: true,
    reason_insufficient: false,
    reason_conflict: false,
    reason_alternate: false,
    action_clarification: false,
    action_direction: false,
    action_approval: false,
    effect_increase_cost: false,
    effect_decrease_cost: false,
    effect_unknown_cost: false,
    effect_increase_time: false,
    effect_decrease_time: false,
    effect_unknown_time: false,
    attach_photos: false,
    attach_markup: false,
    attach_submittal: false,
    attach_other: "",
    attached_files: [],
    closed_date: "",
    contract: "paint",
  };
};

export function normalizeRfiAttachedFiles(raw: unknown): RfiAttachedFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const filename = typeof o.filename === "string" ? o.filename : "";
      const storage_path = typeof o.storage_path === "string" ? o.storage_path : "";
      if (!id || !filename || !storage_path) return null;
      return { id, filename, storage_path };
    })
    .filter((f): f is RfiAttachedFile => Boolean(f));
}

function rfiBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

export function normalizeRfiFormData(raw: unknown): RfiFormData {
  const base = defaultRfiFormData();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  return normalizeRfiImpactFields({
    ...base,
    rfi_date: typeof o.rfi_date === "string" ? o.rfi_date : base.rfi_date,
    due_date: typeof o.due_date === "string" ? o.due_date : base.due_date,
    to_name: typeof o.to_name === "string" ? o.to_name : base.to_name,
    attn_name: typeof o.attn_name === "string" ? o.attn_name : base.attn_name,
    from_name: typeof o.from_name === "string" ? o.from_name : base.from_name,
    spec_ref: typeof o.spec_ref === "string" ? o.spec_ref : base.spec_ref,
    drawing_ref: typeof o.drawing_ref === "string" ? o.drawing_ref : base.drawing_ref,
    detail_no: typeof o.detail_no === "string" ? o.detail_no : base.detail_no,
    cost_change: typeof o.cost_change === "string" ? o.cost_change : base.cost_change,
    sched_change: typeof o.sched_change === "string" ? o.sched_change : base.sched_change,
    question: typeof o.question === "string" ? o.question : base.question,
    solution_text: typeof o.solution_text === "string" ? o.solution_text : base.solution_text,
    impact_notes: typeof o.impact_notes === "string" ? o.impact_notes : base.impact_notes,
    attach_other: typeof o.attach_other === "string" ? o.attach_other : base.attach_other,
    pdf_show_solution: rfiBool(o.pdf_show_solution, base.pdf_show_solution),
    pdf_show_response: rfiBool(o.pdf_show_response, base.pdf_show_response),
    reason_insufficient: rfiBool(o.reason_insufficient, base.reason_insufficient),
    reason_conflict: rfiBool(o.reason_conflict, base.reason_conflict),
    reason_alternate: rfiBool(o.reason_alternate, base.reason_alternate),
    action_clarification: rfiBool(o.action_clarification, base.action_clarification),
    action_direction: rfiBool(o.action_direction, base.action_direction),
    action_approval: rfiBool(o.action_approval, base.action_approval),
    effect_increase_cost: rfiBool(o.effect_increase_cost, base.effect_increase_cost),
    effect_decrease_cost: rfiBool(o.effect_decrease_cost, base.effect_decrease_cost),
    effect_unknown_cost: rfiBool(o.effect_unknown_cost, base.effect_unknown_cost),
    effect_increase_time: rfiBool(o.effect_increase_time, base.effect_increase_time),
    effect_decrease_time: rfiBool(o.effect_decrease_time, base.effect_decrease_time),
    effect_unknown_time: rfiBool(o.effect_unknown_time, base.effect_unknown_time),
    attach_photos: rfiBool(o.attach_photos, base.attach_photos),
    attach_markup: rfiBool(o.attach_markup, base.attach_markup),
    attach_submittal: rfiBool(o.attach_submittal, base.attach_submittal),
    attached_files: normalizeRfiAttachedFiles(o.attached_files ?? base.attached_files),
    closed_date: typeof o.closed_date === "string" ? o.closed_date : base.closed_date,
    contract: normalizeTransmittalContract(o.contract),
  });
}

export function rfiContractFromData(raw: unknown): TransmittalContract {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "paint";
  const contract = (raw as Partial<RfiFormData>).contract;
  return normalizeTransmittalContract(contract);
}

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type Rfi = Database["public"]["Tables"]["rfis"]["Row"];

export type Submittal = Database["public"]["Tables"]["submittals"]["Row"];
export type WorkOrder = Database["public"]["Tables"]["work_orders"]["Row"];

export const SUBMITTAL_SCOPES = ["", "Paint", "Wallcovering", "FRP", "Track", "Other"] as const;
export const SUBMITTAL_STATUSES = ["Draft", "Ready", "Submitted", "Returned"] as const;
export const SUBMITTAL_TYPES = [
  "",
  "Product Data",
  "Color Samples",
  "Shop Drawings",
  "Substitution",
  "Other",
] as const;
export const SUBMITTAL_RESULTS = ["", "AAN", "NET", "R&R", "MCN"] as const;

/** Project row with empty strings instead of null for form inputs. */
export type ProjectForm = Omit<
  Project,
  "job_address" | "job_address2" | "contractor" | "architect" | "owner"
> & {
  job_address: string;
  job_address2: string;
  contractor: string;
  architect: string;
  owner: string;
  jobInfo: JobInfoData;
};

/** Normalize nullable DB text fields for form binding. */
export function normalizeProject(row: Project): ProjectForm {
  const dataBlob =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {};
  return {
    ...row,
    job_address: row.job_address ?? "",
    job_address2: row.job_address2 ?? "",
    contractor: row.contractor ?? "",
    architect: row.architect ?? "",
    owner: row.owner ?? "",
    jobInfo: normalizeJobInfo(dataBlob.job_info, row),
  };
}
