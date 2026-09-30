import { supabase } from "./supabase";

export type ToolboxTalk = {
  id: string;
  title: string;
  submittedByName: string;
  completedAt: string;
  attendeeCount: number;
  notes: string;
};

type ToolboxTalkRow = {
  id: string;
  title: string;
  submitted_by_name: string;
  completed_at: string;
  attendee_count: number;
  notes: string;
};

export async function loadToolboxTalks(projectId: string): Promise<{
  talks: ToolboxTalk[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("list_tailgate_meetings_for_jobflow" as never, {
    p_project_id: projectId,
  } as never);

  if (error) return { talks: [], error: error.message };

  const talks = ((data ?? []) as ToolboxTalkRow[]).map((row) => ({
    id: row.id,
    title: row.title.trim() || "Toolbox talk",
    submittedByName: row.submitted_by_name.trim() || "Field user",
    completedAt: row.completed_at,
    attendeeCount: Number.isFinite(row.attendee_count) ? row.attendee_count : 0,
    notes: row.notes.trim(),
  }));

  return { talks, error: null };
}
