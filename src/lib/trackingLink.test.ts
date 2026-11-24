import assert from "node:assert/strict";
import test from "node:test";
import { trackingLink } from "./trackingLink.ts";

test("a UPS number opens the UPS tracking page", () => {
  const link = trackingLink("1Z999AA10123456784");
  assert.equal(link?.carrier, "UPS");
  assert.equal(link?.url, "https://www.ups.com/track?tracknum=1Z999AA10123456784");
});

test("a USPS number opens the USPS tracking page", () => {
  const link = trackingLink("9400 1118 9900 1234 5678 90");
  assert.equal(link?.carrier, "USPS");
  assert.match(link?.url ?? "", /^https:\/\/tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=/);
});

test("a 12 digit FedEx number opens the FedEx tracking page", () => {
  const link = trackingLink("123456789012");
  assert.equal(link?.carrier, "FedEx");
  assert.match(link?.url ?? "", /^https:\/\/www\.fedex\.com\/fedextrack\/\?trknbr=/);
});

test("an unrecognized tracking number opens a Google search", () => {
  const link = trackingLink("TBA123456789012");
  assert.equal(link?.carrier, "Google");
  assert.match(link?.url ?? "", /^https:\/\/www\.google\.com\/search\?q=/);
});

test("a received date is not a tracking link", () => {
  assert.equal(trackingLink("11/23/2026"), null);
  assert.equal(trackingLink(""), null);
});
