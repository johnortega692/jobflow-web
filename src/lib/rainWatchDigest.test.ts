import assert from "node:assert/strict";
import test from "node:test";
import { buildRainWatchSection, rainWatchSubjectClause, type RainWatchDigestWeather } from "./rainWatchDigest.ts";

const NOW = new Date(2026, 10, 24, 7, 0, 0);

function job(patch: Partial<{ id: string; exterior_start: string | null; exterior_end: string | null; is_exterior: boolean }> = {}) {
  return {
    id: "p1",
    jobNumber: "210",
    jobName: "Harbor",
    is_exterior: true,
    exterior_start: null,
    exterior_end: null,
    ...patch,
  };
}

function weather(patch: Partial<RainWatchDigestWeather> = {}): RainWatchDigestWeather {
  return {
    project_id: "p1",
    fetched_at: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    raining_now: false,
    precip_prob_next_hours: [10, 10, 10, 10, 10, 10, 10, 10],
    next_rain_at: null,
    daily: [],
    ...patch,
  };
}

test("raining now on an exterior job is a blue row for today", () => {
  const rows = buildRainWatchSection([job()], [weather({ raining_now: true })], NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.workLabel, "Exterior work today");
  assert.equal(rows[0]?.chipLabel, "Raining now");
  assert.equal(rows[0]?.chipTone, "raining");
});

test("a 50 percent chance inside three hours is rain today", () => {
  const rows = buildRainWatchSection(
    [job()],
    [weather({ precip_prob_next_hours: [10, 20, 55, 10, 10, 10, 10, 10] })],
    NOW,
  );
  assert.equal(rows[0]?.chipLabel, "Rain today · 55%");
  assert.equal(rows[0]?.chipTone, "soon");
});

test("rain later today stays gray and a chance under 50 is left out", () => {
  const later = buildRainWatchSection(
    [job()],
    [weather({ precip_prob_next_hours: [10, 10, 10, 10, 10, 70, 10, 10] })],
    NOW,
  );
  assert.equal(later[0]?.chipLabel, "Rain today · 70%");
  assert.equal(later[0]?.chipTone, "tomorrow");

  const light = buildRainWatchSection(
    [job()],
    [weather({ precip_prob_next_hours: [49, 10, 10, 10, 10, 10, 10, 10] })],
    NOW,
  );
  assert.deepEqual(light, []);
});

test("rain tomorrow uses the next-day chance when it is inside 24 hours", () => {
  const tomorrowMorning = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 6, 0, 0);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][tomorrowMorning.getDay()];
  const rows = buildRainWatchSection(
    [job()],
    [
      weather({
        next_rain_at: tomorrowMorning.toISOString(),
        daily: [{ label: weekday, precip_prob: 80 }],
      }),
    ],
    NOW,
  );
  assert.equal(rows[0]?.chipLabel, "Rain tomorrow · 80%");
  assert.equal(rows[0]?.chipTone, "tomorrow");
});

test("work tomorrow is used when today is outside the window", () => {
  const tomorrow = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1);
  const start = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  const rows = buildRainWatchSection(
    [job({ exterior_start: start })],
    [weather({ raining_now: true })],
    NOW,
  );
  assert.equal(rows[0]?.workLabel, "Exterior work tomorrow");
  assert.equal(rows[0]?.chipLabel, "Raining now");
});

test("stale weather, interior jobs, and a closed window add no row", () => {
  const stale = buildRainWatchSection(
    [job()],
    [weather({ fetched_at: new Date(NOW.getTime() - 46 * 60 * 1000).toISOString(), raining_now: true })],
    NOW,
  );
  assert.deepEqual(stale, []);
  const fresh = buildRainWatchSection(
    [job()],
    [weather({ fetched_at: new Date(NOW.getTime() - 45 * 60 * 1000).toISOString(), raining_now: true })],
    NOW,
  );
  assert.equal(fresh.length, 1);
  assert.deepEqual(buildRainWatchSection([job({ is_exterior: false })], [weather({ raining_now: true })], NOW), []);
  assert.deepEqual(
    buildRainWatchSection(
      [job({ exterior_end: "2026-11-23" })],
      [weather({ raining_now: true })],
      NOW,
    ),
    [],
  );
});

test("the subject clause is omitted when nothing qualifies", () => {
  assert.equal(rainWatchSubjectClause(0), null);
  assert.equal(rainWatchSubjectClause(1), "Rain on 1 scheduled job");
  assert.equal(rainWatchSubjectClause(2), "Rain on 2 scheduled jobs");
});
