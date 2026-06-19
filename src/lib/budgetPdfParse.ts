/** Extract line items from a Job Cost Summary PDF — port of ``budget_maker.parse_pdf``. */

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { BudgetScanLine } from "../types/budgetMaker";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const CATEGORY_HEADER_PATTERNS: { pattern: RegExp; category: string }[] = [
  { pattern: /Material\s+Acct\.?\s*Code/i, category: "Material" },
  { pattern: /Labor\s+Acct\.?\s*Code/i, category: "Labor" },
  { pattern: /Equip(?:ment)?\s+Acct\.?\s*Code/i, category: "Equipment" },
  { pattern: /Other\s+Acct\.?\s*Code/i, category: "Other" },
  { pattern: /Sub(?:contractor)?\s+Acct\.?\s*Code/i, category: "Subcontractor" },
];

const NUM = String.raw`-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?`;
const UOM = String.raw`(?:EA|LF|SF|LY|SY|CY|HR|MO|LS|GAL)`;
const QTY_UOM = String.raw`(?<qty>${NUM})\s*(?<uom>${UOM})`;

const LINE_RE = new RegExp(
  String.raw`^\s*(?<code>\d{2,5})\s+(?<desc>.+?)\s+${QTY_UOM}\s+(?<unit>${NUM})\s+(?<amount>${NUM})(?:\s+(?<crew>${NUM})\s+(?<man>${NUM})\s+(?<prod>${NUM}))?\s*$`,
);

const LINE_NO_UNIT_RE = new RegExp(
  String.raw`^\s*(?<code>\d{2,5})\s+(?<desc>.+?)\s+${QTY_UOM}\s+(?<amount>${NUM})\s*$`,
);

const LINE_UOM_AMOUNT_RE = new RegExp(
  String.raw`^\s*(?<code>\d{2,5})\s+(?<desc>.+?)\s+(?<uom>${UOM})\s+(?<amount>${NUM})\s*$`,
);

const LINE_NOQTY_RE = new RegExp(
  String.raw`^\s*(?<code>\d{2,5})\s+(?<desc>.+?)\s+(?<amount>${NUM})\s+(?<crew>${NUM})\s+(?<man>${NUM})(?:\s+(?<prod>${NUM}))?\s*$`,
);

const SECTION_RE = /^\s*(\d{2,5})\s*$/;
const TOTAL_RE = /Totals?\s/i;

type PdfTextItem = {
  str: string;
  transform: number[];
};

/** Rebuild logical lines from pdf.js text fragments (matches pdfplumber layout). */
function linesFromPdfTextItems(items: unknown[], tolerance = 3): string[] {
  const rows: { x: number; y: number; str: string }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as PdfTextItem;
    if (!item.str?.trim()) continue;
    const t = item.transform;
    if (!t || t.length < 6) continue;
    rows.push({ x: t[4], y: t[5], str: item.str });
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

function toFloat(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

function detectCategory(line: string): string | null {
  for (const { pattern, category } of CATEGORY_HEADER_PATTERNS) {
    if (pattern.test(line)) return category;
  }
  return null;
}

function parsePdfLine(line: string, category: string): Omit<BudgetScanLine, "id" | "Bucket" | "Notes" | "Hidden"> | null {
  let m = LINE_RE.exec(line);
  if (m?.groups) {
    return {
      Category: category,
      "PDF Code": m.groups.code,
      Description: m.groups.desc.trim(),
      Quantity: toFloat(m.groups.qty),
      UoM: m.groups.uom,
      "Unit Cost": toFloat(m.groups.unit),
      Amount: toFloat(m.groups.amount),
      "Man Hours": toFloat(m.groups.man),
    };
  }

  m = LINE_NO_UNIT_RE.exec(line);
  if (m?.groups) {
    return {
      Category: category,
      "PDF Code": m.groups.code,
      Description: m.groups.desc.trim(),
      Quantity: toFloat(m.groups.qty),
      UoM: m.groups.uom,
      "Unit Cost": null,
      Amount: toFloat(m.groups.amount),
      "Man Hours": null,
    };
  }

  m = LINE_UOM_AMOUNT_RE.exec(line);
  if (m?.groups) {
    return {
      Category: category,
      "PDF Code": m.groups.code,
      Description: m.groups.desc.trim(),
      Quantity: null,
      UoM: m.groups.uom,
      "Unit Cost": null,
      Amount: toFloat(m.groups.amount),
      "Man Hours": null,
    };
  }

  m = LINE_NOQTY_RE.exec(line);
  if (m?.groups && category === "Labor") {
    return {
      Category: category,
      "PDF Code": m.groups.code,
      Description: m.groups.desc.trim(),
      Quantity: null,
      UoM: "",
      "Unit Cost": null,
      Amount: toFloat(m.groups.amount),
      "Man Hours": toFloat(m.groups.man),
    };
  }

  return null;
}

export async function parseBudgetPdf(fileBytes: ArrayBuffer): Promise<BudgetScanLine[]> {
  const pdf = await getDocument({ data: new Uint8Array(fileBytes) }).promise;
  const rows: Omit<BudgetScanLine, "id" | "Bucket" | "Notes" | "Hidden">[] = [];
  let currentCategory = "Unknown";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageLines = linesFromPdfTextItems(content.items);

    for (const raw of pageLines) {
      const line = raw.trim();
      if (!line) continue;

      const category = detectCategory(line);
      if (category) {
        currentCategory = category;
        continue;
      }
      if (TOTAL_RE.test(line)) continue;
      if (SECTION_RE.test(line)) continue;

      const parsed = parsePdfLine(line, currentCategory);
      if (parsed) rows.push(parsed);
    }
  }

  return rows.map((row, idx) => ({
    ...row,
    id: `line-${idx}-${crypto.randomUUID()}`,
    Bucket: "",
    Notes: "",
    Hidden: false,
  }));
}

export function exportFilename(stem: string, extension: string, jobName = ""): string {
  const ext = extension.replace(/^\./, "");
  const job = jobName.trim().replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_");
  return job ? `${job}-${stem}.${ext}` : `${stem}.${ext}`;
}
