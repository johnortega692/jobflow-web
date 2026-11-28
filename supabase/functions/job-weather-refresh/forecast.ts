/** Pure National Weather Service forecast shaping. No network calls. */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const RAIN_PROBABILITY = 40;
const RAINING_NOW_PROBABILITY = 60;
const PRECIP_WORDS = /\b(rain|showers?|drizzle|thunderstorms?|sleet)\b/i;
const CHANCE_WORD = /\bchance\b/i;

export type HourlyPeriod = {
  startTime: string;
  endTime: string;
  temperature: number | null;
  shortForecast: string;
  probabilityOfPrecipitation: number | null;
  windSpeed: string | null;
  windDirection: string | null;
};

/** One local hour on the 5 AM–5 PM strip. The hour is the forecast's local hour, not UTC. */
export type StripHour = {
  hour: number;
  precip_prob: number | null;
};

export type PrecipSample = {
  startMs: number;
  endMs: number;
  mm: number | null;
};

export type DailyWeather = {
  label: string;
  date: string;
  precip_prob: number | null;
  short_forecast: string;
  hi: number | null;
  lo: number | null;
  today_partial: boolean;
  /** Null when the hourly feed does not cover this local date. */
  hours: StripHour[] | null;
  /** Inches of quantitative precip from 6 AM to 3 PM. Null when the grid has no coverage. */
  qpf_in: number | null;
};

export type WeatherSnapshot = {
  raining_now: boolean;
  precip_prob_next_hours: Array<number | null>;
  next_rain_at: string | null;
  temp_now: number | null;
  wind_mph: number | null;
  wind_dir: string | null;
  condition_now: string | null;
  hourly_times: Array<string | null>;
  daily: DailyWeather[];
  alert_text: string | null;
  source: "nws";
};

export function coordinateBucket(lat: number, lng: number): { lat: string; lng: string; key: string } {
  const latText = (Math.round(lat * 100) / 100).toFixed(2);
  const lngText = (Math.round(lng * 100) / 100).toFixed(2);
  return { lat: latText, lng: lngText, key: `${latText},${lngText}` };
}

/** Forecast wording that describes precipitation in progress, not a chance of it. */
export function isDefinitePrecip(shortForecast: string): boolean {
  const text = shortForecast.trim();
  if (!PRECIP_WORDS.test(text)) return false;
  if (CHANCE_WORD.test(text)) return false;
  return true;
}

