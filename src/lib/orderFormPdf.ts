import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { downloadPdfBytes } from "./pdfDownload";
import type { DeliverySchedulingSettings } from "./deliverySettings";
import { DEFAULT_DELIVERY_SCHEDULING } from "./deliverySettings";
import {
  createLetterPdfFonts,
  drawCenteredText,
  drawDataTable,
  drawWrappedText,
  embedLogoImage,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  MUTED,
  PDF_MARGIN_BOTTOM,
  PDF_MARGIN_TOP,
  PDF_MARGIN_X,
  TEXT,
  wrapLines,
  type PdfTableState,
} from "./pdfDrawCore";
import { formatLongDate, type PrintBranding } from "./printCore";

export const MATERIAL_PURCHASE_ORDER_TITLE = "Material Purchase Order";

export type OrderFormPdfTable = {
  columns: string[];
  colWeights: number[];
  rows: string[][];
  aligns?: Array<"left" | "right" | "center">;
  borders?: "grid" | "rows";
  padY?: number;
  headerPadY?: number;
};

export type OrderFormPdfOptions = {
  filename: string;
  branding: PrintBranding;
  /** Defaults to Material Purchase Order. */
  title?: string;
  /** Sequential PO e.g. 1058-002 — shown as badge + info row. */
  poNumber?: string;
  infoRows: { label: string; value: string }[];
  detailsSectionTitle: string;
  table: OrderFormPdfTable;
  deliverySettings?: DeliverySchedulingSettings;
};

/**
 * Purchase / material order form PDF (pdf-lib download — same path as paint submittals).
 */
