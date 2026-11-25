export type SpreadActivity = {
  id: string;
  startIso: string;
  endIso: string;
  includeWeekends?: boolean;
};

export type SpreadBudget = {
  id: string;
  hours: number;
};

export type SpreadMode = "activity-days" | "even-per-week";

export type SpreadBudgetHoursResult = {
  rows: { id: string; hours: number[]; dayHours: number[][] }[];
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

function emptyWeekDays(): number[] {
  return [0, 0, 0, 0, 0, 0, 0];
}

/** Monday is 0 and Sunday is 6, matching Plan week columns. */
function planDayIndex(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function isoFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function holidaySet(holidays: readonly string[]): Set<string> {
  const dates = new Set<string>();
  for (const holiday of holidays) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(holiday.trim());
    if (match?.[1]) dates.add(match[1]);
  }
  return dates;
}

/**
 * Place `total` onto the days that have weight, using full 8-hour man-days first.
 * Earlier open days fill to the next person. One day keeps whatever is left under 8 hours.
 */
function placeFullManDays(total: number, weights: readonly number[]): number[] {
  const hours = Math.max(0, Math.round(total));
  const out = weights.map(() => 0);
  const slots = weights.flatMap((weight, index) => (weight > 0 ? [index] : []));
  if (hours === 0 || slots.length === 0) return out;

  const fullDays = Math.floor(hours / 8);
  const remainder = hours % 8;
  const peoplePerDay = Math.floor(fullDays / slots.length);
  const extraDays = fullDays % slots.length;
  for (const index of slots) out[index] = peoplePerDay * 8;
  for (let i = 0; i < extraDays; i += 1) out[slots[i]!] = (out[slots[i]!] ?? 0) + 8;
  if (remainder > 0) {
    let target = slots[0]!;
    for (const index of slots) {
      if ((out[index] ?? 0) < (out[target] ?? 0)) target = index;
    }
    out[target] = (out[target] ?? 0) + remainder;
  }
  return out;
}

/**
 * Workday weight for each week starting Monday at `gridStart`.
 * Activity-days mode counts each covered day. Even-per-week mode marks a touched week as 1.
 * Weekends count only for activities marked includeWeekends.
 * `dayWeights` is Mon–Sun for each week. Holidays stay in the week weight and stay off the day plan.
 */
export function weekActivityWeights(
  activities: readonly SpreadActivity[],
  gridStart: string,
  weekCount: number,
  mode: SpreadMode,
  holidays: readonly string[] = [],
): { weights: number[]; dayWeights: number[][]; skippedBeforeGrid: { id: string; days: number }[] } {
  const weeks = Math.max(0, Math.floor(weekCount));
  const weights = Array.from({ length: weeks }, () => 0);
  const dayWeights = Array.from({ length: weeks }, () => emptyWeekDays());
  const skippedBeforeGrid: { id: string; days: number }[] = [];
  const blocked = holidaySet(holidays);
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
        if (!isWeekday(cursor) && !activity.includeWeekends) continue;
        const index = Math.floor((dayNumber(cursor) - originDay) / 7);
        if (index < 0) {
          skipped += 1;
          continue;
        }
        if (index >= weeks) continue;
        if (mode === "even-per-week") weights[index] = 1;
        else weights[index] = (weights[index] ?? 0) + 1;
        const dayIndex = planDayIndex(cursor);
        if (dayIndex < 0 || dayIndex > 6 || blocked.has(isoFromDate(cursor))) continue;
        const days = dayWeights[index]!;
        if (mode === "even-per-week") days[dayIndex] = 1;
        else days[dayIndex] = (days[dayIndex] ?? 0) + 1;
      }
      if (skipped > 0) skippedBeforeGrid.push({ id: activity.id, days: skipped });
    }
  }

  return { weights, dayWeights, skippedBeforeGrid };
}

/**
 * Spread each budget across the labor-projection weeks touched by the activities.
 * Weeks start on Monday at `gridStart`. Saturday and Sunday count when that activity includes weekends.
 * Each week's hours are then placed on the dates the activities cover, filling 8-hour days first.
 */
