import { allocateWeightedHours } from "./spreadBudgetHours.ts";

export type CarryCell = {
  phaseId: string;
  weekIndex: number;
  hours: number;
};

export type CarryActual = {
  phaseId: string;
  actual: number;
};

export type CarryDest = "next" | "spread" | "park";

function hoursAt(grid: readonly CarryCell[], phaseId: string, weekIndex: number): number {
  return grid.find((cell) => cell.phaseId === phaseId && cell.weekIndex === weekIndex)?.hours ?? 0;
}

function withHours(grid: CarryCell[], phaseId: string, weekIndex: number, hours: number): CarryCell[] {
  const next = grid.filter((cell) => !(cell.phaseId === phaseId && cell.weekIndex === weekIndex));
  if (hours > 0) next.push({ phaseId, weekIndex, hours });
  return next;
}

function actualHours(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/**
 * Set this week's actual hours, then move any shortfall.
 * `next` adds it to the following week. `spread` splits whole hours across later weeks
 * using the same weighted remainder rule as the GC spread. `park` only removes the shortfall.
 * Next-week on the last week returns the grid unchanged.
 */
export function carryOver(
  grid: readonly CarryCell[],
  weekIndex: number,
  actuals: readonly CarryActual[],
  dest: CarryDest,
  weights: readonly number[],
): CarryCell[] {
  const weekCount = Math.max(
    weights.length,
    weekIndex + 1,
    ...grid.map((cell) => cell.weekIndex + 1),
    0,
  );
  if (dest === "next" && weekIndex >= weekCount - 1) {
    return grid.map((cell) => ({ ...cell }));
  }

  let next = grid.map((cell) => ({ ...cell }));
  for (const row of actuals) {
    const planned = hoursAt(next, row.phaseId, weekIndex);
    const actual = actualHours(row.actual);
    next = withHours(next, row.phaseId, weekIndex, actual);
    const shortfall = Math.max(0, planned - actual);
    if (shortfall <= 0 || dest === "park") continue;

    if (dest === "next") {
      const following = hoursAt(next, row.phaseId, weekIndex + 1);
      next = withHours(next, row.phaseId, weekIndex + 1, following + shortfall);
      continue;
    }

    const later = Array.from({ length: weekCount }, (_, index) =>
      index > weekIndex ? (weights[index] ?? 0) : 0,
    );
    if (!later.some((weight) => weight > 0)) continue;
    const shares = allocateWeightedHours(shortfall, later);
    shares.forEach((share, index) => {
      if (share <= 0) return;
      const existing = hoursAt(next, row.phaseId, index);
      next = withHours(next, row.phaseId, index, existing + share);
    });
  }
  return next;
}
