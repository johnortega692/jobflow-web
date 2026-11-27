import assert from "node:assert/strict";
import test from "node:test";
import { invoiceVendorNamesMatch, normalizeClaudeInvoice, parsedFileFromClaudeRead } from "./claudeInvoice.ts";

test("a Claude invoice read keeps shipped lines, fees, and the Whitecap name", () => {
  const read = normalizeClaudeInvoice({
    vendorName: "White Cap, L.P.",
    invoiceNo: "50040021311",
    invoiceDate: "10/07/2026",
    total: "1,332.67",
    taxAmount: "118.38",
    lines: [
      {
        productId: "12137005",
        description: "MED-LG SERIES 1 HARNESS",
        qty: "3",
        unit: "EA",
        unitPrice: "$60.99",
        extended: "182.97",
        fee: false,
      },
      {
        description: "HDRDESC",
        qty: 1,
        unitPrice: 0,
        extended: 0,
        fee: false,
      },
      {
        description: "Freight",
        qty: 1,
        unitPrice: 12,
        extended: 12,
        fee: true,
      },
    ],
  });

  assert.equal(read.invoiceNo, "50040021311");
  assert.equal(read.total, 1332.67);
  assert.equal(read.taxPercent, 9.749);
  assert.equal(read.lines.length, 2);
  assert.equal(invoiceVendorNamesMatch("Whitecap", read.vendorName), true);
  assert.equal(invoiceVendorNamesMatch("Sunbelt Rentals", read.vendorName), false);

  const file = parsedFileFromClaudeRead(read, { id: "custom-whitecap", vendorName: "Whitecap", catalog: false });
  assert.equal(file.invoices[0]?.lines[0]?.netPrice, 60.99);
  assert.equal(file.invoices[0]?.lines[0]?.qty, 3);
  assert.equal(file.invoices[0]?.lines[1]?.catalogItem, false);
  assert.equal(file.invoices[0]?.lines[1]?.description, "Freight");
});
