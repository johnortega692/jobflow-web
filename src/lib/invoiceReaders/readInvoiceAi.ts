import { authFetch } from "../apiAuth";
import {
  invoiceVendorNamesMatch,
  normalizeClaudeInvoice,
  parsedFileFromClaudeRead,
  type ClaudeInvoiceRead,
} from "./claudeInvoice";
import type { CustomInvoiceReader } from "./genericInvoice";
import type { ParsedInvoiceFile } from "./types";

const MAX_PDF_BYTES = 3_200_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function readApiJson(res: Response): Promise<ClaudeInvoiceRead & { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as ClaudeInvoiceRead & { error?: string };
  } catch {
    const snippet = text.trim().slice(0, 160);
    if (snippet.includes("FUNCTION_INVOCATION_FAILED") || snippet.startsWith("A server error")) {
      throw new Error("Invoice reading is not available yet. Add ANTHROPIC_API_KEY in Vercel, then redeploy.");
    }
    throw new Error(snippet || `Could not read that invoice (${res.status}).`);
  }
}

async function fetchClaudeInvoice(bytes: Uint8Array, vendorName: string): Promise<ClaudeInvoiceRead> {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("That PDF is too large to read. Use a file under 3 MB.");
  }
  const res = await authFetch("/api/read-invoice", {
    method: "POST",
    body: JSON.stringify({
      pdf_base64: bytesToBase64(bytes),
      vendor_name: vendorName,
    }),
  });
  const body = await readApiJson(res);
  if (!res.ok) throw new Error(body.error ?? `Could not read that invoice (${res.status}).`);
  const read = normalizeClaudeInvoice(body);
  if (read.lines.length === 0) throw new Error("No priced lines were found on this invoice.");
  return read;
}

export async function readCustomInvoice(bytes: Uint8Array, vendor: CustomInvoiceReader): Promise<ParsedInvoiceFile> {
  const read = await fetchClaudeInvoice(bytes, vendor.vendorName);
  return parsedFileFromClaudeRead(read, vendor);
}

export async function readCustomInvoicePreview(
  bytes: Uint8Array,
  vendor: CustomInvoiceReader,
  pdfText: string,
): Promise<{ file: ParsedInvoiceFile; nameMatches: boolean }> {
  const read = await fetchClaudeInvoice(bytes, vendor.vendorName);
  return {
    file: parsedFileFromClaudeRead(read, vendor),
    nameMatches: invoiceVendorNamesMatch(vendor.vendorName, pdfText) || invoiceVendorNamesMatch(vendor.vendorName, read.vendorName),
  };
}
