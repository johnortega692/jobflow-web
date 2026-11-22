import { readInvoiceCharges } from "./invoiceCharges.ts";
import type { InvoiceLine, InvoiceReader, ParsedInvoice, PdfRow } from "./types.ts";

const MONEY = /^-?\d+\.\d{2}$/;
const ITEM = /^([A-Z0-9][A-Z0-9.-]{2,})\/([A-Z0-9]{1,6})$/i;
const SAP = /^\d{6,12}$/;

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

const SHEEN_RULES: { pattern: RegExp; sheen: string }[] = [
  { pattern: /\bSEMI[-\s]?GLOSS\b|\bS\/G\b|\bSG\b/i, sheen: "Semi-Gloss" },
  { pattern: /\bEGGSHELL\b|\bEGG\b|\bES\b/i, sheen: "Eggshell" },
  { pattern: /\bSATIN\b|\bSAT\b/i, sheen: "Satin" },
  { pattern: /\bFLAT\b|\bFL\b/i, sheen: "Flat" },
  { pattern: /\bGLOSS\b/i, sheen: "Gloss" },
  { pattern: /\bPRIMERS?\b|\bPRMR\b|\bPRM\b/i, sheen: "Primer" },
];

type Column = "item" | "description" | "qty" | "price" | "amount";

