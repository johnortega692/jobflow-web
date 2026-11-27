import { vendorKey } from "./genericInvoice.ts";

/** Reader id from the invoice file name. Null when the name does not match a known vendor. */
export function invoiceReaderIdFromFileName(
  fileName: string,
  custom: { id: string; vendorName: string }[] = [],
): string | null {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  if (/^INVOICES-E_/i.test(base)) return "sherwin-williams";
  if (/^PPC_Invoices/i.test(base)) return "ppg";
  if (/^DE/i.test(base)) return "dunn-edwards";
  if (/^BM[\s_-]/i.test(base) || /benjamin\s*moore/i.test(base)) return "benjamin-moore";
  if (/sunbelt/i.test(base)) return "sunbelt";
  if (/^WG-Invoice/i.test(base) || /wolf-?gordon/i.test(base)) return "wolf-gordon";
  const folded = vendorKey(base);
  for (const reader of custom) {
    const key = vendorKey(reader.vendorName);
    if (key.length >= 4 && folded.includes(key)) return reader.id;
  }
  return null;
}
