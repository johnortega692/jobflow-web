export type SpreadActivity = {
  id: string;
  startIso: string;
  endIso: string;
};

export type SpreadBudget = {
  id: string;
  hours: number;
};

export type SpreadMode = "activity-days" | "even-per-week";

export type SpreadBudgetHoursResult = {
  rows: { id: string; hours: number[] }[];
  activeWeekCount: number;
  totalHours: number;
  skippedBeforeGrid: { id: string; days: number }[];
};

function parseIso(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Whole hours that sum to `total`. Earlier weeks are rounded; the last active week keeps the remainder. */
export function allocateWeightedHours(total: number, weights: readonly number[]): number[] {
  const hours = Math.max(0, Math.round(total));
  const out = weights.map(() => 0);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (hours === 0 || weightSum <= 0) return out;

  const active: number[] = [];
  weights.forEach((weight, index) => {
    if (weight > 0) active.push(index);
  });
  const last = active[active.length - 1]!;
  let used = 0;
  for (const index of active) {
    if (index === last) continue;
    const share = Math.max(0, Math.round((hours * weights[index]!) / weightSum));
    out[index] = share;
    used += share;
  }
  const remainder = hours - used;
  if (remainder >= 0) {
    out[last] = remainder;
    return out;
  }
  let debt = -remainder;
  for (let cursor = active.length - 2; cursor >= 0 && debt > 0; cursor -= 1) {
    const index = active[cursor]!;
    const take = Math.min(out[index]!, debt);
    out[index] = out[index]! - take;
    debt -= take;
  }
  return out;
}

/**
 * Workday weight for each week starting Monday at `gridStart`.
 * Activity-days mode counts Mon–Fri overlaps. Even-per-week mode marks a touched week as 1.
 */
export function weekActivityWeights(
  activities: readonly SpreadActivity[],
  gridStart: string,
  weekCount: number,
  mode: SpreadMode,
): { weights: number[]; skippedBeforeGrid: { id: string; days: number }[] } {
  const weeks = Math.max(0, Math.floor(weekCount));
  const weights = Array.from({ length: weeks }, () => 0);
  const skippedBeforeGrid: { id: string; days: number }[] = [];
  const origin = parseIso(gridStart);

  if (origin && weeks > 0) {
    const originDay = dayNumber(origin);
    for (const activity of activities) {
      const start = parseIso(activity.startIso);
      const end = parseIso(activity.endIso || activity.startIso);
      if (!start || !end) continue;
      const first = start <= end ? start : end;
      const last = start <= end ? end : start;
      let skipped = 0;
      for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
        if (!isWeekday(cursor)) continue;
        const index = Math.floor((dayNumber(cursor) - originDay) / 7);
        if (index < 0) {
          skipped += 1;
          continue;
        }
        if (index >= weeks) continue;
        if (mode === "even-per-week") weights[index] = 1;
        else weights[index] = (weights[index] ?? 0) + 1;
      }
      if (skipped > 0) skippedBeforeGrid.push({ id: activity.id, days: skipped });
    }
  }

  return { weights, skippedBeforeGrid };
}

/**
 * Spread each budget across the labor-projection weeks touched by the activities.
 * Weeks start on Monday at `gridStart`. Only Mon–Fri days count.
 */
export function spreadBudgetHours(
  activities: readonly SpreadActivity[],
  budgets: readonly SpreadBudget[],
  gridStart: string,
  weekCount: number,
  mode: SpreadMode,
): SpreadBudgetHoursResult {
  const { weights, skippedBeforeGrid } = weekActivityWeights(activities, gridStart, weekCount, mode);
  const rows = budgets.map((budget) => ({
    id: budget.id,
    hours: allocateWeightedHours(budget.hours, weights),
  }));
  const activeWeekCount = weights.filter((weight) => weight > 0).length;
  const totalHours = rows.reduce((sum, row) => sum + row.hours.reduce((inner, hours) => inner + hours, 0), 0);

  return { rows, activeWeekCount, totalHours, skippedBeforeGrid };
}
