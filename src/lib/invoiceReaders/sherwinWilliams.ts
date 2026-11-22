import { combinePaintFeeLines, readInvoiceCharges } from "./invoiceCharges.ts";
import type { InvoiceLine, InvoiceReader, ParsedInvoice, PdfRow } from "./types.ts";

const SALES_NUMBER = /^\d{2,6}-\d{2,8}$/;
const MONEY = /^-?\d+\.\d{2}$/;

const SHEEN_RULES: { pattern: RegExp; sheen: string }[] = [
  { pattern: /\bSEMI[-\s]?GLOSS\b|\bS\/G\b|\bSG\b/i, sheen: "Semi-Gloss" },
  { pattern: /\bEGGSHELL\b|\bEGG\b|\bEG\b/i, sheen: "Eggshell" },
  { pattern: /\bHIGH\s+GLOSS\b|\bHG\b/i, sheen: "High Gloss" },
  { pattern: /\bLOW\s+LUSTRE\b|\bLOW\s+LUSTER\b/i, sheen: "Low Lustre" },
  { pattern: /\bLOW\s+SHEEN\b/i, sheen: "Low Sheen" },
  { pattern: /\bLOW\s+GLOSS\b/i, sheen: "Low Gloss" },
  { pattern: /\bNO\s+SHEEN\b/i, sheen: "No Sheen" },
  { pattern: /\bSATIN\b|\bSAT\b/i, sheen: "Satin" },
  { pattern: /\bVELVET\b/i, sheen: "Velvet" },
  { pattern: /\bMATTE\b/i, sheen: "Matte" },
  { pattern: /\bFLAT\b|\bFL\b/i, sheen: "Flat" },
  { pattern: /\bGLOSS\b|\bGL\b/i, sheen: "Gloss" },
  { pattern: /\bPRIMERS?\b|\bPRMR\b|\bPRM\b|\bPR\b/i, sheen: "Primer" },
];

type Column = "sales" | "size" | "product" | "description" | "qty" | "price" | "value";

const HEADER_WORDS: { label: string; column: Column }[] = [
  { label: "SALES NUMBER", column: "sales" },
  { label: "SIZE", column: "size" },
  { label: "PRODUCT", column: "product" },
  { label: "DESCRIPTION", column: "description" },
  { label: "QTY", column: "qty" },
  { label: "PRICE", column: "price" },
  { label: "VALUE", column: "value" },
];

function rowText(row: PdfRow): string {
  return row.map((frag) => frag.str).join(" ").replace(/\s+/g, " ").trim();
}

