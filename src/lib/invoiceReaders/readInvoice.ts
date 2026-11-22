import { extractPdfTextPages } from "../pdfTextExtract.ts";
import { dunnEdwardsReader, parseDunnEdwardsPages } from "./dunnEdwards.ts";
import { parsePpgPages, ppgReader } from "./ppg.ts";
import { parseSherwinWilliamsPages, sherwinWilliamsReader } from "./sherwinWilliams.ts";
import type { InvoiceReader, ParsedInvoice, ParsedInvoiceFile } from "./types.ts";

const readers: InvoiceReader[] = [sherwinWilliamsReader, dunnEdwardsReader, ppgReader];

export const invoiceReaderChoices = readers.map((reader) => ({ id: reader.id, vendorName: reader.vendorName }));

function parsePages(reader: InvoiceReader, pages: Awaited<ReturnType<typeof extractPdfTextPages>>): ParsedInvoice[] {
  if (reader.id === "sherwin-williams") return parseSherwinWilliamsPages(pages);
  if (reader.id === "dunn-edwards") return parseDunnEdwardsPages(pages);
  if (reader.id === "ppg") return parsePpgPages(pages);
  return [reader.parse(pages.flat())].filter((invoice) => invoice != null);
}

export async function readVendorInvoice(fileBytes: ArrayBuffer, readerId: string): Promise<ParsedInvoiceFile> {
  const reader = readers.find((candidate) => candidate.id === readerId);
  if (!reader) throw new Error("Choose Sherwin Williams, Dunn Edwards, or PPG Paints.");
  const pages = await extractPdfTextPages(fileBytes);
  const text = pages.flat().map((row) => row.map((frag) => frag.str).join(" ")).join("\n");
  if (!reader.detect(text)) {
    throw new Error(`This PDF is not a ${reader.vendorName} invoice.`);
  }
  const invoices = parsePages(reader, pages);
  if (invoices.length === 0) {
    throw new Error(`No priced lines were found on this ${reader.vendorName} invoice.`);
  }
  return { vendorName: reader.vendorName, invoices };
}
