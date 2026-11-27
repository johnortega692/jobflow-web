import type { InvoiceLine, PdfRow } from "./types.js";

export type InvoiceCharges = {
  total: number | null;
  taxPercent: number | null;
};

function rowText(row: PdfRow): string {
  return row.map((frag) => frag.str).join(" ").replace(/\s+/g, " ").trim();
}

function moneyAmounts(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/-?\$?\s*(\d{1,3}(?:,\d{3})*|\d+)\.\d{2}/g)) {
    const n = Number(match[0].replace(/[$,\s]/g, ""));
    if (Number.isFinite(n)) found.push(Math.round(n * 100) / 100);
  }
  return found;
}

function isTotalRow(text: string): boolean {
  if (/SUBTOTAL|TENDERED|PENDING|\bTAX\s+TOTAL\b|\bTOTAL\s+TAX\b|\bTOTAL\s+GROSS\b|\bTOTAL\s+(?:SHIPPING|HANDLING)\b/i.test(text)) return false;
  if (/\bTOTAL AMOUNT\b/i.test(text)) return true;
  if (/(^|\s)TOTAL(\s|$)/i.test(text)) return true;
  return /\bCHARGE\b/i.test(text) && /\$\s*\d/.test(text);
}

/** Pick the rate whose rounded tax matches the printed cents. */
function inferTaxPercent(taxAmount: number, total: number): number | null {
  const base = Math.round((total - taxAmount) * 100) / 100;
  if (base <= 0 || taxAmount <= 0) return null;
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

export function readInvoiceCharges(rows: PdfRow[]): InvoiceCharges {
  let printedPercent: number | null = null;
  let taxAmount: number | null = null;
  let total: number | null = null;
  for (const row of rows) {
    const text = rowText(row);
    const printed = text.match(/([\d.]+)\s*%\s*SALES TAX/i)
      ?? text.match(/\bTAX:\s*([\d.]+)\s*%/i)
      ?? text.match(/\bTAX(?:\s+TOTAL)?\s*\(\s*([\d.]+)\s*%\s*\)/i);
    if (printed?.[1]) {
      printedPercent = Number(printed[1]);
      const last = moneyAmounts(text).at(-1);
      if (last != null && Math.abs(last - printedPercent) > 0.001) taxAmount = last;
    } else if (/\bTOTAL\s+TAX\b/i.test(text) || (/\bSALES TAX\b/i.test(text) && !/SUBTOTAL/i.test(text))) {
      const last = moneyAmounts(text).at(-1);
      if (last != null) taxAmount = last;
    }
    if (isTotalRow(text)) {
      const last = moneyAmounts(text).at(-1);
      if (last != null) total = last;
    }
  }
  const taxPercent = printedPercent ?? (taxAmount != null && total != null ? inferTaxPercent(taxAmount, total) : null);
  return { total, taxPercent };
}

const PAINT_FEE = /PAINT\s*CARE|\bPAINT FEE\b/i;
const ECO_FEE = /\bECO\s*FEE\b/i;
const RECOVERY_FEE = /\bRECOVERY\s*FEE\b/i;
const VENDOR_FEE = new RegExp(`${PAINT_FEE.source}|${ECO_FEE.source}|${RECOVERY_FEE.source}`, "i");

/** Several paint-fee rows become one line whose price is their total. */
export function combinePaintFeeLines(lines: InvoiceLine[]): InvoiceLine[] {
  const fees = lines.filter((line) => PAINT_FEE.test(line.description));
  if (fees.length < 2) return lines;
  const total = Math.round(fees.reduce((sum, line) => sum + line.netPrice * line.qty, 0) * 100) / 100;
  const first = fees[0]!;
  let placed = false;
  const merged: InvoiceLine[] = [];
  for (const line of lines) {
    if (!PAINT_FEE.test(line.description)) {
      merged.push(line);
      continue;
    }
    if (placed) continue;
    placed = true;
    merged.push({
      ...first,
      qty: 1,
      listPrice: total,
      netPrice: total,
      discountAmount: 0,
      discountPercent: null,
      catalogItem: false,
    });
  }
  return merged;
}

export function paintFeeAmount(lines: InvoiceLine[]): number {
  return feeAmount(lines, PAINT_FEE);
}

export function ecoFeeAmount(lines: InvoiceLine[]): number {
  return feeAmount(lines, ECO_FEE);
}

/** Paint, eco, and recovery fees are one amount. One vendor invoice is open at a time. */
export function invoiceFeeAmount(lines: InvoiceLine[]): number {
  return feeAmount(lines, VENDOR_FEE);
}

function feeAmount(lines: InvoiceLine[], pattern: RegExp): number {
  const sum = lines.reduce((total, line) => {
    if (!pattern.test(line.description)) return total;
    return total + line.netPrice * line.qty;
  }, 0);
  return Math.round(sum * 100) / 100;
}

export function formatTaxPercent(percent: number): string {
  const rounded = Math.round(percent * 1000) / 1000;
  return `${rounded.toFixed(3).replace(/\.?0+$/, "")}%`;
}
