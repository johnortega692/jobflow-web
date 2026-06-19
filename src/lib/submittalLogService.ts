import { supabase } from "./supabase";
import {
  buildAutoLogRow,
  dbRowToLog,
  logRowToDbPayload,
  normalizeLogRow,
  sortLogRows,
} from "./submittalLogHelpers";
import type { SubmittalLogRow } from "../types/submittalLog";
import type { Submittal } from "../types/database";

export async function loadSubmittalLogRows(projectId: string): Promise<SubmittalLogRow[]> {
  const { data, error } = await supabase
    .from("submittals")
    .select("*")
    .eq("project_id", projectId)
    .order("line_number", { ascending: true });
  if (error) throw new Error(error.message);
  return sortLogRows((data ?? []).map(dbRowToLog));
}

export async function insertSubmittalLogRow(
  projectId: string,
  row: SubmittalLogRow,
): Promise<SubmittalLogRow> {
  const { data: userData } = await supabase.auth.getUser();
  const payload = logRowToDbPayload(normalizeLogRow(row), projectId, userData.user?.id);
  const { data, error } = await supabase.from("submittals").insert(payload).select("*").single();
  if (error) throw new Error(error.message);
  return dbRowToLog(data as Submittal);
}

export async function updateSubmittalLogRow(row: SubmittalLogRow): Promise<SubmittalLogRow> {
  const payload = logRowToDbPayload(normalizeLogRow(row), "", null);
  const { data, error } = await supabase
    .from("submittals")
    .update({
      line_number: payload.line_number,
      description: payload.description,
      spec_section: payload.spec_section,
      submittal_type: payload.submittal_type,
      scope: payload.scope,
      status: payload.status,
      result_code: payload.result_code,
      data: payload.data,
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return dbRowToLog(data as Submittal);
}

export async function deleteSubmittalLogRows(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("submittals").delete().in("id", ids);
  if (error) throw new Error(error.message);
}

export async function recordPdfLogRow(
  projectId: string,
  params: Parameters<typeof buildAutoLogRow>[1],
): Promise<SubmittalLogRow> {
  const existing = await loadSubmittalLogRows(projectId);
  const row = buildAutoLogRow(existing, params);
  return insertSubmittalLogRow(projectId, row);
}

export async function markRowsSubmitted(
  rows: SubmittalLogRow[],
  transmittalNumber: string,
): Promise<SubmittalLogRow[]> {
  const today = new Date();
  const submitDate = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`;
  const updated: SubmittalLogRow[] = [];
  for (const row of rows) {
    const next = normalizeLogRow({
      ...row,
      submit_date: submitDate,
      status: "Submitted",
      transmittal_number: transmittalNumber.trim() || row.transmittal_number,
    });
    updated.push(await updateSubmittalLogRow(next));
  }
  return updated;
}
