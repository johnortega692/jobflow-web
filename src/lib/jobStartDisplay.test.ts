import assert from "node:assert/strict";
import test from "node:test";
import { formatJobStart } from "./jobStartDisplay.ts";

const TODAY = new Date(2026, 10, 26);

function isoOffset(days: number): string {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("a start 115 days ago shows the short date and a day count", () => {
  const display = formatJobStart(isoOffset(-115), TODAY);
  assert.equal(display.dateLabel, "Aug 3");
  assert.deepEqual(display.marker, { kind: "day", text: "Day 115" });
  assert.equal(display.title, "08/03/2026");
});

test("a start 4 days out shows an in-Nd chip", () => {
  const display = formatJobStart(isoOffset(4), TODAY);
  assert.equal(display.dateLabel, "Nov 30");
  assert.deepEqual(display.marker, { kind: "soon", text: "in 4d" });
});

test("tomorrow uses the Tomorrow chip", () => {
  const display = formatJobStart(isoOffset(1), TODAY);
  assert.equal(display.dateLabel, "Nov 27");
  assert.deepEqual(display.marker, { kind: "soon", text: "Tomorrow" });
});

test("today uses the Today chip", () => {
  const display = formatJobStart(isoOffset(0), TODAY);
  assert.equal(display.dateLabel, "Nov 26");
  assert.deepEqual(display.marker, { kind: "soon", text: "Today" });
});

test("a start more than 14 days out in another year is the date only", () => {
  const display = formatJobStart(isoOffset(154), TODAY);
  assert.equal(display.dateLabel, "Apr 29, 2027");
  assert.equal(display.marker, null);
  assert.equal(display.title, "04/29/2027");
});

test("day 14 still gets a chip and day 15 does not", () => {
  assert.equal(formatJobStart(isoOffset(14), TODAY).marker?.text, "in 14d");
  assert.equal(formatJobStart(isoOffset(15), TODAY).marker, null);
  assert.equal(formatJobStart(isoOffset(15), TODAY).dateLabel, "Dec 11");
});

test("a missing start date is a dash", () => {
  assert.deepEqual(formatJobStart("", TODAY), { dateLabel: "—", marker: null, title: "" });
  assert.deepEqual(formatJobStart("not a date", TODAY), { dateLabel: "—", marker: null, title: "" });
});
