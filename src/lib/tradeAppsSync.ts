import { syncProjectTradeJobsToFieldTools, type FieldToolsJobSyncRow } from "./fieldToolsJobSync";
import { projectTradeJobIdentities } from "./jobInfo";
import { registerProjectTradeJobsInManpower, type ManpowerRegisterRow } from "./registerProjectTradeJobs";
import type { ProjectForm } from "../types/database";

export type TradeAppsSyncResult = {
  ok: boolean;
  messages: string[];
  errors: string[];
  fieldTools: FieldToolsJobSyncRow[];
  manpower: ManpowerRegisterRow[];
};

/** Minimum job setup fields before auto-syncing to Field Tools / Manpower. */
export function fieldAppsSyncReady(project: ProjectForm): boolean {
  const j = project.jobInfo;
  return Boolean(
    project.job_number.trim() &&
      project.job_address.trim() &&
      j.field_request_pm.trim() &&
      j.field_request_super.trim(),
  );
}

export async function syncProjectTradeApps(
  project: ProjectForm,
  projectId: string,
): Promise<TradeAppsSyncResult> {
  const identities = projectTradeJobIdentities(project);
  const messages: string[] = [];
  const errors: string[] = [];

  if (!identities.length) {
    return {
      ok: false,
      messages: [],
      errors: ["Add a job number before syncing to Field Tools and Manpower."],
      fieldTools: [],
      manpower: [],
    };
  }

  const fieldTools = await syncProjectTradeJobsToFieldTools(project);
  for (const row of fieldTools) {
    if (row.ok) messages.push(`Field Tools · ${row.jobNumber}`);
    else errors.push(`Field Tools · ${row.contractLabel}: ${row.message}`);
  }

  const { rows: manpower, error: rpcError } = await registerProjectTradeJobsInManpower(projectId, project);
  if (rpcError) errors.push(`Manpower: ${rpcError}`);
  else {
    for (const row of manpower) {
      if (row.ok) messages.push(`Manpower · ${row.manpowerName}`);
      else errors.push(`Manpower · ${row.contractLabel}: ${row.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    messages,
    errors,
    fieldTools,
    manpower,
  };
}
