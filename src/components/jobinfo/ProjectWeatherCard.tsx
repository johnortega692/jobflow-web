import { useEffect, useId, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  RAIN_WATCH_BANNER_COLORS,
  WEATHER_CHIP_COLORS,
  dailyOutlook,
  driestChartHour,
  forecastIconKind,
  heroWeatherPill,
  hourlyChartHours,
  outlookTint,
  peakChartHour,
  weatherUpdatedLabel,
  type ChartHour,
  type DayOutlook,
  type ProjectWeatherRow,
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

const CHART_WIDTH = 720;
const CHART_HEIGHT = 108;
const PLOT_LEFT = 12;
const PLOT_RIGHT = 46;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 74;
const LABEL_Y = 96;

function formatTemp(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}°`;
}

function formatPercent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function smoothLine(points: Array<[number, number]>): string {
  if (!points.length) return "";
  const fmt = (value: number) => value.toFixed(1);
  let path = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)] ?? next;
    if (!previous || !current || !next || !after) continue;
    const c1x = current[0] + (next[0] - previous[0]) / 6;
    const c1y = current[1] + (next[1] - previous[1]) / 6;
    const c2x = next[0] - (after[0] - current[0]) / 6;
    const c2y = next[1] - (after[1] - current[1]) / 6;
    path += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(next[0])} ${fmt(next[1])}`;
  }
  return path;
}

function chartGeometry(hours: ChartHour[]) {
  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const coords = hours.map((hour, index) => {
    const probability = hour.probability ?? 0;
    const x = PLOT_LEFT + (index / 7) * plotWidth;
    const y = PLOT_TOP + (1 - Math.max(0, Math.min(100, probability)) / 100) * plotHeight;
    return [x, y] as [number, number];
  });
  const line = smoothLine(coords);
  const area = `${line} L ${coords[7]?.[0] ?? PLOT_LEFT} ${PLOT_BOTTOM} L ${coords[0]?.[0] ?? PLOT_LEFT} ${PLOT_BOTTOM} Z`;
  const y50 = PLOT_TOP + plotHeight / 2;
  return { coords, line, area, y50 };
}

function chartLabel(hours: ChartHour[]): string {
  const peak = peakChartHour(hours);
  const points = hours
    .map((hour) => `${hour.axisLabel || "hour"} ${hour.probability == null ? "unknown" : `${Math.round(hour.probability)}%`}`)
    .join(", ");
  const peakText = peak
    ? ` Peak ${Math.round(peak.probability)}%${peak.clockLabel ? ` at ${peak.clockLabel}` : ""}.`
    : "";
  return `Rain chance for the next 8 hours. ${points}.${peakText}`;
}

function ForecastIcon({ forecast }: { forecast: string }) {
  const kind = forecastIconKind(forecast);
  const shared = {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    "aria-hidden": true as const,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "job-weather-day-icon",
  };
  if (kind === "sun") {
    return (
      <svg {...shared}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
      </svg>
    );
  }
  if (kind === "rain") {
    return (
      <svg {...shared}>
        <path d="M7 15.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.4-1.2A4.2 4.2 0 0 0 7 15.5z" />
        <path d="M8 18.2l-.8 1.8M12 18.2l-.8 1.8M16 18.2l-.8 1.8" />
      </svg>
    );
  }
  return (
    <svg {...shared}>
      <path d="M7 16.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.4-1.2A4.2 4.2 0 0 0 7 16.5z" />
    </svg>
  );
}

function RainChanceChart({ hours, gradientId }: { hours: ChartHour[]; gradientId: string }) {
  const { coords, line, area, y50 } = chartGeometry(hours);
  const peak = peakChartHour(hours);
  const peakPoint = peak ? coords[peak.index] : null;
  return (
    <svg
      className="job-weather-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={chartLabel(hours)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4f8cff" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#4f8cff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${gradientId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <line
        x1={PLOT_LEFT}
        x2={CHART_WIDTH - PLOT_RIGHT}
        y1={y50}
        y2={y50}
        stroke="#5a657c"
        strokeDasharray="4 4"
        strokeWidth="1"
      />
      <text x={CHART_WIDTH - 4} y={y50 + 4} textAnchor="end" fill="#9aa3b5" fontSize="11" fontWeight="700">
        50%
      </text>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="#7eb0ff" strokeWidth="2.5" strokeLinejoin="round" />
      {coords.map(([x, y], index) =>
        peak?.index === index ? null : (
          <circle key={index} cx={x} cy={y} r="2.6" fill="#d6e6ff" />
        ),
      )}
      {peak && peakPoint ? (
        <>
          <circle cx={peakPoint[0]} cy={peakPoint[1]} r="5.5" fill="#4f8cff" filter={`url(#${gradientId}-glow)`} />
          <circle cx={peakPoint[0]} cy={peakPoint[1]} r="2.4" fill="#e8ecf4" />
          <text
            x={peakPoint[0]}
            y={Math.max(14, peakPoint[1] - 12)}
            textAnchor={peak.index === 0 ? "start" : peak.index === 7 ? "end" : "middle"}
            fill="#e8ecf4"
            fontSize="13"
            fontWeight="700"
          >
            {Math.round(peak.probability)}%
          </text>
        </>
      ) : null}
      {hours.map((hour, index) => (
        <text
          key={`${hour.axisLabel}-${index}`}
          x={coords[index]?.[0] ?? 0}
          y={LABEL_Y}
          textAnchor={index === 0 ? "start" : index === 7 ? "end" : "middle"}
          fill={index === 0 ? "#e8ecf4" : "#9aa3b5"}
          fontSize="12"
          fontWeight={index === 0 ? 700 : 600}
        >
          {hour.axisLabel}
        </text>
      ))}
    </svg>
  );
}

