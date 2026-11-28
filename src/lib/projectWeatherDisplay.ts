const HOUR_MS = 60 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
const SOON_HOURS = 3;
const TOMORROW_START_HOURS = 24;
const TOMORROW_END_HOURS = 48;
const OUTLOOK_DAYS = 7;
const RAIN_DAY_PROBABILITY = 40;

export type ProjectWeatherRow = {
  fetched_at: string;
  raining_now: boolean;
  precip_prob_next_hours: unknown;
  next_rain_at: string | null;
  daily: unknown;
};

export type WeatherChipTone = "raining" | "soon" | "tomorrow" | "dry" | "muted";

export type WeatherChipKind =
  | "interior"
  | "none"
  | "stale"
  | "raining"
  | "soon"
  | "later"
  | "tomorrow"
  | "dry";

export type WeatherChip = {
  kind: WeatherChipKind;
  label: string;
  tone: WeatherChipTone;
};

/** Text and fill pairs that clear 4.5:1 on the projects table. */
export const WEATHER_CHIP_COLORS: Record<WeatherChipTone, { background: string; color: string }> = {
  raining: { background: "#16325c", color: "#d6e6ff" },
  soon: { background: "#3f3214", color: "#ffe7a8" },
  tomorrow: { background: "#2c3344", color: "#e6ebf5" },
  dry: { background: "#143528", color: "#d7ffe6" },
  muted: { background: "#2b3344", color: "#d5dbe6" },
};

export const RAIN_WATCH_BANNER_COLORS = {
  background: "#3a2e14",
  color: "#ffe7a8",
  border: "#8a6a1e",
  actionBackground: "#ffe7a8",
  actionColor: "#1a1408",
};

export type DashboardWeatherStatus = {
  kind: "raining" | "soon" | "dry";
  label: "Raining now" | "Rain soon" | "Dry";
};

export type HourChance = {
  label: string;
  probability: number | null;
};

export type StripHourView = {
  hour: number;
  precipProb: number | null;
};

export type WorkVerdict = "go" | "partial" | "nogo";

export type WorkWindowScore = {
  verdict: WorkVerdict | null;
  windowMax: number | null;
  firstRainHour: number | null;
  note: string;
};

export type DayOutlook = {
  label: string;
  precipProb: number | null;
  shortForecast: string;
  hi: number | null;
  lo: number | null;
  todayPartial: boolean;
  hours: StripHourView[] | null;
  qpfIn: number | null;
  verdict: WorkVerdict | null;
  windowMax: number | null;
  firstRainHour: number | null;
  note: string;
};

export type ChartHour = {
  probability: number | null;
  axisLabel: string;
  clockLabel: string | null;
};

export type HeroWeatherPill = {
  kind: "raining" | "soon" | "dry";
  label: string;
};

const HERO_RAIN_PROBABILITY = 40;

/** Crew call for the 6:00 AM–3:00 PM window. Edit these to retune the outlook. */
export const WORK_WINDOW = {
  windowStart: 6,
  windowEnd: 15,
  goMax: 30,
  rainLikely: 40,
  noGoMax: 60,
  noGoHours: 5,
} as const;

const STRIP_START_HOUR = 5;
const STRIP_END_HOUR = 17;

export type OutlookTint = "wet" | "watch" | "plain";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function dashboardWeatherStatus(row: ProjectWeatherRow, nowMs: number): DashboardWeatherStatus {
  if (row.raining_now) return { kind: "raining", label: "Raining now" };
  const next = row.next_rain_at ? Date.parse(row.next_rain_at) : Number.NaN;
  if (Number.isFinite(next)) {
    const hours = (next - nowMs) / HOUR_MS;
    if (hours >= -1 && hours <= SOON_HOURS) return { kind: "soon", label: "Rain soon" };
  }
  return { kind: "dry", label: "Dry" };
}

export function weatherUpdatedLabel(fetchedAt: string, nowMs: number): string {
  const fetched = Date.parse(fetchedAt);
  const minutes = Number.isFinite(fetched) ? Math.max(0, Math.round((nowMs - fetched) / 60000)) : 0;
  return `Updated ${minutes} min ago · National Weather Service`;
}

export function hourlyRainChances(value: unknown): HourChance[] {
  const probs = asNumberArray(value);
  return Array.from({ length: 8 }, (_, index) => ({
    label: index === 0 ? "Now" : `+${index}h`,
    probability: probs[index] ?? null,
  }));
}

