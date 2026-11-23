import assert from "node:assert/strict";
import test from "node:test";
import { compareInvoiceLines, invoiceComparePrice, invoiceLinkChoices } from "./compareInvoice.ts";
import { ecoFeeAmount, paintFeeAmount } from "./invoiceCharges.ts";
import { parseSherwinWilliams, parseSherwinWilliamsPages } from "./sherwinWilliams.ts";
import type { PdfRow } from "./types.ts";
import type { InvoiceCatalogItem } from "./compareInvoice.ts";

function row(parts: [number, string][]): PdfRow {
  return parts.map(([x, str]) => ({ x, str }));
}

const invoiceRows: PdfRow[] = [
  row([[54, "THE SHERWIN-WILLIAMS CO."]]),
  row([[474, "No."], [497, "51080193851126"]]),
  row([[474, "DATE: 11/06/2026"]]),
  row([[474, "PAGE NN OF NNN"]]),
  row([[474, "PAGE 1 OF 1"]]),
  row([
    [20, "SALES NUMBER"],
    [96, "SIZE"],
    [135, "PRODUCT"],
    [189, "DESCRIPTION"],
    [471, "QTY"],
    [514, "PRICE"],
    [560, "VALUE"],
  ]),
  row([
    [30, "6514-38368"],
    [88, "GALLON"],
    [136, "B66T3154"],
    [190, "PI DTM SG ULTRA"],
    [484, "1"],
    [518, "37.80"],
    [567, "37.80"],
  ]),
  row([[189, "Color: SW6258 TRICORN BLACK"]]),
  row([
    [35, "597-4167"],
    [93, "EACH"],
    [136, "559372000"],
    [190, "BG2 4 SIDED 2G GRID"],
    [484, "1"],
    [523, "4.49"],
    [571, "4.49"],
  ]),
  row([[189, "DISCOUNT (% 15.00)"], [569, "-0.67"]]),
  row([
    [35, "180-6959"],
    [93, "EACH"],
    [136, "996959140"],
    [190, '14" MR FRAME(6-1/2")'],
    [484, "1"],
    [523, "4.79"],
    [571, "4.79"],
  ]),
  row([[189, "DISCOUNT (% 15.00)"], [569, "-0.72"]]),
  row([
    [30, "6514-14021"],
    [91, "2 INCH"],
    [190, 'SW 2" POLY ANGLE SAS'],
    [484, "1"],
    [518, "12.99"],
    [567, "12.99"],
  ]),
  row([[189, "DISCOUNT (% 15.00)"], [569, "-1.95"]]),
  row([
    [35, "160-8769"],
    [93, "EACH"],
    [136, "02GLSWM"],
    [190, "2GAL PLAST PAIL"],
    [484, "1"],
    [523, "7.79"],
    [571, "7.79"],
  ]),
  row([[189, "DISCOUNT (% 15.00)"], [569, "-1.17"]]),
  row([[378, "SUBTOTAL BEFORE TAX"], [565, "63.35"]]),
  row([[380, "10.000% SALES TAX:1-059513100"], [570, "6.34"]]),
  row([[378, "CHARGE"], [561, "$69.69"]]),
];

function item(partial: Partial<InvoiceCatalogItem> & Pick<InvoiceCatalogItem, "id" | "section" | "name">): InvoiceCatalogItem {
  return {
    category: "",
    productId: "",
    akas: [],
    unitCost: null,
    sheenCosts: {},
    sheens: [],
    vendorNames: [],
    ...partial,
  };
}

test("Sherwin Williams invoice lines keep net price after the line discount", () => {
  const parsed = parseSherwinWilliams(invoiceRows);
  assert.ok(parsed);
  assert.equal(parsed.vendorName, "Sherwin Williams");
  assert.equal(parsed.invoiceNo, "51080193851126");
  assert.equal(parsed.invoiceDate, "11/06/2026");
  assert.equal(parsed.pageCount, 1);
  assert.equal(parsed.firstPage, 1);
  assert.equal(parsed.lastPage, 1);
  assert.equal(parsed.total, 69.69);
  assert.equal(parsed.taxPercent, 10);
  assert.equal(paintFeeAmount(parsed.lines), 0);
  assert.equal(ecoFeeAmount(parsed.lines), 0);
  assert.deepEqual(
    parsed.lines.map((line) => [line.section, line.productId || line.salesNumber, line.sheen, line.netPrice, line.color]),
    [
      ["paint_product", "B66T3154", "Semi-Gloss", 37.8, "SW6258 TRICORN BLACK"],
      ["sundry", "559372000", null, 3.82, ""],
      ["sundry", "996959140", null, 4.07, ""],
      ["sundry", "6514-14021", null, 11.04, ""],
      ["sundry", "02GLSWM", null, 6.62, ""],
    ],
  );
});

