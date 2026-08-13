import { logProjectActivityEvent } from "./projectActivity";
import { supabase } from "./supabase";

export async function fetchProjectIsDone(projectId: string): Promise<{
  isDone: boolean;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("project_is_done" as never, {
    p_project_id: projectId,
  } as never);
  if (error) return { isDone: false, error: error.message };
  return { isDone: Boolean(data), error: null };
}

export async function listDoneProjectIds(): Promise<{
  ids: string[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("list_done_project_ids" as never);
  if (error) return { ids: [], error: error.message };
  const raw = data as unknown;
  const ids = Array.isArray(raw) ? raw.map((id) => String(id)) : [];
  return { ids, error: null };
}

export async function setProjectDone(
  projectId: string,
  done: boolean,
  jobLabel: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("admin_set_project_done" as never, {
    p_project_id: projectId,
    p_done: done,
  } as never);
  if (error) return error.message;

  const label = jobLabel.trim() || "project";
  await logProjectActivityEvent({
    projectId,
    action: done ? "project_marked_done" : "project_reopened",
    summary: done ? `Marked completed — ${label}` : `Reopened — ${label}`,
  });
  return null;
}