export async function buildOrderFormPdfBytes(
  options: Omit<OrderFormPdfOptions, "filename">,
): Promise<Uint8Array> {
  const {
    branding,
    title = MATERIAL_PURCHASE_ORDER_TITLE,
    poNumber,
    infoRows,
    detailsSectionTitle,
    table,
    deliverySettings = DEFAULT_DELIVERY_SCHEDULING,
  } = options;
  const ds = deliverySettings;
  const doc = await PDFDocument.create();
  const { font, bold } = await createLetterPdfFonts(doc);
  const logo = await embedLogoImage(doc, branding.logoUrl);
  let page = doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  const pageWidth = page.getWidth();
  const centerX = pageWidth / 2;
  const contentWidth = pageWidth - PDF_MARGIN_X * 2;
  const footerTop = PDF_MARGIN_BOTTOM;
  let y = page.getHeight() - PDF_MARGIN_TOP;

  if (logo) {
    const maxW = 280;
    const maxH = 72;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawImage(logo, { x: centerX - lw / 2, y: y - lh, width: lw, height: lh });
    y -= lh + 8;
  } else if (branding.companyName.trim()) {
    drawCenteredText(page, branding.companyName, centerX, y - 14, bold, 14);
    y -= 22;
  }

  page.drawLine({
    start: { x: PDF_MARGIN_X, y },
    end: { x: pageWidth - PDF_MARGIN_X, y },
    thickness: 1.5,
    color: TEXT,
  });
  y -= 10;

  const contact = (branding.companyContactLine || branding.companyInfo).trim();
  if (contact) {
    y = drawCenteredWrappedText(page, contact, centerX, y, contentWidth, font, 9, 12);
    y -= 14;
  }

  page.drawText(formatLongDate(), {
    x: PDF_MARGIN_X,
    y: y - 10,
    size: 10,
    font,
    color: TEXT,
  });

  const po = poNumber?.trim() ?? "";
  if (po) {
    const badge = `PO# ${po}`;
    const badgeSize = 11;
    const badgePadX = 10;
    const badgePadY = 5;
    const badgeW = bold.widthOfTextAtSize(badge, badgeSize) + badgePadX * 2;
    const badgeH = badgeSize + badgePadY * 2;
    const badgeX = pageWidth - PDF_MARGIN_X - badgeW;
    const badgeY = y - badgeH;
    page.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeW,
      height: badgeH,
      color: rgb(0, 0, 0),
    });
    page.drawText(badge, {
      x: badgeX + badgePadX,
      y: badgeY + badgePadY,
      size: badgeSize,
      font: bold,
      color: rgb(1, 1, 1),
    });
  }
  y -= 28;

  drawCenteredText(page, title, centerX, y - 14, bold, 16);
  const titleW = bold.widthOfTextAtSize(title, 16);
  page.drawLine({
    start: { x: centerX - titleW / 2, y: y - 18 },
    end: { x: centerX + titleW / 2, y: y - 18 },
    thickness: 1,
    color: TEXT,
  });
  y -= 40;

  for (const row of infoRows) {
    const line = `${row.label}: ${row.value}`.trim();
    if (!line || line === `${row.label}:`) continue;
    y = drawWrappedText(page, line, PDF_MARGIN_X, y, contentWidth, font, 11, 15);
    y -= 2;
  }
  y -= 8;

  let state: PdfTableState = { doc, page, y, font, bold };
  state = drawSectionTitle(state, detailsSectionTitle, footerTop);

  if (!table.rows.length) {
    state = ensureSpace(state, 28, footerTop);
    state.page.drawText("No items have been added to this order form yet.", {
      x: PDF_MARGIN_X,
      y: state.y - 11,
      size: 11,
      font,
      color: MUTED,
    });
    state = { ...state, y: state.y - 28 };
  } else {
    state = drawDataTable(
      state,
      PDF_MARGIN_X,
      table.columns,
      table.colWeights,
      table.rows,
      9,
      footerTop,
      { aligns: table.aligns, borders: table.borders, padY: table.padY, headerPadY: table.headerPadY },
    );
  }

  state = drawSectionTitle(state, "DELIVERY SCHEDULING INFORMATION", footerTop);

  type DeliveryLine =
    | { kind: "text"; text: string; bold?: boolean; size?: number }
    | { kind: "labeled"; label: string; value: string; size?: number };

  const deliveryLines: DeliveryLine[] = [
    { kind: "text", text: "Warehouse Contact Info:", bold: true, size: 11 },
    {
      kind: "text",
      text: `  o  ${ds.warehouse_contact_name} - ${ds.warehouse_contact_email} - Cell: ${ds.warehouse_contact_cell}`,
      size: 10,
    },
    { kind: "text", text: `  o  Main Office: ${ds.warehouse_main_office}`, size: 10 },
    { kind: "labeled", label: "Receiving Hours:", value: ds.receiving_hours, size: 11 },
    { kind: "labeled", label: "Dock Restrictions:", value: ds.dock_restrictions, size: 11 },
    { kind: "labeled", label: "Is a lift gate needed?", value: ds.lift_gate_needed, size: 11 },
    { kind: "text", text: "", size: 10 },
    { kind: "text", text: ds.closing_note, size: 10 },
  ];

  for (const entry of deliveryLines) {
    const size = entry.size ?? 10;
    if (entry.kind === "text") {
      const useBold = Boolean(entry.bold);
      const lines = wrapLines(entry.text, useBold ? state.bold : state.font, size, contentWidth);
      for (const wrapped of lines.length ? lines : [""]) {
        state = ensureSpace(state, size + 4, footerTop);
        if (wrapped) {
          state.page.drawText(wrapped, {
            x: PDF_MARGIN_X,
            y: state.y - size,
            size,
            font: useBold ? state.bold : state.font,
            color: TEXT,
          });
        }
        state = { ...state, y: state.y - (size + 4) };
      }
      continue;
    }

    const label = entry.label.trim();
    const value = entry.value.trim();
    const labelWidth = state.bold.widthOfTextAtSize(`${label} `, size);
    const valueMax = Math.max(40, contentWidth - labelWidth);
    const valueLines = value ? wrapLines(value, state.font, size, valueMax) : [""];

    valueLines.forEach((wrapped, index) => {
      state = ensureSpace(state, size + 4, footerTop);
      if (index === 0) {
        state.page.drawText(label, {
          x: PDF_MARGIN_X,
          y: state.y - size,
          size,
          font: state.bold,
          color: TEXT,
        });
        if (wrapped) {
          state.page.drawText(wrapped, {
            x: PDF_MARGIN_X + labelWidth,
            y: state.y - size,
            size,
            font: state.font,
            color: TEXT,
          });
        }
      } else if (wrapped) {
        state.page.drawText(wrapped, {
          x: PDF_MARGIN_X + labelWidth,
          y: state.y - size,
          size,
          font: state.font,
          color: TEXT,
        });
      }
      state = { ...state, y: state.y - (size + 4) };
    });
  }

  // Signature in normal flow (~20pt after closing paragraph), not page-bottom anchored.
  state = drawOrderThankYouInFlow(state, branding, footerTop);

  return doc.save();
}