test("a quart of Bondo floor patch stays a sundry", () => {
  const parsed = parseSherwinWilliams([
    ...invoiceRows.slice(0, 6),
    row([
      [30, "6501-16870"],
      [88, "QUART"],
      [136, "A4916870"],
      [190, "BONDO ALLPURP FLR QT"],
      [484, "1"],
      [518, "22.89"],
      [567, "22.89"],
    ]),
    row([[189, "DISCOUNT (% 15.00)"], [569, "-3.43"]]),
    row([[378, "SUBTOTAL BEFORE TAX"], [565, "19.46"]]),
  ]);
  assert.ok(parsed);
  const line = parsed.lines[0]!;
  assert.equal(line.section, "sundry");
  assert.equal(line.sheen, null);
  assert.equal(line.productId, "A4916870");
  assert.equal(line.netPrice, 19.46);
});

test("a Sherwin Williams paint fee stays on the bill and out of the catalog compare", () => {
  const parsed = parseSherwinWilliams([
    ...invoiceRows.slice(0, 6),
    row([[47, "10"], [190, "GOVT IMPOSED PAINT FEE"], [484, "2"], [523, "0.65"], [571, "1.30"]]),
    row([[47, "10"], [190, "GOVT IMPOSED PAINT FEE"], [484, "2"], [523, "0.65"], [571, "1.30"]]),
    row([[378, "SUBTOTAL BEFORE TAX"], [561, "1.30"]]),
    row([[382, "8.750% SALES TAX:1-059533000"], [565, "0.11"]]),
    row([[378, "CHARGE"], [556, "$1.41"]]),
  ]);
  assert.ok(parsed);
  const fees = parsed.lines.filter((line) => line.description === "GOVT IMPOSED PAINT FEE");
  assert.equal(fees.length, 1);
  const fee = fees[0]!;
  assert.equal(fee.catalogItem, false);
  assert.equal(fee.qty, 1);
  assert.equal(fee.netPrice, 2.6);
  assert.equal(paintFeeAmount(parsed.lines), 2.6);
  assert.equal(parsed.taxPercent, 8.75);
  assert.equal(parsed.total, 1.41);
  const compared = compareInvoiceLines(parsed.lines, [], {}, "Sherwin Williams");
  const feeRow = compared.find((row) => row.line.description === "GOVT IMPOSED PAINT FEE");
  assert.equal(feeRow?.kind, "fee");
  assert.equal(feeRow?.item, null);
});

test("catalog compare matches a sundry code, suggests a close name, and leaves unknown paint unmatched", () => {
  const parsed = parseSherwinWilliams(invoiceRows);
  assert.ok(parsed);
  const rows = compareInvoiceLines(parsed.lines, [
    item({
      id: "grid",
      section: "sundry",
      name: "2Gal Grid",
      productId: "BG2",
      unitCost: 3.82,
      vendorNames: ["Sherwin Williams"],
    }),
    item({
      id: "pail",
      section: "sundry",
      name: "2Gal Pail",
      productId: "BP2",
      unitCost: 8,
      vendorNames: [],
    }),
    item({
      id: "other-pail",
      section: "sundry",
      name: "2Gal Pail",
      productId: "02GLSWM",
      unitCost: 1,
      vendorNames: ["Dunn Edwards"],
    }),
    item({
      id: "dtm",
      section: "paint_product",
      name: "DTM Acrylic",
      category: "Sherwin Williams",
      sheens: ["Semi-Gloss"],
      sheenCosts: { "Semi-Gloss": 42.51 },
      vendorNames: ["Sherwin Williams"],
    }),
    item({
      id: "other-grid",
      section: "sundry",
      name: "Other Grid",
      productId: "559372000",
      unitCost: 1,
      vendorNames: ["Dunn Edwards"],
    }),
  ], {}, "Sherwin Williams");

  assert.equal(rows[0]?.kind, "missing");
  assert.equal(rows[1]?.kind, "match");
  assert.equal(rows[1]?.item?.id, "grid");
  assert.equal(rows[1]?.samePrice, true);
  assert.equal(rows[3]?.kind, "missing");
  assert.equal(rows[4]?.kind, "missing");
  assert.equal(rows[4]?.item, null);
});

