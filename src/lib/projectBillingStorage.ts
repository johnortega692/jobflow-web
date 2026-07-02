import { parseProjectDataBlob } from "./jobInfo";
import { commitProjectUpdate } from "./projectActivity";
import { supabase } from "./supabase";
import { BILLING_DATA_KEY, type ProjectBillingData } from "../types/projectBilling";
import type { Json } from "../types/database";

/** Save billing blob into projects.data (shallow merge) + activity entry. */
export async function saveProjectBilling(
  projectId: string,
  billing: ProjectBillingData,
  summary: string,
): Promise<string | null> {
  return commitProjectUpdate({
    projectId,
    mergeData: { [BILLING_DATA_KEY]: billing },
    activity: { action: "billing_saved", summary },
  });
}

/** Persist billing without writing project activity (manpower calendar edits). */
export async function saveProjectBillingQuiet(
  projectId: string,
  billing: ProjectBillingData,
): Promise<string | null> {
  const { data: row, error: loadErr } = await supabase
    .from("projects")
    .select("data")
    .eq("id", projectId)
    .single();
  if (loadErr) return loadErr.message;

  const base = parseProjectDataBlob(row?.data);
  const { error: updateErr } = await supabase
    .from("projects")
    .update({ data: { ...base, [BILLING_DATA_KEY]: billing } as Json })
    .eq("id", projectId);
  return updateErr?.message ?? null;
}