export function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12} ${suffix}`;
}

export function hourTick(hour: number): string {
  const suffix = hour >= 12 ? "p" : "a";
  const hour12 = hour % 12 || 12;
  return `${hour12}${suffix}`;
}

const TIMING_UNAVAILABLE: WorkWindowScore = {
  verdict: null,
  windowMax: null,
  firstRainHour: null,
  note: "Timing not available",
};

/** Score one day's 5 AM–5 PM strip against the crew window. */
export function scoreWorkWindow(hours: StripHourView[] | null): WorkWindowScore {
  if (!hours?.length) return TIMING_UNAVAILABLE;
  const window = hours
    .filter(
      (hour) =>
        hour.hour >= WORK_WINDOW.windowStart &&
        hour.hour < WORK_WINDOW.windowEnd &&
        hour.precipProb != null,
    )
    .sort((left, right) => left.hour - right.hour);
  if (!window.length) return TIMING_UNAVAILABLE;

  const windowMax = Math.max(...window.map((hour) => hour.precipProb ?? 0));
  const soaked = window.filter((hour) => (hour.precipProb ?? 0) >= WORK_WINDOW.noGoMax).length;
  const first = window.find((hour) => (hour.precipProb ?? 0) >= WORK_WINDOW.rainLikely);
  const firstRainHour = first ? first.hour : null;

  if (windowMax < WORK_WINDOW.goMax) {
    const note =
      windowMax >= 10 ? "Low rain chance through the work window." : "Dry through the work window.";
    return { verdict: "go", windowMax, firstRainHour, note };
  }
  if (soaked >= WORK_WINDOW.noGoHours) {
    return { verdict: "nogo", windowMax, firstRainHour, note: "Rain most of the window. Hold the crew." };
  }
  if (firstRainHour == null) {
    return {
      verdict: "partial",
      windowMax,
      firstRainHour,
      note: "Low-end chance only. Watch the morning update.",
    };
  }
  if (firstRainHour < WORK_WINDOW.windowStart + 2) {
    return { verdict: "partial", windowMax, firstRainHour, note: "Rain likely from the start. Consider holding." };
  }
  return {
    verdict: "partial",
    windowMax,
    firstRainHour,
    note: `Send crew, plan to pull off around ${hourLabel(firstRainHour)}.`,
  };
}

function parseStrip(value: unknown): StripHourView[] | null {
  if (!Array.isArray(value)) return null;
  const hours: StripHourView[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { hour?: unknown; precip_prob?: unknown };
    if (typeof record.hour !== "number" || !Number.isInteger(record.hour)) continue;
    if (record.hour < STRIP_START_HOUR || record.hour > STRIP_END_HOUR) continue;
    hours.push({ hour: record.hour, precipProb: finiteNumber(record.precip_prob) });
  }
  return hours.length ? hours : null;
}

export function dailyOutlook(value: unknown): DayOutlook[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, OUTLOOK_DAYS).map((day) => {
    const record = day && typeof day === "object" ? (day as Record<string, unknown>) : {};
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const shortForecast = typeof record.short_forecast === "string" ? record.short_forecast.trim() : "";
    const hours = parseStrip(record.hours);
    const score = scoreWorkWindow(hours);
    return {
      label: label || "—",
      precipProb: finiteNumber(record.precip_prob),
      shortForecast,
      hi: finiteNumber(record.hi),
      lo: finiteNumber(record.lo),
      todayPartial: record.today_partial === true,
      hours,
      qpfIn: finiteNumber(record.qpf_in),
      ...score,
    };
  });
}

export const TODAY_DONE_NOTE = "Work window is over.";

export function isWorkWindowOver(now: Date): boolean {
  return now.getHours() >= WORK_WINDOW.windowEnd;
}

export type TodayWindow = { kind: "done" } | { kind: "open"; score: WorkWindowScore };

/** Today before 3 PM, scored from the current hour through 2 PM. After 3 PM the shift is done. */
export function todayWindow(day: Pick<DayOutlook, "hours">, now: Date): TodayWindow {
  if (isWorkWindowOver(now)) return { kind: "done" };
  const start = Math.max(now.getHours(), WORK_WINDOW.windowStart);
  const ahead = (day.hours ?? []).filter((hour) => hour.hour >= start && hour.hour < WORK_WINDOW.windowEnd);
  return { kind: "open", score: scoreWorkWindow(ahead.length ? ahead : null) };
}

/** First Partial or No-go day. Today when the window is clear. Skip Today after 3 PM. */
export function defaultOutlookIndex(days: DayOutlook[], now?: Date): number {
  const skipToday = now != null && isWorkWindowOver(now);
  const index = days.findIndex((day, dayIndex) => {
    if (skipToday && dayIndex === 0) return false;
    return day.verdict === "partial" || day.verdict === "nogo";
  });
  if (index >= 0) return index;
  return skipToday && days.length > 1 ? 1 : 0;
}

/** Clock time from an NWS timestamp, using the offset already in the string. */
export function weatherClockLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return minute === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function hourlyChartHours(probabilities: unknown, times: unknown): ChartHour[] {
  const probs = asNumberArray(probabilities);
  const stamps = Array.isArray(times) ? times : [];
  return Array.from({ length: 8 }, (_, index) => {
    const clockLabel = weatherClockLabel(stamps[index]);
    return {
      probability: probs[index] ?? null,
      axisLabel: index === 0 ? "Now" : (clockLabel ?? ""),
      clockLabel,
    };
  });
}

function extremeHour(
  hours: ChartHour[],
  pick: "max" | "min",
): { index: number; probability: number; clockLabel: string | null } | null {
  let index = -1;
  let probability = pick === "max" ? -1 : 101;
  for (let cursor = 0; cursor < hours.length; cursor += 1) {
    const value = hours[cursor]?.probability;
    if (value == null) continue;
    const better = pick === "max" ? value > probability : value < probability;
    if (index === -1 || better) {
      index = cursor;
      probability = value;
    }
  }
  if (index < 0) return null;
  return { index, probability, clockLabel: hours[index]?.clockLabel ?? null };
}

export function peakChartHour(hours: ChartHour[]) {
  return extremeHour(hours, "max");
}

export function driestChartHour(hours: ChartHour[]) {
  return extremeHour(hours, "min");
}

export function heroWeatherPill(rainingNow: boolean, hours: ChartHour[]): HeroWeatherPill {
  if (rainingNow) return { kind: "raining", label: "Raining now" };
  const peak = peakChartHour(hours);
  if (peak && peak.probability >= HERO_RAIN_PROBABILITY) {
    const when = peak.clockLabel ? ` at ${peak.clockLabel}` : "";
    return { kind: "soon", label: `Rain soon · peaks ${Math.round(peak.probability)}%${when}` };
  }
  return { kind: "dry", label: "Dry next 8 hours" };
}

export function forecastIconKind(text: string): "rain" | "sun" | "cloud" {
  if (/\b(rain|showers?|drizzle|thunderstorms?|sleet|storms?)\b/i.test(text)) return "rain";
  if (/\b(sunny|sun|clear|fair)\b/i.test(text)) return "sun";
  return "cloud";
}

export function outlookTint(precipProb: number | null): OutlookTint {
  if (precipProb != null && precipProb >= 60) return "wet";
  if (precipProb != null && precipProb >= RAIN_DAY_PROBABILITY) return "watch";
  return "plain";
}

function leadingDryDays(daily: unknown): number | null {
  if (!Array.isArray(daily) || daily.length === 0) return null;
  let count = 0;
  for (const day of daily.slice(0, OUTLOOK_DAYS)) {
    const record = day && typeof day === "object" ? (day as { precip_prob?: unknown }) : {};
    const probability = finiteNumber(record.precip_prob);
    if (probability != null && probability >= RAIN_DAY_PROBABILITY) break;
    count += 1;
  }
  return count;
}

export function isRainWatchChip(chip: WeatherChip): boolean {
  return chip.kind === "raining" || chip.kind === "soon";
}

export function isRainRiskChip(chip: WeatherChip): boolean {
  return (
    chip.kind === "raining" ||
    chip.kind === "soon" ||
    chip.kind === "later" ||
    chip.kind === "tomorrow"
  );
}

function asNumberArray(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null));
}

function dailyProb(value: unknown, index: number): number | null {
  if (!Array.isArray(value)) return null;
  const day = value[index];
  if (!day || typeof day !== "object") return null;
  const prob = (day as { precip_prob?: unknown }).precip_prob;
  return typeof prob === "number" && Number.isFinite(prob) ? prob : null;
}

function withPercent(label: string, probability: number | null): string {
  if (probability == null) return label;
  return `${label} · ${probability}%`;
}

function rainInLabel(hours: number): string {
  const n = Math.max(1, Math.round(hours));
  return `Rain in ~${n} ${n === 1 ? "hr" : "hrs"}`;
}

function dryLabel(days: number): string {
  const n = Math.min(OUTLOOK_DAYS, Math.max(1, Math.round(days)));
  return `Dry for ${n} ${n === 1 ? "day" : "days"}`;
}

function probabilityFor(
  hoursFromNow: number,
  fetchedMs: number,
  nextMs: number,
  row: ProjectWeatherRow,
): number | null {
  const hoursFromFetch = (nextMs - fetchedMs) / HOUR_MS;
  const probs = asNumberArray(row.precip_prob_next_hours);
  const index = Math.round(hoursFromFetch);
  const hourly = index >= 0 && index < probs.length ? probs[index] : null;
  if (hourly != null) return Math.round(hourly);
  if (hoursFromNow >= TOMORROW_START_HOURS && hoursFromNow <= TOMORROW_END_HOURS) {
    const daily = dailyProb(row.daily, 1);
    return daily == null ? null : Math.round(daily);
  }
  if (hoursFromNow > SOON_HOURS && hoursFromNow < TOMORROW_START_HOURS) {
    const daily = dailyProb(row.daily, 0);
    return daily == null ? null : Math.round(daily);
  }
  return null;
}

export function projectWeatherChip(
  project: { is_exterior?: boolean | null },
  row: ProjectWeatherRow | null | undefined,
  nowMs: number,
): WeatherChip {
  if (project.is_exterior !== true) {
    return { kind: "interior", label: "Interior, no weather", tone: "muted" };
  }
  if (!row) {
    return { kind: "none", label: "No forecast", tone: "muted" };
  }
  const fetched = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetched) || nowMs - fetched > STALE_MS) {
    return { kind: "stale", label: "Weather stale", tone: "muted" };
  }
  if (row.raining_now) {
    return { kind: "raining", label: "Raining now", tone: "raining" };
  }

  const next = row.next_rain_at ? Date.parse(row.next_rain_at) : Number.NaN;
  const hours = Number.isFinite(next) ? (next - nowMs) / HOUR_MS : null;
  if (hours != null && hours >= -1 && hours <= SOON_HOURS) {
    const displayHours = Math.max(0, hours);
    return {
      kind: "soon",
      label: withPercent(rainInLabel(displayHours), probabilityFor(displayHours, fetched, next, row)),
      tone: "soon",
    };
  }
  if (hours != null && hours > SOON_HOURS && hours < TOMORROW_START_HOURS) {
    return {
      kind: "later",
      label: withPercent(rainInLabel(hours), probabilityFor(hours, fetched, next, row)),
      tone: "tomorrow",
    };
  }
  if (hours != null && hours >= TOMORROW_START_HOURS && hours <= TOMORROW_END_HOURS) {
    return {
      kind: "tomorrow",
      label: withPercent("Rain tomorrow", probabilityFor(hours, fetched, next, row)),
      tone: "tomorrow",
    };
  }

  const fromHours = hours == null || hours < -1 ? OUTLOOK_DAYS : Math.min(OUTLOOK_DAYS, Math.max(1, Math.floor(hours / 24)));
  const fromDaily = leadingDryDays(row.daily);
  const days = fromDaily == null || fromDaily === 0 ? fromHours : Math.min(fromHours, fromDaily);
  return { kind: "dry", label: dryLabel(days), tone: "dry" };
}

/** Compact projects-list label. Dry sits beside the GC; other pills use the full phrase. */
export function projectListWeatherLabel(chip: WeatherChip): string {
  if (chip.kind === "dry") {
    const days = chip.label.match(/^Dry for (\d+)/)?.[1];
    return days ? `Dry ${days}d` : "Dry";
  }
  if (chip.kind === "soon" || chip.kind === "later") {
    return chip.label.replace(/^Rain in ~(\d+) hrs?/, "Rain ~$1h");
  }
  return chip.label;
}