export function expectsRain(period: Pick<HourlyPeriod, "shortForecast" | "probabilityOfPrecipitation">): boolean {
  const probability = period.probabilityOfPrecipitation;
  if (typeof probability === "number" && probability >= RAIN_PROBABILITY) return true;
  return isDefinitePrecip(period.shortForecast);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

/** First number in an NWS windSpeed such as "10 mph" or "5 to 10 mph". */
export function parseWindMph(windSpeed: string | null): number | null {
  if (!windSpeed) return null;
  const match = /\d+(?:\.\d+)?/.exec(windSpeed);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function localDate(startTime: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(startTime);
  return match?.[1] ?? null;
}

function localHour(startTime: string): number | null {
  const match = /T(\d{2})/.exec(startTime);
  if (!match) return null;
  const hour = Number(match[1]);
  return hour <= 23 ? hour : null;
}

const STRIP_START_HOUR = 5;
const STRIP_END_HOUR = 17;
const QPF_START_HOUR = 6;
const QPF_END_HOUR = 15;

/**
 * 5 AM through 5 PM for one local date, read from the offset in each NWS timestamp.
 * Null when that date is absent from the hourly feed.
 */
export function stripHoursForDate(periods: HourlyPeriod[], isoDate: string): StripHour[] | null {
  let covered = false;
  const byHour = new Map<number, number | null>();
  for (const period of periods) {
    if (localDate(period.startTime) !== isoDate) continue;
    covered = true;
    const hour = localHour(period.startTime);
    if (hour == null || hour < STRIP_START_HOUR || hour > STRIP_END_HOUR) continue;
    if (!byHour.has(hour)) byHour.set(hour, period.probabilityOfPrecipitation);
  }
  if (!covered) return null;
  return Array.from({ length: STRIP_END_HOUR - STRIP_START_HOUR + 1 }, (_, index) => {
    const hour = STRIP_START_HOUR + index;
    return { hour, precip_prob: byHour.has(hour) ? (byHour.get(hour) ?? null) : null };
  });
}

function zonedParts(
  utcMs: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  const bag: Record<string, string> = {};
  for (const part of format.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  let hour = Number(bag.hour);
  const minute = Number(bag.minute);
  if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour === 24) hour = 0;
  return { year, month, day, hour, minute };
}

function partsToUtc(parts: { year: number; month: number; day: number; hour: number; minute: number }): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
}

/** UTC instant of a civil time in the forecast timezone. Handles DST gaps and folds. */
export function zonedLocalToUtc(date: string, hour: number, minute: number, timeZone: string): number | null {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = zonedParts(guess, timeZone);
  if (!first) return null;
  const offset = partsToUtc(first) - guess;
  let instant = guess - offset;
  const second = zonedParts(instant, timeZone);
  if (!second) return null;
  const corrected = partsToUtc(second) - instant;
  if (corrected !== offset) instant = guess - corrected;
  return instant;
}

function durationMs(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const total = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  return total > 0 ? total : null;
}

function millimeters(value: number, unit: string): number {
  if (/\bin\b|inch/i.test(unit) && !/mm/i.test(unit)) return value * 25.4;
  return value;
}

/** Quantitative precipitation intervals. Null when the grid property is missing. */
export function parseQuantitativePrecipitation(body: unknown): PrecipSample[] | null {
  if (!body || typeof body !== "object") return null;
  const grid = (body as { properties?: { quantitativePrecipitation?: unknown } }).properties?.quantitativePrecipitation;
  if (!grid || typeof grid !== "object" || !Array.isArray((grid as { values?: unknown }).values)) return null;
  const unit = typeof (grid as { uom?: unknown }).uom === "string" ? (grid as { uom: string }).uom : "wmoUnit:mm";
  const samples: PrecipSample[] = [];
  for (const raw of (grid as { values: unknown[] }).values) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { validTime?: unknown; value?: unknown };
    if (typeof row.validTime !== "string") continue;
    const split = row.validTime.split("/");
    const start = split[0] ? Date.parse(split[0]) : Number.NaN;
    const duration = split[1] ? durationMs(split[1]) : null;
    if (!Number.isFinite(start) || duration == null) continue;
    const amount = typeof row.value === "number" && Number.isFinite(row.value) ? millimeters(row.value, unit) : null;
    samples.push({ startMs: start, endMs: start + duration, mm: amount });
  }
  return samples;
}

/** Inches of precip overlapping 6:00 AM–3:00 PM local. Null when that window is not covered. */
export function qpfInchesForWindow(samples: PrecipSample[] | null, date: string, timeZone: string | null): number | null {
  if (!samples || !timeZone) return null;
  const start = zonedLocalToUtc(date, QPF_START_HOUR, 0, timeZone);
  const end = zonedLocalToUtc(date, QPF_END_HOUR, 0, timeZone);
  if (start == null || end == null || end <= start) return null;
  let mm = 0;
  let sawNumber = false;
  let sawOverlap = false;
  for (const sample of samples) {
    const duration = sample.endMs - sample.startMs;
    if (duration <= 0) continue;
    const overlap = Math.max(0, Math.min(sample.endMs, end) - Math.max(sample.startMs, start));
    if (overlap <= 0) continue;
    sawOverlap = true;
    if (sample.mm == null) continue;
    sawNumber = true;
    mm += sample.mm * (overlap / duration);
  }
  if (!sawOverlap || !sawNumber) return null;
  return Math.round((mm / 25.4) * 100) / 100;
}

function weekdayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? isoDate;
}

