import { readInvoiceCharges } from "./invoiceCharges.ts";
import type { InvoiceLine, InvoiceReader, ParsedInvoice, PdfRow } from "./types.ts";

const ITEM = /^[A-Z]{1,4}\d{2,}(?:-\d+)+$/i;

type Column = "qty" | "unit" | "price" | "amount";

function rowText(row: PdfRow): string {
  return row.map((frag) => frag.str).join(" ").replace(/\s+/g, " ").trim();
}

function money(raw: string): number | null {
  const text = raw.trim().replace(/[$,]/g, "");
  if (!/^-?\d+\.\d{2}$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function sheenFromDescription(description: string): string | null {
  if (/\bSEMI[-\s]?GLOSS\b/i.test(description)) return "Semi-Gloss";
  if (/\bEGGSHELL\b/i.test(description)) return "Eggshell";
  if (/\bSATIN\b/i.test(description)) return "Satin";
  if (/\bFLAT\b/i.test(description)) return "Flat";
  if (/\bGLOSS\b/i.test(description)) return "Gloss";
  if (/\bPRIMERS?\b/i.test(description)) return "Primer";
  return null;
}

function paintSize(unit: string): string {
  const compact = unit.toUpperCase().replace(/[\s-]+/g, "");
  if (/^(?:\d+)?(?:GL|GAL|GALLONS?)$/.test(compact)) {
    const count = compact.match(/^(\d+)/);
    const gallons = count ? Number(count[1]) : 1;
    return gallons > 1 ? `${gallons}GL` : "GALLON";
  }
  if (/^(?:QT|QUARTS?)$/.test(compact)) return "QUART";
  if (/^(?:PT|PINTS?)$/.test(compact)) return "PINT";
  return unit.trim();
}

function isPaintUnit(unit: string): boolean {
  return /^(?:GL|GAL|GALLONS?|QT|QUARTS?|PT|PINTS?)$/i.test(unit.replace(/[\s-]+/g, ""));
}

function headerColumns(rows: PdfRow[]): { column: Column; x: number }[] | null {
  for (const row of rows) {
    const text = rowText(row).toUpperCase();
    if (!text.includes("ITEM") || !text.includes("QUANTITY") || !text.includes("AMOUNT")) continue;
    const found: { column: Column; x: number }[] = [];
    const take = (column: Column, label: string) => {
      const frag = row.find((item) => item.str.replace(/\s+/g, " ").trim().toUpperCase() === label);
      if (frag) found.push({ column, x: frag.x });
    };
    take("qty", "QUANTITY");
    take("unit", "UNIT");
    take("price", "PRICE");
    take("amount", "AMOUNT");
    if (!found.some((column) => column.column === "qty") || !found.some((column) => column.column === "amount")) continue;
    return found.sort((a, b) => a.x - b.x);
  }
  return null;
}

function cellsFromRow(row: PdfRow, columns: { column: Column; x: number }[]): {
  item: string;
  qty: string;
  unit: string;
  price: string;
  amount: string;
} {
  const qty = columns.find((column) => column.column === "qty");
  const leftEdge = (qty?.x ?? 400) - 20;
  const buckets: Record<Column, string[]> = { qty: [], unit: [], price: [], amount: [] };
  const left: string[] = [];
  for (const frag of row) {
    if (frag.x < leftEdge) {
      left.push(frag.str);
      continue;
    }
    let chosen = columns[0]!;
    for (const column of columns) {
      if (column.x <= frag.x + 13) chosen = column;
    }
    buckets[chosen.column].push(frag.str);
  }
  const join = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    item: join(left),
    qty: join(buckets.qty),
    unit: join(buckets.unit),
    price: join(buckets.price),
    amount: join(buckets.amount),
  };
}

function skipNote(text: string): boolean {
  return /non-cancelable|all amounts are shown|limited and exclusive warranty|wolf-gordon inc\s+\||please remit|click here to pay|credit card|electronic funds|keybank|remittance address/i.test(text);
}

type Draft = {
  productId: string;
  description: string;
  color: string;
  qty: number;
  unit: string;
  listPrice: number;
  amount: number;
};

function finishProduct(draft: Draft): InvoiceLine {
  const qty = draft.qty > 0 ? draft.qty : 1;
  const net = Math.round((draft.amount / qty) * 100) / 100;
  const paint = isPaintUnit(draft.unit);
  return {
    salesNumber: "",
    size: paint ? paintSize(draft.unit) : draft.unit || "EA",
    productId: draft.productId,
    description: draft.description || draft.productId,
    color: draft.color,
    qty,
    listPrice: draft.listPrice,
    discountAmount: Math.round((net - draft.listPrice) * qty * 100) / 100,
    discountPercent: null,
    netPrice: net,
    section: paint ? "paint_product" : "sundry",
    sheen: paint ? sheenFromDescription(draft.description) : null,
  };
}

function feeLine(description: string, amount: number): InvoiceLine {
  return {
    salesNumber: "",
    size: "EA",
    productId: "",
    description,
    color: "",
    qty: 1,
    listPrice: amount,
    discountAmount: 0,
    discountPercent: null,
    netPrice: amount,
    section: "sundry",
    sheen: null,
    catalogItem: false,
  };
}

function readLines(rows: PdfRow[], columns: { column: Column; x: number }[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let current: Draft | null = null;
  let inBody = false;
  for (const row of rows) {
    const text = rowText(row);
    if (!inBody) {
      if (/\bITEM\b/i.test(text) && /\bQUANTITY\b/i.test(text) && /\bAMOUNT\b/i.test(text)) inBody = true;
      continue;
    }
    if (/\bITEM\b/i.test(text) && /\bQUANTITY\b/i.test(text)) continue;
    if (/^(?:SUBTOTAL|TAX TOTAL|TOTAL|AMOUNT PAID|AMOUNT DUE)\b/i.test(text)) {
      if (current) lines.push(finishProduct(current));
      current = null;
      continue;
    }
    const cells = cellsFromRow(row, columns);
    const amount = money(cells.amount);
    if (/^FREIGHT\b/i.test(text) && amount != null && amount > 0) {
      if (current) lines.push(finishProduct(current));
      current = null;
      lines.push(feeLine("Freight", amount));
      continue;
    }
    const qty = Number(cells.qty);
    const listPrice = money(cells.price) ?? amount;
    if (ITEM.test(cells.item) && amount != null && qty > 0 && listPrice != null) {
      if (current) lines.push(finishProduct(current));
      current = {
        productId: cells.item,
        description: "",
        color: "",
        qty,
        unit: cells.unit,
        listPrice,
        amount,
      };
      continue;
    }
    if (!current || !cells.item || amount != null || skipNote(cells.item)) continue;
    const color = cells.item.match(/^Paint Color:\s*(.+)$/i);
    if (color) {
      current.color = color[1]?.trim() ?? "";
      continue;
    }
    if (!current.description) current.description = cells.item;
  }
  if (current) lines.push(finishProduct(current));
  return lines;
}

function pageMark(rows: PdfRow[]): { page: number; total: number } | null {
  for (const row of rows) {
    const match = rowText(row).match(/^(\d+)\s+of\s+(\d+)$/i);
    if (!match) continue;
    const page = Number(match[1]);
    const total = Number(match[2]);
    if (page > 0 && total > 0) return { page, total };
  }
  return null;
}

function valueUnder(rows: PdfRow[], label: RegExp): string {
  for (let index = 0; index < rows.length; index++) {
    const frag = rows[index]?.find((item) => label.test(item.str.trim()));
    if (!frag) continue;
    for (let next = index + 1; next < Math.min(rows.length, index + 3); next++) {
      const below = rows[next]?.find((item) => Math.abs(item.x - frag.x) <= 8);
      if (!below || label.test(below.str.trim())) continue;
      return below.str.trim();
    }
  }
  return "";
}

function invoiceKey(rows: PdfRow[]): string {
  for (const row of rows) {
    const match = rowText(row).match(/\bInvoice\s+(\d+)\b/i);
    if (match?.[1]) return match[1];
  }
  return valueUnder(rows, /^Invoice ID:?$/i).replace(/^INV/i, "");
}

export function groupWolfGordonPages(pages: PdfRow[][]): PdfRow[][][] {
  const groups: { pages: PdfRow[][]; no: string; total: number; seen: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  for (const page of pages) {
    const mark = pageMark(page);
    const no = invoiceKey(page);
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

export function parseWolfGordonPages(pages: PdfRow[][]): ParsedInvoice[] {
  const invoices: ParsedInvoice[] = [];
  for (const group of groupWolfGordonPages(pages)) {
    const columns = headerColumns(group.flat());
    if (!columns) continue;
    const lines = readLines(group.flat(), columns);
    if (lines.length === 0) continue;
    const marks = group.map(pageMark).filter((mark) => mark != null);
    const pageCount = marks.reduce((max, mark) => Math.max(max, mark.total), 0) || group.length;
    const firstPage = marks[0]?.page ?? 1;
    const lastPage = marks[marks.length - 1]?.page ?? firstPage + group.length - 1;
    const charges = readInvoiceCharges(group.flat());
    const invoiceId = group.map((page) => valueUnder(page, /^Invoice ID:?$/i)).find(Boolean) ?? "";
    invoices.push({
      readerId: "wolf-gordon",
      vendorName: "Wolf Gordon",
      invoiceNo: invoiceId || group.map(invoiceKey).find(Boolean) || "",
      invoiceDate: group.map((page) => valueUnder(page, /^Invoice Date:?$/i)).find(Boolean) ?? "",
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

export function parseWolfGordon(rows: PdfRow[]): ParsedInvoice | null {
  return parseWolfGordonPages([rows])[0] ?? null;
}

export const wolfGordonReader: InvoiceReader = {
  id: "wolf-gordon",
  vendorName: "Wolf Gordon",
  catalog: false,
  detect(text: string): boolean {
    return /WOLF-?GORDON/i.test(text) && /\bINVOICE\b/i.test(text) && /\bQUANTITY\b/i.test(text) && /\bAMOUNT\b/i.test(text);
  },
  parse: parseWolfGordon,
};
