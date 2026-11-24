import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { stampInvoicePdf, stampInvoicePdfMany } from "./invoiceStamp.ts";
import { bumpJobCount, mergeCustomCode, notesForJob, sequenceUsedInNotes } from "./invoiceStampData.ts";

function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const parts = [raw.toString("latin1")];
  const marker = Buffer.from("stream\n");
  let index = 0;
  while (index < raw.length) {
    const start = raw.indexOf(marker, index);
    if (start < 0) break;
    const dataStart = start + marker.length;
    const end = raw.indexOf(Buffer.from("\nendstream"), dataStart);
    if (end < 0) break;
    try {
      parts.push(inflateSync(raw.subarray(dataStart, end)).toString("latin1"));
    } catch {
      parts.push(raw.subarray(dataStart, end).toString("latin1"));
    }
    index = end + 10;
  }
  return parts.join("\n").replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => {
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return out;
  });
}

const sampleStamp = {
  gl: "52000",
  job: "1124-001",
  costCode: "970 - Paint Materials",
  costClass: "2 - Materials",
  approved: "John Ortega",
  notes: "Approved 1124-001-001",
};

test("a stamp is written at 6 pt from the GL, job, cost code, cost class, and approver", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const raw = await doc.save();
  const stamped = await stampInvoicePdf(raw, sampleStamp);
  const text = pdfText(stamped);
  assert.doesNotMatch(text, /1CBI/);
  assert.match(text, / 6 Tf/);
  assert.match(text, /52000/);
  assert.match(text, /1124-001/);
  assert.match(text, /970 - Paint Materials/);
  assert.match(text, /2 - Materials/);
  assert.match(text, /John Ortega/);
  assert.match(text, /Approved 1124-001-001/);
  const out = await PDFDocument.load(stamped);
  assert.equal(out.getPageCount(), 1);
});

test("the stamp is drawn where it was placed on the page", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const raw = await doc.save();
  const stamped = await stampInvoicePdf(raw, sampleStamp, {
    pageIndex: 0,
    x: 0.04,
    y: 0.5,
    width: 0.34,
    height: 0.2,
  });
  const text = pdfText(stamped);
  const placed = /1 0 0 1 ([\d.]+) [\d.]+ Tm/.exec(text);
  assert.ok(placed);
  assert.ok(Number(placed[1]) < 120);
});

test("every stamp on the page is written into the same PDF", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const raw = await doc.save();
  const stamped = await stampInvoicePdfMany(raw, [
    { fields: sampleStamp, placement: { pageIndex: 0, x: 0.62, y: 0.03, width: 0.35, height: 0.1 } },
    {
      fields: { ...sampleStamp, notes: "Approved 1124-001-002", costCode: "975 - Paint Shop Materials" },
      placement: { pageIndex: 0, x: 0.04, y: 0.03, width: 0.35, height: 0.1 },
    },
  ]);
  const text = pdfText(stamped);
  assert.match(text, /Approved 1124-001-001/);
  assert.match(text, /Approved 1124-001-002/);
  assert.match(text, /975 - Paint Shop Materials/);
});

test("the stamp waits until every field is filled in", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const raw = await doc.save();
  await assert.rejects(
    () => stampInvoicePdf(raw, { ...sampleStamp, costCode: "" }),
    /before stamping/,
  );
});

test("notes number the next approval for that job", () => {
  assert.equal(notesForJob("1124-001", 0), "Approved 1124-001-001");
  assert.equal(notesForJob("1124-001", 3), "Approved 1124-001-004");
  assert.equal(sequenceUsedInNotes("1124-001", "Approved 1124-001-003"), 3);
  assert.equal(sequenceUsedInNotes("1124-001", "Call the shop"), null);
});

test("a remembered custom code is kept once, and the job count only moves forward", () => {
  assert.deepEqual(mergeCustomCode(["880 - Extra"], "880 - Extra", true), ["880 - Extra"]);
  assert.deepEqual(mergeCustomCode([], "970 - Paint Materials", true), []);
  assert.deepEqual(mergeCustomCode([], "881 - Shop", true), ["881 - Shop"]);
  assert.equal(bumpJobCount({ "1124-001": 4 }, "1124-001", "Approved 1124-001-002"), null);
  assert.deepEqual(bumpJobCount({ "1124-001": 1 }, "1124-001", "Approved 1124-001-003"), { "1124-001": 3 });
});
