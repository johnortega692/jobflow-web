import { combinePaintFeeLines, readInvoiceCharges } from "./invoiceCharges.ts";
import type { InvoiceLine, InvoiceReader, ParsedInvoice, PdfRow } from "./types.ts";

const MONEY = /^-?\d+\.\d{2}$/;
const STOCK = /^[A-Z0-9][A-Z0-9.*-]{2,}$/i;

const SHEEN_RULES: { pattern: RegExp; sheen: string }[] = [
  { pattern: /\bSEMI[-\s]?GLOSS\b|\bS\/G\b|\bSG\b/i, sheen: "Semi-Gloss" },
  { pattern: /\bEGGSHELL\b|\bEGG\b|\bES\b/i, sheen: "Eggshell" },
  { pattern: /\bSATIN\b|\bSAT\b/i, sheen: "Satin" },
  { pattern: /\bFLAT\b|\bFL\b/i, sheen: "Flat" },
  { pattern: /\bGLOSS\b|\bGL\b/i, sheen: "Gloss" },
  { pattern: /\bPRIMERS?\b|\bPRMR\b|\bPRM\b/i, sheen: "Primer" },
];

type Column = "stock" | "description" | "qty" | "unit" | "price" | "amount" | "tax";

const HEADER_WORDS: { label: string; column: Column }[] = [
  { label: "STOCK NO.", column: "stock" },
  { label: "DESCRIPTION", column: "description" },
  { label: "QTY", column: "qty" },
  { label: "UNIT", column: "unit" },
  { label: "PRICE", column: "price" },
  { label: "AMOUNT", column: "amount" },
  { label: "T", column: "tax" },
];

function rowText(row: PdfRow): string {
  return row.map((frag) => frag.str).join(" ").replace(/\s+/g, " ").trim();
}

