import assert from "node:assert/strict";
import test from "node:test";
import { compareInvoiceLines, type InvoiceCatalogItem } from "./compareInvoice.ts";
import type { InvoiceLine } from "./types.ts";

function item(partial: Pick<InvoiceCatalogItem, "id" | "name" | "productId"> & Partial<InvoiceCatalogItem>): InvoiceCatalogItem {
  return {
    section: "sundry",
    category: "Brushes",
    akas: [],
    unitCost: 20,
    sheenCosts: {},
    sheens: [],
    vendorNames: ["Dunn Edwards"],
    ...partial,
  };
}

function line(partial: Partial<InvoiceLine>): InvoiceLine {
  return {
    salesNumber: "",
    size: "EA",
    productId: "",
    description: "",
    color: "",
    qty: 1,
    listPrice: 28.79,
    discountAmount: 0,
    discountPercent: null,
    netPrice: 28.79,
    section: "sundry",
    sheen: null,
    ...partial,
  };
}

const three = item({ id: "three", name: 'EXCALIBUR ANGLE BRUSH 3"', productId: "COR-20560-3" });
const two = item({ id: "two", name: 'EXCALIBUR ANGLE BRUSH 2.5"', productId: "COR-20560-25" });

test("the 3 inch brush matches and the 2.5 inch brush does not", () => {
  const rows = compareInvoiceLines([line({ productId: "COR-20560-3", description: 'EXCALIBUR ANGLE BRUSH 3"' })], [two, three], {}, "Dunn Edwards");
  assert.equal(rows[0]?.item?.id, "three");
});

test("a shorter invoice stock number still finds the catalog product id", () => {
  const rows = compareInvoiceLines([line({ productId: "20560-3", description: "ANGLE BRUSH" })], [two, three], {}, "Dunn Edwards");
  assert.equal(rows[0]?.item?.id, "three");
});

test("an also-known-as name matches the invoice wording", () => {
  const named = item({
    id: "aka",
    name: "Corona Angular Brush 3in",
    productId: "COR-20565-3",
    akas: ['EXCALIBUR ANGLE BRUSH 3"'],
  });
  const rows = compareInvoiceLines([line({ description: 'EXCALIBUR ANGLE BRUSH 3"' })], [named], {}, "Dunn Edwards");
  assert.equal(rows[0]?.item?.id, "aka");
});
