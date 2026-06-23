import { parseFlexibleDate } from "./dateInputUtils";
import type { FieldPaintRow, FieldWcItemRow } from "./fieldTrackerProject";

export type FieldCalendarEventKind = "start" | "install";

export type FieldCalendarEvent = {
  id: string;
  dateKey: string;
  kind: FieldCalendarEventKind;
  jobNumber: string;
  jobName: string;
  detail: string;
};

export function dateToKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function keyToDate(key: string): Date | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!);
}

export function parseFieldDate(value: string): Date | null {
  return parseFlexibleDate(value);
}

export function buildFieldCalendarEvents(
  paintRows: FieldPaintRow[],
  wcRows: FieldWcItemRow[],
): FieldCalendarEvent[] {
  const events: FieldCalendarEvent[] = [];

  for (const row of paintRows) {
    const d = parseFieldDate(row.startDate);
    if (!d) continue;
    events.push({
      id: `start-${row.projectId}`,
      dateKey: dateToKey(d),
      kind: "start",
      jobNumber: row.jobNumber,
      jobName: row.jobName,
      detail: "Paint start",
    });
  }

  for (const row of wcRows) {
    const d = parseFieldDate(row.installDate);
    if (!d) continue;
    const wcLabel = row.label.trim() || row.wallcoveringName.trim();
    events.push({
      id: `install-${row.projectId}-${row.lineId}`,
      dateKey: dateToKey(d),
      kind: "install",
      jobNumber: row.jobNumber,
      jobName: row.jobName,
      detail: wcLabel ? `WC install · ${wcLabel}` : "WC install",
    });
  }

  return events.sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.jobNumber.localeCompare(b.jobNumber),
  );
}

export function groupEventsByDate(events: FieldCalendarEvent[]): Map<string, FieldCalendarEvent[]> {
  const map = new Map<string, FieldCalendarEvent[]>();
  for (const event of events) {
    const list = map.get(event.dateKey) ?? [];
    list.push(event);
    map.set(event.dateKey, list);
  }
  return map;
}

export type CalendarDayCell = {
  date: Date;
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
};

export function buildMonthGrid(viewMonth: Date): CalendarDayCell[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const todayKey = dateToKey(new Date());
  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateKey = dateToKey(date);
    cells.push({
      date,
      dateKey,
      inMonth: date.getMonth() === month,
      isToday: dateKey === todayKey,
    });
  }

  return cells;
}

export function monthLabel(viewMonth: Date): string {
  return viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
