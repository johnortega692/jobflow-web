import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildWeeklyHoursPdf } from "./weeklyHoursPdf.ts";
import { buildWeeklyHoursGrid, formatWeeklyPrintQuantity } from "./weeklyHoursPrint.ts";

const phases = [
  { id: "paint", costCode: "099100", name: "Interior paint" },
  { id: "wall", costCode: "097200", name: "Wallcovering" },
];

const weeks = ["2026-11-30", "2026-12-07"];

test("week totals stay in hours or become people at eight hours each", () => {
  const cells = [
    { phaseId: "paint", weekStartIso: "2026-11-30", hours: 40 },
    { phaseId: "paint", weekStartIso: "2026-12-07", hours: 12 },
    { phaseId: "wall", weekStartIso: "2026-11-30", hours: 16 },
  ];
  const hours = buildWeeklyHoursGrid({
    weekStarts: weeks,
    phases,
    cells,
    holidays: [],
    measure: "hours",
    layout: "week",
  });
  assert.deepEqual(hours.rows[0]!.values, [40, 12]);
  assert.equal(hours.rows[0]!.total, 52);
  assert.deepEqual(hours.columnTotals, [56, 12]);
  assert.equal(hours.grandTotal, 68);

  const people = buildWeeklyHoursGrid({
    weekStarts: weeks,
    phases,
    cells,
    holidays: [],
    measure: "people",
    layout: "week",
  });
  assert.deepEqual(people.rows[0]!.values, [5, 1.5]);
  assert.equal(people.rows[1]!.values[0], 2);
  assert.equal(formatWeeklyPrintQuantity(1.5, "people"), "1.5");
  assert.equal(formatWeeklyPrintQuantity(0.5, "people"), "0.5");
  assert.equal(formatWeeklyPrintQuantity(5 / 8, "people"), "0.625");
  assert.equal(formatWeeklyPrintQuantity(1.5, "hours"), "1.5");
});

test("day layout uses the saved days and parks an unplanned week on Monday", () => {
  const grid = buildWeeklyHoursGrid({
    weekStarts: weeks,
    phases: [phases[0]!],
    cells: [
      { phaseId: "paint", weekStartIso: "2026-11-30", hours: 15, dayHours: [0, 0, 5, 5, 5, 0, 0] },
      { phaseId: "paint", weekStartIso: "2026-12-07", hours: 8 },
    ],
    holidays: ["2026-12-02"],
    measure: "hours",
    layout: "days",
  });
  assert.equal(grid.columns.length, 14);
  assert.deepEqual(grid.rows[0]!.values.slice(0, 7), [0, 0, 5, 5, 5, 0, 0]);
  assert.equal(grid.rows[0]!.values[7], 8);
  assert.equal(grid.rows[0]!.values[8], 0);
  assert.equal(grid.columns[2]!.holiday, true);
  assert.equal(grid.columns[5]!.weekend, true);
  assert.equal(grid.seededMonday, true);
  assert.equal(grid.rows[0]!.total, 23);
});

test("the pdf prints week totals on one page and days across pages", async () => {
  const cells = [
    { phaseId: "paint", weekStartIso: "2026-11-30", hours: 16, dayHours: [0, 8, 8, 0, 0, 0, 0] },
  ];
  const fractionBytes = await buildWeeklyHoursPdf({
    jobNumber: "1156",
    jobName: "Sample job",
    contractLabel: "Paint",
    weekStarts: ["2026-11-30"],
    phases: [phases[0]!],
    cells: [
      { phaseId: "paint", weekStartIso: "2026-11-30", hours: 17, dayHours: [12, 5, 0, 0, 0, 0, 0] },
    ],
    holidays: [],
    measure: "people",
    layout: "days",
  });
  assert.equal((await PDFDocument.load(fractionBytes)).getPageCount(), 1);

  const weekBytes = await buildWeeklyHoursPdf({
    jobNumber: "1156",
    jobName: "Sample job",
    contractLabel: "Paint",
    weekStarts: weeks,
    phases,
    cells,
    holidays: [],
    measure: "people",
    layout: "week",
  });
  assert.equal(String.fromCharCode(...weekBytes.slice(0, 4)), "%PDF");
  assert.equal((await PDFDocument.load(weekBytes)).getPageCount(), 1);

  const manyWeeks = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(2026, 10, 30 + index * 7);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  });
  const dayBytes = await buildWeeklyHoursPdf({
    jobNumber: "1156",
    jobName: "Sample job",
    contractLabel: "Paint",
    weekStarts: manyWeeks,
    phases,
    cells,
    holidays: [],
    measure: "hours",
    layout: "days",
  });
  assert.equal((await PDFDocument.load(dayBytes)).getPageCount(), 1);
});