function money(raw: string): number | null {
  const text = raw.trim().replace(/[$,]/g, "");
  if (!MONEY.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Patching compounds are sold by the quart and stay sundries. */
function isSundryMaterial(description: string): boolean {
  return /\b(BONDO|PATCH(?:ING)?|SPACKL(?:E|ING)|FILLERS?|CAULK(?:ING)?|SEALANTS?|PUTTY|DRYWALL|JOINT\s+COMPOUNDS?)\b/i.test(description);
}

function isPaintUnit(unit: string, description: string): boolean {
  if (isSundryMaterial(description)) return false;
  return /\b\d*\s*GL\b|\b(GALLONS?|QUARTS?|PINTS?|GAL|QT|PT)\b/i.test(unit);
}

function sheenFromDescription(description: string): string | null {
  for (const rule of SHEEN_RULES) {
    if (rule.pattern.test(description)) return rule.sheen;
  }
  return null;
}

function headerColumns(row: PdfRow): { column: Column; x: number }[] | null {
  const text = rowText(row).toUpperCase();
  if (!text.includes("STOCK") || !text.includes("DESCRIPTION") || !text.includes("PRICE")) return null;
  const found: { column: Column; x: number }[] = [];
  const used = new Set<number>();
  for (const header of HEADER_WORDS) {
    for (let i = 0; i < row.length; i++) {
      if (used.has(i)) continue;
      const single = row[i]!.str.replace(/\s+/g, " ").trim().toUpperCase();
      if (single !== header.label && single !== header.label.replace(/\.$/, "")) continue;
      found.push({ column: header.column, x: row[i]!.x });
      used.add(i);
      break;
    }
  }
  if (!found.some((col) => col.column === "stock") || !found.some((col) => col.column === "price")) return null;
  return found.sort((a, b) => a.x - b.x);
}

function assignColumns(row: PdfRow, columns: { column: Column; x: number }[]): Record<Column, string> {
  const buckets: Record<Column, string[]> = {
    stock: [],
    description: [],
    qty: [],
    unit: [],
    price: [],
    amount: [],
    tax: [],
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
  const join = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    stock: join(buckets.stock),
    description: join(buckets.description),
    qty: join(buckets.qty),
    unit: join(buckets.unit),
    price: join(buckets.price),
    amount: join(buckets.amount),
    tax: join(buckets.tax),
  };
}

function skipLine(stock: string, qty: number, price: number): boolean {
  if (qty <= 0 || price <= 0) return true;
  if (/^MEMO$/i.test(stock)) return true;
  return false;
}

function isFee(stock: string, description: string): boolean {
  return /PAINTCARE/i.test(description) || /^PCF-/i.test(stock);
}

function finishLine(partial: {
  stock: string;
  description: string;
  color: string;
  qty: number;
  unit: string;
  listPrice: number;
  amount: number;
}): InvoiceLine {
  const qty = partial.qty > 0 ? partial.qty : 1;
  const net = Math.round((partial.amount / qty) * 100) / 100;
  const paint = isPaintUnit(partial.unit, partial.description);
  return {
    salesNumber: "",
    size: partial.unit,
    productId: partial.stock,
    description: partial.description,
    color: partial.color,
    qty,
    listPrice: partial.listPrice,
    discountAmount: Math.round((net - partial.listPrice) * qty * 100) / 100,
    discountPercent: null,
    netPrice: net,
    section: paint ? "paint_product" : "sundry",
    sheen: paint ? sheenFromDescription(partial.description) : null,
    catalogItem: !isFee(partial.stock, partial.description),
  };
}

function pageMark(rows: PdfRow[]): { page: number; total: number } | null {
  for (const row of rows) {
    const match = rowText(row).match(/\bPage:\s*(\d+)\s+of\s+(\d+)\b/i);
    if (!match) continue;
    const page = Number(match[1]);
    const total = Number(match[2]);
    if (page > 0 && total > 0) return { page, total };
  }
  return null;
}

function invoiceNumber(rows: PdfRow[]): string {
  for (let i = 0; i < rows.length; i++) {
    const text = rowText(rows[i]!).toUpperCase();
    if (!text.includes("REFERENCE") || !text.includes("ACCOUNT")) continue;
    const next = rows[i + 1];
    const value = next?.[0]?.str.trim() ?? "";
    if (value && !/reference/i.test(value)) return value;
  }
  return "";
}

function invoiceDate(rows: PdfRow[]): string {
  for (const row of rows) {
    const delivery = rowText(row).match(/Delivery Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (delivery?.[1]) return delivery[1];
  }
  for (const row of rows) {
    const order = rowText(row).match(/Order Date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (order?.[1]) return order[1];
  }
  return "";
}

export function groupDunnEdwardsPages(pages: PdfRow[][]): PdfRow[][][] {
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

function readLines(rows: PdfRow[], columns: { column: Column; x: number }[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let current: {
    stock: string;
    description: string;
    color: string;
    qty: number;
    unit: string;
    listPrice: number;
    amount: number;
  } | null = null;
  let inBody = !rows.some((row) => headerColumns(row));

  for (const row of rows) {
    const text = rowText(row);
    if (!inBody) {
      if (headerColumns(row)) inBody = true;
      continue;
    }
    if (/SUBTOTAL|ORDER NOTES|RETURN THIS PORTION/i.test(text)) {
      if (current) lines.push(finishLine(current));
      current = null;
      break;
    }
    const cells = assignColumns(row, columns);
    const listPrice = money(cells.price);
    const amount = money(cells.amount);
    const qty = Number(cells.qty);
    if (STOCK.test(cells.stock) && listPrice != null && amount != null) {
      if (current) lines.push(finishLine(current));
      current = null;
      if (skipLine(cells.stock, Number.isFinite(qty) ? qty : 0, listPrice)) continue;
      current = {
        stock: cells.stock,
        description: cells.description,
        color: "",
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        unit: cells.unit,
        listPrice,
        amount,
      };
      continue;
    }
    if (!current || cells.stock || !cells.description || listPrice != null) continue;
    if (!current.color) current.color = cells.description;
  }
  if (current) lines.push(finishLine(current));
  return lines;
}

export function parseDunnEdwardsPages(pages: PdfRow[][]): ParsedInvoice[] {
  const invoices: ParsedInvoice[] = [];
  for (const group of groupDunnEdwardsPages(pages)) {
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
      readerId: "dunn-edwards",
      vendorName: "Dunn Edwards",
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

export function parseDunnEdwards(rows: PdfRow[]): ParsedInvoice | null {
  return parseDunnEdwardsPages([rows])[0] ?? null;
}

export const dunnEdwardsReader: InvoiceReader = {
  id: "dunn-edwards",
  vendorName: "Dunn Edwards",
  detect(text: string): boolean {
    return /DUNN-EDWARDS/i.test(text) && /STOCK NO/i.test(text) && /\bINVOICE\b/i.test(text);
  },
  parse: parseDunnEdwards,
};
