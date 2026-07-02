import { manpowerWeekStarts, weekTotalHours } from "./manpowerCalendar";
import { buildManpowerPeriods, formatMonthPeriodLabel } from "./manpowerPeriods";
import {
  blendedBillRate,
  blendedCostRate,
  earnedPct,
  revisedContract,
  weeklyBudgetEntry,
  type EarnedVsBilled,
  type ProjectBillingData,
} from "../types/projectBilling";

export type DerivedWeekBudget = {
  weekStartIso: string;
  hours: number;
  laborCost: number;
  materialCost: number;
  laborBillable: number;
  materialBillable: number;
  cost: number;
  billable: number;
};

export type DerivedMonthBudget = {
  key: string;
  label: string;
  weekStartIsos: string[];
  hours: number;
  laborCost: number;
  materialCost: number;
  laborBillable: number;
  materialBillable: number;
  cost: number;
  billable: number;
};

export type PlanBudgetTotals = {
  hours: number;
  laborCost: number;
  materialCost: number;
  laborBillable: number;
  materialBillable: number;
  cost: number;
  billable: number;
};

const EMPTY_TOTALS: PlanBudgetTotals = {
  hours: 0,
  laborCost: 0,
  materialCost: 0,
  laborBillable: 0,
  materialBillable: 0,
  cost: 0,
  billable: 0,
};

function sumWeekBudgets(weeks: DerivedWeekBudget[]): Omit<DerivedMonthBudget, "key" | "label" | "weekStartIsos"> {
  return weeks.reduce(
    (acc, w) => ({
      hours: acc.hours + w.hours,
      laborCost: acc.laborCost + w.laborCost,
      materialCost: acc.materialCost + w.materialCost,
      laborBillable: acc.laborBillable + w.laborBillable,
      materialBillable: acc.materialBillable + w.materialBillable,
      cost: acc.cost + w.cost,
      billable: acc.billable + w.billable,
    }),
    { ...EMPTY_TOTALS },
  );
}

export function deriveWeekBudget(billing: ProjectBillingData, weekStartIso: string): DerivedWeekBudget {
  const hours = weekTotalHours(billing.manpowerCells, weekStartIso);
  const entry = weeklyBudgetEntry(billing.weeklyBudgetEntries, weekStartIso);
  const costRate = blendedCostRate(billing.laborRates);
  const billRate = blendedBillRate(billing.laborRates);
  const laborCost = hours * costRate;
  const laborBillable = hours * billRate;
  return {
    weekStartIso,
    hours,
    laborCost,
    materialCost: entry.materialCost,
    laborBillable,
    materialBillable: entry.materialBillable,
    cost: laborCost + entry.materialCost,
    billable: laborBillable + entry.materialBillable,
  };
}

export function deriveMonthlyBudgets(billing: ProjectBillingData, weekStarts: string[]): DerivedMonthBudget[] {
  const periods = buildManpowerPeriods("month", weekStarts);
  return periods.map((period) => {
    const weeks = period.weekStartIsos.map((w) => deriveWeekBudget(billing, w));
    return {
      key: period.key,
      label: period.label,
      weekStartIsos: period.weekStartIsos,
      ...sumWeekBudgets(weeks),
    };
  });
}

export function monthBeyondContract(
  weekStartIsos: string[],
  allWeekStarts: string[],
  contractEndWeekIndex: number | null,
): boolean {
  if (contractEndWeekIndex === null || weekStartIsos.length === 0) return false;
  return weekStartIsos.every((w) => {
    const idx = allWeekStarts.indexOf(w);
    return idx > contractEndWeekIndex;
  });
}

export function currentMonthKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthlyBudgetContext(
  billing: ProjectBillingData,
  projectStartIso: string,
  projectEndIso: string,
) {
  const { weekStarts, contractEndWeekIndex } = manpowerWeekStarts(
    projectStartIso,
    projectEndIso,
    billing.manpowerCells,
    billing.manpowerWeekCount,
  );
  return {
    weekStarts,
    contractEndWeekIndex,
    months: deriveMonthlyBudgets(billing, weekStarts),
  };
}

export function sumMonthsThrough(months: DerivedMonthBudget[], throughMonthKey: string): PlanBudgetTotals {
  return months
    .filter((m) => m.key <= throughMonthKey)
    .reduce(
      (acc, m) => ({
        hours: acc.hours + m.hours,
        laborCost: acc.laborCost + m.laborCost,
        materialCost: acc.materialCost + m.materialCost,
        laborBillable: acc.laborBillable + m.laborBillable,
        materialBillable: acc.materialBillable + m.materialBillable,
        cost: acc.cost + m.cost,
        billable: acc.billable + m.billable,
      }),
      { ...EMPTY_TOTALS },
    );
}

export function planToDateFromCalendar(
  billing: ProjectBillingData,
  projectStartIso: string,
  projectEndIso: string,
  throughMonthKey = currentMonthKey(),
): PlanBudgetTotals {
  const { months } = monthlyBudgetContext(billing, projectStartIso, projectEndIso);
  return sumMonthsThrough(months, throughMonthKey);
}

export function totalPlanFromCalendar(
  billing: ProjectBillingData,
  projectStartIso: string,
  projectEndIso: string,
): PlanBudgetTotals {
  const { months } = monthlyBudgetContext(billing, projectStartIso, projectEndIso);
  return sumMonthsThrough(months, "9999-12");
}

export function planBillablePctOfContract(
  billableToDate: number,
  revisedContractAmount: number,
): number | null {
  if (revisedContractAmount <= 0) return null;
  return billableToDate / revisedContractAmount;
}

export function planBillablePctOfPlan(billableToDate: number, totalPlanBillable: number): number | null {
  if (totalPlanBillable <= 0) return null;
  return billableToDate / totalPlanBillable;
}

export function earnedVsPlanBillable(
  billing: ProjectBillingData,
  projectStartIso: string,
  projectEndIso: string,
): EarnedVsBilled {
  const earned = earnedPct(billing);
  const revised = revisedContract(billing.contract);
  const toDate = planToDateFromCalendar(billing, projectStartIso, projectEndIso);
  const billablePct = planBillablePctOfContract(toDate.billable, revised);
  const underbilledAmount = billablePct !== null && revised > 0 ? (earned - billablePct) * revised : 0;
  return {
    earnedPct: earned,
    billedPct: billablePct,
    underbilledAmount,
    isUnderbilled: billablePct !== null && earned > billablePct,
  };
}

export function currentMonthLabel(): string {
  return formatMonthPeriodLabel(currentMonthKey());
}
