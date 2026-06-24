import { PDFDocument } from "pdf-lib";

/** Merge PDF byte arrays in order into a single document. */
export async function mergePdfBytes(parts: Uint8Array[]): Promise<Uint8Array> {
  if (!parts.length) throw new Error("No PDF parts to merge.");
  if (parts.length === 1) return parts[0]!;

  const merged = await PDFDocument.create();
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}
