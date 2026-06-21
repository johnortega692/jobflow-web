import { logProjectActivityEvent } from "./projectActivity";
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
  const saved = dbRowToLog(data as Submittal);
  await logProjectActivityEvent({
    projectId,
    action: "submittal_log_added",
    summary: `Submittal log row #${saved.line_number} added`,
  });
  return saved;
}

export async function updateSubmittalLogRow(
  projectId: string,
  row: SubmittalLogRow,
  options?: { log?: boolean },
): Promise<SubmittalLogRow> {
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
  const saved = dbRowToLog(data as Submittal);
  if (options?.log !== false) {
    await logProjectActivityEvent({
      projectId,
      action: "submittal_log_updated",
      summary: `Submittal log row #${saved.line_number} updated`,
    });
  }
  return saved;
}

export async function deleteSubmittalLogRows(projectId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("submittals").delete().in("id", ids);
  if (error) throw new Error(error.message);
  await logProjectActivityEvent({
    projectId,
    action: "submittal_log_deleted",
    summary:
      ids.length === 1
        ? "Submittal log row deleted"
        : `${ids.length} submittal log rows deleted`,
  });
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
  projectId: string,
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
    updated.push(await updateSubmittalLogRow(projectId, next, { log: false }));
  }
  if (updated.length) {
    const trans = transmittalNumber.trim();
    await logProjectActivityEvent({
      projectId,
      action: "submittal_log_submitted",
      summary: trans
        ? `${updated.length} submittal log row(s) marked submitted (Transmittal #${trans})`
        : `${updated.length} submittal log row(s) marked submitted`,
    });
  }
  return updated;
}
