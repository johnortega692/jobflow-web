import assert from "node:assert/strict";
import test from "node:test";
import { parseDunnEdwards } from "./dunnEdwards.ts";
import { foundationGridHtml, foundationGridText } from "./foundationGrid.ts";
import { ecoFeeAmount, paintFeeAmount } from "./invoiceCharges.ts";
import type { PdfRow } from "./types.ts";

function row(parts: [number, string][]): PdfRow {
  return parts.map(([x, str]) => ({ x, str }));
}

const invoiceRows: PdfRow[] = [
  row([[263, "INVOICE"], [509, "Page: 1 of"], [565, "1"]]),
  row([[3, "DUNN-EDWARDS CORPORATION"]]),
  row([[320, "Delivery Date: 10/26/2026"]]),
  row([
    [7, "Reference"],
    [79, "Account No."],
    [158, "Purchase Order"],
    [266, "Written By"],
    [346, "Ship Via"],
    [432, "Order Date"],
    [511, "Store"],
  ]),
  row([
    [7, "2006A22291"],
    [79, "6209371"],
    [158, "1125-005"],
    [266, "Touby Keop"],
    [346, "Customer Pick-up"],
    [432, "10/26/2026"],
    [511, "006"],
  ]),
  row([
    [7, "Stock No."],
    [94, "Description"],
    [320, "QTY"],
    [386, "Unit"],
    [448, "Price"],
    [507, "Amount"],
    [556, "T"],
  ]),
  row([
    [7, "SWLL30-1-L-5"],
    [94, "SPARTAWALL INT ES L BASE"],
    [333, "1"],
    [386, "5GL"],
    [432, "107.50"],
    [504, "107.50"],
    [556, "T"],
  ]),
  row([[94, "[BM] OC-152 SUPER WHITE"]]),
  row([
    [7, "MEMO"],
    [94, "0007-0116-08261"],
    [333, "0"],
    [391, "EA"],
    [444, "0.00"],
    [516, "0.00"],
  ]),
  row([
    [7, "PCF-R-L-5"],
    [94, "PAINTCARE FEE"],
    [333, "1"],
    [391, "EA"],
    [444, "1.50"],
    [516, "1.50"],
    [556, "T"],
  ]),
  row([
    [7, "VNPL00-0-WH-5"],
    [94, "VINYLASTIC PLUS INT PRIMER WH"],
    [333, "1"],
    [386, "5GL"],
    [438, "57.00"],
    [510, "57.00"],
    [556, "T"],
  ]),
  row([[7, "PCF-R-L-5"], [94, "PAINTCARE FEE"], [333, "1"], [391, "EA"], [444, "1.50"], [516, "1.50"]]),
  row([[367, "Subtotal:"], [483, "167.50"]]),
  row([[367, "Tax: 9.00 %"], [488, "15.07"]]),
  row([[367, "Total Amount:"], [464, "$"], [483, "182.57"]]),
];

test("Dunn Edwards invoice keeps paint lines and fees for Foundation", () => {
  const parsed = parseDunnEdwards(invoiceRows);
  assert.ok(parsed);
  assert.equal(parsed.vendorName, "Dunn Edwards");
  assert.equal(parsed.invoiceNo, "2006A22291");
  assert.equal(parsed.invoiceDate, "10/26/2026");
  assert.equal(parsed.pageCount, 1);
  assert.equal(parsed.total, 182.57);
  assert.equal(parsed.taxPercent, 9);
  assert.equal(paintFeeAmount(parsed.lines), 3);
  assert.equal(ecoFeeAmount(parsed.lines), 0);
  assert.deepEqual(
    parsed.lines.filter((line) => line.catalogItem !== false).map((line) => [line.section, line.productId, line.sheen, line.netPrice, line.color]),
    [
      ["paint_product", "SWLL30-1-L-5", "Eggshell", 107.5, "[BM] OC-152 SUPER WHITE"],
      ["paint_product", "VNPL00-0-WH-5", "Primer", 57, ""],
    ],
  );
  assert.equal(foundationGridText(parsed.lines), [
    "SPARTAWALL INT ES L BASE\t1\t\t107.50",
    "PAINTCARE FEE\t1\t\t3.00",
    "VINYLASTIC PLUS INT PRIMER WH\t1\t\t57.00",
  ].join("\r\n"));
  assert.equal(
    foundationGridHtml(parsed.lines),
    "<table><tr><td>SPARTAWALL INT ES L BASE</td><td>1</td><td></td><td>107.50</td></tr><tr><td>PAINTCARE FEE</td><td>1</td><td></td><td>3.00</td></tr><tr><td>VINYLASTIC PLUS INT PRIMER WH</td><td>1</td><td></td><td>57.00</td></tr></table>",
  );
});
