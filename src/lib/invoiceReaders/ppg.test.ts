import assert from "node:assert/strict";
import test from "node:test";
import { foundationGridText } from "./foundationGrid.ts";
import { ecoFeeAmount, paintFeeAmount } from "./invoiceCharges.ts";
import { parsePpgPages } from "./ppg.ts";
import type { PdfRow } from "./types.ts";

function row(parts: [number, string][]): PdfRow {
  return parts.map(([x, str]) => ({ x, str }));
}

const pageOne: PdfRow[] = [
  row([[535, "PAGE 1 OF 2"]]),
  row([[402, "INVOICE #"], [463, "811620018081"]]),
  row([[104, "IRONWOOD COMMERCIAL"], [463, "24 Oct 2026"]]),
  row([[402, "DATE"]]),
  row([[41, "Item # / SAP #"], [137, "Description"], [389, "Qty"], [423, "Unit Price"], [544, "Amount"]]),
  row([[41, "MMM00408/EA"], [137, "SU CP-002-ESF MED SANDING SPONGE"], [396, "2"], [435, "$3.14"], [548, "$6.28"]]),
  row([[41, "00745039"]]),
  row([[41, "IXP20771/EA"], [137, "SXA110 GL STIX BONDING PRIMER IXP20771"], [396, "3"], [429, "$88.95"], [538, "$266.85"]]),
  row([[41, "00773521"]]),
  row([[41, "PPR00210/EA"], [137, "5GGSS 5 GALLON 4S BUCKET GRID PPR00210"], [396, "1"], [435, "$4.67"], [548, "$4.67"]]),
  row([[41, "00758429"]]),
  row([[41, "ABC12345/5GL"], [137, "SPEEDHIDE INT SATIN WHITE"], [396, "1"], [429, "$107.50"], [538, "$107.50"]]),
  row([[137, "SW 7006 EXTRA WHITE"]]),
  row([[498, "CONTINUED ON PAGE 2"]]),
];

const pageTwo: PdfRow[] = [
  row([[535, "PAGE 2 OF 2"]]),
  row([[489, "CONTINUED FROM PAGE 1"]]),
  row([[435, "INVOICE # 811620018081"]]),
  row([[36, "TERMS:"]]),
  row([[420, "Item Subtotal"], [543, "$332.40"]]),
  row([[420, "Eco Fee"], [552, "$1.95"]]),
  row([[420, "Sales Tax"], [547, "$28.84"]]),
  row([[420, "Total"], [543, "$363.19"]]),
];

test("PPG invoice keeps each price, a gallon primer, and the eco fee", () => {
  const invoices = parsePpgPages([pageOne, pageTwo]);
  assert.equal(invoices.length, 1);
  const invoice = invoices[0]!;
  assert.equal(invoice.vendorName, "PPG Paints");
  assert.equal(invoice.invoiceNo, "811620018081");
  assert.equal(invoice.invoiceDate, "10/24/2026");
  assert.equal(invoice.pageCount, 2);
  assert.equal(invoice.firstPage, 1);
  assert.equal(invoice.lastPage, 2);

  const sponge = invoice.lines[0]!;
  assert.equal(sponge.productId, "MMM00408");
  assert.equal(sponge.salesNumber, "00745039");
  assert.equal(sponge.section, "sundry");
  assert.equal(sponge.qty, 2);
  assert.equal(sponge.netPrice, 3.14);
  assert.equal(sponge.size, "EA");

  const primer = invoice.lines[1]!;
  assert.equal(primer.section, "paint_product");
  assert.equal(primer.sheen, "Primer");
  assert.equal(primer.size, "GALLON");
  assert.equal(primer.qty, 3);
  assert.equal(primer.netPrice, 88.95);

  const grid = invoice.lines[2]!;
  assert.equal(grid.section, "sundry");
  assert.equal(grid.size, "EA");
  assert.equal(grid.netPrice, 4.67);

  const satin = invoice.lines[3]!;
  assert.equal(satin.section, "paint_product");
  assert.equal(satin.sheen, "Satin");
  assert.equal(satin.size, "5GL");
  assert.equal(satin.color, "SW 7006 EXTRA WHITE");
  assert.equal(satin.netPrice, 107.5);

  const fee = invoice.lines.at(-1)!;
  assert.equal(fee.description, "Eco Fee");
  assert.equal(fee.catalogItem, false);
  assert.equal(fee.netPrice, 1.95);
  assert.equal(invoice.lines.some((line) => line.description === "Sales Tax"), false);
  assert.equal(invoice.total, 363.19);
  assert.equal(invoice.taxPercent, 8.625);
  assert.equal(paintFeeAmount(invoice.lines), 0);
  assert.equal(ecoFeeAmount(invoice.lines), 1.95);

  const pasted = foundationGridText(invoice.lines);
  assert.match(pasted, /SXA110 GL STIX BONDING PRIMER IXP20771\t3\t\t88\.95/);
  assert.match(pasted, /Eco Fee\t1\t\t1\.95/);
});
