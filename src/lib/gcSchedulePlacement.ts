/**
 * Decide whether a reviewed GC activity lands on Labor Projection hours
 * or on Upcoming in Manpower.
 */

import {
  addWeeksIso,
  emptyDayHours,
  mondayIsoFromDateInput,
  todayMondayIso,
  weekColumnLabel,
  weekDayIsos,
  withCellDayHours,
  withCellHours,
} from "./manpowerCalendar";
import type { GcScheduleActivity, GcTrade } from "./gcScheduleImport";
import {
  phaseDisplayLabel,
  type ManpowerCell,
  type ManpowerPhase,
} from "../types/projectBilling";

export type GcDestination = "projection" | "upcoming";

export type GcPlacement = {
  destination: GcDestination;
  /** Projection weeks the activity overlaps, in order. Hours are split across these. */
  projectionWeeks: string[];
  upcomingDateIso: string | null;
  phaseId: string;
  note: string;
  blocked: boolean;
};

const TRADE_LABEL: Record<GcTrade, string> = {
  paint: "Paint",
  wallcovering: "Wallcovering",
};

export function phasesForTrade(phases: ManpowerPhase[], trade: GcTrade): ManpowerPhase[] {
  return phases.filter((phase) => phase.contract === trade);
}

export function defaultPhaseId(phases: ManpowerPhase[], trade: GcTrade, activityName: string): string {
  const pool = phasesForTrade(phases, trade);
  if (!pool.length) return "";
  const hay = activityName.toLowerCase();
  let best = pool[0]!;
  let bestScore = 0;
  for (const phase of pool) {
    let score = 0;
    const code = phase.costCode.trim().toLowerCase();
    const label = phase.name.trim().toLowerCase();
    if (code && hay.includes(code)) score += 3;
    if (label && label.length > 3 && hay.includes(label)) score += 2;
    for (const word of label.split(/\W+/)) {
      if (word.length > 3 && hay.includes(word)) score += 1;
    }
    if (score > bestScore) {
      best = phase;
      bestScore = score;
    }
  }
  return best.id;
}

/** About six months. Older than this stays off Upcoming; later dates are not capped. */
const UPCOMING_PAST_WEEKS = 26;

function dateAllowed(iso: string, nowMonday: string): "ok" | "past" {
  const earliest = addWeeksIso(nowMonday, -UPCOMING_PAST_WEEKS);
  if (iso < earliest) return "past";
  return "ok";
}

export function placeGcActivity(input: {
  activity: GcScheduleActivity;
  trade: GcTrade;
  phaseId: string;
  phases: ManpowerPhase[];
  weekStarts: string[];
  projectStartIso: string;
  projectEndIso: string;
  nowMondayIso?: string;
}): GcPlacement {
  const nowMonday = input.nowMondayIso ?? todayMondayIso();
  const tradePhases = phasesForTrade(input.phases, input.trade);
  const phaseOk = tradePhases.some((phase) => phase.id === input.phaseId);
  const phaseId = phaseOk ? input.phaseId : defaultPhaseId(input.phases, input.trade, input.activity.name);
  const phase = tradePhases.find((row) => row.id === phaseId);
  const activityDate = input.activity.startIso ?? input.activity.finishIso;
  const hasSchedule = Boolean(input.projectStartIso.trim() || input.projectEndIso.trim());
  const monday = activityDate ? mondayIsoFromDateInput(activityDate) : null;

  function upcoming(dateIso: string, note: string, blocked = false): GcPlacement {
    return {
      destination: "upcoming",
      projectionWeeks: [],
      upcomingDateIso: blocked ? null : dateIso,
      phaseId,
      note,
      blocked,
    };
  }

  function overlapWeeks(startIso: string, finishIso: string | null): string[] {
    const startMonday = mondayIsoFromDateInput(startIso);
    if (!startMonday) return [];
    const finishMonday = mondayIsoFromDateInput(finishIso ?? startIso) ?? startMonday;
    const end = finishMonday >= startMonday ? finishMonday : startMonday;
    return input.weekStarts.filter((week) => week >= startMonday && week <= end);
  }

  if (!activityDate || !monday) {
    return upcoming(nowMonday, `No GC date — adds to Upcoming this week (${weekColumnLabel(nowMonday)})`);
  }

  const overlapped = overlapWeeks(activityDate, input.activity.finishIso);
  if (hasSchedule && overlapped.length > 0 && phase) {
    const first = overlapped[0]!;
    const last = overlapped[overlapped.length - 1]!;
    const span =
      overlapped.length === 1
        ? `week of ${weekColumnLabel(first)}`
        : `weeks of ${weekColumnLabel(first)}–${weekColumnLabel(last)}`;
    return {
      destination: "projection",
      projectionWeeks: overlapped,
      upcomingDateIso: null,
      phaseId: phase.id,
      note:
        overlapped.length === 1
          ? `Adds hours to ${phaseDisplayLabel(phase)} · ${span}. Each working day is planned at 8 hrs per person.`
          : `Splits hours across ${phaseDisplayLabel(phase)} · ${span}. Each working day is planned at 8 hrs per person.`,
      blocked: false,
    };
  }

  const window = dateAllowed(activityDate, nowMonday);
  if (window === "past") {
    return upcoming(activityDate, "That GC date is more than about six months in the past for Upcoming.", true);
  }

  if (!hasSchedule) {
    return upcoming(activityDate, `No projection dates — adds to Upcoming on ${weekColumnLabel(monday)}`);
  }
  if (!phase) {
    return upcoming(
      activityDate,
      `No ${TRADE_LABEL[input.trade]} cost code on this projection — adds to Upcoming on ${weekColumnLabel(monday)}`,
    );
  }
  return upcoming(activityDate, `Not on the projection calendar — adds to Upcoming on ${weekColumnLabel(monday)}`);
}

