import type { TransmittalContract } from "./jobInfo";
import type { BudgetMakerData, ManpowerBudgetPushRecord } from "../types/budgetMaker";

export function manpowerPushForContract(
  draft: BudgetMakerData,
  contract: TransmittalContract,
): ManpowerBudgetPushRecord | undefined {
  const perContract = draft.manpower_budget_pushes?.[contract];
  if (perContract?.pushed_at) return perContract;

  if (contract === "paint" && draft.manpower_budget_pushed_at) {
    return {
      pushed_at: draft.manpower_budget_pushed_at,
      hours: draft.manpower_budget_hours ?? 0,
      include_supervision: draft.manpower_budget_include_supervision,
    };
  }

  return undefined;
}

export function contractManpowerAlreadyPushed(
  draft: BudgetMakerData,
  contract: TransmittalContract,
): boolean {
  return Boolean(manpowerPushForContract(draft, contract)?.pushed_at);
}

export function patchManpowerPushForContract(
  draft: BudgetMakerData,
  contract: TransmittalContract,
  record: ManpowerBudgetPushRecord,
): BudgetMakerData {
  const next: BudgetMakerData = {
    ...draft,
    manpower_budget_pushes: {
      ...draft.manpower_budget_pushes,
      [contract]: record,
    },
  };

  if (contract === "paint") {
    next.manpower_budget_pushed_at = record.pushed_at;
    next.manpower_budget_hours = record.hours;
    next.manpower_budget_include_supervision = record.include_supervision;
  }

  return next;
}
