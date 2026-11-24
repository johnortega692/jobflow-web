import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type InvoiceStampFields = {
  gl: string;
  job: string;
  costCode: string;
  costClass: string;
  approved: string;
  notes: string;
};

/** Box on a page. x and y are the top-left, each value is a fraction of that page. */
export type InvoiceStampPlacement = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function defaultInvoiceStampPlacement(): InvoiceStampPlacement {
  return { pageIndex: 0, x: 0.62, y: 0.03, width: 0.35, height: 0.1 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let next = text;
  while (next.length > 1 && font.widthOfTextAtSize(`${next}…`, size) > maxWidth) next = next.slice(0, -1);
  return `${next}…`;
}

type PreparedStamp = {
  gl: string;
  job: string;
  costCode: string;
  costClass: string;
  approved: string;
  notes: string;
};

export type InvoiceStampMark = {
  fields: InvoiceStampFields;
  placement?: InvoiceStampPlacement;
};

function preparedFields(fields: InvoiceStampFields): PreparedStamp {
  const gl = fields.gl.trim();
  const job = fields.job.trim();
  const costCode = fields.costCode.trim();
  const costClass = fields.costClass.trim();
  const approved = fields.approved.trim();
  const notes = fields.notes.trim();
  if (!gl || !job || !costCode || !costClass || !approved) {
    throw new Error("Enter the GL, job, cost code, cost class, and who approved it before stamping.");
  }
  return { gl, job, costCode, costClass, approved, notes };
}

function drawStamp(
  page: ReturnType<PDFDocument["getPages"]>[number],
  font: PDFFont,
  bold: PDFFont,
  fields: PreparedStamp,
  placement: InvoiceStampPlacement,
) {
  const ink = rgb(0.7, 0.08, 0.1);
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const boxW = clamp(placement.width, 0.12, 1) * pageW;
  const boxH = clamp(placement.height, 0.08, 1) * pageH;
  const x = clamp(placement.x, 0, 1 - boxW / pageW) * pageW;
  const y = pageH - clamp(placement.y, 0, 1 - boxH / pageH) * pageH - boxH;
  const size = 6;
  const outer = 2.25;
  const pad = 4;
  const lineH = 9;
  const rows = [
    { label: "GL", value: fields.gl },
    { label: "JOB#", value: fields.job },
    { label: "COST CODE", value: fields.costCode },
    { label: "COST CLASS", value: fields.costClass },
    { label: "APPROVED", value: fields.approved },
    { label: "NOTES", value: fields.notes },
  ];

  page.drawRectangle({
    x,
    y,
    width: boxW,
    height: boxH,
    borderColor: ink,
    borderWidth: 0.9,
    color: rgb(1, 1, 1),
  });
  page.drawRectangle({
    x: x + outer,
    y: y + outer,
    width: Math.max(4, boxW - outer * 2),
    height: Math.max(4, boxH - outer * 2),
    borderColor: ink,
    borderWidth: 0.6,
  });
  rows.forEach((row, index) => {
    const baseline = y + boxH - outer - pad - size - index * lineH;
    const title = `${row.label}:`;
    page.drawText(title, { x: x + outer + pad, y: baseline, size, font: bold, color: ink });
    const titleW = bold.widthOfTextAtSize(title, size);
    const lineX = x + outer + pad + titleW + 3;
    const lineEnd = x + boxW - outer - pad;
    const lineY = baseline - 1;
    if (lineEnd > lineX + 8) {
      page.drawLine({
        start: { x: lineX, y: lineY },
        end: { x: lineEnd, y: lineY },
        thickness: 0.6,
        color: ink,
      });
    }
    const value = fit(row.value, font, size, Math.max(8, lineEnd - lineX - 4));
    if (value) page.drawText(value, { x: lineX + 2, y: baseline, size, font, color: ink });
  });
}

/** Draw every stamp onto one copy. The source bytes are left unchanged. */
export async function stampInvoicePdfMany(
  source: ArrayBuffer | Uint8Array,
  marks: InvoiceStampMark[],
): Promise<Uint8Array> {
  const prepared = marks.map((mark) => ({
    fields: preparedFields(mark.fields),
    placement: mark.placement ?? defaultInvoiceStampPlacement(),
  }));
  const doc = await PDFDocument.load(source, { ignoreEncryption: true });
  const pages = doc.getPages();
  if (!pages.length) throw new Error("This PDF has no pages.");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const mark of prepared) {
    const page = pages[clamp(mark.placement.pageIndex, 0, pages.length - 1)];
    if (!page) throw new Error("This PDF has no pages.");
    drawStamp(page, font, bold, mark.fields, mark.placement);
  }
  return doc.save();
}

/** Draw a received stamp. The source bytes are left unchanged. */
export async function stampInvoicePdf(
  source: ArrayBuffer | Uint8Array,
  fields: InvoiceStampFields,
  placement: InvoiceStampPlacement = defaultInvoiceStampPlacement(),
): Promise<Uint8Array> {
  return stampInvoicePdfMany(source, [{ fields, placement }]);
}
