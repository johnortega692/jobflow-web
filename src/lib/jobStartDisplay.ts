import { formatDateDisplay, parseFlexibleDate } from "./dateInputUtils.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAY_MS = 86400000;

export type JobStartMarker =
  | { kind: "day"; text: string }
  | { kind: "soon"; text: string };

export type JobStartDisplay = {
  dateLabel: string;
  marker: JobStartMarker | null;
  /** Full MM/DD/YYYY for the hover title. Empty when there is no start date. */
  title: string;
};

function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Whole local calendar days from today to the job start. Negative means already started. */
function daysFromToday(start: Date, today: Date): number {
  const target = startOfLocalDay(start);
  const day = startOfLocalDay(today);
  return Math.round((target.getTime() - day.getTime()) / DAY_MS);
}

/**
 * Single-line job start label.
 * Past dates get a muted "Day N". The next 14 days get an amber chip. Later dates are the date only.
 */
export function formatJobStart(dateStr: string, today: Date = new Date()): JobStartDisplay {
  const parsed = parseFlexibleDate(dateStr);
  if (!parsed) return { dateLabel: "—", marker: null, title: "" };

  const start = startOfLocalDay(parsed);
  const day = startOfLocalDay(today);
  const days = daysFromToday(start, day);
  const month = MONTHS[start.getMonth()] ?? "Jan";
  const dateLabel =
    start.getFullYear() === day.getFullYear()
      ? `${month} ${start.getDate()}`
      : `${month} ${start.getDate()}, ${start.getFullYear()}`;

  let marker: JobStartMarker | null = null;
  if (days < 0) marker = { kind: "day", text: `Day ${-days}` };
  else if (days === 0) marker = { kind: "soon", text: "Today" };
  else if (days === 1) marker = { kind: "soon", text: "Tomorrow" };
  else if (days <= 14) marker = { kind: "soon", text: `in ${days}d` };

  return { dateLabel, marker, title: formatDateDisplay(start) };
}
