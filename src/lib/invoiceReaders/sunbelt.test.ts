import assert from "node:assert/strict";
import test from "node:test";
import { parseSunbeltPages } from "./sunbelt.ts";
import type { PdfRow } from "./types.ts";

function row(parts: [number, string][]): PdfRow {
  return parts.map(([x, str]) => ({ x, str }));
}

const page: PdfRow[] = [
  row([[272, "SUNBELT"], [312, "RENTALS,"], [426, "INVOICE NO."], [486, "191635138-0001"]]),
  row([[422, "INVOICE DATE"], [486, "11/13/26"]]),
  row([[487, "PAGE"]]),
  row([[520, "1 of 1"]]),
  row([[53, "QTY"], [82, "EQUIPMENT #"], [324, "Min"], [376, "Day"], [422, "Week"], [462, "4 Week"], [537, "Amount"]]),
  row([[59, "1.00 10'-14' SINGLE MANLIFT S/P"], [307, "150.00"], [359, "150.00"], [410, "250.00"], [462, "350.00"], [537, "350.00"]]),
  row([[82, "10220249"], [145, "Make: GENIE"], [220, "Model: GR12"], [295, "Ser #: GRP-56923"]]),
  row([[82, "HR OUT: 247.000"], [192, "HR IN: 250.700"], [301, "TOTAL: 3.700"]]),
  row([[59, "1.00 10'-14' SINGLE MANLIFT S/P"], [307, "150.00"], [359, "150.00"], [410, "250.00"], [462, "350.00"], [537, "350.00"]]),
  row([[82, "DDE123008"], [145, "Make: JLG"], [209, "Model: 1230ES"], [295, "Ser #: M130004762"]]),
  row([[82, "HR OUT: 227.273"], [192, "HR IN: 230.645"]]),
  row([[59, "1.00 10'-14' SINGLE MANLIFT S/P"], [537, "350.00"]]),
  row([[82, "10007914"], [145, "Make: JLG"], [209, "Model: 1230ES"]]),
  row([[341, "Rental Sub-total:"], [531, "1050.00"]]),
  row([[48, "SALES ITEMS:"]]),
  row([[53, "Qty"], [82, "Item number"], [249, "Unit"], [307, "Price"]]),
  row([[71, "1 CAHERS1"], [255, "EA"], [307, "7.890"], [549, "7.89"]]),
  row([[82, "CA .75% HEAVY EQUIP. RENTAL TAX"]]),
  row([[71, "1 DLPKSRCHG"], [255, "EA"], [301, "75.000"], [543, "75.00"]]),
  row([[82, "TRANSPORTATION SURCHARGE"]]),
  row([[71, "1 ENVIRONMENTAL"], [255, "EA"], [301, "15.750"], [543, "15.75"]]),
  row([[82, "2133XXX000 ENVIRON/HAZMAT/DISPOSAL FEE"]]),
  row([[71, "1 RENTAL PROTECTION PLAN"], [537, "157.50"]]),
  row([[88, "DELIVERY CHARGE"], [537, "150.00"]]),
  row([[48, "SALES ITEMS:"]]),
  row([[88, "PICKUP CHARGE"], [537, "150.00"]]),
  row([[82, "BILLED FOR FOUR WEEKS 11/05/26 THRU 12/02/26."]]),
  row([[407, "SUBTOTAL"], [543, "1,606.14"]]),
  row([[406, "SALES TAX"], [554, "142.00"]]),
  row([[399, "INVOICE TOTAL"], [543, "1,748.14"]]),
];

test("a Sunbelt rental invoice keeps the lifts, charges, and invoice total", () => {
  const invoices = parseSunbeltPages([page]);
  assert.equal(invoices.length, 1);
  const invoice = invoices[0]!;
  assert.equal(invoice.vendorName, "Sunbelt Rentals");
  assert.equal(invoice.invoiceNo, "191635138-0001");
  assert.equal(invoice.invoiceDate, "11/13/2026");
  assert.equal(invoice.total, 1748.14);

  const first = invoice.lines[0]!;
  assert.equal(first.description, "10'-14' SINGLE MANLIFT S/P");
  assert.equal(first.productId, "10220249");
  assert.equal(first.color, "Make: GENIE Model: GR12 Ser #: GRP-56923");
  assert.equal(first.qty, 1);
  assert.equal(first.netPrice, 350);
  assert.equal(first.size, "4WK");
  assert.equal(first.catalogItem, true);

  assert.equal(invoice.lines[1]?.productId, "DDE123008");
  assert.equal(invoice.lines[2]?.productId, "10007914");

  const tax = invoice.lines[3]!;
  assert.equal(tax.productId, "CAHERS1");
  assert.equal(tax.description, "CA .75% HEAVY EQUIP. RENTAL TAX");
  assert.equal(tax.netPrice, 7.89);
  assert.equal(tax.catalogItem, false);

  const haul = invoice.lines[4]!;
  assert.equal(haul.productId, "DLPKSRCHG");
  assert.equal(haul.description, "TRANSPORTATION SURCHARGE");
  assert.equal(haul.netPrice, 75);

  const enviro = invoice.lines[5]!;
  assert.equal(enviro.productId, "2133XXX000");
  assert.equal(enviro.description, "ENVIRONMENTAL — ENVIRON/HAZMAT/DISPOSAL FEE");
  assert.equal(enviro.netPrice, 15.75);

  assert.equal(invoice.lines[6]?.description, "RENTAL PROTECTION PLAN");
  assert.equal(invoice.lines[6]?.netPrice, 157.5);
  assert.equal(invoice.lines[7]?.description, "DELIVERY CHARGE");
  assert.equal(invoice.lines[7]?.netPrice, 150);
  assert.equal(invoice.lines[8]?.description, "PICKUP CHARGE");
  assert.equal(invoice.lines[8]?.netPrice, 150);
  assert.match(invoice.lines[8]?.color ?? "", /11\/05\/26 THRU 12\/02\/26/);
  assert.equal(invoice.lines.length, 9);
});
