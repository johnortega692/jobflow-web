import { readInvoiceCharges } from "./invoiceCharges.ts";
import type { InvoiceLine, InvoiceReader, ParsedInvoice, PdfRow } from "./types.ts";

function rowText(row: PdfRow): string {
  return row.map((frag) => frag.str).join(" ").replace(/\s+/g, " ").trim();
}

function money(raw: string): number | null {
  const text = raw.trim().replace(/[$,]/g, "");
  if (!/^-?\d+\.\d{2}$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function textIn(row: PdfRow, min: number, max: number): string {
  return row
    .filter((frag) => frag.x >= min && frag.x < max)
    .map((frag) => frag.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function lineAmount(row: PdfRow): number | null {
  const hits = row.filter((frag) => frag.x >= 480 && money(frag.str) != null);
  const last = hits.at(-1);
  return last ? money(last.str) : null;
}

function rateSize(row: PdfRow, amount: number): string {
  const rates = row
    .filter((frag) => frag.x >= 280 && frag.x < 480)
    .map((frag) => money(frag.str))
    .filter((value): value is number => value != null);
  const four = rates[3];
  const week = rates[2];
  const day = rates[1];
  const min = rates[0];
  if (four != null && four === amount) return "4WK";
  if (week != null && week === amount) return "WEEK";
  if (day != null && day === amount) return "DAY";
  if (min != null && min === amount) return "MIN";
  return "";
}

function isHeader(text: string): boolean {
  if (/\bEQUIPMENT\s*#/i.test(text)) return true;
  if (/\bITEM NUMBER\b/i.test(text)) return true;
  if (/^SALES ITEMS:?$/i.test(text)) return true;
  if (/^QTY\b/i.test(text) && /\b(?:EQUIPMENT|ITEM)\b/i.test(text)) return true;
  return false;
}

function isSkipNote(text: string): boolean {
  return /^HR OUT\b/i.test(text)
    || /SUB-?TOTAL|SALES TAX|INVOICE TOTAL|EQUIPMENT\.\s*SERVICE|REMIT\b|NET 30|PO BOX|WEEK BILL|@SUNBELT/i.test(text);
}

function isCharge(description: string): boolean {
  return /\b(?:TAX|SURCHARGE|FEE|CHARGE|PROTECTION)\b/i.test(description);
}

function expandYear(date: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(date.trim());
  if (!match) return date.trim();
  const year = Number(match[3]);
  const full = year >= 70 ? 1900 + year : 2000 + year;
  return `${match[1]}/${match[2]}/${full}`;
}

type Draft = {
  qty: number;
  description: string;
  productId: string;
  detail: string;
  amount: number;
  size: string;
};

function finish(draft: Draft): InvoiceLine {
  const qty = draft.qty > 0 ? draft.qty : 1;
  const net = Math.round((draft.amount / qty) * 100) / 100;
  const charge = isCharge(draft.description);
  return {
    salesNumber: "",
    size: draft.size || (charge ? "EA" : ""),
    productId: draft.productId,
    description: draft.description,
    color: draft.detail,
    qty,
    listPrice: net,
    discountAmount: 0,
    discountPercent: null,
    netPrice: net,
    section: "sundry",
    sheen: null,
    catalogItem: !charge,
  };
}

function attachNote(draft: Draft, text: string) {
  const equipment = text.match(/^([A-Z0-9-]+)\s+(Make:\s*.+)$/i);
  if (equipment) {
    draft.productId = equipment[1] ?? draft.productId;
    draft.detail = equipment[2] ?? "";
    return;
  }
  if (/^BILLED FOR\b/i.test(text)) {
    draft.detail = text.replace(/\.$/, "");
    return;
  }
  const coded = text.match(/^([A-Z0-9]*\d[A-Z0-9]*)\s+(.+)$/);
  if (coded && !draft.productId) {
    draft.productId = coded[1] ?? "";
    draft.description = [draft.description, coded[2]].filter(Boolean).join(" — ");
    return;
  }
  if (/^[A-Z0-9-]{4,}$/.test(draft.description) && !draft.productId) {
    draft.productId = draft.description;
    draft.description = text;
    return;
  }
  draft.description = [draft.description, text].filter(Boolean).join(" — ");
}

function readLines(rows: PdfRow[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  let current: Draft | null = null;
  let inBody = false;
  for (const row of rows) {
    const narrative = textIn(row, 0, 240);
    const full = rowText(row);
    if (!inBody) {
      if (/\bQTY\b/i.test(full) && /\bEQUIPMENT\s*#/i.test(full)) inBody = true;
      continue;
    }
    if (isHeader(narrative) || isHeader(full) || isSkipNote(full)) {
      if (/INVOICE TOTAL/i.test(full)) inBody = false;
      continue;
    }
    const amount = lineAmount(row);
    if (amount != null && amount > 0 && narrative && !isSkipNote(narrative)) {
      if (current) lines.push(finish(current));
      const priced = /^(\d+(?:\.\d+)?)\s+(.+)$/.exec(narrative);
      const qty = priced ? Number(priced[1]) : 1;
      const description = (priced ? priced[2] : narrative).trim();
      const unit = textIn(row, 240, 290);
      current = {
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        description,
        productId: "",
        detail: "",
        amount,
        size: rateSize(row, amount) || unit,
      };
      continue;
    }
    const note = rowText(row);
    if (!current || !note || isSkipNote(note)) continue;
    attachNote(current, note);
  }
  if (current) lines.push(finish(current));
  return lines;
}

function pageMark(rows: PdfRow[]): { page: number; total: number } | null {
  for (const row of rows) {
    const text = rowText(row);
    const match = text.match(/\bPAGE\s+(\d+)\s+OF\s+(\d+)\b/i) ?? text.match(/^(\d+)\s+of\s+(\d+)$/i);
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

export function groupSunbeltPages(pages: PdfRow[][]): PdfRow[][][] {
  const groups: { pages: PdfRow[][]; no: string; total: number; seen: number }[] = [];
  let current: (typeof groups)[number] | null = null;
  for (const page of pages) {
    const mark = pageMark(page);
    const no = labeledValue(page, /^INVOICE NO\.?$/i);
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

export function parseSunbeltPages(pages: PdfRow[][]): ParsedInvoice[] {
  const invoices: ParsedInvoice[] = [];
  for (const group of groupSunbeltPages(pages)) {
    const lines = readLines(group.flat());
    if (lines.length === 0) continue;
    const marks = group.map(pageMark).filter((mark) => mark != null);
    const pageCount = marks.reduce((max, mark) => Math.max(max, mark.total), 0) || group.length;
    const firstPage = marks[0]?.page ?? 1;
    const lastPage = marks[marks.length - 1]?.page ?? firstPage + group.length - 1;
    const charges = readInvoiceCharges(group.flat());
    invoices.push({
      readerId: "sunbelt",
      vendorName: "Sunbelt Rentals",
      invoiceNo: group.map((page) => labeledValue(page, /^INVOICE NO\.?$/i)).find(Boolean) ?? "",
      invoiceDate: expandYear(group.map((page) => labeledValue(page, /^INVOICE DATE$/i)).find(Boolean) ?? ""),
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

export function parseSunbelt(rows: PdfRow[]): ParsedInvoice | null {
  return parseSunbeltPages([rows])[0] ?? null;
}

export const sunbeltReader: InvoiceReader = {
  id: "sunbelt",
  vendorName: "Sunbelt Rentals",
  catalog: false,
  detect(text: string): boolean {
    return /SUNBELT\s+RENTALS/i.test(text) && /\bINVOICE\b/i.test(text) && /EQUIPMENT\s*#/i.test(text);
  },
  parse: parseSunbelt,
};
