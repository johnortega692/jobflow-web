import { bucketIsMaterial, bucketMetrics } from "./budgetMakerCore";
import { budgetProfileValues, type TransmittalContract } from "./jobInfo";
import { parseMoney } from "./manpowerCalculator";
import { defaultBudgetLibrary, type BudgetLibrary } from "../types/budgetMaker";
import type { BudgetBucket, BudgetMakerData, BudgetScanLine } from "../types/budgetMaker";
import type { ProjectForm } from "../types/database";

/** Sum of contract sell values used for Labor Projection % complete billable. */
export function resolveLaborProjectionContractValue(
  project: Pick<ProjectForm, "job_number" | "job_name" | "jobInfo">,
  budget: BudgetMakerData,
  contracts: TransmittalContract[],
): number {
  let sum = 0;
  for (const c of contracts) {
    const fromSlice = budget.by_contract?.[c]?.grand_total?.trim() ?? "";
    const fromProfile = budgetProfileValues(project, c).grandTotal.trim();
    sum += parseMoney(fromSlice || fromProfile);
  }
  if (sum > 0) return sum;
  const active =
    budget.grand_total.trim() || budgetProfileValues(project, budget.contract).grandTotal.trim();
  return parseMoney(active);
}

function contractBudgetSlice(
  budget: BudgetMakerData,
  contract: TransmittalContract,
): { lines: BudgetScanLine[]; buckets: BudgetBucket[] } {
  if (budget.contract === contract) {
    return { lines: budget.lines, buckets: budget.buckets };
  }
  const slice = budget.by_contract?.[contract];
  return { lines: slice?.lines ?? [], buckets: slice?.buckets ?? [] };
}

/** Sum of Budget Maker material bucket amounts for Labor Projection months. */
export function resolveLaborProjectionMaterialCost(
  budget: BudgetMakerData,
  contracts: TransmittalContract[],
  lib: BudgetLibrary = defaultBudgetLibrary(),
): number {
  const list = contracts.length ? contracts : [budget.contract];
  let sum = 0;
  for (const c of list) {
    const { lines, buckets } = contractBudgetSlice(budget, c);
    buckets.forEach((bucket, i) => {
      if (!bucketIsMaterial(bucket, lib)) return;
      sum += bucketMetrics(i, lines).amount;
    });
  }
  return sum;
}