const HEADER_WORDS: { label: string; column: Column }[] = [
  { label: "ITEM # / SAP #", column: "item" },
  { label: "DESCRIPTION", column: "description" },
  { label: "QTY", column: "qty" },
  { label: "UNIT PRICE", column: "price" },
  { label: "AMOUNT", column: "amount" },
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

function sheenFromDescription(description: string): string | null {
  for (const rule of SHEEN_RULES) {
    if (rule.pattern.test(description)) return rule.sheen;
  }
  return null;
}

function isSundryNoun(description: string): boolean {
  return /\b(BUCKETS?|GRIDS?|TAPES?|SPONGES?|ROLLERS?|COVERS?|BRUSH(?:ES)?|SANDING|TRAYS?|LINERS?|PAILS?|RAGS?|PLASTIC|CAULK(?:ING)?|SANDPAPER|DISCS?|FRAMES?|MASKING|BONDO|PATCH(?:ING)?|SPACKL(?:E|ING)|FILLERS?|SEALANTS?|PUTTY|DRYWALL|JOINT\s+COMPOUNDS?)\b/i.test(description);
}

function gallonCount(unit: string): { gallons: number } | null {
  const compact = unit.toUpperCase().replace(/[\s-]+/g, "");
  const match = compact.match(/^(\d+)?(?:GL|GAL|GALLONS?)$/);
  if (!match) return null;
  const gallons = match[1] ? Number(match[1]) : 1;
  return gallons > 0 ? { gallons } : null;
}

function normalizeUnit(unit: string): string {
  const gallons = gallonCount(unit);
  if (gallons) return gallons.gallons <= 1 ? "GALLON" : `${gallons.gallons}GL`;
  const compact = unit.toUpperCase().replace(/[\s-]+/g, "");
  if (/^(?:QT|QTS|QUARTS?)$/.test(compact)) return "QUART";
  if (/^(?:PT|PTS|PINTS?)$/.test(compact)) return "PINT";
  return compact || "EA";
}

function paintSize(unit: string, description: string): string {
  const fromUnit = gallonCount(unit);
  if (fromUnit) return fromUnit.gallons <= 1 ? "GALLON" : `${fromUnit.gallons}GL`;
  const counted = description.match(/\b(\d+)\s*-?\s*G(?:AL(?:LON)?S?|L)\b/i);
  if (counted) return Number(counted[1]) <= 1 ? "GALLON" : `${counted[1]}GL`;
  if (/\b(?:GL|GAL|GALLONS?)\b/i.test(description)) return "GALLON";
  return normalizeUnit(unit);
}

function isPaint(unit: string, description: string): boolean {
  if (isSundryNoun(description)) return false;
  if (gallonCount(unit) || /^(?:QUART|PINT)$/.test(normalizeUnit(unit))) return true;
  return sheenFromDescription(description) != null;
}

function headerColumns(row: PdfRow): { column: Column; x: number }[] | null {
  const text = rowText(row).toUpperCase();
  if (!text.includes("DESCRIPTION") || !text.includes("UNIT PRICE") || !text.includes("QTY")) return null;
  const found: { column: Column; x: number }[] = [];
  const used = new Set<number>();
  for (const header of HEADER_WORDS) {
    for (let i = 0; i < row.length; i++) {
      if (used.has(i)) continue;
      const single = row[i]!.str.replace(/\s+/g, " ").trim().toUpperCase();
      if (single !== header.label) continue;
      found.push({ column: header.column, x: row[i]!.x });
      used.add(i);
      break;
    }
  }
  if (!found.some((col) => col.column === "item") || !found.some((col) => col.column === "price")) return null;
  return found.sort((a, b) => a.x - b.x);
}

function assignColumns(row: PdfRow, columns: { column: Column; x: number }[]): Record<Column, string> {
  const buckets: Record<Column, string[]> = {
    item: [],
    description: [],
    qty: [],
    price: [],
    amount: [],
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
    item: join(buckets.item),
    description: join(buckets.description),
    qty: join(buckets.qty),
    price: join(buckets.price),
    amount: join(buckets.amount),
  };
}

function finishLine(partial: {
  productId: string;
  salesNumber: string;
  description: string;
  color: string;
  qty: number;
  unit: string;
  listPrice: number;
  amount: number;
}): InvoiceLine {
  const qty = partial.qty > 0 ? partial.qty : 1;
  const net = Math.round((partial.amount / qty) * 100) / 100;
  const paint = isPaint(partial.unit, partial.description);
  return {
    salesNumber: partial.salesNumber,
    size: paint ? paintSize(partial.unit, partial.description) : normalizeUnit(partial.unit),
    productId: partial.productId,
    description: partial.description,
    color: partial.color,
    qty,
    listPrice: partial.listPrice,
    discountAmount: Math.round((net - partial.listPrice) * qty * 100) / 100,
    discountPercent: null,
    netPrice: net,
    section: paint ? "paint_product" : "sundry",
    sheen: paint ? sheenFromDescription(partial.description) : null,
  };
}

function feeLine(row: PdfRow): InvoiceLine | null {
  const text = rowText(row);
  const eco = /\bECO\s+FEE\b/i.test(text);
  const paintCare = /\bPAINT\s*CARE\b/i.test(text);
  if (!eco && !paintCare) return null;
  const amount = row.map((frag) => money(frag.str)).find((value) => value != null && value > 0);
  if (amount == null) return null;
  return {
    salesNumber: "",
    size: "EA",
    productId: "",
    description: eco ? "Eco Fee" : "PaintCare Fee",
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

function pageMark(rows: PdfRow[]): { page: number; total: number } | null {
  for (const row of rows) {
    const match = rowText(row).match(/\bPAGE\s+(\d+)\s+OF\s+(\d+)\b/i);
    if (!match) continue;
    const page = Number(match[1]);
    const total = Number(match[2]);
    if (page > 0 && total > 0) return { page, total };
  }
  return null;
}

function invoiceNumber(rows: PdfRow[]): string {
  for (const row of rows) {
    const text = rowText(row);
    const inline = text.match(/\bINVOICE\s*#\s*([A-Z0-9]+)/i);
    if (inline?.[1] && !/^INVOICE$/i.test(inline[1])) return inline[1];
    for (let i = 0; i < row.length; i++) {
      if (!/^INVOICE\s*#$/i.test(row[i]!.str.trim())) continue;
      const next = row[i + 1]?.str.trim() ?? "";
      if (next && !/date/i.test(next)) return next;
    }
  }
  return "";
}

function invoiceDate(rows: PdfRow[]): string {
  for (const row of rows) {
    const text = rowText(row);
    const numeric = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (numeric?.[1]) return numeric[1];
    const named = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
    const month = named ? MONTHS[named[2]!.toLowerCase()] : undefined;
    if (named && month) return `${month}/${named[1]!.padStart(2, "0")}/${named[3]}`;
  }
  return "";
}

function stopsPage(text: string): boolean {
  if (/CONTINUED ON PAGE/i.test(text)) return true;
  if (/\bSALES TAX\b|\bTOTAL TENDERED\b|\bPENDING AMOUNT\b/i.test(text)) return true;
  return /^\s*TOTAL\b/i.test(text) && !/SUBTOTAL/i.test(text);
}

export function groupPpgPages(pages: PdfRow[][]): PdfRow[][][] {
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
    productId: string;
    salesNumber: string;
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
    const fee = feeLine(row);
    if (fee) {
      if (current) lines.push(finishLine(current));
      current = null;
      lines.push(fee);
      continue;
    }
    if (stopsPage(text)) {
      if (current) lines.push(finishLine(current));
      current = null;
      break;
    }
    const cells = assignColumns(row, columns);
    const item = cells.item.match(ITEM);
    const listPrice = money(cells.price);
    const amount = money(cells.amount);
    const qty = Number(cells.qty);
    if (item && listPrice != null && amount != null && listPrice > 0 && qty > 0) {
      if (current) lines.push(finishLine(current));
      current = {
        productId: item[1]!.toUpperCase(),
        salesNumber: "",
        description: cells.description,
        color: "",
        qty,
        unit: item[2]!.toUpperCase(),
        listPrice,
        amount,
      };
      continue;
    }
    if (!current) continue;
    if (SAP.test(cells.item) && !cells.description && listPrice == null) {
      current.salesNumber = cells.item;
      continue;
    }
    if (!cells.item && cells.description && listPrice == null && amount == null && !current.color) {
      current.color = cells.description;
    }
  }
  if (current) lines.push(finishLine(current));
  return lines;
}

export function parsePpgPages(pages: PdfRow[][]): ParsedInvoice[] {
  const invoices: ParsedInvoice[] = [];
  for (const group of groupPpgPages(pages)) {
    const columns = group.flat().map(headerColumns).find((found) => found != null);
    if (!columns) continue;
    const lines = group.flatMap((page) => readLines(page, columns));
    if (lines.length === 0) continue;
    const marks = group.map(pageMark).filter((mark) => mark != null);
    const pageCount = marks.reduce((max, mark) => Math.max(max, mark.total), 0) || group.length;
    const firstPage = marks[0]?.page ?? 1;
    const lastPage = marks[marks.length - 1]?.page ?? firstPage + group.length - 1;
    const charges = readInvoiceCharges(group.flat());
    invoices.push({
      readerId: "ppg",
      vendorName: "PPG Paints",
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

export function parsePpg(rows: PdfRow[]): ParsedInvoice | null {
  return parsePpgPages([rows])[0] ?? null;
}

export const ppgReader: InvoiceReader = {
  id: "ppg",
  vendorName: "PPG Paints",
  detect(text: string): boolean {
    return /PITTSBURGH PAINTS|\bPPC\b|\bPPG\b/i.test(text)
      && /\bINVOICE\b/i.test(text)
      && /UNIT PRICE/i.test(text)
      && /SAP/i.test(text);
  },
  parse: parsePpg,
};
