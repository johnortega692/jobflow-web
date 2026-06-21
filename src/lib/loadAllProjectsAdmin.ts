import { normalizeProject, type ProjectForm } from "../types/database";
import { getSupabaseAdmin } from "./supabaseAdmin";

export async function loadAllProjectsAdmin(): Promise<{ projects: ProjectForm[]; error: string | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from("projects")
    .select("*")
    .order("job_number", { ascending: true });
  if (error) return { projects: [], error: error.message };
  return { projects: (data ?? []).map(normalizeProject), error: null };
}
