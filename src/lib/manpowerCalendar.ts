import { isoDateToDisplay, parseFlexibleDate, toIsoDateValue } from "./dateInputUtils";
import type { ManpowerCell, ManpowerPhaseId } from "../types/projectBilling";

export const HOURS_PER_MAN_WEEK = 40;
/** One crew member working one day. */
export const HOURS_PER_CREW_DAY = 8;
export const DEFAULT_MANPOWER_WEEK_COUNT = 8;

function localFromParts(y: number, m: number, d: number): Date {
  return new Date(y, m, d);
}

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday on or before the given date (local calendar). */
export function mondayOnOrBefore(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

export function mondayIsoFromDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = toIsoDateValue(trimmed);
  const parsed = iso ? parseFlexibleDate(iso) : parseFlexibleDate(trimmed);
  if (!parsed) return null;
  return isoLocal(mondayOnOrBefore(parsed));
}

export function todayMondayIso(): string {
  return isoLocal(mondayOnOrBefore(new Date()));
}

export function addWeeksIso(mondayIso: string, weeks: number): string {
  const [y, m, d] = mondayIso.split("-").map(Number);
  const date = localFromParts(y!, m! - 1, d!);
  date.setDate(date.getDate() + weeks * 7);
  return isoLocal(date);
}

/** M/D label for a Monday ISO date. */
export function weekColumnLabel(mondayIso: string): string {
  const [, m, d] = mondayIso.split("-").map(Number);
  return `${m}/${d}`;
}

export function weekIndex(anchorMondayIso: string, weekMondayIso: string): number {
  const [ay, am, ad] = anchorMondayIso.split("-").map(Number);
  const [by, bm, bd] = weekMondayIso.split("-").map(Number);
  const a = localFromParts(ay!, am! - 1, ad!).getTime();
  const b = localFromParts(by!, bm! - 1, bd!).getTime();
  return Math.round((b - a) / (7 * 24 * 60 * 60 * 1000));
}

export function manpowerAnchorMonday(projectStartIso: string, cells: ManpowerCell[]): string {
  const fromStart = mondayIsoFromDateInput(projectStartIso);
  let anchor = fromStart ?? todayMondayIso();
  for (const cell of cells) {
    if (!cell.weekStartIso) continue;
    const idx = weekIndex(anchor, cell.weekStartIso);
    if (idx < 0) anchor = cell.weekStartIso;
  }
  return anchor;
}

export type ManpowerWeekRange = {
  weekStarts: string[];
  /** Index of end_date's week relative to anchor; null when end_date is absent/unparseable. */
  contractEndWeekIndex: number | null;
};

/**
 * Week columns from anchor through the latest of: end_date's Monday (when set),
 * latest crew cell, manpowerWeekCount (Add week), or DEFAULT_MANPOWER_WEEK_COUNT
 * when end_date is missing.
 */
export function manpowerWeekStarts(
  projectStartIso: string,
  projectEndIso: string,
  cells: ManpowerCell[],
  weekCount: number,
): ManpowerWeekRange {
  const anchor = manpowerAnchorMonday(projectStartIso, cells);
  const endMonday = mondayIsoFromDateInput(projectEndIso);
  let contractEndWeekIndex: number | null = null;
  let lastIndex: number;

  if (endMonday) {
    const endIdx = weekIndex(anchor, endMonday);
    if (endIdx >= 0) {
      contractEndWeekIndex = endIdx;
      lastIndex = endIdx;
    } else {
      // end_date is before the anchor week — ignore for sizing (fall back below)
      contractEndWeekIndex = null;
      lastIndex = Math.max(DEFAULT_MANPOWER_WEEK_COUNT, weekCount) - 1;
    }
  } else {
    lastIndex = Math.max(DEFAULT_MANPOWER_WEEK_COUNT, weekCount) - 1;
  }

  lastIndex = Math.max(lastIndex, weekCount - 1);

  for (const cell of cells) {
    if (!cell.weekStartIso) continue;
    const idx = weekIndex(anchor, cell.weekStartIso);
    if (idx >= 0) lastIndex = Math.max(lastIndex, idx);
  }

  const weekStarts = Array.from({ length: lastIndex + 1 }, (_, i) => addWeeksIso(anchor, i));
  return { weekStarts, contractEndWeekIndex };
}

/** Planned hours for a phase in a given week. */
export function cellHours(cells: ManpowerCell[], phaseId: ManpowerPhaseId, weekStartIso: string): number {
  const cell = cells.find((c) => c.phaseId === phaseId && c.weekStartIso === weekStartIso);
  return cell?.hours ?? 0;
}

export function withCellHours(
  cells: ManpowerCell[],
  phaseId: ManpowerPhaseId,
  weekStartIso: string,
  hours: number,
): ManpowerCell[] {
  const next = cells.filter((c) => !(c.phaseId === phaseId && c.weekStartIso === weekStartIso));
  if (hours > 0) next.push({ phaseId, weekStartIso, hours });
  return next;
}

