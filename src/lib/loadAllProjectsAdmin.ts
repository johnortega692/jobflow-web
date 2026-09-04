import { normalizeProject, type ProjectForm } from "../types/database.js";
import { filterProjectsVisibleInFieldApps } from "./projectFieldAppVisibility.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export async function loadAllProjectsAdmin(): Promise<{ projects: ProjectForm[]; error: string | null }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("projects").select("*").order("job_number", { ascending: true });
  if (error) return { projects: [], error: error.message };

  const { data: hiddenRows, error: hiddenError } = await admin
    .from("project_field_app_visibility" as never)
    .select("project_id")
    .eq("hidden_from_field_apps", true);
  if (hiddenError) return { projects: [], error: hiddenError.message };

  const hiddenIds = ((hiddenRows ?? []) as { project_id: string }[]).map((row) => row.project_id);
  return {
    projects: filterProjectsVisibleInFieldApps((data ?? []).map(normalizeProject), hiddenIds),
    error: null,
  };
}
