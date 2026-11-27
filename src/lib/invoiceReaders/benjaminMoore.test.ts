import assert from "node:assert/strict";
import test from "node:test";
import { parseBenjaminMoorePages } from "./benjaminMoore.ts";
import { invoiceFeeAmount } from "./invoiceCharges.ts";
import type { PdfRow } from "./types.ts";

function row(parts: [number, string][]): PdfRow {
  return parts.map(([x, str]) => ({ x, str }));
}

const page: PdfRow[] = [
  row([[313, "Sold To"], [427, "10023593"], [680, "Page 1 of 1"]]),
  row([[313, "Invoice Number"], [427, "5500945061"]]),
  row([[313, "Invoice Date"], [427, "10/29/2026"]]),
  row([[678, "INVOICE"]]),
  row([[43, "SKU"], [210, "Description"], [376, "Quantity"], [421, "Net Amount"], [481, "Promotion"], [534, "Job Quote"], [580, "Extended Amount"], [650, "Unit Extended"], [725, "Fees"]]),
  row([[484, "Discount"], [537, "Discount"], [666, "Price"]]),
  row([[20, "C08500-001"], [94, "FS ALL PURP PRIMER -WHITE"], [403, "1"], [449, "84.32"], [620, "84.32"], [682, "84.32"], [711, "E"]]),
  row([[94, "TINT TO SHADE OF HC-154 HALE NAVY"]]),
  row([[20, "C08500-001"], [94, "FS ALL PURP PRIMER -WHITE"], [403, "1"], [449, "84.32"], [620, "84.32"], [682, "84.32"], [711, "E"]]),
  row([[94, "Total Amount before Fees & Taxes"], [615, "168.64"]]),
  row([[94, "Recovery Fee [E]"], [624, "1.30"]]),
  row([[94, "Sales Tax"], [620, "17.60"]]),
  row([[94, "Total Amount in USD, Due by 11/28/2026"], [615, "187.54"]]),
  row([[14, "The products, technology, or software covered under this invoice are for sale in the U.S. only."]]),
];

test("a Benjamin Moore national account invoice keeps both primers, the tint, and the recovery fee", () => {
  const invoices = parseBenjaminMoorePages([page]);
  assert.equal(invoices.length, 1);
  const invoice = invoices[0]!;
  assert.equal(invoice.vendorName, "Benjamin Moore");
  assert.equal(invoice.invoiceNo, "5500945061");
  assert.equal(invoice.invoiceDate, "10/29/2026");
  assert.equal(invoice.pageCount, 1);
  assert.equal(invoice.total, 187.54);
  assert.equal(invoice.taxPercent, 10.354);

  assert.equal(invoice.lines.length, 3);
  const first = invoice.lines[0]!;
  assert.equal(first.productId, "C08500-001");
  assert.equal(first.description, "FS ALL PURP PRIMER -WHITE");
  assert.equal(first.color, "TINT TO SHADE OF HC-154 HALE NAVY");
  assert.equal(first.section, "paint_product");
  assert.equal(first.sheen, "Primer");
  assert.equal(first.qty, 1);
  assert.equal(first.netPrice, 84.32);

  const second = invoice.lines[1]!;
  assert.equal(second.productId, "C08500-001");
  assert.equal(second.color, "");
  assert.equal(second.netPrice, 84.32);

  const fee = invoice.lines[2]!;
  assert.equal(fee.description, "Recovery Fee");
  assert.equal(fee.netPrice, 1.3);
  assert.equal(fee.catalogItem, false);
  assert.equal(invoiceFeeAmount(invoice.lines), 1.3);
});
