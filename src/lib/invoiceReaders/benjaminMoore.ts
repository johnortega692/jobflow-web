import { readInvoiceCharges } from "./invoiceCharges.ts";
import type { InvoiceLine, InvoiceReader, ParsedInvoice, PdfRow } from "./types.ts";

const MONEY = /^-?\d+\.\d{2}$/;
const SKU = /^[A-Z]{1,4}\d{3,}(?:-[A-Z0-9]+)+$/i;

const SHEEN_RULES: { pattern: RegExp; sheen: string }[] = [
  { pattern: /\bSEMI[-\s]?GLOSS\b|\bS\/G\b|\bSG\b/i, sheen: "Semi-Gloss" },
  { pattern: /\bEGGSHELL\b|\bEGG\b|\bES\b/i, sheen: "Eggshell" },
  { pattern: /\bSATIN\b|\bSAT\b/i, sheen: "Satin" },
  { pattern: /\bFLAT\b|\bFL\b/i, sheen: "Flat" },
  { pattern: /\bGLOSS\b/i, sheen: "Gloss" },
  { pattern: /\bPRIMERS?\b|\bPRMR\b|\bPRM\b/i, sheen: "Primer" },
];

type Column = "quantity" | "net" | "extended" | "unitPrice" | "fees";

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

function gallonsFromDescription(description: string): number | null {
  const counted = description.match(/\b(\d+)\s*-?\s*G(?:AL(?:LON)?S?|L)\b/i);
  if (!counted) return null;
  const gallons = Number(counted[1]);
  return gallons > 0 ? gallons : null;
}

function paintSize(description: string): string {
  const gallons = gallonsFromDescription(description);
  if (gallons && gallons > 1) return `${gallons}GL`;
  if (gallons === 1 || /\b(?:GL|GAL|GALLONS?)\b/i.test(description)) return "GALLON";
  if (/\b(?:QUARTS?|QT)\b/i.test(description)) return "QUART";
  if (/\b(?:PINTS?|PT)\b/i.test(description)) return "PINT";
  return "";
}

function isPaint(description: string): boolean {
  if (isSundryNoun(description)) return false;
  if (paintSize(description)) return true;
  return sheenFromDescription(description) != null;
}

function isFeeText(text: string): boolean {
  return /RECOVERY FEE|ECO FEE|PAINT\s*CARE|\bPAINT FEE\b/i.test(text);
}

function isSummaryText(text: string): boolean {
  return /TOTAL AMOUNT|SALES TAX|CASH DISCOUNT|NET AMOUNT DUE|RECOVERY FEE|ECO FEE|PAINT\s*CARE/i.test(text);
}

function isFooter(text: string): boolean {
  return /CORPORATE NATIONAL|JOB DESCRIPTION|RETAILER INVOICE|PICKED UP|CONFORMITY|EXPORT|ACKNOWLEDGE|DIVERSION|QUESTIONS REGARDING|FOR SALE IN THE U\.S/i.test(text);
}

type HeaderColumn = { column: Column; x: number };

function headerColumns(rows: PdfRow[]): HeaderColumn[] | null {
  for (let i = 0; i < rows.length; i++) {
    const text = rowText(rows[i]!).toUpperCase();
    if (!text.includes("SKU") || !text.includes("DESCRIPTION") || !text.includes("QUANTITY")) continue;
    const frags = [...rows[i]!];
    const next = rows[i + 1];
    if (next && /\b(?:DISCOUNT|PRICE)\b/i.test(rowText(next)) && !frags.some((frag) => SKU.test(frag.str.trim()))) {
      const nextText = rowText(next).toUpperCase();
      if (!nextText.includes("SKU") && !nextText.includes("TOTAL")) frags.push(...next);
    }
    const found: HeaderColumn[] = [];
    const take = (column: Column, label: string) => {
      const frag = frags.find((item) => item.str.replace(/\s+/g, " ").trim().toUpperCase() === label);
      if (frag) found.push({ column, x: frag.x });
    };
    take("quantity", "QUANTITY");
    take("net", "NET AMOUNT");
    take("extended", "EXTENDED AMOUNT");
    take("fees", "FEES");
    const price = frags.find((item) => item.str.replace(/\s+/g, " ").trim().toUpperCase() === "PRICE");
    if (price) found.push({ column: "unitPrice", x: price.x });
    if (!found.some((column) => column.column === "quantity")) return null;
    if (!found.some((column) => column.column === "extended") && !found.some((column) => column.column === "unitPrice")) return null;
    return found.sort((a, b) => a.x - b.x);
  }
  return null;
}

function cellsFromRow(row: PdfRow, columns: HeaderColumn[]): {
  sku: string;
  description: string;
  quantity: string;
  net: string;
  extended: string;
  unitPrice: string;
  fees: string;
} {
  const quantity = columns.find((column) => column.column === "quantity");
  const leftEdge = quantity ? quantity.x - 30 : 360;
  const left = row.filter((frag) => frag.x < leftEdge);
  const right = row.filter((frag) => frag.x >= leftEdge);
  const buckets: Record<Column, string[]> = {
    quantity: [],
    net: [],
    extended: [],
    unitPrice: [],
    fees: [],
  };
  for (const frag of right) {
    let chosen = columns[0]!;
    for (const column of columns) {
      if (column.x <= frag.x + 16) chosen = column;
    }
    buckets[chosen.column].push(frag.str);
  }
  const join = (parts: string[]) => parts.join(" ").replace(/\s+/g, " ").trim();
  const sku = left.filter((frag) => SKU.test(frag.str.trim())).map((frag) => frag.str.trim()).join(" ");
  const description = join(left.filter((frag) => !SKU.test(frag.str.trim())).map((frag) => frag.str));
  return {
    sku,
    description,
    quantity: join(buckets.quantity),
    net: join(buckets.net),
    extended: join(buckets.extended),
    unitPrice: join(buckets.unitPrice),
    fees: join(buckets.fees),
  };
}

