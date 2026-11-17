import assert from "node:assert/strict";
import test from "node:test";
import { carryOver, type CarryCell } from "./carryOver.ts";

function hours(grid: readonly CarryCell[], phaseId: string, weekIndex: number): number {
  return grid.find((cell) => cell.phaseId === phaseId && cell.weekIndex === weekIndex)?.hours ?? 0;
}

test("(a) 37 planned, 30 actual, next week gains 7", () => {
  const grid = carryOver(
    [
      { phaseId: "901", weekIndex: 0, hours: 37 },
      { phaseId: "901", weekIndex: 1, hours: 4 },
      { phaseId: "381", weekIndex: 0, hours: 12 },
    ],
    0,
    [{ phaseId: "901", actual: 30 }],
    "next",
    [1, 1, 1, 1],
  );
  assert.equal(hours(grid, "901", 0), 30);
  assert.equal(hours(grid, "901", 1), 11);
  assert.equal(hours(grid, "381", 0), 12);
});

test("(b) remaining weeks split 7 whole hours and the last week keeps the remainder", () => {
  const grid = carryOver(
    [
      { phaseId: "901", weekIndex: 0, hours: 37 },
      { phaseId: "901", weekIndex: 1, hours: 4 },
    ],
    0,
    [{ phaseId: "901", actual: 30 }],
    "spread",
    [0, 1, 1, 1],
  );
  assert.equal(hours(grid, "901", 0), 30);
  assert.equal(hours(grid, "901", 1), 6);
  assert.equal(hours(grid, "901", 2), 2);
  assert.equal(hours(grid, "901", 3), 3);
  const carried = 2 + 2 + 3;
  assert.equal(carried, 7);
});

test("(c) park lowers this week only, so budget left grows by the shortfall", () => {
  const before = [
    { phaseId: "901", weekIndex: 0, hours: 37 },
    { phaseId: "901", weekIndex: 1, hours: 5 },
    { phaseId: "901", weekIndex: 2, hours: 4 },
  ];
  const budget = 100;
  const plannedBefore = before.reduce((sum, cell) => sum + cell.hours, 0);
  const grid = carryOver(before, 0, [{ phaseId: "901", actual: 30 }], "park", [1, 1, 1]);
  const plannedAfter = grid.reduce((sum, cell) => sum + cell.hours, 0);
  assert.equal(hours(grid, "901", 0), 30);
  assert.equal(hours(grid, "901", 1), 5);
  assert.equal(hours(grid, "901", 2), 4);
  assert.equal(budget - plannedAfter, budget - plannedBefore + 7);
});

test("(d) actual 0 removes the cell, and actual above planned changes only this cell", () => {
  const cleared = carryOver(
    [
      { phaseId: "901", weekIndex: 0, hours: 37 },
      { phaseId: "901", weekIndex: 1, hours: 8 },
    ],
    0,
    [{ phaseId: "901", actual: 0 }],
    "park",
    [1, 1],
  );
  assert.equal(
    cleared.some((cell) => cell.phaseId === "901" && cell.weekIndex === 0),
    false,
  );
  assert.equal(hours(cleared, "901", 1), 8);

  const over = carryOver(
    [
      { phaseId: "901", weekIndex: 0, hours: 37 },
      { phaseId: "901", weekIndex: 1, hours: 8 },
    ],
    0,
    [{ phaseId: "901", actual: 40 }],
    "next",
    [1, 1],
  );
  assert.equal(hours(over, "901", 0), 40);
  assert.equal(hours(over, "901", 1), 8);
});

test("(e) next week on the last week is a no-op", () => {
  const before = [
    { phaseId: "901", weekIndex: 2, hours: 37 },
    { phaseId: "901", weekIndex: 1, hours: 5 },
  ];
  const grid = carryOver(before, 2, [{ phaseId: "901", actual: 30 }], "next", [1, 1, 1]);
  assert.deepEqual(
    grid.map((cell) => ({ ...cell })).sort((a, b) => a.weekIndex - b.weekIndex),
    before.map((cell) => ({ ...cell })).sort((a, b) => a.weekIndex - b.weekIndex),
  );
});
