/** Reader id from the invoice file name. Null when the name does not match a known vendor. */
export function invoiceReaderIdFromFileName(fileName: string): string | null {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  if (/^INVOICES-E_/i.test(base)) return "sherwin-williams";
  if (/^PPC_Invoices/i.test(base)) return "ppg";
  if (/^DE/i.test(base)) return "dunn-edwards";
  return null;
}
