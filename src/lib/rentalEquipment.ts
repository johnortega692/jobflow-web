export const RENTAL_STATUSES = ["needed", "ordered", "on_rent", "called_off", "picked_up"] as const;

export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_STATUS_LABEL: Record<RentalStatus, string> = {
  needed: "Needed",
  ordered: "Ordered",
  on_rent: "On rent",
  called_off: "Called off",
  picked_up: "Picked up",
};

/** A rental line. Units with different dates belong on their own lines. */
export type RentalLine = {
  id: string;
  /** Equipment and size, such as "Boom, 45 ft". */
  name: string;
  /** Always 1. Another piece is another row, so one can come off rent on its own day. */
  quantity: number;
  /** First day on rent, YYYY-MM-DD. Empty until set. */
  onRentIso: string;
  /** Last day on rent, YYYY-MM-DD, inclusive. Empty until set. */
  offRentIso: string;
  /** When set, Saturdays, Sundays, and job holidays are not on rent. */
  skipClosedDays: boolean;
  vendor: string;
  poNumber: string;
  dayRate: number | null;
  weekRate: number | null;
  fourWeekRate: number | null;
  /** One delivery and pickup charge per unit. */
  deliveryPickup: number | null;
  status: RentalStatus;
};

/** A hand-entered quantity. Without dayIso it covers the whole week. With dayIso it covers that day. */
export type RentalWeekOverride = {
  equipmentId: string;
  weekStartIso: string;
  quantity: number;
  dayIso?: string;
};

export type RentalWeekFill = {
  quantity: number;
  /** "X", "X · from Wed", or "X · thru Wed". Empty when the week is cleared. */
  label: string;
  overridden: boolean;
  /** Days of this Monday week the line actually covers. */
  note: string;
};

export type RentalQuote = {
  /** Cheapest time charge plus delivery, for one unit. */
  perUnit: number;
  total: number;
  /** "1 × 4-week + 1 × day + delivery" */
  summary: string;
};

