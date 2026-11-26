import assert from "node:assert/strict";
import test from "node:test";
import {
  RAIN_WATCH_BANNER_COLORS,
  WEATHER_CHIP_COLORS,
  dailyOutlook,
  dashboardWeatherStatus,
  driestChartHour,
  forecastIconKind,
  heroWeatherPill,
  hourlyChartHours,
  outlookTint,
  peakChartHour,
  weatherClockLabel,
  hourlyRainChances,
  isRainRiskChip,
  isRainWatchChip,
  projectListWeatherLabel,
  projectWeatherChip,
  weatherUpdatedLabel,
  type ProjectWeatherRow,
} from "./projectWeatherDisplay.ts";

const NOW = Date.parse("2026-11-24T20:00:00.000Z");

function row(patch: Partial<ProjectWeatherRow> = {}): ProjectWeatherRow {
  return {
    fetched_at: new Date(NOW - 10 * 60 * 1000).toISOString(),
    raining_now: false,
    precip_prob_next_hours: [10, 20, 55, 15, 5, 0, 0, 0],
    next_rain_at: null,
    daily: [
      { precip_prob: 30 },
      { precip_prob: 70 },
      { precip_prob: 10 },
    ],
    ...patch,
  };
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("interior jobs stay muted even when a weather row exists", () => {
  const chip = projectWeatherChip({ is_exterior: false }, row({ raining_now: true }), NOW);
  assert.equal(chip.kind, "interior");
  assert.equal(chip.label, "Interior, no weather");
  assert.equal(isRainWatchChip(chip), false);
  assert.equal(isRainRiskChip(chip), false);
});

test("exterior jobs without a forecast are not labeled interior", () => {
  const chip = projectWeatherChip({ is_exterior: true }, null, NOW);
  assert.equal(chip.label, "No forecast");
  assert.equal(chip.tone, "muted");
});

test("a forecast older than 45 minutes replaces the weather chip", () => {
  const chip = projectWeatherChip(
    { is_exterior: true },
    row({
      fetched_at: new Date(NOW - 46 * 60 * 1000).toISOString(),
      raining_now: true,
    }),
    NOW,
  );
  assert.equal(chip.kind, "stale");
  assert.equal(chip.label, "Weather stale");
  assert.equal(isRainWatchChip(chip), false);
  assert.equal(isRainRiskChip(chip), false);
});

test("a fresh fetch at 45 minutes still shows the forecast", () => {
  const chip = projectWeatherChip(
    { is_exterior: true },
    row({
      fetched_at: new Date(NOW - 45 * 60 * 1000).toISOString(),
      raining_now: true,
    }),
    NOW,
  );
  assert.equal(chip.kind, "raining");
  assert.equal(chip.label, "Raining now");
});

test("rain inside 3 hours is amber and uses the hourly percent", () => {
  const next = new Date(NOW + 2.2 * 60 * 60 * 1000).toISOString();
  const chip = projectWeatherChip(
    { is_exterior: true },
    row({ next_rain_at: next, precip_prob_next_hours: [10, 20, 55, 15, 5, 0, 0, 0] }),
    NOW,
  );
  assert.equal(chip.kind, "soon");
  assert.equal(chip.tone, "soon");
  assert.equal(chip.label, "Rain in ~2 hrs · 55%");
  assert.equal(projectListWeatherLabel(chip), "Rain ~2h · 55%");
  assert.equal(isRainWatchChip(chip), true);
  assert.equal(isRainRiskChip(chip), true);
});

test("one hour uses the singular label and omits a missing percent", () => {
  const next = new Date(NOW + 0.6 * 60 * 60 * 1000).toISOString();
  const chip = projectWeatherChip(
    { is_exterior: true },
    row({ next_rain_at: next, precip_prob_next_hours: [null, null, null, null, null, null, null, null] }),
    NOW,
  );
  assert.equal(chip.label, "Rain in ~1 hr");
});

test("rain already due inside the current hour shows about 1 hour", () => {
  const next = new Date(NOW - 20 * 60 * 1000).toISOString();
  const chip = projectWeatherChip(
    { is_exterior: true },
    row({ next_rain_at: next, precip_prob_next_hours: [62, 10, 10, 10, 10, 10, 10, 10] }),
    NOW,
  );
  assert.equal(chip.kind, "soon");
  assert.equal(chip.label, "Rain in ~1 hr · 62%");
});

test("same-day rain after 3 hours stays gray and out of the rain watch", () => {
  const next = new Date(NOW + 10 * 60 * 60 * 1000).toISOString();
  const chip = projectWeatherChip(
    { is_exterior: true },
    row({ next_rain_at: next, daily: [{ precip_prob: 44 }, { precip_prob: 10 }, { precip_prob: 5 }] }),
    NOW,
  );
  assert.equal(chip.kind, "later");
  assert.equal(chip.tone, "tomorrow");
  assert.equal(chip.label, "Rain in ~10 hrs · 44%");
  assert.equal(isRainWatchChip(chip), false);
  assert.equal(isRainRiskChip(chip), true);
});

test("rain in 24 to 48 hours is tomorrow and uses the next daily percent", () => {
  const next = new Date(NOW + 30 * 60 * 60 * 1000).toISOString();
  const chip = projectWeatherChip({ is_exterior: true }, row({ next_rain_at: next }), NOW);
  assert.equal(chip.kind, "tomorrow");
  assert.equal(chip.label, "Rain tomorrow · 70%");
  assert.equal(isRainRiskChip(chip), true);
  assert.equal(isRainWatchChip(chip), false);
});

test("seven dry days read as dry for 7 days", () => {
  const daily = Array.from({ length: 7 }, () => ({ precip_prob: 10, short_forecast: "Sunny" }));
  const chip = projectWeatherChip({ is_exterior: true }, row({ daily }), NOW);
  assert.equal(chip.kind, "dry");
  assert.equal(chip.label, "Dry for 7 days");
  assert.equal(chip.tone, "dry");
});

test("a wet day in the outlook shortens the dry count", () => {
  const daily = [
    { precip_prob: 10 },
    { precip_prob: 20 },
    { precip_prob: 15 },
    { precip_prob: 5 },
    { precip_prob: 55 },
    { precip_prob: 10 },
    { precip_prob: 0 },
  ];
  const chip = projectWeatherChip({ is_exterior: true }, row({ daily }), NOW);
  assert.equal(chip.label, "Dry for 4 days");
  assert.equal(projectListWeatherLabel(chip), "Dry 4d");
});

test("rain beyond 48 hours counts dry days from the forecast window", () => {
  const dryWeek = Array.from({ length: 7 }, () => ({ precip_prob: 5 }));
  const twoDays = projectWeatherChip(
    { is_exterior: true },
    row({ next_rain_at: new Date(NOW + 50 * 60 * 60 * 1000).toISOString(), daily: dryWeek }),
    NOW,
  );
  assert.equal(twoDays.label, "Dry for 2 days");
  const oneDay = projectWeatherChip(
    { is_exterior: true },
    row({ next_rain_at: new Date(NOW + 49 * 60 * 60 * 1000).toISOString(), daily: dryWeek }),
    NOW,
  );
  assert.equal(oneDay.label, "Dry for 2 days");
  const threeDays = projectWeatherChip(
    { is_exterior: true },
    row({ next_rain_at: new Date(NOW + 80 * 60 * 60 * 1000).toISOString(), daily: dryWeek }),
    NOW,
  );
  assert.equal(threeDays.label, "Dry for 3 days");
  const week = projectWeatherChip(
    { is_exterior: true },
    row({
      next_rain_at: new Date(NOW + 200 * 60 * 60 * 1000).toISOString(),
      daily: Array.from({ length: 7 }, () => ({ precip_prob: 5 })),
    }),
    NOW,
  );
  assert.equal(week.label, "Dry for 7 days");
});

test("dashboard banner is raining, rain soon, or dry", () => {
  assert.deepEqual(dashboardWeatherStatus(row({ raining_now: true }), NOW), {
    kind: "raining",
    label: "Raining now",
  });
  const soon = dashboardWeatherStatus(
    row({ next_rain_at: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() }),
    NOW,
  );
  assert.equal(soon.label, "Rain soon");
  const later = dashboardWeatherStatus(
    row({ next_rain_at: new Date(NOW + 30 * 60 * 60 * 1000).toISOString() }),
    NOW,
  );
  assert.equal(later.label, "Dry");
});

test("dashboard header and hourly labels follow the forecast row", () => {
  assert.equal(
    weatherUpdatedLabel(new Date(NOW - 12 * 60 * 1000).toISOString(), NOW),
    "Updated 12 min ago · National Weather Service",
  );
  const hours = hourlyRainChances([80, 20, null]);
  assert.equal(hours.length, 8);
  assert.equal(hours[0]?.label, "Now");
  assert.equal(hours[1]?.label, "+1h");
  assert.equal(hours[7]?.label, "+7h");
  assert.equal(hours[2]?.probability, null);
  const days = dailyOutlook([
    { label: "Tue", precip_prob: 40, short_forecast: "Showers", hi: 68, lo: 51 },
    { label: "Wed", precip_prob: 10, short_forecast: "Sunny", hi: 70, lo: 49 },
  ]);
  assert.equal(days.length, 2);
  assert.equal(days[0]?.label, "Tue");
  assert.equal(days[0]?.shortForecast, "Showers");
  assert.equal(days[0]?.hi, 68);
  assert.equal(outlookTint(60), "wet");
  assert.equal(outlookTint(40), "watch");
  assert.equal(outlookTint(39), "plain");
});

test("the dashboard hero uses the peak hour, the driest hour, and today's partial low", () => {
  assert.equal(weatherClockLabel("2026-11-24T21:00:00-08:00"), "9 PM");
  assert.equal(weatherClockLabel("2026-11-25T00:30:00-08:00"), "12:30 AM");
  const times = [
    "2026-11-24T21:00:00-08:00",
    "2026-11-24T22:00:00-08:00",
    "2026-11-24T23:00:00-08:00",
    "2026-11-25T00:00:00-08:00",
    "2026-11-25T01:00:00-08:00",
    "2026-11-25T02:00:00-08:00",
    "2026-11-25T03:00:00-08:00",
    "2026-11-25T04:00:00-08:00",
  ];
  const hours = hourlyChartHours([80, 10, 55, 10, 5, 0, 20, 15], times);
  assert.equal(hours[0]?.axisLabel, "Now");
  assert.equal(hours[5]?.axisLabel, "2 AM");
  assert.equal(peakChartHour(hours)?.clockLabel, "9 PM");
  assert.equal(driestChartHour(hours)?.index, 5);
  assert.equal(heroWeatherPill(false, hours).label, "Rain soon · peaks 80% at 9 PM");
  assert.equal(heroWeatherPill(true, hours).label, "Raining now");
  assert.equal(heroWeatherPill(false, hourlyChartHours([10, 20, 15], times)).label, "Dry next 8 hours");
  const days = dailyOutlook([{ label: "Tue", precip_prob: 40, hi: null, lo: 47, today_partial: true }]);
  assert.equal(days[0]?.todayPartial, true);
  assert.equal(days[0]?.lo, 47);
  assert.equal(forecastIconKind("Chance Light Rain"), "rain");
  assert.equal(forecastIconKind("Partly Sunny"), "sun");
  assert.equal(forecastIconKind("Mostly Cloudy"), "cloud");
});

test("chip and banner colors clear 4.5:1", () => {
  for (const pair of Object.values(WEATHER_CHIP_COLORS)) {
    assert.ok(contrast(pair.color, pair.background) >= 4.5, `${pair.color} on ${pair.background}`);
  }
  assert.ok(
    contrast(RAIN_WATCH_BANNER_COLORS.color, RAIN_WATCH_BANNER_COLORS.background) >= 4.5,
  );
  assert.ok(
    contrast(RAIN_WATCH_BANNER_COLORS.actionColor, RAIN_WATCH_BANNER_COLORS.actionBackground) >= 4.5,
  );
});