export function spreadBudgetHours(
  activities: readonly SpreadActivity[],
  budgets: readonly SpreadBudget[],
  gridStart: string,
  weekCount: number,
  mode: SpreadMode,
  holidays: readonly string[] = [],
): SpreadBudgetHoursResult {
  const { weights, dayWeights, skippedBeforeGrid } = weekActivityWeights(
    activities,
    gridStart,
    weekCount,
    mode,
    holidays,
  );
  const rows = budgets.map((budget) => {
    const hours = allocateWeightedHours(budget.hours, weights);
    return {
      id: budget.id,
      hours,
      dayHours: hours.map((weekHours, index) => placeFullManDays(weekHours, dayWeights[index] ?? emptyWeekDays())),
    };
  });
  const activeWeekCount = weights.filter((weight) => weight > 0).length;
  const totalHours = rows.reduce((sum, row) => sum + row.hours.reduce((inner, hours) => inner + hours, 0), 0);

  return { rows, activeWeekCount, totalHours, skippedBeforeGrid };
}

export type SpreadActivityHours = SpreadActivity & {
  phaseId: string;
  hours: number;
  /** Cost-code total, used when none of the checked activities on that code have their own hours. */
  budgetHours?: number;
};

function addPlacedRow(
  merged: Map<string, { hours: number[]; dayHours: number[][] }>,
  row: { id: string; hours: number[]; dayHours: number[][] },
) {
  const current = merged.get(row.id);
  if (!current) {
    merged.set(row.id, {
      hours: row.hours.slice(),
      dayHours: row.dayHours.map((days) => days.slice()),
    });
    return;
  }
  row.hours.forEach((hours, index) => {
    current.hours[index] = (current.hours[index] ?? 0) + hours;
  });
  row.dayHours.forEach((days, index) => {
    const dest = current.dayHours[index] ?? emptyWeekDays();
    days.forEach((hours, day) => {
      dest[day] = (dest[day] ?? 0) + hours;
    });
    current.dayHours[index] = dest;
  });
}

/**
 * Spread checked activities onto their cost codes.
 * An activity with its own hours uses that number. When every checked activity on a code is blank,
 * that code's total hours are spread across those activities' dates.
 */
export function spreadActivityHours(
  activities: readonly SpreadActivityHours[],
  gridStart: string,
  weekCount: number,
  mode: SpreadMode,
  holidays: readonly string[] = [],
): SpreadBudgetHoursResult {
  const merged = new Map<string, { hours: number[]; dayHours: number[][] }>();
  const skippedBeforeGrid: { id: string; days: number }[] = [];
  const typedPhases = new Set(activities.filter((activity) => activity.phaseId && activity.hours > 0).map((activity) => activity.phaseId));

  for (const activity of activities) {
    if (!activity.phaseId || !(activity.hours > 0)) continue;
    const placed = spreadBudgetHours(
      [activity],
      [{ id: activity.phaseId, hours: activity.hours }],
      gridStart,
      weekCount,
      mode,
      holidays,
    );
    skippedBeforeGrid.push(...placed.skippedBeforeGrid);
    const row = placed.rows[0];
    if (row) addPlacedRow(merged, row);
  }

  const budgets = new Map<string, SpreadActivityHours[]>();
  for (const activity of activities) {
    if (!activity.phaseId || activity.hours > 0 || typedPhases.has(activity.phaseId)) continue;
    if (!((activity.budgetHours ?? 0) > 0)) continue;
    const list = budgets.get(activity.phaseId) ?? [];
    list.push(activity);
    budgets.set(activity.phaseId, list);
  }
  for (const [phaseId, group] of budgets) {
    const placed = spreadBudgetHours(
      group,
      [{ id: phaseId, hours: group[0]?.budgetHours ?? 0 }],
      gridStart,
      weekCount,
      mode,
      holidays,
    );
    skippedBeforeGrid.push(...placed.skippedBeforeGrid);
    const row = placed.rows[0];
    if (row) addPlacedRow(merged, row);
  }

  const rows = [...merged].map(([id, row]) => ({ id, hours: row.hours, dayHours: row.dayHours }));
  const weekCountSafe = rows[0]?.hours.length ?? 0;
  let activeWeekCount = 0;
  for (let index = 0; index < weekCountSafe; index += 1) {
    if (rows.some((row) => (row.hours[index] ?? 0) > 0)) activeWeekCount += 1;
  }
  const totalHours = rows.reduce((sum, row) => sum + row.hours.reduce((inner, hours) => inner + hours, 0), 0);
  return { rows, activeWeekCount, totalHours, skippedBeforeGrid };
}
