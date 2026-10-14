/**
 * Decide whether a reviewed GC activity lands on Labor Projection hours
 * or on Upcoming in Manpower.
 */

import {
  addWeeksIso,
  cellHours,
  mondayIsoFromDateInput,
  todayMondayIso,
  weekColumnLabel,
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
          ? `Adds hours to ${phaseDisplayLabel(phase)} · ${span}`
          : `Splits hours across ${phaseDisplayLabel(phase)} · ${span}`,
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

/** Split one activity's hours across the weeks it overlaps. The last week gets the remainder. */
export function splitGcHours(
  phaseId: string,
  weeks: string[],
  hours: number,
): { phaseId: string; weekStartIso: string; hours: number }[] {
  if (!phaseId || !(hours > 0) || weeks.length === 0) return [];
  let used = 0;
  return weeks.flatMap((weekStartIso, index) => {
    const share =
      index === weeks.length - 1
        ? Math.round((hours - used) * 10) / 10
        : Math.floor((hours / weeks.length) * 10) / 10;
    used += share;
    if (!(share > 0)) return [];
    return [{ phaseId, weekStartIso, hours: share }];
  });
}

export function addGcHours(
  cells: ManpowerCell[],
  adds: { phaseId: string; weekStartIso: string; hours: number }[],
): ManpowerCell[] {
  const grouped = new Map<string, { phaseId: string; weekStartIso: string; hours: number }>();
  for (const add of adds) {
    if (!add.phaseId || !add.weekStartIso || !(add.hours > 0)) continue;
    const key = `${add.phaseId}:${add.weekStartIso}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      phaseId: add.phaseId,
      weekStartIso: add.weekStartIso,
      hours: (prev?.hours ?? 0) + add.hours,
    });
  }
  let next = cells;
  for (const add of grouped.values()) {
    const hours = Math.round((cellHours(next, add.phaseId, add.weekStartIso) + add.hours) * 10) / 10;
    next = withCellHours(next, add.phaseId, add.weekStartIso, hours);
  }
  return next;
}

export function upcomingEventTitle(jobNumber: string, activityName: string): string {
  const name = activityName.trim().replace(/\s+/g, " ");
  const job = jobNumber.trim();
  const titled = job && !name.toLowerCase().startsWith(job.toLowerCase()) ? `${job} ${name}` : name;
  return titled.slice(0, 120);
}
