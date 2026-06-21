import type { Database, Json } from "./database.generated";
import type { JobInfoData } from "./jobInfo";
import { normalizeJobInfo, normalizeTransmittalContract, type TransmittalContract } from "../lib/jobInfo";

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
    cost_change: "TBD",
    sched_change: "TBD",
    question: "",
    solution_text: "",
    impact_notes: "",
    pdf_show_solution: true,
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
