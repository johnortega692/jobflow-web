import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callOffByIso,
  cheapestRentalQuote,
  inclusiveDays,
  normalizeRentalLine,
  normalizeRentalLines,
  orderByIso,
  rentalDayFill,
  rentalQuoteForLine,
  rentalReminders,
  rentalUnitWeeks,
  rentalWeekFill,
  shiftRentalLine,
  type RentalLine,
} from "./rentalEquipment.ts";

const weeks = ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"];

function boom(patch: Partial<RentalLine> = {}): RentalLine {
  return {
    id: "boom",
    name: "Boom, 45 ft",
    quantity: 3,
    onRentIso: "2026-12-02",
    offRentIso: "2026-12-30",
    skipClosedDays: false,
    vendor: "",
    poNumber: "",
    dayRate: 100,
    weekRate: 400,
    fourWeekRate: 1200,
    deliveryPickup: 150,
    status: "needed",
    ...patch,
  };
}

test("dates fill the weeks and mark the partial start and end", () => {
  const line = boom();
  assert.equal(rentalWeekFill(line, "2026-11-30", null)?.label, "X · from Wed");
  assert.equal(rentalWeekFill(line, "2026-12-07", null)?.label, "X");
  assert.equal(rentalWeekFill(line, "2026-12-28", null)?.label, "X · thru Wed");
  assert.equal(rentalUnitWeeks(line, weeks, new Map()), 5);
  assert.equal(inclusiveDays(line.onRentIso, line.offRentIso), 29);
});

test("a same-week rental names both edges", () => {
  const label = rentalWeekFill(boom({ onRentIso: "2026-12-02", offRentIso: "2026-12-04" }), "2026-11-30", null)?.label;
  assert.equal(label, "X · from Wed · thru Fri");
});

test("each day in the rental is on or off and days outside it stay blank", () => {
  const line = boom();
  assert.equal(rentalDayFill(line, "2026-11-30", null, null), null);
  assert.equal(rentalDayFill(line, "2026-12-01", null, null), null);
  assert.deepEqual(rentalDayFill(line, "2026-12-02", null, null), { quantity: 1, overridden: false });
  assert.deepEqual(rentalDayFill(line, "2026-12-06", null, null), { quantity: 1, overridden: false });
  assert.deepEqual(rentalDayFill(line, "2026-12-30", null, null), { quantity: 1, overridden: false });
  assert.equal(rentalDayFill(line, "2026-12-31", null, null), null);
  assert.deepEqual(rentalDayFill(line, "2026-12-02", null, 0), { quantity: 0, overridden: true });
});

test("skipping weekends and holidays leaves those days blank and shortens the estimate", () => {
  const line = boom({ skipClosedDays: true });
  const holidays = ["2026-12-25"];
  assert.equal(rentalDayFill(line, "2026-12-05", null, null, holidays), null);
  assert.equal(rentalDayFill(line, "2026-12-06", null, null, holidays), null);
  assert.equal(rentalDayFill(line, "2026-12-25", null, null, holidays), null);
  assert.deepEqual(rentalDayFill(line, "2026-12-04", null, null, holidays), { quantity: 1, overridden: false });
  assert.deepEqual(rentalDayFill(line, "2026-12-24", null, null, holidays), { quantity: 1, overridden: false });
  assert.equal(rentalWeekFill(line, "2026-11-30", null, holidays)?.label, "X · from Wed");
  assert.equal(rentalWeekFill(line, "2026-12-21", null, holidays)?.label, "X");
  assert.equal(rentalWeekFill(line, "2026-12-28", null, holidays)?.label, "X · thru Wed");
  assert.equal(rentalUnitWeeks(line, weeks, new Map(), holidays), 5);
  const quote = rentalQuoteForLine(line, holidays);
  const full = rentalQuoteForLine(boom());
  assert.equal(quote?.summary, "3 × week + delivery");
  assert.equal(quote?.total, 1350);
  assert.ok(full && quote && quote.total < full.total);
  const weekendOnly = boom({ onRentIso: "2026-12-05", offRentIso: "2026-12-06", skipClosedDays: true });
  assert.equal(rentalWeekFill(weekendOnly, "2026-11-30", null, holidays), null);
});

test("a week override replaces the date quantity and zero clears the week", () => {
  const line = boom();
  assert.equal(rentalWeekFill(line, "2026-11-30", 1)?.label, "X · from Wed");
  assert.equal(rentalWeekFill(line, "2026-12-07", 0)?.label, "");
  const overrides = new Map<string, number>([
    ["2026-11-30", 1],
    ["2026-12-07", 0],
  ]);
  assert.equal(rentalUnitWeeks(line, weeks, overrides), 4);
});

test("the cheapest mix beats five weekly charges", () => {
  const quote = cheapestRentalQuote(29, 3, boom());
  assert.equal(quote?.summary, "1 × 4-week + 1 × day + delivery");
  assert.equal(quote?.perUnit, 1450);
  assert.equal(quote?.total, 4350);
  const weeklyOnly = cheapestRentalQuote(29, 1, { dayRate: null, weekRate: 500, fourWeekRate: null, deliveryPickup: null });
  assert.equal(weeklyOnly?.summary, "5 × week");
  assert.equal(weeklyOnly?.perUnit, 2500);
});

test("order by and call off by skip weekends", () => {
  const line = boom();
  assert.equal(orderByIso(line.onRentIso), "2026-11-30");
  assert.equal(callOffByIso(line.offRentIso), "2026-12-29");
  const due = rentalReminders([line], "2026-11-28");
  assert.equal(due[0]?.text, "Order Boom, 45 ft by 11/30");
  assert.equal(due[0]?.overdue, false);
  const late = rentalReminders([boom({ status: "on_rent" })], "2026-12-30");
  assert.equal(late[0]?.text, "Call off Boom, 45 ft by 12/29");
  assert.equal(late[0]?.overdue, true);
  assert.equal(rentalReminders([boom({ status: "picked_up" })], "2026-11-28").length, 0);
});

test("shifting a line moves both dates and keeps a confirmed status", () => {
  const shifted = shiftRentalLine(boom({ status: "on_rent" }), 7);
  assert.equal(shifted.onRentIso, "2026-12-09");
  assert.equal(shifted.offRentIso, "2027-01-06");
  assert.equal(shifted.status, "on_rent");
});

test("an older weekly rate becomes the week rate and each piece is its own line", () => {
  const line = normalizeRentalLine({ id: "lift", name: "Boom", weeklyRate: 450, quantity: 2 });
  assert.equal(line?.weekRate, 450);
  assert.equal(line?.quantity, 1);
  assert.equal(line?.status, "needed");
  const lines = normalizeRentalLines([{ id: "lift", name: "Boom", quantity: 3 }]);
  assert.deepEqual(
    lines.map((item) => item.id),
    ["lift", "lift:2", "lift:3"],
  );
  assert.equal(lines.every((item) => item.quantity === 1), true);
});