function money(raw: string): number | null {
  const text = raw.trim();
  if (!MONEY.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Patching compounds are sold by the quart and stay sundries. */
function isSundryMaterial(description: string): boolean {
  return /\b(BONDO|PATCH(?:ING)?|SPACKL(?:E|ING)|FILLERS?|CAULK(?:ING)?|SEALANTS?|PUTTY|DRYWALL|JOINT\s+COMPOUNDS?)\b/i.test(description);
}

function isPaintSize(size: string, description: string): boolean {
  if (isSundryMaterial(description)) return false;
  return /\b(GALLONS?|QUARTS?|PINTS?|GAL|QT|PT)\b/i.test(size);
}

function sheenFromDescription(description: string): string | null {
  for (const rule of SHEEN_RULES) {
    if (rule.pattern.test(description)) return rule.sheen;
  }
  return null;
}

function headerColumns(row: PdfRow): { column: Column; x: number }[] | null {
  const text = rowText(row).toUpperCase();
  if (!text.includes("SALES NUMBER") || !text.includes("DESCRIPTION") || !text.includes("PRICE")) return null;
  const found: { column: Column; x: number }[] = [];
  const used = new Set<number>();
  for (const header of HEADER_WORDS) {
    const words = header.label.split(" ");
    for (let i = 0; i < row.length; i++) {
      if (used.has(i)) continue;
      const single = row[i]!.str.replace(/\s+/g, " ").trim().toUpperCase();
      const joined = row.slice(i, i + words.length).map((frag) => frag.str).join(" ").replace(/\s+/g, " ").trim().toUpperCase();
      const span = single === header.label ? 1 : joined === header.label ? words.length : 0;
      if (!span) continue;
      found.push({ column: header.column, x: row[i]!.x });
      for (let j = 0; j < span; j++) used.add(i + j);
      break;
    }
  }
  if (!found.some((col) => col.column === "sales") || !found.some((col) => col.column === "price")) return null;
  return found.sort((a, b) => a.x - b.x);
}

function assignColumns(row: PdfRow, columns: { column: Column; x: number }[]): Record<Column, string> {
  const buckets: Record<Column, string[]> = {
    sales: [],
    size: [],
    product: [],
    description: [],
    qty: [],
    price: [],
    value: [],
  };
  for (const frag of row) {
    let best = columns[0]!;
    let bestDist = Infinity;
    for (const column of columns) {
      const dist = Math.abs(frag.x - column.x);
      if (dist < bestDist) {
        best = column;
        bestDist = dist;
      }
    }
    buckets[best.column].push(frag.str);
  }
  return {
    sales: buckets.sales.join(" ").replace(/\s+/g, " ").trim(),
    size: buckets.size.join(" ").replace(/\s+/g, " ").trim(),
    product: buckets.product.join(" ").replace(/\s+/g, " ").trim(),
    description: buckets.description.join(" ").replace(/\s+/g, " ").trim(),
    qty: buckets.qty.join(" ").replace(/\s+/g, " ").trim(),
    price: buckets.price.join(" ").replace(/\s+/g, " ").trim(),
    value: buckets.value.join(" ").replace(/\s+/g, " ").trim(),
  };
}

function finishLine(partial: {
  salesNumber: string;
  size: string;
  productId: string;
  description: string;
  color: string;
  qty: number;
  listPrice: number;
  discountAmount: number;
  discountPercent: number | null;
}): InvoiceLine {
  const qty = partial.qty > 0 ? partial.qty : 1;
  const net = Math.round((partial.listPrice + partial.discountAmount / qty) * 100) / 100;
  const paint = isPaintSize(partial.size, partial.description);
  return {
    ...partial,
    qty,
    netPrice: net,
    section: paint ? "paint_product" : "sundry",
    sheen: paint ? sheenFromDescription(partial.description) : null,
  };
}

function pageMark(rows: PdfRow[]): { page: number; total: number } | null {
  for (const row of rows) {
    const matches = [...rowText(row).matchAll(/\bPAGE\s+(\d+)\s+OF\s+(\d+)\b/gi)];
    const match = matches[matches.length - 1];
    if (!match) continue;
    const page = Number(match[1]);
    const total = Number(match[2]);
    if (page > 0 && total > 0) return { page, total };
  }
  return null;
}

function invoiceNumber(rows: PdfRow[]): string {
  for (const row of rows) {
    const no = rowText(row).match(/\bNo\.?\s+(\d{6,})\b/i);
    if (no?.[1]) return no[1];
  }
  return "";
}

function invoiceDate(rows: PdfRow[]): string {
  for (const row of rows) {
    const date = rowText(row).match(/\bDATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (date?.[1]) return date[1];
  }
  return "";
}

/** Split a PDF into invoices using the printed PAGE n OF m line. */
export function groupSherwinWilliamsPages(pages: PdfRow[][]): PdfRow[][][] {
  const groups: { pages: PdfRow[][]; no: string; total: number; seen: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  for (const page of pages) {
    const mark = pageMark(page);
    const no = invoiceNumber(page);
    const starts =
      !current
      || (mark?.page === 1 && current.seen > 0)
      || (no !== "" && current.no !== "" && no !== current.no)
      || (current.total > 0 && current.seen >= current.total);
    if (starts || !current) {
      current = { pages: [], no, total: mark?.total ?? 0, seen: 0 };
      groups.push(current);
    } else if (no && !current.no) {
      current.no = no;
    }
    if (mark) current.total = mark.total;
    current.pages.push(page);
    current.seen += 1;
  }
  return groups.map((group) => group.pages);
}

export function parseSherwinWilliamsPages(pages: PdfRow[][]): ParsedInvoice[] {
  const invoices: ParsedInvoice[] = [];
  for (const group of groupSherwinWilliamsPages(pages)) {
    const columns = group.flat().map(headerColumns).find((found) => found != null);
    if (!columns) continue;
    const lines = combinePaintFeeLines(group.flatMap((page) => readLines(page, columns)));
    if (lines.length === 0) continue;
    const marks = group.map(pageMark).filter((mark) => mark != null);
    const pageCount = marks.reduce((max, mark) => Math.max(max, mark.total), 0) || group.length;
    const firstPage = marks[0]?.page ?? 1;
    const lastPage = marks[marks.length - 1]?.page ?? firstPage + group.length - 1;
    const charges = readInvoiceCharges(group.flat());
    invoices.push({
      readerId: "sherwin-williams",
      vendorName: "Sherwin Williams",
      invoiceNo: group.map(invoiceNumber).find(Boolean) ?? "",
      invoiceDate: group.map(invoiceDate).find(Boolean) ?? "",
      pageCount,
      firstPage,
      lastPage,
      lines,
      total: charges.total,
      taxPercent: charges.taxPercent,
    });
  }
  return invoices;
}

function readLines(rows: PdfRow[], columns: { column: Column; x: number }[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let current: ReturnType<typeof startLine> | null = null;
  let inBody = !rows.some((row) => headerColumns(row));

  function startLine(cells: Record<Column, string>, listPrice: number) {
    const qty = Number(cells.qty);
    return {
      salesNumber: cells.sales,
      size: cells.size,
      productId: cells.product,
      description: cells.description,
      color: "",
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      listPrice,
      discountAmount: 0,
      discountPercent: null as number | null,
    };
  }

  for (const row of rows) {
    const text = rowText(row);
    if (!inBody) {
      if (headerColumns(row)) inBody = true;
      continue;
    }
    if (/SUBTOTAL/i.test(text)) {
      if (current) lines.push(finishLine(current));
      current = null;
      break;
    }
    const cells = assignColumns(row, columns);
    const listPrice = money(cells.price);
    if (/PAINT\s*CARE|\bPAINT FEE\b|\bECO\s*FEE\b/i.test(cells.description)) {
      const extended = money(cells.value);
      const qty = Number(cells.qty);
      if ((listPrice != null && listPrice > 0) || (extended != null && extended > 0)) {
        if (current) lines.push(finishLine(current));
        current = null;
        const count = Number.isFinite(qty) && qty > 0 ? qty : 1;
        const net = extended != null ? Math.round((extended / count) * 100) / 100 : listPrice ?? 0;
        lines.push({
          salesNumber: cells.sales,
          size: cells.size || "EA",
          productId: cells.product,
          description: cells.description,
          color: "",
          qty: count,
          listPrice: listPrice ?? net,
          discountAmount: 0,
          discountPercent: null,
          netPrice: net,
          section: "sundry",
          sheen: null,
          catalogItem: false,
        });
        continue;
      }
    }
    if (SALES_NUMBER.test(cells.sales) && listPrice != null && listPrice >= 0) {
      if (current) lines.push(finishLine(current));
      current = startLine(cells, listPrice);
      continue;
    }
    if (!current) continue;
    if (/^COLOR:/i.test(cells.description) && !current.color) {
      current.color = cells.description.replace(/^COLOR:\s*/i, "").trim();
      continue;
    }
    if (/^DISCOUNT\b/i.test(cells.description)) {
      const percent = cells.description.match(/\(\s*%\s*([\d.]+)\s*\)/);
      const amount = money(cells.value) ?? money(cells.price);
      if (percent) current.discountPercent = Number(percent[1]);
      if (amount != null && amount < 0) current.discountAmount += amount;
    }
  }
  if (current) lines.push(finishLine(current));
  return lines;
}

export function parseSherwinWilliams(rows: PdfRow[]): ParsedInvoice | null {
  const parsed = parseSherwinWilliamsPages([rows]);
  return parsed[0] ?? null;
}

export const sherwinWilliamsReader: InvoiceReader = {
  id: "sherwin-williams",
  vendorName: "Sherwin Williams",
  detect(text: string): boolean {
    return /SHERWIN-WILLIAMS/i.test(text) && /SALES NUMBER/i.test(text) && /\bPRICE\b/i.test(text);
  },
  parse: parseSherwinWilliams,
};
