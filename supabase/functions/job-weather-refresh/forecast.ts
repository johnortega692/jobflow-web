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

export type DailyWeather = {
  label: string;
  precip_prob: number | null;
  short_forecast: string;
  hi: number | null;
  lo: number | null;
  today_partial: boolean;
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
      precip_prob: precip,
      short_forecast: short,
      hi: daytimePassed ? null : temperatureOf(daytime, "max"),
      lo: temperatureOf(nighttime, "min"),
      today_partial: daytimePassed,
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
): WeatherSnapshot | null {
  const outlook = daily.slice(0, OUTLOOK_DAYS);
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
