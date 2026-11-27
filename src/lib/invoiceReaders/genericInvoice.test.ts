import assert from "node:assert/strict";
import test from "node:test";
import { customReaderId, parseGenericInvoicePages, reservedInvoiceVendor, vendorNameInText } from "./genericInvoice.ts";
import type { PdfRow } from "./types.ts";

function row(parts: [number, string][]): PdfRow {
  return parts.map(([x, str]) => ({ x, str }));
}

const vendor = { id: "custom-northwind-supply", vendorName: "Northwind Supply", catalog: false };

const page: PdfRow[] = [
  row([[40, "Northwind Supply"], [420, "INVOICE"]]),
  row([[40, "Invoice Number"], [160, "44021"]]),
  row([[40, "Invoice Date"], [160, "11/02/2026"]]),
  row([[40, "ITEM"], [300, "QTY"], [360, "UNIT"], [430, "PRICE"], [510, "AMOUNT"]]),
  row([[40, "NW-10 Blue tape"], [310, "2"], [365, "EA"], [430, "$4.50"], [510, "$9.00"]]),
  row([[40, "Freight"], [510, "$12.00"]]),
  row([[40, "Tax (8.25%)"], [510, "$1.73"]]),
  row([[40, "Total"], [510, "$22.73"]]),
];

test("a new vendor invoice keeps the item, the fee, and the printed tax", () => {
  const invoices = parseGenericInvoicePages([page], vendor);
  assert.equal(invoices.length, 1);
  const invoice = invoices[0]!;
  assert.equal(invoice.invoiceNo, "44021");
  assert.equal(invoice.invoiceDate, "11/02/2026");
  assert.equal(invoice.total, 22.73);
  assert.equal(invoice.taxPercent, 8.25);
  assert.equal(invoice.lines.length, 2);
  assert.equal(invoice.lines[0]?.productId, "NW-10");
  assert.equal(invoice.lines[0]?.description, "Blue tape");
  assert.equal(invoice.lines[0]?.qty, 2);
  assert.equal(invoice.lines[0]?.netPrice, 4.5);
  assert.equal(invoice.lines[1]?.description, "Freight");
  assert.equal(invoice.lines[1]?.netPrice, 12);
  assert.equal(invoice.lines[1]?.catalogItem, false);
});

test("a custom vendor id comes from the name and built-in vendors stay reserved", () => {
  assert.equal(customReaderId("Northwind Supply"), "custom-northwind-supply");
  assert.equal(reservedInvoiceVendor("Wolf Gordon"), true);
  assert.equal(reservedInvoiceVendor("Northwind Supply"), false);
  assert.equal(vendorNameInText("Northwind Supply", "Sold by Northwind Supply\nInvoice 1"), true);
  assert.equal(vendorNameInText("Northwind Supply", "Sherwin Williams invoice"), false);
});

const whitecap = { id: "custom-whitecap", vendorName: "Whitecap", catalog: false };

const whitecapPage: PdfRow[] = [
  row([[534, "INVOICE"]]),
  row([[504, "INVOICE"], [535, "NUMBER"]]),
  row([[507, "50040021311"]]),
  row([[510, "INVOICE"], [541, "DATE"]]),
  row([[512, "10/07/2026"]]),
  row([[20, "LINE"], [60, "PART"], [78, "NUMBER"], [204, "DESCRIPTION"], [333, "QTY"], [347, "ORD"], [377, "UNIT"], [393, "PRICE"], [428, "QTY"], [442, "BKO"], [469, "QTY"], [483, "SHP"], [515, "EXTENDED"], [574, "TAX"]]),
  row([[522, "PRICE"], [574, "AMT"]]),
  row([[25, "0"], [43, "HDRDESC"], [345, "1"], [397, "0"], [440, "0"], [480, "1"], [543, "0.00"]]),
  row([[123, "DELIVERY"], [165, "TAG#:"], [190, "42987792"]]),
  row([[25, "1"], [43, "12137005"], [123, "MED-LG"], [156, "SERIES"], [188, "1"], [195, "HARNESS"], [345, "3"], [381, "60.99"], [410, "EA"], [440, "0"], [480, "3"], [535, "182.97"], [579, "17.83"]]),
  row([[125, "LEGS"], [149, "GUARDIAN"], [193, "FALL"]]),
  row([[25, "5"], [43, "7611801838"], [123, "16OZ"], [145, "CLEAR"], [174, "M1800"], [343, "24"], [385, "7.45"], [410, "EA"], [440, "0"], [478, "24"], [535, "178.80"], [579, "17.43"]]),
  row([[125, "MARKING"], [165, "PAINT"]]),
  row([[54, "The"], [70, "White"], [93, "Cap"], [110, "Family"], [135, "of"], [144, "Brands"]]),
  row([[433, "TOTAL"], [461, "GROSS"], [568, "1,214.29"]]),
  row([[433, "TOTAL"], [461, "TAX"], [575, "118.38"]]),
  row([[433, "TOTAL"], [461, "INVOICE"], [564, "1,332.67"]]),
];

test("a Whitecap invoice uses the shipped quantity and extended price", () => {
  const invoices = parseGenericInvoicePages([whitecapPage], whitecap);
  assert.equal(invoices.length, 1);
  const invoice = invoices[0]!;
  assert.equal(invoice.invoiceNo, "50040021311");
  assert.equal(invoice.invoiceDate, "10/07/2026");
  assert.equal(invoice.total, 1332.67);
  assert.equal(invoice.taxPercent, 9.749);
  assert.equal(invoice.lines.length, 2);
  const harness = invoice.lines[0]!;
  assert.equal(harness.productId, "12137005");
  assert.equal(harness.description, "MED-LG SERIES 1 HARNESS LEGS GUARDIAN FALL");
  assert.equal(harness.qty, 3);
  assert.equal(harness.size, "EA");
  assert.equal(harness.netPrice, 60.99);
  const paint = invoice.lines[1]!;
  assert.equal(paint.productId, "7611801838");
  assert.equal(paint.description, "16OZ CLEAR M1800 MARKING PAINT");
  assert.equal(paint.qty, 24);
  assert.equal(paint.netPrice, 7.45);
});
