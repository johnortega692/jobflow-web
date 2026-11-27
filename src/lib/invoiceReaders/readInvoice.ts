import { extractPdfTextPages } from "../pdfTextExtract.ts";
import { benjaminMooreReader, parseBenjaminMoorePages } from "./benjaminMoore.ts";
import { dunnEdwardsReader, parseDunnEdwardsPages } from "./dunnEdwards.ts";
import { parseGenericInvoicePages, vendorNameInText, type CustomInvoiceReader } from "./genericInvoice.ts";
import { parsePpgPages, ppgReader } from "./ppg.ts";
import { parseSherwinWilliamsPages, sherwinWilliamsReader } from "./sherwinWilliams.ts";
import { parseSunbeltPages, sunbeltReader } from "./sunbelt.ts";
import { parseWolfGordonPages, wolfGordonReader } from "./wolfGordon.ts";
import type { InvoiceReader, ParsedInvoice, ParsedInvoiceFile } from "./types.ts";

const readers: InvoiceReader[] = [sherwinWilliamsReader, dunnEdwardsReader, ppgReader, benjaminMooreReader, sunbeltReader, wolfGordonReader];

export type InvoiceReaderChoice = {
  id: string;
  vendorName: string;
  catalog: boolean;
};

export const invoiceReaderChoices: InvoiceReaderChoice[] = readers.map((reader) => ({
  id: reader.id,
  vendorName: reader.vendorName,
  catalog: reader.catalog !== false,
}));

export function invoiceReaderChoicesWith(custom: CustomInvoiceReader[]): InvoiceReaderChoice[] {
  const ids = new Set(invoiceReaderChoices.map((choice) => choice.id));
  const extra = custom
    .filter((reader) => reader.id && reader.vendorName && !ids.has(reader.id))
    .map((reader) => ({ id: reader.id, vendorName: reader.vendorName, catalog: reader.catalog }));
  return [...invoiceReaderChoices, ...extra];
}

function readerList(custom: CustomInvoiceReader[]): InvoiceReader[] {
  const customReaders = custom.map((vendor): InvoiceReader => ({
    id: vendor.id,
    vendorName: vendor.vendorName,
    catalog: vendor.catalog,
    detect(text: string): boolean {
      return vendorNameInText(vendor.vendorName, text) && /\bINVOICE\b/i.test(text);
    },
    parse(rows) {
      return parseGenericInvoicePages([rows], vendor)[0] ?? null;
    },
  }));
  return [...readers, ...customReaders];
}

export function invoiceReaderUsesCatalog(readerId: string, custom: CustomInvoiceReader[] = []): boolean {
  return readerList(custom).find((reader) => reader.id === readerId)?.catalog !== false;
}

function parsePages(reader: InvoiceReader, pages: Awaited<ReturnType<typeof extractPdfTextPages>>): ParsedInvoice[] {
  if (reader.id === "sherwin-williams") return parseSherwinWilliamsPages(pages);
  if (reader.id === "dunn-edwards") return parseDunnEdwardsPages(pages);
  if (reader.id === "ppg") return parsePpgPages(pages);
  if (reader.id === "benjamin-moore") return parseBenjaminMoorePages(pages);
  if (reader.id === "sunbelt") return parseSunbeltPages(pages);
  if (reader.id === "wolf-gordon") return parseWolfGordonPages(pages);
  if (reader.id.startsWith("custom-")) {
    return parseGenericInvoicePages(pages, {
      id: reader.id,
      vendorName: reader.vendorName,
      catalog: reader.catalog !== false,
    });
  }
  return [reader.parse(pages.flat())].filter((invoice) => invoice != null);
}

export async function readVendorInvoice(
  fileBytes: ArrayBuffer,
  readerId: string,
  custom: CustomInvoiceReader[] = [],
): Promise<ParsedInvoiceFile> {
  const available = readerList(custom);
  const selected = available.find((candidate) => candidate.id === readerId);
  if (!selected) throw new Error("Choose an invoice vendor.");
  const pages = await extractPdfTextPages(fileBytes);
  const text = pages.flat().map((row) => row.map((frag) => frag.str).join(" ")).join("\n");
  const reader = selected.detect(text) ? selected : available.find((candidate) => candidate.detect(text));
  if (!reader) {
    throw new Error(`This PDF is not a ${selected.vendorName} invoice.`);
  }
  const invoices = parsePages(reader, pages);
  if (invoices.length === 0) {
    throw new Error(`No priced lines were found on this ${reader.vendorName} invoice.`);
  }
  return { vendorName: reader.vendorName, readerId: reader.id, invoices };
}