/** Dates in this projection week that the activity covers, skipping holidays. Weekends count only when requested. */
export function gcWorkingDayIndexes(
  weekStartIso: string,
  startIso: string | null,
  finishIso: string | null,
  holidays: readonly string[] = [],
  includeWeekends = false,
): number[] {
  const days = weekDayIsos(weekStartIso);
  const start = startIso?.trim() || days[0]!;
  const finish = finishIso?.trim() || days[6]!;
  const blocked = new Set(holidays);
  const indexes: number[] = [];
  days.forEach((iso, index) => {
    if (!includeWeekends && index > 4) return;
    if (iso < start || iso > finish) return;
    if (blocked.has(iso)) return;
    indexes.push(index);
  });
  return indexes;
}

function allocateTenths(total: number, weights: readonly number[]): number[] {
  const hours = Math.round(total * 10) / 10;
  const out = weights.map(() => 0);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(hours > 0) || weightSum <= 0) return out;
  const active: number[] = [];
  weights.forEach((weight, index) => {
    if (weight > 0) active.push(index);
  });
  const last = active[active.length - 1]!;
  let used = 0;
  for (const index of active) {
    if (index === last) continue;
    const share = Math.round(((hours * weights[index]!) / weightSum) * 10) / 10;
    out[index] = share;
    used = Math.round((used + share) * 10) / 10;
  }
  out[last] = Math.max(0, Math.round((hours - used) * 10) / 10);
  return out;
}

function dayHoursForShare(hours: number, dayIndexes: number[]): number[] {
  const days = emptyDayHours();
  if (!dayIndexes.length || !(hours > 0)) return days;
  const shares = allocateTenths(hours, dayIndexes.map(() => 1));
  dayIndexes.forEach((dayIndex, shareIndex) => {
    days[dayIndex] = shares[shareIndex] ?? 0;
  });
  return days;
}

export type GcHourAdd = {
  phaseId: string;
  weekStartIso: string;
  hours: number;
  dayHours?: number[];
};

/** Spread an activity across its working days. Eight hours on a day is one person in Plan week. */
export function gcProjectionAdds(input: {
  phaseId: string;
  hours: number;
  weeks: string[];
  startIso: string | null;
  finishIso: string | null;
  holidays?: readonly string[];
  includeWeekends?: boolean;
}): GcHourAdd[] {
  if (!input.phaseId || !(input.hours > 0) || input.weeks.length === 0) return [];
  const holidays = input.holidays ?? [];
  const includeWeekends = input.includeWeekends === true;
  const daySets = input.weeks.map((week) =>
    gcWorkingDayIndexes(week, input.startIso, input.finishIso, holidays, includeWeekends),
  );
  const weights = daySets.map((days) => days.length);
  const weekHours =
    weights.some((weight) => weight > 0)
      ? allocateTenths(input.hours, weights)
      : allocateTenths(input.hours, input.weeks.map(() => 1));
  return input.weeks.flatMap((weekStartIso, index) => {
    const hours = weekHours[index] ?? 0;
    if (!(hours > 0)) return [];
    const dayIndexes = daySets[index] ?? [];
    return [
      {
        phaseId: input.phaseId,
        weekStartIso,
        hours,
        ...(dayIndexes.length ? { dayHours: dayHoursForShare(hours, dayIndexes) } : {}),
      },
    ];
  });
}

export function addGcHours(cells: ManpowerCell[], adds: GcHourAdd[]): ManpowerCell[] {
  let next = cells;
  for (const add of adds) {
    if (!add.phaseId || !add.weekStartIso || !(add.hours > 0)) continue;
    const current = next.find((cell) => cell.phaseId === add.phaseId && cell.weekStartIso === add.weekStartIso);
    if (!add.dayHours) {
      const hours = Math.round(((current?.hours ?? 0) + add.hours) * 10) / 10;
      next = withCellHours(next, add.phaseId, add.weekStartIso, hours);
      continue;
    }
    const base = current?.dayHours?.length === 7 ? current.dayHours.slice() : emptyDayHours();
    if (current && !current.dayHours && current.hours > 0) base[0] = current.hours;
    add.dayHours.forEach((hours, index) => {
      base[index] = Math.round(((base[index] ?? 0) + hours) * 10) / 10;
    });
    next = withCellDayHours(next, add.phaseId, add.weekStartIso, base);
  }
  return next;
}

/** Finish date when the activity runs past its start. Empty when it is one day. */
export function upcomingSpanEnd(startIso: string | null | undefined, finishIso: string | null | undefined): string {
  const start = (startIso ?? "").trim();
  const finish = (finishIso ?? "").trim();
  if (!start || !finish || finish <= start) return "";
  return finish;
}

export function upcomingEventTitle(jobNumber: string, activityName: string): string {
  const name = activityName.trim().replace(/\s+/g, " ");
  const job = jobNumber.trim();
  const titled = job && !name.toLowerCase().startsWith(job.toLowerCase()) ? `${job} ${name}` : name;
  return titled.slice(0, 120);
}
