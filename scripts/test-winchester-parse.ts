import { readFileSync } from "fs";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { normalizeProposalPdfText, importJobInfoFromProposalText } from "../src/lib/proposalPdfImport.ts";

GlobalWorkerOptions.workerSrc = new URL(
  "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

async function extractPdfPlainText(fileBytes: ArrayBuffer): Promise<string> {
  const doc = await getDocument({ data: fileBytes }).promise;
  const pageLines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rows: { x: number; y: number; str: string }[] = [];
    for (const raw of content.items) {
      if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
      const item = raw as { str: string; transform: number[] };
      if (!item.str?.trim() || item.transform.length < 6) continue;
      rows.push({ x: item.transform[4]!, y: item.transform[5]!, str: item.str });
    }
    rows.sort((a, b) => b.y - a.y || a.x - b.x);
    let group: typeof rows = [];
    let y0: number | null = null;
    const flush = () => {
      if (!group.length) return;
      pageLines.push(
        group
          .sort((a, b) => a.x - b.x)
          .map((g) => g.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    };
    for (const row of rows) {
      if (y0 === null || Math.abs(row.y - y0) <= 3) {
        group.push(row);
        if (y0 === null) y0 = row.y;
      } else {
        flush();
        group = [row];
        y0 = row.y;
      }
    }
    flush();
  }
  return pageLines.join("\n");
}

const path = "c:/Users/johno/Downloads/Ironwood  Builders 560 Winchester Paint.pdf";
const buf = readFileSync(path);
const text = await extractPdfPlainText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const pos = text.indexOf("Proposal To:");
console.log("--- after Proposal To ---");
console.log(text.slice(pos, pos + 1200));
console.log("\n--- RESULT ---");
console.log(JSON.stringify(importJobInfoFromProposalText(text, "Ironwood  Builders 560 Winchester Paint.pdf"), null, 2));
