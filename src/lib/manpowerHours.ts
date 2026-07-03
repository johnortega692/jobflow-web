import { hoursToManWeeks, manpowerWeekStarts, weekTotalHours } from "./manpowerCalendar";
import { buildManpowerPeriods, formatMonthPeriodLabel } from "./manpowerPeriods";
import type { ProjectBillingData } from "../types/projectBilling";

export type DerivedWeekHours = {
  weekStartIso: string;
  hours: number;
  manWeeks: number;
};

export type DerivedMonthHours = {
  key: string;
  label: string;
  weekStartIsos: string[];
  hours: number;
  manWeeks: number;
};

export function deriveWeekHours(billing: ProjectBillingData, weekStartIso: string): DerivedWeekHours {
  const hours = weekTotalHours(billing.manpowerCells, weekStartIso);
  return { weekStartIso, hours, manWeeks: hoursToManWeeks(hours) };
}

export function deriveMonthlyHours(billing: ProjectBillingData, weekStarts: string[]): DerivedMonthHours[] {
  const periods = buildManpowerPeriods("month", weekStarts);
  return periods.map((period) => {
    const hours = period.weekStartIsos.reduce(
      (sum, w) => sum + weekTotalHours(billing.manpowerCells, w),
      0,
    );
    return {
      key: period.key,
      label: period.label,
      weekStartIsos: period.weekStartIsos,
      hours,
      manWeeks: hoursToManWeeks(hours),
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

export function currentMonthLabel(): string {
  return formatMonthPeriodLabel(currentMonthKey());
}

export function manpowerHoursContext(
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
    weeks: weekStarts.map((w) => deriveWeekHours(billing, w)),
    months: deriveMonthlyHours(billing, weekStarts),
  };
}

export function sumHoursThroughMonth(months: DerivedMonthHours[], throughMonthKey: string): number {
  return months.filter((m) => m.key <= throughMonthKey).reduce((sum, m) => sum + m.hours, 0);
}

export function hoursToDateFromCalendar(
  billing: ProjectBillingData,
  projectStartIso: string,
  projectEndIso: string,
  throughMonthKey = currentMonthKey(),
): number {
  const { months } = manpowerHoursContext(billing, projectStartIso, projectEndIso);
  return sumHoursThroughMonth(months, throughMonthKey);
}

export function formatHoursCompact(hours: number): string {
  if (hours <= 0) return "—";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function formatManWeeksCompact(hours: number): string {
  if (hours <= 0) return "—";
  const mw = hoursToManWeeks(hours);
  return Number.isInteger(mw) ? String(mw) : mw.toFixed(1);
}
