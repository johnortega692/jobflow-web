import { supabase } from "./supabase";
import type { ProjectForm } from "../types/database";

export async function getProjectFieldAppVisibility(projectId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_project_field_app_visibility", {
    p_project_id: projectId,
  } as never);

  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function setProjectFieldAppVisibility(
  projectId: string,
  hidden: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_project_field_app_visibility", {
    p_project_id: projectId,
    p_hidden: hidden,
  } as never);

  if (error) throw new Error(error.message);
}

export function filterProjectsVisibleInFieldApps<T extends { id: string }>(
  projects: T[],
  hiddenIds: Iterable<string>,
): T[] {
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(hiddenIds);
  if (!hidden.size) return projects;
  return projects.filter((project) => !hidden.has(project.id));
}

/** Office / Settings send-now: drop jobs hidden from Field Tools / Field View. */
export async function excludeHiddenFieldAppProjects<T extends { id: string }>(
  projects: T[],
): Promise<T[]> {
  if (!projects.length) return projects;
  const flags = await Promise.all(
    projects.map((project) => getProjectFieldAppVisibility(project.id).catch(() => false)),
  );
  return projects.filter((_, index) => !flags[index]);
}

export async function loadVisibleProjectsForTrackerEmails(
  load: () => Promise<{ projects: ProjectForm[]; error: string | null }>,
): Promise<{ projects: ProjectForm[]; error: string | null }> {
  const result = await load();
  if (result.error) return result;
  return { projects: await excludeHiddenFieldAppProjects(result.projects), error: null };
}