function finishProduct(partial: {
  sku: string;
  description: string;
  color: string;
  qty: number;
  listPrice: number;
  amount: number;
}): InvoiceLine {
  const qty = partial.qty > 0 ? partial.qty : 1;
  const net = Math.round((partial.amount / qty) * 100) / 100;
  const paint = isPaint(partial.description);
  return {
    salesNumber: "",
    size: paint ? paintSize(partial.description) : "EA",
    productId: partial.sku,
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

function feeLine(description: string, amount: number): InvoiceLine {
  const name = description.replace(/\s*\[[A-Z]\]\s*/gi, " ").replace(/\s+/g, " ").trim();
  return {
    salesNumber: "",
    size: "EA",
    productId: "",
    description: name || "Recovery Fee",
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
    sku: string;
    description: string;
    color: string;
    qty: number;
    listPrice: number;
    amount: number;
  } | null = null;
  let inBody = false;
  for (const row of rows) {
    const text = rowText(row);
    if (!inBody) {
      if (/\bSKU\b/i.test(text) && /\bDESCRIPTION\b/i.test(text) && /\bQUANTITY\b/i.test(text)) inBody = true;
      continue;
    }
    if (/^(?:DISCOUNT|PRICE)(?:\s+(?:DISCOUNT|PRICE))*$/i.test(text)) continue;
    const cells = cellsFromRow(row, columns);
    const extended = money(cells.extended) ?? money(cells.net) ?? money(cells.unitPrice);
    if (isFeeText(cells.description) && extended != null && extended > 0) {
      if (current) lines.push(finishProduct(current));
      current = null;
      lines.push(feeLine(cells.description, extended));
      continue;
    }
    const qty = Number(cells.quantity);
    const listPrice = money(cells.unitPrice) ?? money(cells.net) ?? extended;
    if (SKU.test(cells.sku) && listPrice != null && extended != null && qty > 0) {
      if (current) lines.push(finishProduct(current));
      current = {
        sku: cells.sku,
        description: cells.description,
        color: "",
        qty,
        listPrice,
        amount: extended,
      };
      continue;
    }
    if (!current || cells.sku || extended != null || !cells.description) continue;
    if (isSummaryText(cells.description) || isFooter(cells.description)) continue;
    if (!current.color) current.color = cells.description;
  }
  if (current) lines.push(finishProduct(current));
  return lines;
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

function labeledValue(rows: PdfRow[], label: RegExp): string {
  for (const row of rows) {
    const parts = row.map((frag) => frag.str.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (!label.test(parts[i] ?? "")) continue;
      const next = parts.slice(i + 1).join(" ").trim();
      if (next) return next;
    }
  }
  return "";
}

export function groupBenjaminMoorePages(pages: PdfRow[][]): PdfRow[][][] {
  const groups: { pages: PdfRow[][]; no: string; total: number; seen: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  for (const page of pages) {
    const mark = pageMark(page);
    const no = labeledValue(page, /^INVOICE NUMBER$/i);
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

export function parseBenjaminMoorePages(pages: PdfRow[][]): ParsedInvoice[] {
  const invoices: ParsedInvoice[] = [];
  for (const group of groupBenjaminMoorePages(pages)) {
    const columns = headerColumns(group.flat());
    if (!columns) continue;
    const lines = readLines(group.flat(), columns);
    if (lines.length === 0) continue;
    const marks = group.map(pageMark).filter((mark) => mark != null);
    const pageCount = marks.reduce((max, mark) => Math.max(max, mark.total), 0) || group.length;
    const firstPage = marks[0]?.page ?? 1;
    const lastPage = marks[marks.length - 1]?.page ?? firstPage + group.length - 1;
    const charges = readInvoiceCharges(group.flat());
    invoices.push({
      readerId: "benjamin-moore",
      vendorName: "Benjamin Moore",
      invoiceNo: group.map((page) => labeledValue(page, /^INVOICE NUMBER$/i)).find(Boolean) ?? "",
      invoiceDate: group.map((page) => labeledValue(page, /^INVOICE DATE$/i)).find(Boolean) ?? "",
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

export function parseBenjaminMoore(rows: PdfRow[]): ParsedInvoice | null {
  return parseBenjaminMoorePages([rows])[0] ?? null;
}

export const benjaminMooreReader: InvoiceReader = {
  id: "benjamin-moore",
  vendorName: "Benjamin Moore",
  detect(text: string): boolean {
    return /BENJAMIN MOORE/i.test(text) && /\bINVOICE\b/i.test(text) && /\bSKU\b/.test(text);
  },
  parse: parseBenjaminMoore,
};
