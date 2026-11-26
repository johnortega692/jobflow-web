import assert from "node:assert/strict";
import test from "node:test";
import { invoiceReaderIdFromFileName } from "./invoiceFileVendor.ts";

test("invoice file names pick Dunn Edwards, PPG, and Sherwin Williams", () => {
  assert.equal(invoiceReaderIdFromFileName("DE2007A13711.pdf"), "dunn-edwards");
  assert.equal(invoiceReaderIdFromFileName("PPC_Invoices_322551370000_p.pdf"), "ppg");
  assert.equal(invoiceReaderIdFromFileName("INVOICES-E_20261103093724_.pdf"), "sherwin-williams");
  assert.equal(invoiceReaderIdFromFileName("notes.pdf"), null);
});