test("find item includes a product saved for all vendors and keeps that link", () => {
  const open = item({ id: "open", section: "sundry", name: "Acetone", productId: "124-2197", vendorNames: [] });
  const other = item({ id: "de", section: "sundry", name: "Acetone DE", productId: "124-2197", vendorNames: ["Dunn Edwards"] });
  const sw = item({ id: "sw", section: "sundry", name: "Acetone SW", productId: "124-2198", vendorNames: ["Sherwin Williams"] });
  const choices = invoiceLinkChoices([open, other, sw], "Sherwin Williams", "sundry", "acetone");
  assert.deepEqual(choices.map((choice) => choice.id).sort(), ["open", "sw"]);

  const line = {
    salesNumber: "",
    size: "QT",
    productId: "124-2197",
    description: "ACETONE QT",
    color: "",
    qty: 1,
    listPrice: 10.4,
    discountAmount: 0,
    discountPercent: null,
    netPrice: 10.4,
    section: "sundry" as const,
    sheen: null,
  };
  assert.equal(compareInvoiceLines([line], [open], {}, "Sherwin Williams")[0]?.item, null);
  const linked = compareInvoiceLines([line], [open], {}, "Sherwin Williams", { ":0::124-2197": "open" });
  assert.equal(linked[0]?.item?.id, "open");
});

test("an AKA matches a sheen or tint name to one paint product", () => {
  const parsed = parseSherwinWilliams(invoiceRows);
  assert.ok(parsed);
  const rows = compareInvoiceLines([parsed.lines[0]!], [
    item({
      id: "dtm",
      section: "paint_product",
      name: "DTM Acrylic",
      akas: ["PI DTM SG ULTRA"],
      sheens: ["Semi-Gloss"],
      sheenCosts: { "Semi-Gloss": 42.51 },
      vendorNames: ["Sherwin Williams"],
    }),
  ], {}, "Sherwin Williams");
  assert.equal(rows[0]?.kind, "match");
  assert.equal(rows[0]?.item?.id, "dtm");
  assert.equal(rows[0]?.sheenKey, "Semi-Gloss");
});

test("a primer abbreviation uses the Primer price on a primer-only product", () => {
  const parsed = parseSherwinWilliams([
    row([[54, "THE SHERWIN-WILLIAMS CO."]]),
    row([[474, "No."], [497, "46554169361026"]]),
    row([[474, "DATE: 10/26/2026"]]),
    row([[474, "PAGE 1 OF 1"]]),
    row([
      [20, "SALES NUMBER"],
      [96, "SIZE"],
      [135, "PRODUCT"],
      [189, "DESCRIPTION"],
      [471, "QTY"],
      [514, "PRICE"],
      [560, "VALUE"],
    ]),
    row([
      [30, "6514-00001"],
      [88, "GALLON"],
      [136, "B28W8030"],
      [190, "PVA INT PRMR WHITE"],
      [484, "1"],
      [518, "10.80"],
      [567, "10.80"],
    ]),
    row([[378, "SUBTOTAL BEFORE TAX"], [565, "10.80"]]),
  ]);
  assert.ok(parsed);
  assert.equal(parsed.lines[0]?.sheen, "Primer");
  const rows = compareInvoiceLines(parsed.lines, [
    item({
      id: "pva",
      section: "paint_product",
      name: "PVA",
      akas: ["PVA INT PRMR WHITE"],
      sheens: ["Primer"],
      sheenCosts: { Primer: 12.14 },
      vendorNames: ["Sherwin Williams"],
    }),
  ], {}, "Sherwin Williams");
  assert.equal(rows[0]?.kind, "match");
  assert.equal(rows[0]?.sheenKey, "Primer");
  assert.equal(rows[0]?.catalogPrice, 12.14);
});

