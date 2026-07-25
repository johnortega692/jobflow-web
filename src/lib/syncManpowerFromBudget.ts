import {
  bucketMetrics,
  bucketShowsAmountOnFieldHoursExport,
  costCodeNumberOnly,
  formatCostCode,
  workItemForBucket,
} from "./budgetMakerCore";
import type { TransmittalContract } from "./jobInfo";
import { emptyBudgetContractSlice } from "./budgetPerContract";
import type { BudgetLibrary, BudgetMakerData } from "../types/budgetMaker";
import {
  isLegacyCoatPhaseId,
  manpowerPhaseId,
  plannedHoursForPhase,
  type ManpowerPhase,
  type ProjectBillingData,
} from "../types/projectBilling";

type ProjectionBucketRow = {
  costCode: string;
  name: string;
  hours: number;
};

function contractSlice(budget: BudgetMakerData, contract: TransmittalContract) {
  return budget.by_contract?.[contract] ?? emptyBudgetContractSlice();
}

/** Hours-PDF-visible labor rows for one contract (materials/equipment excluded). */
export function laborProjectionRowsForContract(
  budget: BudgetMakerData,
  lib: BudgetLibrary,
  contract: TransmittalContract,
): ProjectionBucketRow[] {
  const slice = contractSlice(budget, contract);
  const byCode = new Map<string, ProjectionBucketRow>();

  slice.buckets.forEach((bucket, i) => {
    if (bucket.hide_from_hours_pdf) return;
    const { amount, hours } = bucketMetrics(i, slice.lines);
    if (budget.hide_zero_amounts && amount === 0) return;
    if (bucketShowsAmountOnFieldHoursExport(bucket, lib)) return;

    const label = formatCostCode(bucket.cost_code, lib, bucket.cost_class);
    const costCode = costCodeNumberOnly(label);
    if (!costCode) return;
    const name = workItemForBucket(bucket, lib) || costCode;
    const existing = byCode.get(costCode);
    if (existing) {
      existing.hours += hours;
      return;
    }
    byCode.set(costCode, { costCode, name, hours });
  });

  return [...byCode.values()].sort((a, b) => {
    const an = Number(a.costCode);
    const bn = Number(b.costCode);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.costCode.localeCompare(b.costCode);
  });
}

export function buildManpowerPhasesFromBudget(
  budget: BudgetMakerData,
  lib: BudgetLibrary,
  contracts: TransmittalContract[],
): ManpowerPhase[] {
  const phases: ManpowerPhase[] = [];
  for (const contract of contracts) {
    for (const row of laborProjectionRowsForContract(budget, lib, contract)) {
      phases.push({
        id: manpowerPhaseId(contract, row.costCode),
        name: row.name,
        costCode: row.costCode,
        contract,
        budgetHours: row.hours,
        actualHours: 0,
      });
    }
  }
  return phases;
}

function phasesFingerprint(phases: ManpowerPhase[]): string {
  return phases
    .map((p) => `${p.id}|${p.name}|${p.budgetHours}|${p.contract}|${p.costCode}`)
    .join(";");
}

/** Rebuild projection rows from Budget Hours PDF set; keep planned cells for surviving codes. */
export function syncBillingPhasesFromBudget(
  billing: ProjectBillingData,
  budget: BudgetMakerData,
  lib: BudgetLibrary,
  contracts: TransmittalContract[],
): { billing: ProjectBillingData; changed: boolean } {
  const fromBudget = buildManpowerPhasesFromBudget(budget, lib, contracts);
  const prevById = new Map(billing.manpowerPhases.map((p) => [p.id, p]));
  const nextPhases: ManpowerPhase[] = fromBudget.map((phase) => ({
    ...phase,
    actualHours: prevById.get(phase.id)?.actualHours ?? 0,
  }));

  const keepIds = new Set(nextPhases.map((p) => p.id));

  for (const prev of billing.manpowerPhases) {
    if (keepIds.has(prev.id) || isLegacyCoatPhaseId(prev.id)) continue;
    const planned = plannedHoursForPhase(prev.id, billing.manpowerCells);
    if (planned <= 0) continue;
    nextPhases.push({
      ...prev,
      name: prev.name.includes("(removed)") ? prev.name : `${prev.name} (removed)`,
    });
    keepIds.add(prev.id);
  }

  const nextCells = billing.manpowerCells.filter((c) => keepIds.has(c.phaseId));
  const nextActuals = billing.manpowerPeriodActuals.filter((a) => keepIds.has(a.phaseId));

  const next: ProjectBillingData = {
    ...billing,
    manpowerPhases: nextPhases,
    manpowerCells: nextCells,
    manpowerPeriodActuals: nextActuals,
  };

  const changed =
    phasesFingerprint(billing.manpowerPhases) !== phasesFingerprint(nextPhases) ||
    billing.manpowerCells.length !== nextCells.length ||
    billing.manpowerPeriodActuals.length !== nextActuals.length;

  return { billing: next, changed };
}
