import assert from "node:assert/strict";
import test from "node:test";
import { parseWolfGordonPages } from "./wolfGordon.ts";
import type { PdfRow } from "./types.ts";

function row(parts: [number, string][]): PdfRow {
  return parts.map(([x, str]) => ({ x, str }));
}

const pageOne: PdfRow[] = [
  row([[41, "Invoice 1421614"], [426, "1151 — Crusoe 2nd Floor"]]),
  row([[41, "Invoice Date:"], [145, "Order Date:"]]),
  row([[41, "11/10/2026"], [145, "11/9/2026"]]),
  row([[41, "Invoice ID:"], [145, "WG Order ID:"]]),
  row([[41, "INV1421614"], [145, "SO2792292"]]),
  row([[36, "ITEM"], [403, "QUANTITY"], [449, "UNIT"], [493, "PRICE"], [541, "AMOUNT"]]),
  row([[114, "SM2000-15"], [434, "1"], [452, "GL"], [480, "$336.75"], [539, "$336.75"]]),
  row([[114, "Metalli Coat 2000 1GL"]]),
  row([[114, "Paint Color:"], [165, "SM8109"]]),
  row([[114, "This item is non-cancelable and non-returnable"]]),
  row([[114, "SM400-15"], [434, "1"], [452, "GL"], [480, "$175.00"], [539, "$175.00"]]),
  row([[114, "Ultra Clear Satin 1GL"]]),
  row([[114, "This item is non-cancelable and non-returnable"]]),
  row([[114, "SM330-11"], [434, "1"], [452, "GL"], [485, "$98.25"], [544, "$98.25"]]),
  row([[114, "PrimeMaster Bonding 1GL"]]),
  row([[285, "1 of 2"]]),
];

const pageTwo: PdfRow[] = [
  row([[41, "Invoice 1421614"]]),
  row([[36, "ITEM"], [403, "QUANTITY"], [449, "UNIT"], [493, "PRICE"], [541, "AMOUNT"]]),
  row([[425, "Subtotal"], [539, "$610.00"]]),
  row([[431, "Freight"], [544, "$59.61"]]),
  row([[390, "Tax Total (9.75%)"], [544, "$59.49"]]),
  row([[441, "Total"], [539, "$729.10"]]),
  row([[406, "Amount Paid"], [549, "$0.00"]]),
  row([[408, "Amount Due"], [539, "$729.10"]]),
  row([[285, "2 of 2"]]),
];

test("a Wolf Gordon invoice keeps the coatings, the color, freight, and the printed tax", () => {
  const invoices = parseWolfGordonPages([pageOne, pageTwo]);
  assert.equal(invoices.length, 1);
  const invoice = invoices[0]!;
  assert.equal(invoice.vendorName, "Wolf Gordon");
  assert.equal(invoice.invoiceNo, "INV1421614");
  assert.equal(invoice.invoiceDate, "11/10/2026");
  assert.equal(invoice.pageCount, 2);
  assert.equal(invoice.firstPage, 1);
  assert.equal(invoice.lastPage, 2);
  assert.equal(invoice.total, 729.1);
  assert.equal(invoice.taxPercent, 9.75);

  assert.equal(invoice.lines.length, 4);
  const coat = invoice.lines[0]!;
  assert.equal(coat.productId, "SM2000-15");
  assert.equal(coat.description, "Metalli Coat 2000 1GL");
  assert.equal(coat.color, "SM8109");
  assert.equal(coat.qty, 1);
  assert.equal(coat.size, "GALLON");
  assert.equal(coat.section, "paint_product");
  assert.equal(coat.netPrice, 336.75);

  const satin = invoice.lines[1]!;
  assert.equal(satin.productId, "SM400-15");
  assert.equal(satin.description, "Ultra Clear Satin 1GL");
  assert.equal(satin.sheen, "Satin");
  assert.equal(satin.netPrice, 175);

  const primer = invoice.lines[2]!;
  assert.equal(primer.productId, "SM330-11");
  assert.equal(primer.description, "PrimeMaster Bonding 1GL");
  assert.equal(primer.netPrice, 98.25);

  const freight = invoice.lines[3]!;
  assert.equal(freight.description, "Freight");
  assert.equal(freight.netPrice, 59.61);
  assert.equal(freight.catalogItem, false);
});