test("a 5 gallon invoice price divides to the 1 gallon catalog price", () => {
  const five = {
    salesNumber: "",
    size: "5GL",
    productId: "",
    description: "SPARTAWALL",
    color: "",
    qty: 1,
    listPrice: 107.5,
    discountAmount: 0,
    discountPercent: null,
    netPrice: 107.5,
    section: "paint_product" as const,
    sheen: "Eggshell",
  };
  assert.equal(invoiceComparePrice(five, true), 21.5);
  assert.equal(invoiceComparePrice(five, false), 107.5);
  assert.equal(invoiceComparePrice({ ...five, size: "GALLON", netPrice: 37.8 }, true), 37.8);
  assert.equal(invoiceComparePrice({ ...five, section: "sundry", size: "EA", netPrice: 6.62 }, true), 6.62);
});

test("a primer product still prices Primer when the invoice line names no sheen", () => {
  const rows = compareInvoiceLines([
    {
      salesNumber: "",
      size: "GALLON",
      productId: "",
      description: "PVA",
      color: "",
      qty: 1,
      listPrice: 10.8,
      discountAmount: 0,
      discountPercent: null,
      netPrice: 10.8,
      section: "paint_product",
      sheen: null,
    },
  ], [
    item({
      id: "pva",
      section: "paint_product",
      name: "PVA",
      sheens: ["Primer"],
      sheenCosts: { Primer: 12.14 },
      vendorNames: ["Sherwin Williams"],
    }),
  ], {}, "Sherwin Williams");
  assert.equal(rows[0]?.sheenKey, "Primer");
  assert.equal(rows[0]?.catalogPrice, 12.14);
});

test("a paint price matches without a sheen when every sheen has that price", () => {
  const rows = compareInvoiceLines([
    {
      salesNumber: "",
      size: "GALLON",
      productId: "A41W00151",
      description: "DURATION HOME",
      color: "",
      qty: 1,
      listPrice: 48,
      discountAmount: 0,
      discountPercent: null,
      netPrice: 48,
      section: "paint_product",
      sheen: null,
    },
  ], [
    item({
      id: "duration",
      section: "paint_product",
      name: "Duration Home",
      productId: "A41W00151",
      sheens: ["Flat", "Eggshell", "Semi-Gloss"],
      sheenCosts: { Flat: 48, Eggshell: 48, "Semi-Gloss": 48 },
      vendorNames: ["Sherwin Williams"],
    }),
  ], {}, "Sherwin Williams");
  assert.equal(rows[0]?.kind, "match");
  assert.equal(rows[0]?.sheenKey, null);
  assert.equal(rows[0]?.catalogPrice, null);
  assert.equal(rows[0]?.samePrice, false);
  assert.deepEqual(rows[0]?.sheenOptions?.map((option) => option.name), ["Flat", "Eggshell", "Semi-Gloss"]);
});

test("different sheen prices ask for a sheen until one is chosen", () => {
  const line = {
    salesNumber: "",
    size: "GALLON",
    productId: "A41W00151",
    description: "DURATION HOME",
    color: "",
    qty: 1,
    listPrice: 48,
    discountAmount: 0,
    discountPercent: null,
    netPrice: 48,
    section: "paint_product" as const,
    sheen: null,
  };
  const catalog = [
    item({
      id: "duration",
      section: "paint_product",
      name: "Duration Home",
      productId: "A41W00151",
      sheens: ["Flat", "Eggshell", "Semi-Gloss"],
      sheenCosts: { Flat: 40, Eggshell: 48, "Semi-Gloss": 52 },
      vendorNames: ["Sherwin Williams"],
    }),
  ];
  const waiting = compareInvoiceLines([line], catalog, {}, "Sherwin Williams");
  assert.equal(waiting[0]?.sheenKey, null);
  assert.equal(waiting[0]?.catalogPrice, null);
  assert.equal(waiting[0]?.samePrice, false);
  assert.deepEqual(waiting[0]?.sheenOptions?.map((option) => option.name), ["Flat", "Eggshell", "Semi-Gloss"]);

  const chosen = compareInvoiceLines([line], catalog, {}, "Sherwin Williams", {}, "", {}, { ":0::A41W00151": "Eggshell" });
  assert.equal(chosen[0]?.sheenKey, "Eggshell");
  assert.equal(chosen[0]?.catalogPrice, 48);
  assert.equal(chosen[0]?.samePrice, true);
  assert.deepEqual(chosen[0]?.sheenOptions?.map((option) => option.name), ["Flat", "Eggshell", "Semi-Gloss"]);
});

