import assert from "node:assert/strict";
import test from "node:test";
import { paintPacketTrackingNumber, stampPaintPacketTracking } from "./paintPacketTracking.ts";

const history = [
  {
    submittal_number: 1,
    revision_number: 0,
    date: "Nov 1, 2026",
    items: [],
    scope: "paint",
    packet_tracking: "1Z999AA10123456784",
  },
];

test("the open paint package tracking number is the one on the tracker", () => {
  assert.equal(
    paintPacketTrackingNumber({ packet_tracking: "123456789012" }, history),
    "123456789012",
  );
});

test("a new revision with no number yet still shows the last mailed packet", () => {
  assert.equal(paintPacketTrackingNumber({ packet_tracking: "" }, history), "1Z999AA10123456784");
});

test("saving a number keeps it on that revision only", () => {
  const stamped = stampPaintPacketTracking(history, {
    submittal_number: 1,
    revision_number: 0,
    packet_tracking: "9400111899001234567890",
  });
  assert.equal(stamped[0]?.packet_tracking, "9400111899001234567890");
  const next = stampPaintPacketTracking(
    [...stamped, { submittal_number: 1, revision_number: 1, date: "Nov 2, 2026", items: [], scope: "paint", packet_tracking: "" }],
    { submittal_number: 1, revision_number: 1, packet_tracking: "123456789012" },
  );
  assert.equal(next[0]?.packet_tracking, "9400111899001234567890");
  assert.equal(next[1]?.packet_tracking, "123456789012");
});