export async function downloadOrderFormPdf(options: OrderFormPdfOptions): Promise<void> {
  const { filename, ...rest } = options;
  downloadPdfBytes(await buildOrderFormPdfBytes(rest), filename);
}

function orderThankYouLines(branding: PrintBranding): string[] {
  return [branding.footerName, branding.footerPhone, branding.footerEmail]
    .map((v) => v.trim())
    .filter(Boolean);
}

function drawOrderThankYouInFlow(
  state: PdfTableState,
  branding: PrintBranding,
  contentBottom: number,
): PdfTableState {
  const lines = orderThankYouLines(branding);
  const lineHeight = 14;
  const thankYouSize = 11;
  const signerSize = 10.5;
  const gapAfterClosing = 20;
  const gapAfterThankYou = 18;
  const blockHeight =
    gapAfterClosing + thankYouSize + gapAfterThankYou + Math.max(lines.length, 1) * lineHeight;

  let next = ensureSpace(state, blockHeight, contentBottom);
  next = { ...next, y: next.y - gapAfterClosing };

  next.page.drawText("Thank you,", {
    x: PDF_MARGIN_X,
    y: next.y - thankYouSize,
    size: thankYouSize,
    font: next.bold,
    color: TEXT,
  });
  next = { ...next, y: next.y - thankYouSize - gapAfterThankYou };

  for (const line of lines) {
    next.page.drawText(line, {
      x: PDF_MARGIN_X,
      y: next.y - signerSize,
      size: signerSize,
      font: next.font,
      color: TEXT,
    });
    next = { ...next, y: next.y - lineHeight };
  }

  return next;
}

function drawCenteredWrappedText(
  page: PDFPage,
  text: string,
  centerX: number,
  topY: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
): number {
  let y = topY;
  for (const line of wrapLines(text, font, size, maxWidth)) {
    if (line) drawCenteredText(page, line, centerX, y - size, font, size);
    y -= lineHeight;
  }
  return y;
}

function drawSectionTitle(state: PdfTableState, title: string, footerTop: number): PdfTableState {
  const height = 22;
  let next = ensureSpace(state, height + 8, footerTop);
  const pageWidth = next.page.getWidth();
  const width = pageWidth - PDF_MARGIN_X * 2;
  next.page.drawRectangle({
    x: PDF_MARGIN_X,
    y: next.y - height,
    width,
    height,
    color: rgb(0.94, 0.94, 0.94),
  });
  next.page.drawRectangle({
    x: PDF_MARGIN_X,
    y: next.y - height,
    width: 4,
    height,
    color: rgb(0.2, 0.2, 0.2),
  });
  next.page.drawText(title, {
    x: PDF_MARGIN_X + 12,
    y: next.y - height + 6,
    size: 11,
    font: next.bold,
    color: TEXT,
  });
  return { ...next, y: next.y - height - 10 };
}

function ensureSpace(state: PdfTableState, need: number, footerTop: number): PdfTableState {
  if (state.y - need >= footerTop) return state;
  const page = state.doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  return { ...state, page, y: page.getHeight() - PDF_MARGIN_TOP };
}
