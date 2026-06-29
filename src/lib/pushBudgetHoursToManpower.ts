import type { TransmittalContract } from "./jobInfo";
import { supabase } from "./supabase";

export type PushBudgetHoursResult = {
  job_name: string;
  budgeted_hours: number;
  pushed_at: string;
  contract?: TransmittalContract;
  include_supervision?: boolean;
};

export async function pushBudgetHoursToManpower(
  projectId: string,
  budgetedHours: number,
  includeSupervision = false,
  contract: TransmittalContract = "paint",
): Promise<{ data: PushBudgetHoursResult | null; error: string | null }> {
  const { data, error } = await supabase.rpc("push_budget_hours_to_manpower", {
    p_project_id: projectId,
    p_budgeted_hours: budgetedHours,
    p_include_supervision: includeSupervision,
    p_contract: contract,
  } as never);

  if (error) return { data: null, error: error.message };

  const row = data as PushBudgetHoursResult | null;
  if (!row?.pushed_at) {
    return { data: null, error: "Push succeeded but no confirmation was returned." };
  }

  return { data: row, error: null };
}
