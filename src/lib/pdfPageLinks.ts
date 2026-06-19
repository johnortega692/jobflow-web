import { PDFArray, PDFName, PDFPage } from "pdf-lib";

/** Internal page link — rect is PDF coords [left, bottom, right, top]. */
export function addInternalPageLink(
  page: PDFPage,
  targetPageIndex: number,
  rect: [number, number, number, number],
): void {
  const doc = page.doc;
  const pages = doc.getPages();
  const target = pages[targetPageIndex];
  if (!target) return;

  const link = doc.context.register(
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rect,
      Border: [0, 0, 0],
      Dest: [target.ref, "Fit"],
    }),
  );

  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) {
    existing.push(link);
  } else {
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  }
}
