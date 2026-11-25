import assert from "node:assert/strict";
import test from "node:test";
import {
  exteriorWindowOrderError,
  isRainRelevant,
  normalizeExteriorDate,
} from "./exteriorWorkWindow.ts";

const project = {
  is_exterior: true,
  exterior_start: null as string | null,
  exterior_end: null as string | null,
};

test("interior jobs are never rain relevant", () => {
  assert.equal(isRainRelevant({ is_exterior: false }, "2026-11-24"), false);
});

test("a blank window covers every day", () => {
  assert.equal(isRainRelevant(project, "2026-11-24"), true);
  assert.equal(isRainRelevant(project, new Date(2026, 10, 25)), true);
});

test("the window is inclusive and open on a missing side", () => {
  const bounded = { ...project, exterior_start: "2026-11-24", exterior_end: "2026-11-26" };
  assert.equal(isRainRelevant(bounded, "2026-11-24"), true);
  assert.equal(isRainRelevant(bounded, "2026-11-26"), true);
  assert.equal(isRainRelevant(bounded, "2026-11-23"), false);
  assert.equal(isRainRelevant(bounded, "2026-11-27"), false);

  const startOnly = { ...project, exterior_start: "2026-11-24", exterior_end: null };
  assert.equal(isRainRelevant(startOnly, "2026-11-23"), false);
  assert.equal(isRainRelevant(startOnly, "2026-12-01"), true);

  const endOnly = { ...project, exterior_start: null, exterior_end: "2026-11-26" };
  assert.equal(isRainRelevant(endOnly, "2026-11-01"), true);
  assert.equal(isRainRelevant(endOnly, "2026-11-27"), false);
});

test("ends before starts is the only window error", () => {
  assert.equal(exteriorWindowOrderError("2026-11-26", "2026-11-24"), "Ends can't be before Starts.");
  assert.equal(exteriorWindowOrderError("2026-11-24", "2026-11-24"), null);
  assert.equal(exteriorWindowOrderError("2026-11-24", null), null);
  assert.equal(exteriorWindowOrderError(null, null), null);
  assert.equal(normalizeExteriorDate(""), null);
  assert.equal(normalizeExteriorDate("11/24/2026"), "2026-11-24");
});