export function parseHourlyForecast(body: unknown): HourlyPeriod[] | null {
  if (!body || typeof body !== "object") return null;
  const periods = (body as { properties?: { periods?: unknown } }).properties?.periods;
  if (!Array.isArray(periods)) return null;
  const parsed: HourlyPeriod[] = [];
  for (const raw of periods) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const startTime = typeof row.startTime === "string" ? row.startTime : "";
    const endTime = typeof row.endTime === "string" ? row.endTime : "";
    if (!startTime || !endTime) continue;
    const pop = row.probabilityOfPrecipitation;
    const probability =
      pop && typeof pop === "object" ? numberOrNull((pop as { value?: unknown }).value) : null;
    parsed.push({
      startTime,
      endTime,
      temperature: numberOrNull(row.temperature),
      shortForecast: typeof row.shortForecast === "string" ? row.shortForecast : "",
      probabilityOfPrecipitation: probability,
      windSpeed: textOrNull(row.windSpeed),
      windDirection: textOrNull(row.windDirection),
    });
  }
  return parsed.length ? parsed : null;
}

export function hourlyForecastUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const url = (body as { properties?: { forecastHourly?: unknown } }).properties?.forecastHourly;
  if (typeof url !== "string" || !url.startsWith("https://api.weather.gov/")) return null;
  return url;
}

const OUTLOOK_DAYS = 7;

function weatherServiceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("https://api.weather.gov/")) return null;
  return value;
}

export function dailyForecastUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return weatherServiceUrl((body as { properties?: { forecast?: unknown } }).properties?.forecast);
}

export function forecastGridUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return weatherServiceUrl((body as { properties?: { forecastGridData?: unknown } }).properties?.forecastGridData);
}

export function forecastTimeZone(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const timeZone = (body as { properties?: { timeZone?: unknown } }).properties?.timeZone;
  if (typeof timeZone !== "string" || !timeZone.trim()) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

type ForecastPeriod = {
  startTime: string;
  isDaytime: boolean;
  temperature: number | null;
  shortForecast: string;
  probabilityOfPrecipitation: number | null;
};

function temperatureOf(periods: ForecastPeriod[], pick: "max" | "min"): number | null {
  let value: number | null = null;
  for (const period of periods) {
    if (typeof period.temperature !== "number") continue;
    value =
      value == null
        ? period.temperature
        : pick === "max"
          ? Math.max(value, period.temperature)
          : Math.min(value, period.temperature);
  }
  return value;
}

/** Up to seven local days from the NWS forecast. Fewer days are returned as they arrive. */
export function parseDailyForecast(body: unknown): DailyWeather[] | null {
  if (!body || typeof body !== "object") return null;
  const periods = (body as { properties?: { periods?: unknown } }).properties?.periods;
  if (!Array.isArray(periods)) return null;

  const parsed: ForecastPeriod[] = [];
  for (const raw of periods) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const startTime = typeof row.startTime === "string" ? row.startTime : "";
    if (!localDate(startTime)) continue;
    const pop = row.probabilityOfPrecipitation;
    parsed.push({
      startTime,
      isDaytime: row.isDaytime === true,
      temperature: numberOrNull(row.temperature),
      shortForecast: typeof row.shortForecast === "string" ? row.shortForecast.trim() : "",
      probabilityOfPrecipitation:
        pop && typeof pop === "object" ? numberOrNull((pop as { value?: unknown }).value) : null,
    });
  }
  if (!parsed.length) return null;

  const byDate = new Map<string, ForecastPeriod[]>();
  for (const period of parsed) {
    const date = localDate(period.startTime);
    if (!date) continue;
    const list = byDate.get(date) ?? [];
    list.push(period);
    byDate.set(date, list);
  }

  const daily: DailyWeather[] = [];
  for (const [date, hours] of byDate) {
    if (daily.length >= OUTLOOK_DAYS) break;
    const daytime = hours.filter((period) => period.isDaytime);
    const nighttime = hours.filter((period) => !period.isDaytime);
    const short =
      daytime.find((period) => period.shortForecast)?.shortForecast ??
      hours.find((period) => period.shortForecast)?.shortForecast ??
      "";
    let precip: number | null = null;
    for (const period of hours) {
      if (typeof period.probabilityOfPrecipitation !== "number") continue;
      precip =
        precip == null
          ? period.probabilityOfPrecipitation
          : Math.max(precip, period.probabilityOfPrecipitation);
    }
    const daytimePassed = daily.length === 0 && daytime.length === 0 && nighttime.length > 0;
    daily.push({
      label: weekdayLabel(date),
      date,
      precip_prob: precip,
      short_forecast: short,
      hi: daytimePassed ? null : temperatureOf(daytime, "max"),
      lo: temperatureOf(nighttime, "min"),
      today_partial: daytimePassed,
      hours: null,
      qpf_in: null,
    });
  }
  return daily.length ? daily : null;
}

