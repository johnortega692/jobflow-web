import assert from "node:assert/strict";
import test from "node:test";
import { trackerCronSlotsDueOnUtcDate, trackerSlotsForWeekday } from "./trackerEmailSchedule.ts";

test("7 AM Pacific in winter is 15:00 UTC, and 14:00 UTC sends nothing", () => {
  const winterMorning = new Date("2026-11-23T15:00:00.000Z");
  const anHourEarly = new Date("2026-11-23T14:00:00.000Z");
  const options = {
    timezone: "America/Los_Angeles",
    sendHour: 7,
    notesDigestHour: 7,
    notesDigestEnabled: true,
    digestWeekday: 1,
    wallcoveringDigestWeekday: 5,
    siteReadyWeekday: 1,
  };
  assert.deepEqual(trackerCronSlotsDueOnUtcDate(anHourEarly, options), []);
  assert.deepEqual(trackerCronSlotsDueOnUtcDate(winterMorning, options), [
    "daily",
    "monday",
    "weekly",
    "notes",
  ]);
});

test("Monday's mail includes the combined digest and leaves Friday's wallcovering digest out", () => {
  assert.deepEqual(
    trackerSlotsForWeekday(1, {
      digestWeekday: 1,
      wallcoveringDigestWeekday: 5,
      siteReadyWeekday: 1,
      notesDigestEnabled: true,
    }),
    ["daily", "monday", "weekly", "notes"],
  );
});
