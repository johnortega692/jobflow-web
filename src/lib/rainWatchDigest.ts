import { isRainRelevant, type ExteriorWindowProject } from "./exteriorWorkWindow.js";

const HOUR_MS = 60 * 60 * 1000;
const STALE_MS = 45 * 60 * 1000;
const LOOKAHEAD_MS = 24 * HOUR_MS;
const SOON_MS = 3 * HOUR_MS;
const RAIN_PERCENT = 50;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type RainWatchDigestJob = ExteriorWindowProject & {
  id: string;
  jobNumber: string;
  jobName: string;
};

export type RainWatchDigestWeather = {
  project_id: string;
  fetched_at: string;
  raining_now: boolean;
  precip_prob_next_hours: unknown;
  next_rain_at: string | null;
  daily: unknown;
};

export type RainWatchDigestChipTone = "raining" | "soon" | "tomorrow";

export type RainWatchDigestRow = {
  projectId: string;
  jobNumber: string;
  jobName: string;
  workLabel: "Exterior work today" | "Exterior work tomorrow";
  chipLabel: string;
  chipTone: RainWatchDigestChipTone;
};

type RainHit = { at: number; probability: number };

function calendarKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function asProbs(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null));
}

function dailyProbability(daily: unknown, when: Date): number | null {
  if (!Array.isArray(daily)) return null;
  const label = WEEKDAYS[when.getDay()];
  for (const day of daily) {
    if (!day || typeof day !== "object") continue;
    const record = day as { label?: unknown; precip_prob?: unknown };
    if (record.label !== label) continue;
    return typeof record.precip_prob === "number" && Number.isFinite(record.precip_prob)
      ? record.precip_prob
      : null;
  }
  return null;
}

function isStale(fetchedAt: string, nowMs: number): boolean {
  const fetched = Date.parse(fetchedAt);
  return !Number.isFinite(fetched) || nowMs - fetched > STALE_MS;
}

function rainHits(weather: RainWatchDigestWeather, nowMs: number): RainHit[] {
  const fetched = Date.parse(weather.fetched_at);
  if (!Number.isFinite(fetched)) return [];
  const probs = asProbs(weather.precip_prob_next_hours);
  const hits: RainHit[] = [];
  for (let index = 0; index < probs.length && index < 8; index += 1) {
    const probability = probs[index];
    if (probability == null || probability < RAIN_PERCENT) continue;
    const at = fetched + index * HOUR_MS;
    if (at >= nowMs + LOOKAHEAD_MS) continue;
    if (at + HOUR_MS <= nowMs) continue;
    hits.push({ at, probability: Math.round(probability) });
  }

  const next = weather.next_rain_at ? Date.parse(weather.next_rain_at) : Number.NaN;
  if (Number.isFinite(next) && next > nowMs && next <= nowMs + LOOKAHEAD_MS) {
    const index = Math.round((next - fetched) / HOUR_MS);
    const hourly = index >= 0 && index < probs.length ? probs[index] : null;
    const probability = hourly ?? dailyProbability(weather.daily, new Date(next));
    if (probability != null && probability >= RAIN_PERCENT) {
      hits.push({ at: next, probability: Math.round(probability) });
    }
  }

  hits.sort((left, right) => left.at - right.at || right.probability - left.probability);
  return hits;
}

function chipFor(weather: RainWatchDigestWeather, hit: RainHit | null, nowMs: number): {
  chipLabel: string;
  chipTone: RainWatchDigestChipTone;
} | null {
  if (weather.raining_now) return { chipLabel: "Raining now", chipTone: "raining" };
  if (!hit) return null;
  const when = new Date(hit.at);
  const today = calendarKey(new Date(nowMs));
  const chipLabel =
    calendarKey(when) === today
      ? `Rain today · ${hit.probability}%`
      : `Rain tomorrow · ${hit.probability}%`;
  const chipTone: RainWatchDigestChipTone = hit.at - nowMs <= SOON_MS ? "soon" : "tomorrow";
  return { chipLabel, chipTone };
}

export function rainWatchSubjectClause(count: number): string | null {
  if (count <= 0) return null;
  return `Rain on ${count} scheduled ${count === 1 ? "job" : "jobs"}`;
}

/** Exterior jobs with rain now or a 50%+ chance in the next 24 hours, during today's or tomorrow's work window. */
export function buildRainWatchSection(
  jobs: RainWatchDigestJob[],
  weatherRows: RainWatchDigestWeather[],
  now: Date,
): RainWatchDigestRow[] {
  const nowMs = now.getTime();
  const today = now;
  const tomorrow = addDays(now, 1);
  const weatherByProject = new Map(weatherRows.map((row) => [row.project_id, row]));
  const rows: RainWatchDigestRow[] = [];

  for (const job of jobs) {
    const relevantToday = isRainRelevant(job, today);
    const relevantTomorrow = isRainRelevant(job, tomorrow);
    if (!relevantToday && !relevantTomorrow) continue;
    const weather = weatherByProject.get(job.id);
    if (!weather || isStale(weather.fetched_at, nowMs)) continue;
    const hit = rainHits(weather, nowMs)[0] ?? null;
    if (!weather.raining_now && !hit) continue;
    const chip = chipFor(weather, hit, nowMs);
    if (!chip) continue;
    rows.push({
      projectId: job.id,
      jobNumber: job.jobNumber,
      jobName: job.jobName,
      workLabel: relevantToday ? "Exterior work today" : "Exterior work tomorrow",
      chipLabel: chip.chipLabel,
      chipTone: chip.chipTone,
    });
  }

  rows.sort(
    (left, right) =>
      left.jobNumber.localeCompare(right.jobNumber, undefined, { numeric: true }) ||
      left.jobName.localeCompare(right.jobName),
  );
  return rows;
}
