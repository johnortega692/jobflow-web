import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfTextItem = {
  str: string;
  transform: number[];
};

function linesFromPdfTextItems(items: unknown[], tolerance = 3): string[] {
  const rows: { x: number; y: number; str: string }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as PdfTextItem;
    if (!item.str?.trim()) continue;
    const t = item.transform;
    if (!t || t.length < 6) continue;
    rows.push({ x: t[4]!, y: t[5]!, str: item.str });
  }
  rows.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: string[] = [];
  let group: typeof rows = [];
  let y0: number | null = null;

  function flush() {
    if (!group.length) return;
    lines.push(
      group
        .sort((a, b) => a.x - b.x)
        .map((g) => g.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  for (const row of rows) {
    if (y0 === null || Math.abs(row.y - y0) <= tolerance) {
      group.push(row);
      if (y0 === null) y0 = row.y;
    } else {
      flush();
      group = [row];
      y0 = row.y;
    }
  }
  flush();
  return lines;
}

/** Extract plain text from a searchable PDF (all pages, line-oriented). */
export async function extractPdfPlainText(fileBytes: ArrayBuffer): Promise<string> {
  const doc = await getDocument({ data: fileBytes }).promise;
  const pageLines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageLines.push(...linesFromPdfTextItems(content.items));
  }
  return pageLines.join("\n");
}
