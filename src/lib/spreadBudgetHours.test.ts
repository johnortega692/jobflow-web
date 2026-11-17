import assert from "node:assert/strict";
import test from "node:test";
import { spreadBudgetHours } from "./spreadBudgetHours.ts";

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
