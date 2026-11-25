/** Matches Plan week: one person is one 8-hour day. */
const HOURS_PER_PERSON = 8;

export type WeeklyPrintMeasure = "hours" | "people";
export type WeeklyPrintLayout = "week" | "days";

export type WeeklyPrintPhase = {
  id: string;
  costCode: string;
  name: string;
};

export type WeeklyPrintCell = {
  phaseId: string;
  weekStartIso: string;
  hours: number;
  dayHours?: number[];
};

export type WeeklyPrintColumn = {
  weekStart: string;
  /** 0 = Monday … 6 = Sunday. Null on the week-total layout. */
  dayIndex: number | null;
  weekend: boolean;
  holiday: boolean;
};

export type WeeklyPrintRow = {
  phaseId: string;
  label: string;
  values: number[];
  total: number;
};

export type WeeklyPrintGrid = {
  measure: WeeklyPrintMeasure;
  layout: WeeklyPrintLayout;
  columns: WeeklyPrintColumn[];
  rows: WeeklyPrintRow[];
  columnTotals: number[];
  grandTotal: number;
  /** A week total with no saved day plan was placed on Monday. */
  seededMonday: boolean;
};

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function isoParts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function addDays(iso: string, days: number): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  const date = new Date(parts.y, parts.m - 1, parts.d + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function printWeekDayIsos(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(mondayIso, index));
}

export function printWeekLabel(mondayIso: string): string {
  const parts = isoParts(mondayIso);
  if (!parts) return mondayIso;
  return `${parts.m}/${parts.d}`;
}

export function printDateLabel(iso: string): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  return `${parts.m}/${parts.d}/${parts.y}`;
}

export function weeklyPrintPhaseLabel(phase: WeeklyPrintPhase): string {
  const code = phase.costCode.trim();
  const name = phase.name.trim();
  if (code && name && name !== code) return `${code}  ${name}`;
  return code || name || phase.id;
}

/** Hours, or people where 8 hours is one person. */
export function weeklyPrintQuantity(hours: number, measure: WeeklyPrintMeasure): number {
  if (!(hours > 0) || !Number.isFinite(hours)) return 0;
  if (measure === "people") return hours / HOURS_PER_PERSON;
  return hours;
}

/** 1 person is 8 hours. 1.5 is 12 hours. */
export const PEOPLE_PRINT_KEY = "1 person = 8 hours. 1.5 is one person plus 4 hours.";

export function formatWeeklyPrintQuantity(value: number, measure: WeeklyPrintMeasure = "hours"): string {
  if (!(value > 0) || !Number.isFinite(value)) return "";
  if (measure === "people") {
    const hours = Math.round(value * HOURS_PER_PERSON);
    if (hours <= 0) return "";
    const people = hours / HOURS_PER_PERSON;
    return String(people);
  }
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  const tenth = Math.round(rounded * 10) / 10;
  if (Math.abs(tenth - rounded) < 0.001) return tenth.toFixed(1);
  return rounded.toFixed(2);
}

/** People totals keep the headcount and add the hours those people represent. */
export function formatWeeklyPrintTotal(value: number, measure: WeeklyPrintMeasure): string {
  const shown = formatWeeklyPrintQuantity(value, measure);
  if (!shown || measure !== "people") return shown;
  const hours = Math.round(value * HOURS_PER_PERSON);
  return `${shown} (${hours}h)`;
}

function dayHoursForCell(cell: WeeklyPrintCell | undefined): { days: number[]; seeded: boolean } {
  const days = [0, 0, 0, 0, 0, 0, 0];
  if (!cell || !(cell.hours > 0)) return { days, seeded: false };
  if (cell.dayHours && cell.dayHours.length === 7) {
    for (let i = 0; i < 7; i += 1) {
      const hours = cell.dayHours[i] ?? 0;
      days[i] = Number.isFinite(hours) && hours > 0 ? hours : 0;
    }
    return { days, seeded: false };
  }
  days[0] = cell.hours;
  return { days, seeded: true };
}

export function weekdayShort(dayIndex: number): string {
  return WEEKDAY[dayIndex] ?? "";
}

export function buildWeeklyHoursGrid(input: {
  weekStarts: string[];
  phases: WeeklyPrintPhase[];
  cells: WeeklyPrintCell[];
  holidays: string[];
  measure: WeeklyPrintMeasure;
  layout: WeeklyPrintLayout;
}): WeeklyPrintGrid {
  const holidaySet = new Set(input.holidays);
  const cells = new Map(input.cells.map((cell) => [`${cell.phaseId}|${cell.weekStartIso}`, cell]));
  const columns: WeeklyPrintColumn[] = [];

  for (const weekStart of input.weekStarts) {
    const isos = printWeekDayIsos(weekStart);
    if (input.layout === "week") {
      columns.push({
        weekStart,
        dayIndex: null,
        weekend: false,
        holiday: isos.some((iso) => holidaySet.has(iso)),
      });
      continue;
    }
    isos.forEach((iso, dayIndex) => {
      columns.push({
        weekStart,
        dayIndex,
        weekend: dayIndex >= 5,
        holiday: holidaySet.has(iso),
      });
    });
  }

  let seededMonday = false;
  const rows: WeeklyPrintRow[] = input.phases.map((phase) => {
    const values = columns.map((column) => {
      const cell = cells.get(`${phase.id}|${column.weekStart}`);
      if (column.dayIndex == null) return weeklyPrintQuantity(cell?.hours ?? 0, input.measure);
      const { days, seeded } = dayHoursForCell(cell);
      if (seeded) seededMonday = true;
      return weeklyPrintQuantity(days[column.dayIndex] ?? 0, input.measure);
    });
    const total = values.reduce((sum, value) => sum + value, 0);
    return { phaseId: phase.id, label: weeklyPrintPhaseLabel(phase), values, total };
  });

  const columnTotals = columns.map((_, index) => rows.reduce((sum, row) => sum + (row.values[index] ?? 0), 0));
  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);

  return {
    measure: input.measure,
    layout: input.layout,
    columns,
    rows,
    columnTotals,
    grandTotal,
    seededMonday: input.layout === "days" && seededMonday,
  };
}
