import type { CustomInvoiceReader } from "./genericInvoice.js";
import { vendorKey, vendorNameInText } from "./genericInvoice.js";
import type { InvoiceLine, ParsedInvoice, ParsedInvoiceFile } from "./types.js";

export type ClaudeInvoiceLine = {
  productId: string;
  description: string;
  color: string;
  qty: number;
  unit: string;
  unitPrice: number;
  extended: number;
  fee: boolean;
};

export type ClaudeInvoiceRead = {
  vendorName: string;
  invoiceNo: string;
  invoiceDate: string;
  total: number | null;
  taxPercent: number | null;
  lines: ClaudeInvoiceLine[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function money(value: unknown): number {
  const raw = text(value).replace(/[$,]/g, "");
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function qtyOf(value: unknown): number {
  const n = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

function inferTaxPercent(taxAmount: number, total: number): number | null {
  const base = Math.round((total - taxAmount) * 100) / 100;
  if (base <= 0 || taxAmount <= 0 || taxAmount >= total) return null;
  const rough = (taxAmount / base) * 100;
  const taxCents = Math.round(taxAmount * 100);
  const start = Math.round(rough * 1000) - 3;
  for (let i = start; i <= start + 6; i++) {
    const percent = i / 1000;
    const computed = Math.round(base * (percent / 100) * 100);
    if (computed === taxCents) return percent;
  }
  return Math.round(rough * 1000) / 1000;
}

function percentOf(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(text(value).replace(/%/g, ""));
  return Number.isFinite(n) && n > 0 && n < 40 ? Math.round(n * 1000) / 1000 : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function paintSize(unit: string): string {
  const compact = unit.toUpperCase().replace(/[\s-]+/g, "");
  if (/^(?:\d+)?(?:GL|GAL|GALLONS?)$/.test(compact)) return "GALLON";
  if (/^(?:QT|QUARTS?)$/.test(compact)) return "QUART";
  if (/^(?:PT|PINTS?)$/.test(compact)) return "PINT";
  return unit.trim() || "EA";
}

function isPaintUnit(unit: string): boolean {
  return /^(?:GL|GAL|GALLONS?|QT|QUARTS?|PT|PINTS?)$/i.test(unit.replace(/[\s-]+/g, ""));
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

function lineFromRaw(raw: unknown): ClaudeInvoiceLine | null {
  const row = asRecord(raw);
  if (!row) return null;
  const description = text(row.description);
  const productId = text(row.productId ?? row.sku ?? row.partNumber);
  if (!description && !productId) return null;
  const fee = row.fee === true || row.fee === "true";
  const qty = qtyOf(row.qty);
  const unitPrice = money(row.unitPrice ?? row.price);
  const extended = money(row.extended ?? row.amount);
  if (!fee && qty <= 0) return null;
  if (unitPrice <= 0 && extended <= 0) return null;
  return {
    productId,
    description: description || productId,
    color: text(row.color),
    qty: qty > 0 ? qty : 1,
    unit: text(row.unit),
    unitPrice,
    extended,
    fee,
  };
}

export function normalizeClaudeInvoice(raw: unknown): ClaudeInvoiceRead {
  const body = asRecord(raw) ?? {};
  const list = Array.isArray(body.lines) ? body.lines : Array.isArray(raw) ? raw : [];
  const lines = list.map(lineFromRaw).filter((line): line is ClaudeInvoiceLine => line != null);
  const total = money(body.total);
  const taxAmount = money(body.taxAmount);
  const printed = percentOf(body.taxPercent);
  return {
    vendorName: text(body.vendorName),
    invoiceNo: text(body.invoiceNo ?? body.invoiceNumber),
    invoiceDate: text(body.invoiceDate),
    total: total > 0 ? total : null,
    taxPercent: printed ?? (total > 0 && taxAmount > 0 ? inferTaxPercent(taxAmount, total) : null),
    lines,
  };
}

export function invoiceVendorNamesMatch(typed: string, printed: string): boolean {
  const left = vendorKey(typed);
  const right = vendorKey(printed);
  if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) return true;
  return vendorNameInText(typed, printed);
}

function toInvoiceLine(line: ClaudeInvoiceLine): InvoiceLine {
  const qty = line.qty > 0 ? line.qty : 1;
  const net = line.unitPrice > 0
    ? line.unitPrice
    : Math.round((line.extended / qty) * 100) / 100;
  const paint = !line.fee && (isPaintUnit(line.unit) || sheenFromDescription(line.description) != null || /\b(?:GALLONS?|PRIMER)\b/i.test(line.description));
  return {
    salesNumber: "",
    size: line.fee ? "EA" : paintSize(line.unit),
    productId: line.productId,
    description: line.description,
    color: line.color,
    qty,
    listPrice: net,
    discountAmount: 0,
    discountPercent: null,
    netPrice: net,
    section: paint ? "paint_product" : "sundry",
    sheen: paint ? sheenFromDescription(line.description) : null,
    ...(line.fee ? { catalogItem: false as const } : {}),
  };
}

export function parsedFileFromClaudeRead(read: ClaudeInvoiceRead, vendor: CustomInvoiceReader): ParsedInvoiceFile {
  const invoice: ParsedInvoice = {
    readerId: vendor.id,
    vendorName: vendor.vendorName,
    invoiceNo: read.invoiceNo,
    invoiceDate: read.invoiceDate,
    pageCount: 1,
    firstPage: 1,
    lastPage: 1,
    lines: read.lines.map(toInvoiceLine),
    total: read.total,
    taxPercent: read.taxPercent,
  };
  return { vendorName: vendor.vendorName, readerId: vendor.id, invoices: invoice.lines.length ? [invoice] : [] };
}