/** Seven ISO dates Mon–Sun for a Monday week start. */
export function weekDayIsos(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const [y, m, d] = mondayIso.split("-").map(Number);
    const date = localFromParts(y!, m! - 1, d!);
    date.setDate(date.getDate() + i);
    return isoLocal(date);
  });
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Short weekday + M/D for each day in the week. */
export function weekDayColumnLabels(mondayIso: string): { weekday: string; dateLabel: string; iso: string }[] {
  return weekDayIsos(mondayIso).map((iso, i) => {
    const [, m, d] = iso.split("-").map(Number);
    return { weekday: WEEKDAY_SHORT[i]!, dateLabel: `${m}/${d}`, iso };
  });
}

export function emptyDayHours(): number[] {
  return [0, 0, 0, 0, 0, 0, 0];
}

/** Day breakdown for a cell; seeds Monday when only a week total exists. */
export function cellDayHours(
  cells: ManpowerCell[],
  phaseId: ManpowerPhaseId,
  weekStartIso: string,
): number[] {
  const cell = cells.find((c) => c.phaseId === phaseId && c.weekStartIso === weekStartIso);
  if (!cell) return emptyDayHours();
  if (cell.dayHours && cell.dayHours.length === 7) {
    return cell.dayHours.map((h) => (h > 0 ? h : 0));
  }
  if (cell.hours > 0) {
    const days = emptyDayHours();
    days[0] = cell.hours;
    return days;
  }
  return emptyDayHours();
}

export function sumDayHours(dayHours: number[]): number {
  return dayHours.reduce((sum, h) => sum + (Number.isFinite(h) && h > 0 ? h : 0), 0);
}

export function withCellDayHours(
  cells: ManpowerCell[],
  phaseId: ManpowerPhaseId,
  weekStartIso: string,
  dayHours: number[],
): ManpowerCell[] {
  const normalized = emptyDayHours().map((_, i) => {
    const n = dayHours[i] ?? 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const hours = sumDayHours(normalized);
  const next = cells.filter((c) => !(c.phaseId === phaseId && c.weekStartIso === weekStartIso));
  if (hours > 0) {
    const cell: ManpowerCell = { phaseId, weekStartIso, hours };
    if (normalized.some((h) => h > 0)) cell.dayHours = normalized;
    next.push(cell);
  }
  return next;
}

/** Replace all phase day breakdowns for one week; week totals follow the day sums. */
export function withWeekDayHours(
  cells: ManpowerCell[],
  weekStartIso: string,
  byPhase: Record<ManpowerPhaseId, number[]>,
): ManpowerCell[] {
  let next = cells.filter((c) => c.weekStartIso !== weekStartIso);
  for (const phaseId of Object.keys(byPhase) as ManpowerPhaseId[]) {
    next = withCellDayHours(next, phaseId, weekStartIso, byPhase[phaseId] ?? emptyDayHours());
  }
  return next;
}

export function phaseTotalHours(cells: ManpowerCell[], phaseId: ManpowerPhaseId): number {
  return cells.filter((c) => c.phaseId === phaseId).reduce((sum, c) => sum + c.hours, 0);
}

export function weekTotalHours(cells: ManpowerCell[], weekStartIso: string): number {
  return cells.filter((c) => c.weekStartIso === weekStartIso).reduce((sum, c) => sum + c.hours, 0);
}

/** Crew-equivalent for display (hours ÷ 40). */
export function hoursToManWeeks(hours: number): number {
  return hours / HOURS_PER_MAN_WEEK;
}

/** True when 2+ phases have hours &gt; 0 in the same week. */
export function weekHasPhaseOverlap(cells: ManpowerCell[], weekStartIso: string): boolean {
  const phasesWithHours = new Set(
    cells.filter((c) => c.weekStartIso === weekStartIso && c.hours > 0).map((c) => c.phaseId),
  );
  return phasesWithHours.size >= 2;
}

export const PHASE_ACTIVITY_SHORT: Record<ManpowerPhaseId, string> = {
  prime: "Prime",
  final: "Final",
  punch: "Touch-up",
};

/** User-facing hint when end_date is set but not applied to the week range. */
export function manpowerEndDateHint(projectStartIso: string, projectEndIso: string): string | null {
  const trimmed = projectEndIso.trim();
  if (!trimmed) return null;
  const endMonday = mondayIsoFromDateInput(trimmed);
  if (!endMonday) {
    return "Estimated end date in Job setup could not be read — use the date picker and save job info.";
  }
  const anchor = mondayIsoFromDateInput(projectStartIso) ?? todayMondayIso();
  if (weekIndex(anchor, endMonday) < 0) {
    return "Estimated end date is before the project start date — check both dates in Job setup.";
  }
  return null;
}

export function formatJobDateLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = toIsoDateValue(trimmed);
  if (iso) return isoDateToDisplay(iso);
  const parsed = parseFlexibleDate(trimmed);
  return parsed ? isoDateToDisplay(isoLocal(parsed)) : null;
}
