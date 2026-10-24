import { supabase } from "./supabase";

export type PoSequence = {
  jobCode: string;
  highestIssued: number;
  nextSeq: number;
  hasOverride: boolean;
  digits: number;
  nextPo: string;
};

type SequencePayload = {
  ok?: boolean;
  error?: string;
  job_code?: string;
  highest_issued?: number;
  next_seq?: number;
  has_override?: boolean;
  digits?: number;
  next_po?: string;
};

function payloadError(data: unknown, fallback: string): string | null {
  const row = (data ?? {}) as SequencePayload;
  if (row.ok === false) return row.error || fallback;
  return null;
}

export function previewPoNumber(jobCode: string, nextSeq: number, digits: number): string {
  const width = Math.min(6, Math.max(1, digits || 3));
  return `${jobCode}-${String(nextSeq).padStart(width, "0")}`;
}

export async function getPoSequence(jobCode: string): Promise<PoSequence> {
  const { data, error } = await supabase.rpc("jobflow_get_po_sequence" as never, {
    p_job_code: jobCode,
  } as never);
  if (error) throw new Error(error.message);
  const failed = payloadError(data, "Could not load the PO sequence.");
  if (failed) throw new Error(failed);
  const row = data as SequencePayload;
  return {
    jobCode: String(row.job_code ?? jobCode),
    highestIssued: Number(row.highest_issued) || 0,
    nextSeq: Number(row.next_seq) || 1,
    hasOverride: Boolean(row.has_override),
    digits: Number(row.digits) || 3,
    nextPo: String(row.next_po ?? ""),
  };
}

export async function setPoSequence(jobCode: string, nextSeq: number): Promise<void> {
  const { data, error } = await supabase.rpc("jobflow_set_po_sequence" as never, {
    p_job_code: jobCode,
    p_next_seq: nextSeq,
  } as never);
  if (error) throw new Error(error.message);
  const failed = payloadError(data, "Could not save the PO sequence.");
  if (failed) throw new Error(failed);
}

export async function clearPoSequence(jobCode: string): Promise<void> {
  const { data, error } = await supabase.rpc("jobflow_clear_po_sequence" as never, {
    p_job_code: jobCode,
  } as never);
  if (error) throw new Error(error.message);
  const failed = payloadError(data, "Could not reset the PO sequence.");
  if (failed) throw new Error(failed);
}
