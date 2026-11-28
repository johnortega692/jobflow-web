import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  TODAY_DONE_NOTE,
  WORK_WINDOW,
  dailyOutlook,
  defaultOutlookIndex,
  driestChartHour,
  hourLabel,
  hourTick,
  hourlyChartHours,
  isWorkWindowOver,
  todayWindow,
  type DayOutlook,
  type ProjectWeatherRow,
  type WorkVerdict,
} from "../../lib/projectWeatherDisplay";

type WeatherRecord = ProjectWeatherRow & {
  alert_text: string | null;
  temp_now: number | null;
  wind_mph: number | null;
  wind_dir: string | null;
  condition_now: string | null;
  hourly_times: unknown;
};

type Props = {
  projectId: string;
};

const VERDICT_LABEL = { go: "Go", partial: "Partial", nogo: "No-go" } as const;

function formatTemp(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}°`;
}

function formatPercent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function nwsUpdatedLabel(fetchedAt: string, nowMs: number): string {
  const fetched = Date.parse(fetchedAt);
  const minutes = Number.isFinite(fetched) ? Math.max(0, Math.round((nowMs - fetched) / 60000)) : 0;
  return `NWS · updated ${minutes} min ago`;
}

function windValue(mph: number | null, dir: string | null): string {
  if (mph == null && !dir) return "—";
  const speed = mph == null ? "—" : `${Math.round(mph)} mph`;
  return dir ? `${speed} ${dir}` : speed;
}

function dayName(day: DayOutlook, isToday: boolean): string {
  return isToday ? "Today" : day.label;
}

function chanceTone(probability: number | null): "empty" | "go" | "watch" | "rain" {
  if (probability == null) return "empty";
  if (probability >= WORK_WINDOW.rainLikely) return "rain";
  if (probability >= WORK_WINDOW.goMax) return "watch";
  return "go";
}

function barTone(hour: number, probability: number | null): "outside" | "empty" | "go" | "watch" | "rain" {
  const inside = hour >= WORK_WINDOW.windowStart && hour < WORK_WINDOW.windowEnd;
  if (!inside) return "outside";
  return chanceTone(probability);
}

function windowSlots(day: DayOutlook): { hour: number; precipProb: number | null }[] {
  return Array.from({ length: WORK_WINDOW.windowEnd - WORK_WINDOW.windowStart }, (_, index) => {
    const hour = WORK_WINDOW.windowStart + index;
    const found = day.hours?.find((item) => item.hour === hour);
    return { hour, precipProb: found ? found.precipProb : null };
  });
}

type RowCall = {
  done: boolean;
  windowMax: number | null;
  verdict: WorkVerdict | null;
};

function rowCall(day: DayOutlook, isToday: boolean, now: Date): RowCall {
  if (!isToday) return { done: false, windowMax: day.windowMax, verdict: day.verdict };
  const view = todayWindow(day, now);
  if (view.kind === "done") return { done: true, windowMax: null, verdict: null };
  return { done: false, windowMax: view.score.windowMax, verdict: view.score.verdict };
}

function initialExpanded(days: DayOutlook[], now: Date): number | null {
  if (!days.length) return null;
  const index = defaultOutlookIndex(days, now);
  const day = days[index];
  if (!day || (index === 0 && isWorkWindowOver(now))) return null;
  if (day.verdict === "partial" || day.verdict === "nogo") return index;
  return null;
}

function WarningIcon() {
  return (
    <svg className="job-weather-alert-icon" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8 14.6 13.4H1.4L8 1.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.2v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r="0.7" fill="currentColor" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="job-weather-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={open ? "M3.5 10.5 8 6l4.5 4.5" : "M3.5 5.5 8 10l4.5-4.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VerdictChip({ verdict }: { verdict: WorkVerdict }) {
  return <span className={`job-weather-verdict job-weather-verdict--${verdict}`}>{VERDICT_LABEL[verdict]}</span>;
}

function MiniStrip({ day, done }: { day: DayOutlook; done: boolean }) {
  if (done || !day.hours?.length) return <span className="job-weather-dash">—</span>;
  return (
    <span className="job-weather-mini" aria-hidden="true">
      {windowSlots(day).map((slot) => {
        const scale = slot.precipProb == null ? 0 : Math.max(0, Math.min(100, slot.precipProb));
        const height = Math.max(3, Math.round((scale / 100) * 18));
        return (
          <span
            key={slot.hour}
            className={`job-weather-mini-bar job-weather-mini-bar--${chanceTone(slot.precipProb)}`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </span>
  );
}

function DayDetail({ day, isToday }: { day: DayOutlook; isToday: boolean }) {
  const name = dayName(day, isToday);
  const stored = day.hours ?? [];
  const hours = stored.length
    ? Array.from({ length: 13 }, (_, index) => {
        const hour = index + 5;
        const found = stored.find((item) => item.hour === hour);
        return { hour, precipProb: found ? found.precipProb : null };
      })
    : [];
  const timing = day.firstRainHour == null ? "None above 40%" : `First 40%+ at ${hourLabel(day.firstRainHour)}`;
  const rain = day.qpfIn == null ? "n/a" : day.qpfIn.toFixed(2);
  return (
    <div className="job-weather-detail" id="job-weather-detail" role="region" aria-label={`${name} work window`}>
      <p className="job-weather-detail-note">{day.note}</p>
      {hours.length ? (
        <div
          className="job-weather-bars"
          role="img"
          aria-label={hours
            .map((hour) => `${hourLabel(hour.hour)} ${hour.precipProb == null ? "unknown" : `${Math.round(hour.precipProb)} percent`}`)
            .join(", ")}
        >
          <div className="job-weather-bars-band" aria-hidden="true" />
          {hours.map((hour) => {
            const tone = barTone(hour.hour, hour.precipProb);
            const height = hour.precipProb == null ? 0 : Math.max(0, Math.min(100, hour.precipProb));
            return (
              <div key={hour.hour} className={`job-weather-bar job-weather-bar--${tone}`}>
                <span className="job-weather-bar-pct">{hour.precipProb == null ? "—" : `${Math.round(hour.precipProb)}`}</span>
                <span className="job-weather-bar-track">
                  <span style={{ height: `${height}%` }} />
                </span>
                <span className="job-weather-bar-hour">{hourTick(hour.hour)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="job-weather-detail-facts">
        <div>
          <span className="job-weather-fact-label">Rain timing</span>
          <span className="job-weather-fact-value">{day.verdict ? timing : "Timing not available"}</span>
        </div>
        <div>
          <span className="job-weather-fact-label">Expected rain</span>
          <span className="job-weather-fact-value">{rain}</span>
        </div>
        <div>
          <span className="job-weather-fact-label">Decide by</span>
          <span className="job-weather-fact-value">{isToday ? "4:30 AM check" : "3 PM day before"}</span>
        </div>
      </div>
    </div>
  );
}

export function ProjectWeatherCard({ projectId }: Props) {
  const [row, setRow] = useState<WeatherRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setRow(null);
    void supabase
      .from("job_weather")
      .select(
        "fetched_at, raining_now, precip_prob_next_hours, next_rain_at, daily, alert_text, temp_now, wind_mph, wind_dir, condition_now, hourly_times",
      )
      .eq("project_id", projectId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setRow(null);
        else {
          setRow({
            fetched_at: data.fetched_at,
            raining_now: data.raining_now,
            precip_prob_next_hours: data.precip_prob_next_hours,
            next_rain_at: data.next_rain_at,
            daily: data.daily,
            alert_text: data.alert_text,
            temp_now: data.temp_now,
            wind_mph: data.wind_mph,
            wind_dir: data.wind_dir,
            condition_now: data.condition_now,
            hourly_times: data.hourly_times,
          });
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    setPickedDay(null);
  }, [projectId, row?.fetched_at]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const now = new Date(nowMs);
  const days = dailyOutlook(row?.daily);
  const fallback = initialExpanded(days, now);
  const expandedIndex = pickedDay == null ? fallback : pickedDay < 0 || pickedDay >= days.length ? null : pickedDay;
  const hours = hourlyChartHours(row?.precip_prob_next_hours, row?.hourly_times);
  const driest = driestChartHour(hours);
  const driestText = driest
    ? `${Math.round(driest.probability)}%${driest.clockLabel ? ` at ${driest.clockLabel}` : ""}`
    : "—";
  const alert = row?.alert_text?.trim() ?? "";
  const condition = row?.condition_now?.trim() ?? "";

  return (
    <section className="job-weather-card" aria-label="Weather">
      {!loaded ? (
        <p className="job-weather-empty">Loading weather…</p>
      ) : !row ? (
        <p className="job-weather-empty">Weather loads within 15 minutes</p>
      ) : (
        <>
          {alert ? (
            <div className="job-weather-alert">
              <WarningIcon />
              <p title={alert}>{alert}</p>
            </div>
          ) : null}

          <div className="job-weather-body">
            <div className="job-weather-now">
              <p className="job-weather-now-temp">{row.temp_now == null ? "—" : `${Math.round(row.temp_now)}°`}</p>
              <div className="job-weather-now-item">
                <p className="job-weather-now-kicker">Now</p>
                <p className="job-weather-now-value">{condition || "—"}</p>
              </div>
              <div className="job-weather-now-item">
                <p className="job-weather-now-kicker">Wind</p>
                <p className="job-weather-now-value">{windValue(row.wind_mph, row.wind_dir)}</p>
              </div>
              <div className="job-weather-now-item">
                <p className="job-weather-now-kicker">Driest hour</p>
                <p className="job-weather-now-value">{driestText}</p>
              </div>
            </div>

            <div className="job-weather-list">
              <div className="job-weather-list-head">
                <span>Day</span>
                <span className="job-weather-col-forecast">Forecast</span>
                <span className="job-weather-col-temps">Hi / Lo</span>
                <span>6a - 3p</span>
                <span className="job-weather-max">Max</span>
                <span>Call</span>
                <span />
              </div>
              {days.map((day, index) => {
                const isToday = index === 0;
                const open = index === expandedIndex;
                const call = rowCall(day, isToday, now);
                const detail =
                  isToday && isWorkWindowOver(now) ? { ...day, note: TODAY_DONE_NOTE } : day;
                return (
                  <div key={`${day.label}-${index}`} className={`job-weather-entry${open ? " job-weather-entry--open" : ""}`}>
                    <button
                      type="button"
                      className="job-weather-row"
                      aria-expanded={open}
                      onClick={() => setPickedDay(open ? -1 : index)}
                    >
                      <span className="job-weather-dayname">{dayName(day, isToday)}</span>
                      <span className="job-weather-forecast job-weather-col-forecast" title={day.shortForecast}>
                        {day.shortForecast || "—"}
                      </span>
                      <span className="job-weather-hilo job-weather-col-temps">
                        <span>{formatTemp(day.hi)}</span>
                        <span aria-hidden="true"> / </span>
                        <span className="job-weather-hilo-lo">{formatTemp(day.lo)}</span>
                      </span>
                      <MiniStrip day={day} done={call.done} />
                      <span className="job-weather-max">{call.done ? "–" : formatPercent(call.windowMax)}</span>
                      <span className="job-weather-call">
                        {call.done ? (
                          <span className="job-weather-verdict job-weather-verdict--done">Done</span>
                        ) : call.verdict ? (
                          <VerdictChip verdict={call.verdict} />
                        ) : null}
                      </span>
                      <Chevron open={open} />
                    </button>
                    {open ? <DayDetail day={detail} isToday={isToday} /> : null}
                  </div>
                );
              })}
            </div>

            <div className="job-weather-footer">
              <p className="job-weather-legend">
                <span>
                  <i className="job-weather-swatch job-weather-swatch--go" aria-hidden="true" />
                  Under {WORK_WINDOW.goMax}%
                </span>
                <span>
                  <i className="job-weather-swatch job-weather-swatch--watch" aria-hidden="true" />
                  {WORK_WINDOW.goMax}–{WORK_WINDOW.rainLikely - 1}%
                </span>
                <span>
                  <i className="job-weather-swatch job-weather-swatch--rain" aria-hidden="true" />
                  {WORK_WINDOW.rainLikely}%+
                </span>
              </p>
              <p className="job-weather-updated">{nwsUpdatedLabel(row.fetched_at, nowMs)}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
