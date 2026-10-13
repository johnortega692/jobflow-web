import { fieldViewRpcAuthArgs, loadFieldViewSession, noteFieldViewSessionFailure } from "./fieldViewAuth";
import { supabase } from "./supabase";

export type UpcomingGcItem = {
  event_date: string;
  title: string;
};

export type UpcomingGcResult = {
  added: number;
  errors: { title: string; message: string }[];
  error: string | null;
};

const CODE_MESSAGE: Record<string, string> = {
  EVENT_DATE_REQUIRED: "That activity needs a date.",
  EVENT_DATE_PAST: "That date is too far in the past for Upcoming.",
  EVENT_TOO_FAR: "That date is more than about six months out.",
  EVENT_TITLE_REQUIRED: "Activity name is required.",
  EVENT_TITLE_TOO_LONG: "Activity name is too long.",
  WEEK_LABEL_TAKEN: "That week label is already used by another year.",
  PROJECT_NOT_FOUND: "Project was not found.",
};

function messageForCode(code: string): string {
  const token = code.trim();
  return CODE_MESSAGE[token] ?? token;
}

export async function addUpcomingFromGcSchedule(
  projectId: string,
  items: UpcomingGcItem[],
): Promise<UpcomingGcResult> {
  if (!items.length) return { added: 0, errors: [], error: null };
  const { data, error } = await supabase.rpc("jobflow_add_upcoming_from_gc" as never, {
    p_project_id: projectId,
    p_items: items,
    ...fieldViewRpcAuthArgs(loadFieldViewSession()),
  } as never);
  if (error) {
    noteFieldViewSessionFailure(error.message);
    return { added: 0, errors: [], error: messageForCode(error.message) };
  }
  const payload = (data ?? {}) as { added?: number; errors?: { title?: string; code?: string }[] };
  const errors = Array.isArray(payload.errors)
    ? payload.errors.map((row) => ({
        title: String(row.title ?? "").trim(),
        message: messageForCode(String(row.code ?? "")),
      }))
    : [];
  return { added: Number(payload.added ?? 0) || 0, errors, error: null };
}
