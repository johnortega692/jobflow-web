import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWeatherSnapshot,
  coordinateBucket,
  dailyForecastUrl,
  hourlyForecastUrl,
  parseAlertText,
  parseDailyForecast,
  parseHourlyForecast,
  type DailyWeather,
  type HourlyPeriod,
} from "./forecast.ts";

function period(
  start: string,
  temp: number,
  probability: number | null,
  text: string,
  windSpeed: string | null = null,
  windDirection: string | null = null,
): HourlyPeriod {
  const hour = Number(start.slice(11, 13));
  const endHour = (hour + 1) % 24;
  const endDate = endHour === 0 ? nextDate(start.slice(0, 10)) : start.slice(0, 10);
  return {
    startTime: start,
    endTime: `${endDate}T${String(endHour).padStart(2, "0")}:00:00-08:00`,
    temperature: temp,
    shortForecast: text,
    probabilityOfPrecipitation: probability,
    windSpeed,
    windDirection,
  };
}

function nextDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("nearby coordinates share one two-decimal bucket", () => {
  const west = coordinateBucket(34.0522, -118.2437);
  const east = coordinateBucket(34.049, -118.241);
  assert.equal(west.key, "34.05,-118.24");
  assert.equal(east.key, west.key);
  assert.equal(coordinateBucket(34.056, -118.236).key, "34.06,-118.24");
});

test("hourly forecast keeps precipitation probability and drops blank periods", () => {
  const periods = parseHourlyForecast({
    properties: {
      periods: [
        {
          startTime: "2026-11-24T20:00:00-08:00",
          endTime: "2026-11-24T21:00:00-08:00",
          temperature: 58,
          shortForecast: "Light Rain",
          probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 80 },
        },
        { startTime: "", endTime: "2026-11-24T22:00:00-08:00" },
      ],
    },
  });
  assert.equal(periods?.length, 1);
  assert.equal(periods?.[0]?.probabilityOfPrecipitation, 80);
  assert.equal(periods?.[0]?.temperature, 58);
  assert.equal(parseHourlyForecast({ properties: { periods: [] } }), null);
  assert.equal(parseHourlyForecast(null), null);
});

test("hourly forecast url stays on the weather service", () => {
  assert.equal(
    hourlyForecastUrl({
      properties: { forecastHourly: "https://api.weather.gov/gridpoints/LOX/154,44/forecast/hourly" },
    }),
    "https://api.weather.gov/gridpoints/LOX/154,44/forecast/hourly",
  );
  assert.equal(hourlyForecastUrl({ properties: { forecastHourly: "https://example.com/hourly" } }), null);
  assert.equal(hourlyForecastUrl({}), null);
});

test("alert headlines are joined and an empty list is a successful null", () => {
  const parsed = parseAlertText({
    features: [
      { properties: { headline: "Flood Watch issued November 24", event: "Flood Watch" } },
      { properties: { event: "Wind Advisory" } },
    ],
  });
  assert.deepEqual(parsed, {
    ok: true,
    text: "Flood Watch issued November 24\nWind Advisory",
  });
  assert.deepEqual(parseAlertText({ features: [] }), { ok: true, text: null });
  assert.deepEqual(parseAlertText({}), { ok: false });
});

function forecastPeriod(
  start: string,
  isDaytime: boolean,
  temp: number,
  probability: number | null,
  text: string,
) {
  return {
    startTime: start,
    endTime: start,
    isDaytime,
    temperature: temp,
    shortForecast: text,
    probabilityOfPrecipitation: { value: probability },
  };
}