export function parseAlertText(body: unknown): { ok: true; text: string | null } | { ok: false } {
  if (!body || typeof body !== "object" || !Array.isArray((body as { features?: unknown }).features)) {
    return { ok: false };
  }
  const lines: string[] = [];
  for (const feature of (body as { features: unknown[] }).features) {
    if (!feature || typeof feature !== "object") continue;
    const properties = (feature as { properties?: unknown }).properties;
    if (!properties || typeof properties !== "object") continue;
    const headlineValue = (properties as { headline?: unknown }).headline;
    const eventValue = (properties as { event?: unknown }).event;
    const headline = typeof headlineValue === "string" ? headlineValue.trim() : "";
    const event = typeof eventValue === "string" ? eventValue.trim() : "";
    const line = headline || event;
    if (line) lines.push(line);
  }
  if (!lines.length) return { ok: true, text: null };
  const text = lines.join("\n");
  return { ok: true, text: text.length > 4000 ? `${text.slice(0, 3999)}…` : text };
}

export function upcomingPeriods(periods: HourlyPeriod[], now: Date): HourlyPeriod[] {
  const nowMs = now.getTime();
  return periods
    .filter((period) => {
      const end = Date.parse(period.endTime);
      return Number.isFinite(end) && end > nowMs;
    })
    .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
}

export function buildWeatherSnapshot(
  periods: HourlyPeriod[],
  daily: DailyWeather[],
  alertText: string | null,
  now: Date,
  extras?: { timeZone?: string | null; precipitation?: PrecipSample[] | null },
): WeatherSnapshot | null {
  const timeZone = extras?.timeZone ?? null;
  const precipitation = extras?.precipitation ?? null;
  const outlook = daily.slice(0, OUTLOOK_DAYS).map((day) => ({
    ...day,
    hours: day.date ? stripHoursForDate(periods, day.date) : null,
    qpf_in: day.date ? qpfInchesForWindow(precipitation, day.date, timeZone) : null,
  }));
  const upcoming = upcomingPeriods(periods, now);
  if (!upcoming.length || !outlook.length) return null;

  const current = upcoming.find((period) => Date.parse(period.startTime) <= now.getTime()) ?? null;
  const rainingNow = current
    ? isDefinitePrecip(current.shortForecast) ||
      (typeof current.probabilityOfPrecipitation === "number" &&
        current.probabilityOfPrecipitation >= RAINING_NOW_PROBABILITY &&
        PRECIP_WORDS.test(current.shortForecast))
    : false;

  const hours = Array.from({ length: 8 }, (_, index) => upcoming[index] ?? null);
  const currentHour = hours[0];
  const condition = currentHour?.shortForecast.trim() ?? "";

  return {
    raining_now: rainingNow,
    precip_prob_next_hours: hours.map((period) => period?.probabilityOfPrecipitation ?? null),
    next_rain_at: upcoming.find((period) => expectsRain(period))?.startTime ?? null,
    temp_now: currentHour?.temperature == null ? null : Math.round(currentHour.temperature),
    wind_mph: parseWindMph(currentHour?.windSpeed ?? null),
    wind_dir: currentHour?.windDirection?.trim() || null,
    condition_now: condition || null,
    hourly_times: hours.map((period) => period?.startTime ?? null),
    daily: outlook,
    alert_text: alertText,
    source: "nws",
  };
}
