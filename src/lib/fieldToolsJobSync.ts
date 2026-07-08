import { icbiSuperintendent, jobFullAddressOneLine, projectTradeJobIdentities, type TradeJobIdentity } from "./jobInfo";
import { supabase } from "./supabase";
import type { ProjectForm } from "../types/database";

export type FieldToolsJobSyncRow = TradeJobIdentity & {
  ok: boolean;
  message: string;
};

function fieldToolsSuperintendent(project: ProjectForm): string {
  return icbiSuperintendent(project.jobInfo);
}

export async function upsertFieldToolsJob(
  project: ProjectForm,
  identity: TradeJobIdentity,
  projectId?: string,
): Promise<void> {
  const jobNumber = identity.jobNumber.trim();
  if (!jobNumber) throw new Error("Job number is required.");

  const { error } = await supabase.rpc("upsert_field_tools_job", {
    p_job_number: jobNumber,
    p_job_name: identity.jobName.trim(),
    p_address: jobFullAddressOneLine(project, project.jobInfo),
    p_superintendent: fieldToolsSuperintendent(project),
    p_project_id: projectId ?? null,
  } as never);

  if (error) throw new Error(error.message);
}

export async function syncProjectTradeJobsToFieldTools(
  project: ProjectForm,
  projectId?: string,
): Promise<FieldToolsJobSyncRow[]> {
  const identities = projectTradeJobIdentities(project);
  if (!identities.length) {
    return [
      {
        contract: "paint",
        contractLabel: "Paint",
        jobNumber: "",
        jobName: "",
        manpowerName: "",
        ok: false,
        message: "Add a job number before syncing to Field Tools.",
      },
    ];
  }

  const rows: FieldToolsJobSyncRow[] = [];
  for (const identity of identities) {
    try {
      await upsertFieldToolsJob(project, identity, projectId);
      rows.push({
        ...identity,
        ok: true,
        message: `Registered ${identity.jobNumber} in Field Tools.`,
      });
    } catch (e) {
      rows.push({
        ...identity,
        ok: false,
        message: e instanceof Error ? e.message : "Field Tools sync failed.",
      });
    }
  }
  return rows;
}
