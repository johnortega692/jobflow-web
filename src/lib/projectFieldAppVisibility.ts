import { supabase } from "./supabase";

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
