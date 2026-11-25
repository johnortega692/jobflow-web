import assert from "node:assert/strict";
import test from "node:test";
import { spreadActivityHours, spreadBudgetHours } from "./spreadBudgetHours.ts";

const gridStart = "2026-10-26";

test("one activity from 10/26 through 11/13 spreads 348 hours into 116/116/116", () => {
  const result = spreadBudgetHours(
    [{ id: "paint", startIso: "2026-10-26", endIso: "2026-11-13" }],
    [{ id: "901", hours: 348 }],
    gridStart,
    3,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.hours, [116, 116, 116]);
  assert.equal(result.totalHours, 348);
  assert.equal(result.activeWeekCount, 3);
});

test("two overlapping activities give the shared week a higher weight", () => {
  const result = spreadBudgetHours(
    [
      { id: "a", startIso: "2026-10-26", endIso: "2026-10-30" },
      { id: "b", startIso: "2026-10-26", endIso: "2026-11-06" },
    ],
    [{ id: "901", hours: 15 }],
    gridStart,
    3,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.hours, [10, 5, 0]);
});

test("spread hours always add back to H", () => {
  const activities = [
    { id: "a", startIso: "2026-10-28", endIso: "2026-11-06" },
    { id: "b", startIso: "2026-11-04", endIso: "2026-11-18" },
  ];
  for (const hours of [1, 2, 7, 40, 100, 348]) {
    const result = spreadBudgetHours(activities, [{ id: "903", hours }], gridStart, 6, "activity-days");
    const sum = result.rows[0]?.hours.reduce((total, value) => total + value, 0) ?? 0;
    assert.equal(sum, hours);
  }
});

test("weeks with no activity get 0", () => {
  const result = spreadBudgetHours(
    [{ id: "a", startIso: "2026-10-26", endIso: "2026-10-30" }],
    [{ id: "990", hours: 32 }],
    gridStart,
    5,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.hours, [32, 0, 0, 0, 0]);
});

test("a full week of 40 hours is one person each weekday", () => {
  const result = spreadBudgetHours(
    [{ id: "paint", startIso: "2026-10-26", endIso: "2026-10-30" }],
    [{ id: "901", hours: 40 }],
    gridStart,
    1,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.dayHours[0], [8, 8, 8, 8, 8, 0, 0]);
});

test("activity dates place the week's hours on those weekdays", () => {
  const result = spreadBudgetHours(
    [{ id: "paint", startIso: "2026-10-28", endIso: "2026-10-30" }],
    [{ id: "901", hours: 15 }],
    gridStart,
    3,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.hours, [15, 0, 0]);
  assert.deepEqual(result.rows[0]?.dayHours[0], [0, 0, 8, 7, 0, 0, 0]);
  assert.deepEqual(result.rows[0]?.dayHours[1], [0, 0, 0, 0, 0, 0, 0]);
});

test("two days keep a full man-day before the leftover hour", () => {
  const result = spreadBudgetHours(
    [
      { id: "a", startIso: "2026-10-26", endIso: "2026-10-26" },
      { id: "b", startIso: "2026-10-26", endIso: "2026-10-27" },
    ],
    [{ id: "901", hours: 9 }],
    gridStart,
    1,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.dayHours[0], [8, 1, 0, 0, 0, 0, 0]);
});

test("a holiday keeps the week total and leaves that day empty", () => {
  const result = spreadBudgetHours(
    [{ id: "paint", startIso: "2026-10-26", endIso: "2026-10-30" }],
    [{ id: "901", hours: 20 }],
    gridStart,
    1,
    "activity-days",
    ["2026-10-26"],
  );
  assert.deepEqual(result.rows[0]?.hours, [20]);
  assert.deepEqual(result.rows[0]?.dayHours[0], [0, 8, 8, 4, 0, 0, 0]);
});

test("even per week still fills only the dated weekdays", () => {
  const result = spreadBudgetHours(
    [{ id: "paint", startIso: "2026-10-30", endIso: "2026-11-06" }],
    [{ id: "901", hours: 10 }],
    gridStart,
    3,
    "even-per-week",
  );
  assert.deepEqual(result.rows[0]?.hours, [5, 5, 0]);
  assert.deepEqual(result.rows[0]?.dayHours[0], [0, 0, 0, 0, 5, 0, 0]);
  assert.deepEqual(result.rows[0]?.dayHours[1], [5, 0, 0, 0, 0, 0, 0]);
});

test("weekends stay off the plan until the activity includes them", () => {
  const activity = { id: "paint", startIso: "2026-10-31", endIso: "2026-11-01" };
  const weekdays = spreadBudgetHours([activity], [{ id: "901", hours: 14 }], gridStart, 2, "activity-days");
  assert.deepEqual(weekdays.rows[0]?.hours, [0, 0]);

  const weekends = spreadBudgetHours(
    [{ ...activity, includeWeekends: true }],
    [{ id: "901", hours: 14 }],
    gridStart,
    2,
    "activity-days",
  );
  assert.deepEqual(weekends.rows[0]?.hours, [14, 0]);
  assert.deepEqual(weekends.rows[0]?.dayHours[0], [0, 0, 0, 0, 0, 8, 6]);
});

test("a blank activity uses its cost code total", () => {
  const result = spreadActivityHours(
    [{ id: "walls", phaseId: "901", hours: 0, budgetHours: 40, startIso: "2026-10-26", endIso: "2026-10-30" }],
    gridStart,
    1,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.hours, [40]);
  assert.deepEqual(result.rows[0]?.dayHours[0], [8, 8, 8, 8, 8, 0, 0]);
  assert.equal(result.totalHours, 40);
});

test("two blank activities share one cost code total", () => {
  const result = spreadActivityHours(
    [
      { id: "a", phaseId: "901", hours: 0, budgetHours: 15, startIso: "2026-10-26", endIso: "2026-10-30" },
      { id: "b", phaseId: "901", hours: 0, budgetHours: 15, startIso: "2026-10-26", endIso: "2026-11-06" },
    ],
    gridStart,
    3,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.hours, [10, 5, 0]);
  assert.equal(result.totalHours, 15);
});

test("typed hours replace the cost code total on that code", () => {
  const result = spreadActivityHours(
    [
      { id: "typed", phaseId: "901", hours: 8, budgetHours: 40, startIso: "2026-10-26", endIso: "2026-10-26" },
      { id: "blank", phaseId: "901", hours: 0, budgetHours: 40, startIso: "2026-10-27", endIso: "2026-10-30" },
    ],
    gridStart,
    1,
    "activity-days",
  );
  assert.equal(result.totalHours, 8);
});

test("each checked activity spreads its own hours onto its cost code", () => {
  const result = spreadActivityHours(
    [
      { id: "west", phaseId: "904", hours: 10, startIso: "2026-10-26", endIso: "2026-10-30" },
      { id: "east", phaseId: "904", hours: 5, startIso: "2026-11-02", endIso: "2026-11-06" },
    ],
    gridStart,
    3,
    "activity-days",
  );
  assert.deepEqual(result.rows[0]?.hours, [10, 5, 0]);
  assert.equal(result.totalHours, 15);
});

test("workdays before the grid start are counted and left off the weeks", () => {
  const result = spreadBudgetHours(
    [{ id: "early", startIso: "2026-10-20", endIso: "2026-10-30" }],
    [{ id: "901", hours: 10 }],
    gridStart,
    2,
    "activity-days",
  );
  assert.deepEqual(result.skippedBeforeGrid, [{ id: "early", days: 4 }]);
  assert.deepEqual(result.rows[0]?.hours, [10, 0]);
});