const week: DailyWeather[] = [
  { label: "Tue", precip_prob: 80, short_forecast: "Light Rain", hi: 58, lo: 54, today_partial: false },
  { label: "Wed", precip_prob: 15, short_forecast: "Partly Sunny", hi: 64, lo: 53, today_partial: false },
  { label: "Thu", precip_prob: 70, short_forecast: "Rain Likely", hi: 66, lo: 52, today_partial: false },
  { label: "Fri", precip_prob: 10, short_forecast: "Sunny", hi: 68, lo: 50, today_partial: false },
  { label: "Sat", precip_prob: 5, short_forecast: "Sunny", hi: 70, lo: 49, today_partial: false },
  { label: "Sun", precip_prob: 0, short_forecast: "Clear", hi: 69, lo: 48, today_partial: false },
  { label: "Mon", precip_prob: 20, short_forecast: "Mostly Cloudy", hi: 67, lo: 51, today_partial: false },
];

test("the seven-day forecast keeps daytime wording, highs, and nighttime lows", () => {
  const periods = [];
  const dates = ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"];
  for (const date of dates) {
    periods.push(forecastPeriod(`${date}T06:00:00-08:00`, false, 50, 10, "Cloudy"));
    periods.push(forecastPeriod(`${date}T12:00:00-08:00`, true, 68, 60, "Showers"));
  }
  const daily = parseDailyForecast({ properties: { periods } });
  assert.equal(daily?.length, 7);
  assert.equal(daily?.[0]?.label, "Tue");
  assert.equal(daily?.[0]?.short_forecast, "Showers");
  assert.equal(daily?.[0]?.precip_prob, 60);
  assert.equal(daily?.[0]?.hi, 68);
  assert.equal(daily?.[0]?.lo, 50);
  assert.equal(daily?.[0]?.today_partial, false);
  assert.equal(daily?.[6]?.label, "Mon");
  assert.equal(parseDailyForecast({ properties: { periods: periods.slice(0, 4) } })?.length, 2);
  assert.equal(parseDailyForecast({ properties: { periods: [] } }), null);
});

test("a passed daytime period leaves today's high empty and marks the day partial", () => {
  const daily = parseDailyForecast({
    properties: {
      periods: [
        forecastPeriod("2026-11-24T18:00:00-08:00", false, 52, 40, "Light Rain"),
        forecastPeriod("2026-11-25T06:00:00-08:00", false, 48, 10, "Cloudy"),
        forecastPeriod("2026-11-25T12:00:00-08:00", true, 64, 10, "Partly Sunny"),
      ],
    },
  });
  assert.equal(daily?.[0]?.hi, null);
  assert.equal(daily?.[0]?.lo, 52);
  assert.equal(daily?.[0]?.today_partial, true);
  assert.equal(daily?.[1]?.hi, 64);
  assert.equal(daily?.[1]?.lo, 48);
  assert.equal(daily?.[1]?.today_partial, false);
});

test("daily forecast url stays on the weather service", () => {
  assert.equal(
    dailyForecastUrl({
      properties: { forecast: "https://api.weather.gov/gridpoints/LOX/154,44/forecast" },
    }),
    "https://api.weather.gov/gridpoints/LOX/154,44/forecast",
  );
  assert.equal(dailyForecastUrl({ properties: { forecast: "https://example.com/forecast" } }), null);
});