function DayCard({ day, isToday }: { day: DayOutlook; isToday: boolean }) {
  const tint = outlookTint(day.precipProb);
  const colors =
    tint === "wet" ? WEATHER_CHIP_COLORS.raining : tint === "watch" ? WEATHER_CHIP_COLORS.soon : null;
  const percent = day.precipProb == null ? 0 : Math.max(0, Math.min(100, day.precipProb));
  return (
    <article
      className={`job-weather-day${tint === "plain" ? "" : ` job-weather-day--${tint}`}`}
      style={colors ? { background: colors.background, color: colors.color } : undefined}
    >
      <h3>{isToday ? "Today" : day.label}</h3>
      <ForecastIcon forecast={day.shortForecast} />
      <p className="job-weather-day-percent">{formatPercent(day.precipProb)}</p>
      <div className="job-weather-day-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="job-weather-day-condition">{day.shortForecast}</p>
      {isToday && day.todayPartial ? (
        day.lo == null ? null : <p className="job-weather-day-temps">Low {Math.round(day.lo)}°</p>
      ) : (
        <p className="job-weather-day-temps">
          <span>{formatTemp(day.hi)}</span>
          <span aria-hidden="true"> / </span>
          <span className="job-weather-day-lo">{formatTemp(day.lo)}</span>
        </p>
      )}
    </article>
  );
}

export function ProjectWeatherCard({ projectId }: Props) {
  const gradientId = `job-weather-fill-${useId().replace(/:/g, "")}`;
  const [row, setRow] = useState<WeatherRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

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
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const hours = hourlyChartHours(row?.precip_prob_next_hours, row?.hourly_times);
  const days = dailyOutlook(row?.daily);
  const pill = row ? heroWeatherPill(row.raining_now, hours) : null;
  const pillColors = pill ? WEATHER_CHIP_COLORS[pill.kind] : null;
  const driest = driestChartHour(hours);
  const alert = row?.alert_text?.trim() ?? "";
  const condition = row?.condition_now?.trim() ?? "";
  const windDir = row?.wind_dir?.trim() ?? "";

  return (
    <section className="job-weather-card" aria-labelledby="job-weather-heading">
      <header className="job-weather-card-header">
        <div className="job-weather-title-row">
          <h2 id="job-weather-heading">Weather</h2>
          <span className="job-weather-badge">Exterior</span>
        </div>
        {row ? <p className="job-weather-updated">{weatherUpdatedLabel(row.fetched_at, nowMs)}</p> : null}
      </header>

      {!loaded ? (
        <p className="job-weather-empty">Loading weather…</p>
      ) : !row || !pill || !pillColors ? (
        <p className="job-weather-empty">Weather loads within 15 minutes</p>
      ) : (
        <>
          {alert ? (
            <div
              className="job-weather-banner"
              style={{ background: RAIN_WATCH_BANNER_COLORS.background, color: RAIN_WATCH_BANNER_COLORS.color }}
            >
              <p className="job-weather-banner-alert">{alert}</p>
            </div>
          ) : null}

          <div className="job-weather-hero">
            <div>
              {row.temp_now == null ? null : <p className="job-weather-temp">{Math.round(row.temp_now)}°</p>}
              {condition ? <p className="job-weather-condition">{condition}</p> : null}
              <p className="job-weather-pill" style={{ background: pillColors.background, color: pillColors.color }}>
                {pill.label}
              </p>
            </div>
            <div className="job-weather-stats">
              {driest ? (
                <div className="job-weather-stat">
                  <span className="job-weather-stat-label">Driest hour</span>
                  <span className="job-weather-stat-value">{Math.round(driest.probability)}%</span>
                  {driest.clockLabel ? <span className="job-weather-stat-meta">{driest.clockLabel}</span> : null}
                </div>
              ) : null}
              {row.wind_mph == null ? null : (
                <div className="job-weather-stat">
                  <span className="job-weather-stat-label">Wind</span>
                  <span className="job-weather-stat-value">
                    {Math.round(row.wind_mph)} mph{windDir ? ` ${windDir}` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>

          <RainChanceChart hours={hours} gradientId={gradientId} />

          <div className="job-weather-outlook">
            <h3 className="job-weather-outlook-title">7-day outlook</h3>
            <div className="job-weather-days">
              {days.map((day, index) => (
                <DayCard key={`${day.label}-${index}`} day={day} isToday={index === 0} />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