export type RentalReminder = {
  equipmentId: string;
  kind: "order" | "calloff";
  dateIso: string;
  overdue: boolean;
  text: string;
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoParts(iso: string): [number, number, number] | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function addDaysIso(iso: string, days: number): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function weekdayIndex(iso: string): number {
  const parts = isoParts(iso);
  if (!parts) return 0;
  return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
}

function weekdayShort(iso: string): string {
  return WEEKDAY[weekdayIndex(iso)] ?? "";
}

function weekSunday(mondayIso: string): string {
  return addDaysIso(mondayIso, 6);
}

/** Move across weekdays only. Negative counts go earlier. */
export function shiftWeekdays(iso: string, weekdays: number): string {
  if (!isoParts(iso) || weekdays === 0) return iso;
  const step = weekdays < 0 ? -1 : 1;
  let left = Math.abs(weekdays);
  let cursor = iso;
  while (left > 0) {
    cursor = addDaysIso(cursor, step);
    const name = weekdayShort(cursor);
    if (name !== "Sat" && name !== "Sun") left -= 1;
  }
  return cursor;
}

export function inclusiveDays(onRentIso: string, offRentIso: string): number | null {
  if (!isoParts(onRentIso) || !isoParts(offRentIso) || offRentIso < onRentIso) return null;
  const start = isoParts(onRentIso)!;
  const end = isoParts(offRentIso)!;
  const from = new Date(start[0], start[1] - 1, start[2]).getTime();
  const to = new Date(end[0], end[1] - 1, end[2]).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
}

/** Order by is two weekdays before on-rent. Call off by is one weekday before off-rent. */
export function orderByIso(onRentIso: string): string {
  return onRentIso ? shiftWeekdays(onRentIso, -2) : "";
}

export function callOffByIso(offRentIso: string): string {
  return offRentIso ? shiftWeekdays(offRentIso, -1) : "";
}

export function rentalIsConfirmed(status: RentalStatus): boolean {
  return status !== "needed";
}

type DateRange = { start: string; end: string };

function dateRange(line: Pick<RentalLine, "onRentIso" | "offRentIso">): DateRange | null {
  const on = line.onRentIso;
  const off = line.offRentIso;
  if (on && off) return off < on ? null : { start: on, end: off };
  if (on) return { start: on, end: "9999-12-31" };
  if (off) return { start: "0001-01-01", end: off };
  return null;
}

function isWeekend(iso: string): boolean {
  const name = weekdayShort(iso);
  return name === "Sat" || name === "Sun";
}

function eachDay(start: string, end: string, visit: (iso: string) => void) {
  let iso = start;
  while (iso <= end) {
    visit(iso);
    if (iso === end) break;
    const next = addDaysIso(iso, 1);
    if (next === iso) break;
    iso = next;
  }
}

function closedDay(iso: string, skipClosedDays: boolean, holidays: ReadonlySet<string>): boolean {
  return skipClosedDays && (isWeekend(iso) || holidays.has(iso));
}

function openDays(start: string, end: string, skipClosedDays: boolean, holidays: ReadonlySet<string>): string[] {
  const days: string[] = [];
  eachDay(start, end, (iso) => {
    if (!closedDay(iso, skipClosedDays, holidays)) days.push(iso);
  });
  return days;
}

/** One piece per line. A rented day is on (1) or off (0). */
export function rentalDayFill(
  line: Pick<RentalLine, "onRentIso" | "offRentIso" | "skipClosedDays">,
  dateIso: string,
  weekOverride: number | null,
  dayOverride: number | null,
  holidays: readonly string[] = [],
): { quantity: number; overridden: boolean } | null {
  if (dayOverride != null) {
    return { quantity: dayOverride > 0 ? 1 : 0, overridden: true };
  }
  const range = dateRange(line);
  const inRange = Boolean(range && dateIso >= range.start && dateIso <= range.end);
  if (!inRange) return null;
  if (closedDay(dateIso, line.skipClosedDays, new Set(holidays))) return null;
  if (weekOverride != null && !(weekOverride > 0)) return { quantity: 0, overridden: true };
  return { quantity: 1, overridden: weekOverride != null };
}

export function rentalWeekFill(
  line: Pick<RentalLine, "onRentIso" | "offRentIso" | "skipClosedDays">,
  mondayIso: string,
  override: number | null,
  holidays: readonly string[] = [],
): RentalWeekFill | null {
  const range = dateRange(line);
  const sunday = weekSunday(mondayIso);
  const hit = range
    ? {
        from: range.start > mondayIso ? range.start : mondayIso,
        to: range.end < sunday ? range.end : sunday,
      }
    : null;
  const inRange = Boolean(hit && hit.from <= hit.to);
  const holidaySet = new Set(holidays);
  const counted = inRange && hit ? openDays(hit.from, hit.to, line.skipClosedDays, holidaySet) : [];
  const weekOpen = openDays(mondayIso, sunday, line.skipClosedDays, holidaySet);
  if (!inRange && override == null) return null;
  if (inRange && counted.length === 0 && override == null) return null;
  const from = counted[0] ?? "";
  const to = counted[counted.length - 1] ?? "";
  const startsLate = Boolean(from && weekOpen[0] && from !== weekOpen[0]);
  const endsEarly = Boolean(to && weekOpen[weekOpen.length - 1] && to !== weekOpen[weekOpen.length - 1]);
  const note = !from
    ? ""
    : startsLate && endsEarly
      ? `from ${weekdayShort(from)} · thru ${weekdayShort(to)}`
      : startsLate
        ? `from ${weekdayShort(from)}`
        : endsEarly
          ? `thru ${weekdayShort(to)}`
          : "";
  const on = override == null || override > 0;
  if (!on) {
    return { quantity: 0, label: "", overridden: override != null, note };
  }
  return {
    quantity: 1,
    label: note ? `X · ${note}` : "X",
    overridden: override != null,
    note,
  };
}

export function rentalUnitWeeks(
  line: Pick<RentalLine, "onRentIso" | "offRentIso" | "skipClosedDays">,
  weekStarts: string[],
  overrides: ReadonlyMap<string, number>,
  holidays: readonly string[] = [],
): number {
  return weekStarts.reduce((sum, week) => {
    const fill = rentalWeekFill(line, week, overrides.has(week) ? overrides.get(week)! : null, holidays);
    return sum + (fill?.quantity ?? 0);
  }, 0);
}

export function cheapestRentalQuote(
  days: number,
  quantity: number,
  rates: Pick<RentalLine, "dayRate" | "weekRate" | "fourWeekRate" | "deliveryPickup">,
): RentalQuote | null {
  if (!(days > 0) || !(quantity > 0)) return null;
  const day = rates.dayRate && rates.dayRate > 0 ? rates.dayRate : null;
  const week = rates.weekRate && rates.weekRate > 0 ? rates.weekRate : null;
  const four = rates.fourWeekRate && rates.fourWeekRate > 0 ? rates.fourWeekRate : null;
  const maxFour = four ? Math.ceil(days / 28) + 1 : 0;
  const maxWeek = week ? Math.ceil(days / 7) + 1 : 0;
  let best: { cost: number; n4: number; nw: number; nd: number } | null = null;
  for (let n4 = 0; n4 <= maxFour; n4 += 1) {
    for (let nw = 0; nw <= maxWeek; nw += 1) {
      const covered = n4 * 28 + nw * 7;
      const nd = covered < days ? days - covered : 0;
      if (nd > 0 && !day) continue;
      const cost = n4 * (four ?? 0) + nw * (week ?? 0) + nd * (day ?? 0);
      if (!best || cost < best.cost) best = { cost, n4, nw, nd };
    }
  }
  const delivery = rates.deliveryPickup && rates.deliveryPickup > 0 ? rates.deliveryPickup : 0;
  if (!best && !(delivery > 0)) return null;
  const parts: string[] = [];
  if (best?.n4) parts.push(`${best.n4} × 4-week`);
  if (best?.nw) parts.push(`${best.nw} × week`);
  if (best?.nd) parts.push(`${best.nd} × day`);
  if (delivery > 0) parts.push("delivery");
  const perUnit = (best?.cost ?? 0) + delivery;
  return { perUnit, total: perUnit * quantity, summary: parts.join(" + ") };
}

export function rentalBillableDays(line: Pick<RentalLine, "onRentIso" | "offRentIso" | "skipClosedDays">, holidays: readonly string[] = []): number | null {
  if (!line.onRentIso || !line.offRentIso || line.offRentIso < line.onRentIso) return null;
  if (!line.skipClosedDays) return inclusiveDays(line.onRentIso, line.offRentIso);
  const counted = openDays(line.onRentIso, line.offRentIso, true, new Set(holidays));
  return counted.length > 0 ? counted.length : null;
}

export function rentalQuoteForLine(line: RentalLine, holidays: readonly string[] = []): RentalQuote | null {
  const days = rentalBillableDays(line, holidays);
  if (days == null) return null;
  return cheapestRentalQuote(days, 1, line);
}

function shortDate(iso: string): string {
  const parts = isoParts(iso);
  if (!parts) return iso;
  return `${parts[1]}/${parts[2]}`;
}

export function rentalReminders(lines: RentalLine[], todayIso: string, horizonDays = 7): RentalReminder[] {
  const horizon = addDaysIso(todayIso, horizonDays);
  const out: RentalReminder[] = [];
  for (const line of lines) {
    const name = line.name.trim() || "Equipment";
    if (line.status === "needed" || line.status === "ordered") {
      const due = orderByIso(line.onRentIso);
      if (due && due <= horizon) {
        out.push({
          equipmentId: line.id,
          kind: "order",
          dateIso: due,
          overdue: due < todayIso,
          text: `Order ${name} by ${shortDate(due)}`,
        });
      }
    }
    if (line.status === "on_rent") {
      const due = callOffByIso(line.offRentIso);
      if (due && due <= horizon) {
        out.push({
          equipmentId: line.id,
          kind: "calloff",
          dateIso: due,
          overdue: due < todayIso,
          text: `Call off ${name} by ${shortDate(due)}`,
        });
      }
    }
  }
  return out;
}

export function shiftRentalLine(line: RentalLine, dayDelta: number): RentalLine {
  if (!dayDelta) return line;
  return {
    ...line,
    onRentIso: line.onRentIso ? addDaysIso(line.onRentIso, dayDelta) : "",
    offRentIso: line.offRentIso ? addDaysIso(line.offRentIso, dayDelta) : "",
  };
}

export function blankRentalLine(id: string): RentalLine {
  return {
    id,
    name: "",
    quantity: 1,
    onRentIso: "",
    offRentIso: "",
    skipClosedDays: false,
    vendor: "",
    poNumber: "",
    dayRate: null,
    weekRate: null,
    fourWeekRate: null,
    deliveryPickup: null,
    status: "needed",
  };
}

function money(value: unknown): number | null {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

function cleanText(value: unknown, max: number): string {
  return (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanIso(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function normalizeRentalLine(raw: unknown): RentalLine | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 80);
  if (!id) return null;
  const status = RENTAL_STATUSES.includes(record.status as RentalStatus) ? (record.status as RentalStatus) : "needed";
  return {
    id,
    name: cleanText(record.name, 80),
    quantity: 1,
    onRentIso: cleanIso(record.onRentIso),
    offRentIso: cleanIso(record.offRentIso),
    skipClosedDays: record.skipClosedDays === true,
    vendor: cleanText(record.vendor, 80),
    poNumber: cleanText(record.poNumber, 40),
    dayRate: money(record.dayRate),
    weekRate: money(record.weekRate) ?? money(record.weeklyRate),
    fourWeekRate: money(record.fourWeekRate),
    deliveryPickup: money(record.deliveryPickup),
    status,
  };
}

function storedQuantity(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 1;
  const value = (raw as Record<string, unknown>).quantity;
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return 1;
  return Math.min(99, Math.round(quantity));
}

export function normalizeRentalLines(raw: unknown): RentalLine[] {
  if (!Array.isArray(raw)) return [];
  const out: RentalLine[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const line = normalizeRentalLine(item);
    if (!line) continue;
    const copies = storedQuantity(item);
    for (let index = 1; index <= copies; index += 1) {
      const id = index === 1 ? line.id : `${line.id}:${index}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ ...line, id, quantity: 1 });
    }
  }
  return out;
}

export function normalizeRentalOverrides(raw: unknown, equipmentIds: ReadonlySet<string>): RentalWeekOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: RentalWeekOverride[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const equipmentId = cleanText(record.equipmentId, 80);
    const weekStartIso = cleanIso(record.weekStartIso);
    const dayIso = cleanIso(record.dayIso);
    if (!equipmentIds.has(equipmentId) || !weekStartIso) continue;
    const quantityRaw = typeof record.quantity === "number" ? record.quantity : Number(record.quantity);
    if (!Number.isFinite(quantityRaw) || quantityRaw < 0 || quantityRaw > 99) continue;
    const key = `${equipmentId}:${weekStartIso}:${dayIso}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      equipmentId,
      weekStartIso,
      quantity: Math.round(quantityRaw),
      ...(dayIso ? { dayIso } : {}),
    });
  }
  return out;
}
