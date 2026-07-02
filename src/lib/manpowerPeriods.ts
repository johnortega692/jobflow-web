import { weekColumnLabel } from "./manpowerCalendar";
import type { ManpowerCell, ManpowerPhaseId } from "../types/projectBilling";

export type ManpowerPeriodMode = "month" | "week";

export type ManpowerPeriod = {
  key: string;
  label: string;
  weekStartIsos: string[];
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonthPeriodLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return `${MONTH_SHORT[m - 1] ?? m} '${String(y).slice(-2)}`;
}

export function buildManpowerPeriods(mode: ManpowerPeriodMode, weekStarts: string[]): ManpowerPeriod[] {
  if (mode === "week") {
    return weekStarts.map((w) => ({
      key: w,
      label: weekColumnLabel(w),
      weekStartIsos: [w],
    }));
  }

  const byMonth = new Map<string, string[]>();
  for (const w of weekStarts) {
    const monthKey = w.slice(0, 7);
    const list = byMonth.get(monthKey) ?? [];
    list.push(w);
    byMonth.set(monthKey, list);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, weekStartIsos]) => ({
      key,
      label: formatMonthPeriodLabel(key),
      weekStartIsos,
    }));
}

export function plannedHoursInPeriod(
  phaseId: ManpowerPhaseId,
  cells: ManpowerCell[],
  weekStartIsos: string[],
): number {
  const weekSet = new Set(weekStartIsos);
  return cells
    .filter((c) => c.phaseId === phaseId && weekSet.has(c.weekStartIso))
    .reduce((sum, c) => sum + c.hours, 0);
}

export function periodBudgetHours(
  phaseBudget: number,
  periodPlanned: number,
  phasePlannedTotal: number,
): number {
  if (phaseBudget <= 0 || phasePlannedTotal <= 0 || periodPlanned <= 0) return 0;
  return Math.round(phaseBudget * (periodPlanned / phasePlannedTotal));
}

export function formatHoursCell(hours: number): string {
  if (hours <= 0) return "—";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

const HOURS_MODE_KEY = "jobflow-manpower-hours-mode";

export function loadManpowerHoursMode(): ManpowerPeriodMode {
  try {
    const stored = sessionStorage.getItem(HOURS_MODE_KEY);
    if (stored === "week" || stored === "month") return stored;
  } catch {
    /* ignore */
  }
  return "month";
}

export function saveManpowerHoursMode(mode: ManpowerPeriodMode): void {
  try {
    sessionStorage.setItem(HOURS_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}
