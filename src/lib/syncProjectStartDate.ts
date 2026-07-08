import { supabase } from "./supabase";

export async function syncProjectStartDateToManpower(projectId: string): Promise<void> {
  const { error } = await supabase.rpc("sync_project_start_date_to_manpower", {
    p_project_id: projectId,
  } as never);

  if (error) throw new Error(error.message);
}