test("snapshot uses the current hour, the next eight probabilities, and the daily outlook", () => {
  const now = new Date("2026-11-24T20:30:00-08:00");
  const periods = [
    period("2026-11-24T19:00:00-08:00", 60, 90, "Heavy Rain"),
    period("2026-11-24T20:00:00-08:00", 58, 80, "Light Rain"),
    period("2026-11-24T21:00:00-08:00", 57, 20, "Slight Chance Rain Showers"),
    period("2026-11-24T22:00:00-08:00", 55, 40, "Chance Rain Showers"),
    period("2026-11-24T23:00:00-08:00", 54, 10, "Cloudy"),
    period("2026-11-25T00:00:00-08:00", 53, 5, "Cloudy"),
    period("2026-11-25T12:00:00-08:00", 64, 15, "Partly Sunny"),
    period("2026-11-25T18:00:00-08:00", 60, 0, "Sunny"),
    period("2026-11-26T08:00:00-08:00", 52, 30, "Mostly Cloudy"),
    period("2026-11-26T15:00:00-08:00", 66, 70, "Rain Likely"),
  ];

  const snapshot = buildWeatherSnapshot(periods, week, "Wind Advisory", now);
  assert.ok(snapshot);
  assert.equal(snapshot.raining_now, true);
  assert.equal(snapshot.source, "nws");
  assert.equal(snapshot.alert_text, "Wind Advisory");
  assert.deepEqual(snapshot.precip_prob_next_hours, [80, 20, 40, 10, 5, 15, 0, 30]);
  assert.equal(snapshot.temp_now, 58);
  assert.equal(snapshot.wind_mph, null);
  assert.equal(snapshot.condition_now, "Light Rain");
  assert.equal(snapshot.hourly_times[0], "2026-11-24T20:00:00-08:00");
  assert.equal(snapshot.hourly_times[7], "2026-11-26T08:00:00-08:00");
  assert.equal(snapshot.next_rain_at, "2026-11-24T20:00:00-08:00");
  assert.equal(snapshot.daily.length, 7);
  assert.equal(snapshot.daily[0]?.short_forecast, "Light Rain");
});

test("a chance of rain is not raining now, and missing hours stay null", () => {
  const now = new Date("2026-11-24T20:10:00-08:00");
  const periods = [
    period("2026-11-24T20:00:00-08:00", 58, 30, "Chance Rain Showers"),
    period("2026-11-24T21:00:00-08:00", 57, 10, "Cloudy"),
    period("2026-11-25T06:00:00-08:00", 50, 0, "Clear"),
    period("2026-11-25T12:00:00-08:00", 62, 0, "Sunny"),
    period("2026-11-26T09:00:00-08:00", 61, 0, "Sunny"),
    period("2026-11-26T18:00:00-08:00", 55, 50, "Chance Showers"),
  ];
  const snapshot = buildWeatherSnapshot(periods, week.slice(0, 2), null, now);
  assert.ok(snapshot);
  assert.equal(snapshot.raining_now, false);
  assert.equal(snapshot.next_rain_at, "2026-11-26T18:00:00-08:00");
  assert.deepEqual(snapshot.precip_prob_next_hours, [30, 10, 0, 0, 0, 50, null, null]);
  assert.equal(snapshot.hourly_times[5], "2026-11-26T18:00:00-08:00");
  assert.equal(snapshot.hourly_times[6], null);
  assert.equal(snapshot.hourly_times[7], null);
});

test("current conditions come from the first upcoming hour", () => {
  const now = new Date("2026-11-24T20:30:00-08:00");
  const periods = [
    period("2026-11-24T19:00:00-08:00", 61, 90, "Heavy Rain", "3 mph", "S"),
    period("2026-11-24T20:00:00-08:00", 58.4, 80, "  Light Rain  ", "5 to 10 mph", " SW "),
    period("2026-11-24T21:00:00-08:00", 57, 20, "Cloudy", "8 mph", "W"),
  ];
  const snapshot = buildWeatherSnapshot(periods, week.slice(0, 1), null, now);
  assert.ok(snapshot);
  assert.equal(snapshot.temp_now, 58);
  assert.equal(snapshot.wind_mph, 5);
  assert.equal(snapshot.wind_dir, "SW");
  assert.equal(snapshot.condition_now, "Light Rain");
  assert.deepEqual(snapshot.hourly_times.slice(0, 2), [
    "2026-11-24T20:00:00-08:00",
    "2026-11-24T21:00:00-08:00",
  ]);
});

test("an empty daily outlook does not replace a stored snapshot", () => {
  const now = new Date("2026-11-24T20:30:00-08:00");
  const snapshot = buildWeatherSnapshot(
    [period("2026-11-24T20:00:00-08:00", 58, 80, "Light Rain"), period("2026-11-25T09:00:00-08:00", 60, 10, "Sunny")],
    [],
    null,
    now,
  );
  assert.equal(snapshot, null);
});
