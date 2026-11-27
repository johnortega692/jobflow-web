import { readInvoiceCharges } from "./invoiceCharges.js";
import type { InvoiceLine, ParsedInvoice, PdfRow } from "./types.js";

export type CustomInvoiceReader = {
  id: string;
  vendorName: string;
  catalog: boolean;
};

const RESERVED_KEYS = new Set([
  "sherwinwilliams",
  "dunnedwards",
  "ppg",
  "ppgpaints",
  "benjaminmoore",
  "sunbeltrentals",
  "wolfgordon",
]);

type ColumnName = "qty" | "unit" | "price" | "amount" | "tax";
type HeaderColumn = { column: ColumnName; x: number; role?: "ord" | "bko" | "shp" };

const UNIT_WORD = /^(?:EA|EACH|GL|GAL|GALLONS?|QT|QUARTS?|PT|PINTS?|BX|PK|CS|RL|PR|PC|PCS)$/i;

function rowText(row: PdfRow): string {
  return row.map((frag) => frag.str).join(" ").replace(/\s+/g, " ").trim();
}

function labelOf(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/[.:]+$/, "").toUpperCase();
}

function money(raw: string): number | null {
  const text = raw.trim().replace(/[$,]/g, "");
  if (!/^-?\d+\.\d{2}$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function vendorKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function customReaderId(vendorName: string): string {
  const slug = vendorName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `custom-${slug}` : "";
}

export function reservedInvoiceVendor(vendorName: string): boolean {
  return RESERVED_KEYS.has(vendorKey(vendorName));
}

export function vendorNameInText(vendorName: string, text: string): boolean {
  const folded = text.toLowerCase();
  const words = vendorName.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  if (words.length === 0) {
    const key = vendorKey(vendorName);
    return key.length >= 2 && folded.replace(/[^a-z0-9]/g, "").includes(key);
  }
  return words.every((word) => folded.includes(word));
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
  if (/^(?:\d+)?(?:GL|GAL|GALLONS?)$/.test(compact)) return "GALLON";
  if (/^(?:QT|QUARTS?)$/.test(compact)) return "QUART";
  if (/^(?:PT|PINTS?)$/.test(compact)) return "PINT";
  return unit.trim();
}

function isPaintUnit(unit: string): boolean {
  return /^(?:GL|GAL|GALLONS?|QT|QUARTS?|PT|PINTS?)$/i.test(unit.replace(/[\s-]+/g, ""));
}

function headerColumns(rows: PdfRow[]): HeaderColumn[] | null {
  for (const row of rows) {
    const frags = row.map((frag) => ({ x: frag.x, label: labelOf(frag.str) }));
    const found: HeaderColumn[] = [];
    for (let index = 0; index < frags.length; index++) {
      const frag = frags[index]!;
      const next = frags[index + 1];
      if (/^(?:QTY|QUANTITY)$/.test(frag.label)) {
        const role = next && /^(?:SHP|SHIP|SHIPPED)$/.test(next.label)
          ? "shp"
          : next && /^BKO$/.test(next.label)
            ? "bko"
            : next && /^(?:ORD|ORDER|ORDERED)$/.test(next.label)
              ? "ord"
              : undefined;
        found.push({ column: "qty", x: frag.x, role });
      } else if (/^(?:UNIT|UOM)$/.test(frag.label) && next && /^PRICE$/.test(next.label) && next.x - frag.x <= 30) {
        found.push({ column: "price", x: next.x });
        index += 1;
      } else if (/^(?:UNIT|UOM)$/.test(frag.label)) {
        found.push({ column: "unit", x: frag.x });
      } else if (/^(?:PRICE|RATE|UNIT PRICE)$/.test(frag.label)) {
        found.push({ column: "price", x: frag.x });
      } else if (/^(?:AMOUNT|EXTENDED|EXT|NET)$/.test(frag.label)) {
        found.push({ column: "amount", x: frag.x });
      } else if (/^TAX$/.test(frag.label)) {
        found.push({ column: "tax", x: frag.x });
      }
    }
    if (!found.some((column) => column.column === "qty")) continue;
    if (!found.some((column) => column.column === "amount" || column.column === "price")) continue;
    return found.sort((a, b) => a.x - b.x);
  }
  return null;
}

function joinParts(parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function cellsFromRow(row: PdfRow, columns: HeaderColumn[]): Record<"item" | "qty" | "unit" | "price" | "amount", string> {
  const leftEdge = Math.min(...columns.map((column) => column.x)) - 16;
  const buckets = columns.map(() => [] as string[]);
  const left: string[] = [];
  const units: string[] = [];
  for (const frag of row) {
    if (frag.x < leftEdge) {
      left.push(frag.str);
      continue;
    }
    let chosen = 0;
    for (let index = 0; index < columns.length; index++) {
      if (columns[index]!.x <= frag.x + 13) chosen = index;
    }
    const column = columns[chosen]!;
    if (column.column !== "unit" && UNIT_WORD.test(frag.str.trim())) {
      units.push(frag.str);
      continue;
    }
    if (column.column === "tax") continue;
    buckets[chosen]!.push(frag.str);
  }
  const textFor = (name: ColumnName, role?: HeaderColumn["role"]) => {
    const matches = columns
      .map((column, index) => ({ column, text: joinParts(buckets[index] ?? []) }))
      .filter((entry) => entry.column.column === name && (role == null || entry.column.role === role));
    return matches.map((entry) => entry.text).filter(Boolean);
  };
  const shipped = textFor("qty", "shp");
  const qty = shipped.length > 0 ? shipped : textFor("qty").slice(-1);
  return {
    item: joinParts(left),
    qty: qty[0] ?? "",
    unit: joinParts([...textFor("unit"), ...units]),
    price: textFor("price").at(-1) ?? "",
    amount: textFor("amount").at(-1) ?? "",
  };
}

function isFee(text: string): boolean {
  return /\b(?:FREIGHT|SURCHARGE|DELIVERY|PICKUP|RECOVERY\s*FEE|ECO\s*FEE|PAINT\s*FEE|PAINT\s*CARE|ENVIRONMENTAL|PROTECTION)\b/i.test(text);
}

function isTotalish(text: string): boolean {
  return /^(?:SUBTOTAL|TOTAL|AMOUNT DUE|AMOUNT PAID|BALANCE|SALES TAX|TAX TOTAL|TAX)\b/i.test(text);
}

function isFooter(text: string): boolean {
  return /TOTAL\s+GROSS|TOTAL\s+INVOICE|THESE ITEMS ARE CONTROLLED|FAMILY OF BRANDS|FOR QUESTIONS REGARDING|PAY YOUR INVOICES|NO REFUNDS|RECEIVED BY/i.test(text);
}

function isSkipNote(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return /^[\*]+$/.test(compact) || /\bHDRDESC\b/i.test(text) || /DELIVERY\s+TAG/i.test(text);
}

function splitItem(item: string): { productId: string; description: string } {
  const cleaned = item.replace(/^\d{1,4}\s+/, "");
  const match = cleaned.match(/^([A-Z0-9][A-Z0-9-]{2,})\s+(.+)$/i);
  if (!match?.[1] || !match[2]) return { productId: "", description: item };
  return { productId: match[1], description: match[2].trim() };
}

function finishProduct(draft: {
  productId: string;
  description: string;
  color: string;
  qty: number;
  unit: string;
  listPrice: number;
  amount: number;
}): InvoiceLine {
  const qty = draft.qty > 0 ? draft.qty : 1;
  const net = Math.round((draft.amount / qty) * 100) / 100;
  const paint = isPaintUnit(draft.unit) || sheenFromDescription(draft.description) != null || /\b(?:GALLONS?|PRIMER)\b/i.test(draft.description);
  return {
    salesNumber: "",
    size: paint && draft.unit ? paintSize(draft.unit) : draft.unit || "EA",
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

function readLines(rows: PdfRow[], columns: HeaderColumn[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let current: {
    productId: string;
    description: string;
    color: string;
    qty: number;
    unit: string;
    listPrice: number;
    amount: number;
  } | null = null;
  let inBody = false;
  for (const row of rows) {
    const text = rowText(row);
    if (!inBody) {
      if (/\b(?:QTY|QUANTITY)\b/i.test(text) && /\b(?:PRICE|AMOUNT|EXTENDED|RATE)\b/i.test(text)) inBody = true;
      continue;
    }
    if (/\b(?:QTY|QUANTITY)\b/i.test(text) && /\b(?:PRICE|AMOUNT|EXTENDED|RATE)\b/i.test(text)) continue;
    if (isFooter(text)) {
      if (current) lines.push(finishProduct(current));
      current = null;
      break;
    }
    if (isSkipNote(text)) continue;
    if (isTotalish(text)) {
      if (current) lines.push(finishProduct(current));
      current = null;
      continue;
    }
    const cells = cellsFromRow(row, columns);
    const amount = money(cells.amount) ?? money(cells.price);
    const qty = Number(cells.qty.replace(/,/g, ""));
    if (isFee(text) && amount != null && amount > 0 && !(qty > 0 && cells.item && !isFee(cells.item))) {
      if (current) lines.push(finishProduct(current));
      current = null;
      const name = cells.item || text.replace(/\$?-?\d[\d,]*\.\d{2}/g, "").replace(/\s+/g, " ").trim();
      lines.push(feeLine(name || "Fee", amount));
      continue;
    }
    const listPrice = money(cells.price) ?? amount;
    if (cells.item && amount != null && amount > 0 && qty > 0 && listPrice != null) {
      if (current) lines.push(finishProduct(current));
      const split = splitItem(cells.item);
      current = {
        productId: split.productId,
        description: split.description,
        color: "",
        qty,
        unit: cells.unit,
        listPrice,
        amount,
      };
      continue;
    }
    if (!current || !cells.item || amount != null) continue;
    const color = cells.item.match(/^(?:Paint\s+)?Color:\s*(.+)$/i);
    if (color) {
      current.color = color[1]?.trim() ?? "";
      continue;
    }
    if (cells.item.length > 80) continue;
    if (!current.description || current.description === current.productId) current.description = cells.item;
    else current.description = `${current.description} ${cells.item}`.replace(/\s+/g, " ").trim();
  }
  if (current) lines.push(finishProduct(current));
  return lines;
}

function labeledValue(rows: PdfRow[], rowPattern: RegExp, accept: (value: string) => boolean): string {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? [];
    if (!rowPattern.test(rowText(row))) continue;
    const anchor = row.find((frag) => /^invoice$/i.test(frag.str.trim())) ?? row[0];
    if (!anchor) continue;
    const beside = row.find((frag) => frag.x > anchor.x + 8 && accept(frag.str.trim()));
    if (beside) return beside.str.trim();
    for (let below = index + 1; below < Math.min(rows.length, index + 8); below++) {
      const under = (rows[below] ?? []).find((frag) => Math.abs(frag.x - anchor.x) <= 24 && accept(frag.str.trim()));
      if (under) return under.str.trim();
    }
  }
  return "";
}

function invoiceNoFrom(rows: PdfRow[]): string {
  return labeledValue(rows, /\bINVOICE\s+(?:NO\.?|NUMBER|ID|#)\b/i, (value) => /\d/.test(value) && /^[A-Z0-9-]{5,}$/i.test(value) && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value))
    || rows.map((row) => rowText(row).match(/\bInvoice\s+#?\s*(\d{4,})\b/i)?.[1] ?? "").find(Boolean)
    || "";
}

function invoiceDateFrom(rows: PdfRow[]): string {
  return labeledValue(rows, /\bINVOICE\s+DATE\b/i, (value) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value));
}

export function parseGenericInvoicePages(pages: PdfRow[][], vendor: CustomInvoiceReader): ParsedInvoice[] {
  const columns = headerColumns(pages.flat());
  if (!columns) return [];
  const lines = readLines(pages.flat(), columns);
  if (lines.length === 0) return [];
  const charges = readInvoiceCharges(pages.flat());
  return [{
    readerId: vendor.id,
    vendorName: vendor.vendorName,
    invoiceNo: pages.map(invoiceNoFrom).find(Boolean) ?? "",
    invoiceDate: pages.map(invoiceDateFrom).find(Boolean) ?? "",
    pageCount: pages.length,
    firstPage: 1,
    lastPage: pages.length,
    lines,
    total: charges.total,
    taxPercent: charges.taxPercent,
  }];
}