test("an invoice sheen word does not choose the catalog sheen", () => {
  const rows = compareInvoiceLines([
    {
      salesNumber: "",
      size: "GALLON",
      productId: "A41W00151",
      description: "DURATION HOME EGGSHELL",
      color: "",
      qty: 1,
      listPrice: 48,
      discountAmount: 0,
      discountPercent: null,
      netPrice: 48,
      section: "paint_product",
      sheen: "Eggshell",
    },
  ], [
    item({
      id: "duration",
      section: "paint_product",
      name: "Duration Home",
      productId: "A41W00151",
      sheens: ["Flat", "Eggshell", "Semi-Gloss"],
      sheenCosts: { Flat: 40, Eggshell: 48, "Semi-Gloss": 52 },
      vendorNames: ["Sherwin Williams"],
    }),
  ], {}, "Sherwin Williams");
  assert.equal(rows[0]?.sheenKey, null);
  assert.equal(rows[0]?.catalogPrice, null);
  assert.equal(rows[0]?.samePrice, false);
  assert.deepEqual(rows[0]?.sheenOptions?.map((option) => option.name), ["Flat", "Eggshell", "Semi-Gloss"]);
});

test("a PDF with two Sherwin Williams invoices stays split by PAGE n OF m", () => {
  const header = row([
    [20, "SALES NUMBER"],
    [96, "SIZE"],
    [135, "PRODUCT"],
    [189, "DESCRIPTION"],
    [471, "QTY"],
    [514, "PRICE"],
    [560, "VALUE"],
  ]);
  const paint = row([
    [30, "6514-38368"],
    [88, "GALLON"],
    [136, "B66T3154"],
    [190, "PI DTM SG ULTRA"],
    [484, "1"],
    [518, "10.00"],
    [567, "10.00"],
  ]);
  const grid = row([
    [35, "597-4167"],
    [93, "EACH"],
    [136, "559372000"],
    [190, "BG2 GRID"],
    [484, "1"],
    [523, "4.00"],
    [571, "4.00"],
  ]);
  const invoices = parseSherwinWilliamsPages([
    [
      row([[54, "THE SHERWIN-WILLIAMS CO."]]),
      row([[474, "No. 111111111111"]]),
      row([[474, "DATE: 11/01/2026"]]),
      row([[474, "PAGE NN OF NNN"]]),
      row([[474, "PAGE 1 OF 1"]]),
      header,
      paint,
      row([[378, "SUBTOTAL BEFORE TAX"], [565, "10.00"]]),
    ],
    [
      row([[474, "No. 222222222222"]]),
      row([[474, "DATE: 11/02/2026"]]),
      row([[474, "PAGE 1 OF 2"]]),
      header,
      paint,
    ],
    [
      row([[474, "No. 222222222222"]]),
      row([[474, "PAGE 2 OF 2"]]),
      header,
      grid,
      row([[378, "SUBTOTAL BEFORE TAX"], [565, "14.00"]]),
    ],
  ]);
  assert.equal(invoices.length, 2);
  assert.equal(invoices[0]?.invoiceNo, "111111111111");
  assert.equal(invoices[0]?.pageCount, 1);
  assert.equal(invoices[0]?.lines.length, 1);
  assert.equal(invoices[1]?.invoiceNo, "222222222222");
  assert.equal(invoices[1]?.pageCount, 2);
  assert.equal(invoices[1]?.firstPage, 1);
  assert.equal(invoices[1]?.lastPage, 2);
  assert.equal(invoices[1]?.lines.length, 2);
  assert.equal(invoices[1]?.lines[1]?.netPrice, 4);
});
