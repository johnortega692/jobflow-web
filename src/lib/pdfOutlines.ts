import { PDFDocument, PDFHexString, PDFRef } from "pdf-lib";

/** Flat PDF bookmark (page index is 0-based). */
export type PdfOutlineItem = {
  title: string;
  to: number;
};

/**
 * Add a document outline (bookmarks panel) via pdf-lib low-level objects.
 * Adapted from marp-cli (MIT): https://github.com/marp-team/marp-cli
 */
export function setPdfOutlines(doc: PDFDocument, outlines: readonly PdfOutlineItem[]): void {
  if (!outlines.length) return;

  const rootRef = doc.context.nextRef();
  const itemRefs: PDFRef[] = outlines.map(() => doc.context.nextRef());

  const pageRefs: PDFRef[] = [];
  doc.catalog.Pages().traverse((kid, ref) => {
    if (kid.get(kid.context.obj("Type"))?.toString() === "/Page") {
      pageRefs.push(ref);
    }
  });

  for (let i = 0; i < outlines.length; i++) {
    const outline = outlines[i]!;
    const ref = itemRefs[i]!;
    const pageIndex = outline.to;
    const dest =
      pageIndex >= 0 && pageIndex < pageRefs.length
        ? { Dest: [pageRefs[pageIndex], "Fit"] }
        : {};

    doc.context.assign(
      ref,
      doc.context.obj({
        Title: PDFHexString.fromText(outline.title),
        Parent: rootRef,
        ...(i > 0 ? { Prev: itemRefs[i - 1] } : {}),
        ...(i < outlines.length - 1 ? { Next: itemRefs[i + 1] } : {}),
        ...dest,
      }),
    );
  }

  doc.context.assign(
    rootRef,
    doc.context.obj({
      Type: "Outlines",
      First: itemRefs[0],
      Last: itemRefs[outlines.length - 1],
      Count: outlines.length,
    }),
  );

  doc.catalog.set(doc.context.obj("Outlines"), rootRef);
}
