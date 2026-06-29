import { projectTradeJobIdentities, type TradeJobIdentity } from "./jobInfo";
import { supabase } from "./supabase";
import type { ProjectForm } from "../types/database";

export type ManpowerRegisterRow = TradeJobIdentity & {
  ok: boolean;
  message: string;
};

export async function registerProjectTradeJobsInManpower(
  projectId: string,
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
): Promise<{ rows: ManpowerRegisterRow[]; error: string | null }> {
  const identities = projectTradeJobIdentities(project);
  if (!identities.length) {
    return {
      rows: [],
      error: "Add a job number before registering in Manpower.",
    };
  }

  const { data, error } = await supabase.rpc("register_project_trade_jobs", {
    p_project_id: projectId,
  } as never);

  if (error) return { rows: [], error: error.message };

  const registered = Array.isArray(data)
    ? (data as { job_name?: string; ok?: boolean; message?: string }[])
    : [];

  const byName = new Map(
    registered.map((row) => [String(row.job_name ?? "").toLowerCase(), row]),
  );

  const rows: ManpowerRegisterRow[] = identities.map((identity) => {
    const hit = byName.get(identity.manpowerName.toLowerCase());
    if (hit) {
      return {
        ...identity,
        ok: hit.ok !== false,
        message: String(hit.message ?? `Registered ${identity.manpowerName} in Manpower.`),
      };
    }
    return {
      ...identity,
      ok: true,
      message: `Registered ${identity.manpowerName} in Manpower.`,
    };
  });

  return { rows, error: null };
}
