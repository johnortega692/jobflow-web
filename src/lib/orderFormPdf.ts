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
  /** Table body + header text size. Defaults to body/date size (10). */
  fontSize?: number;
};

export type OrderFormPdfOptions = {
  filename: string;
  branding: PrintBranding;
  /** Defaults to Material Purchase Order. */
  title?: string;
  /** Sequential PO e.g. 1058-002 — shown as badge + info row. */
  poNumber?: string;
  /** Letter landscape (wider table). Default portrait. */
  landscape?: boolean;
  /** Tighter page margins (~0.25in). Default uses shared letter margins. */
  narrowMargins?: boolean;
  infoRows: { label: string; value: string }[];
  detailsSectionTitle: string;
  table: OrderFormPdfTable;
  deliverySettings?: DeliverySchedulingSettings;
};

/** ~0.25in — matches RFI / tight print layouts. */
const NARROW_MARGIN_X = 18;
const NARROW_MARGIN_TOP = 18;
const NARROW_MARGIN_BOTTOM = 24;

/** Body text size — matches the date line. Title + company letterhead stay larger/smaller. */
const BODY_SIZE = 10;
const BODY_LINE = 13;
const TITLE_SIZE = 16;
const COMPANY_NAME_SIZE = 14;
const COMPANY_CONTACT_SIZE = 9;

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
    landscape = false,
    narrowMargins = false,
    infoRows,
    detailsSectionTitle,
    table,
    deliverySettings = DEFAULT_DELIVERY_SCHEDULING,
  } = options;
  const ds = deliverySettings;
  const marginX = narrowMargins ? NARROW_MARGIN_X : PDF_MARGIN_X;
  const marginTop = narrowMargins ? NARROW_MARGIN_TOP : PDF_MARGIN_TOP;
  const marginBottom = narrowMargins ? NARROW_MARGIN_BOTTOM : PDF_MARGIN_BOTTOM;
  const doc = await PDFDocument.create();
  const { font, bold } = await createLetterPdfFonts(doc);
  const logo = await embedLogoImage(doc, branding.logoUrl);
  const pageSize: [number, number] = landscape
    ? [LETTER_HEIGHT, LETTER_WIDTH]
    : [LETTER_WIDTH, LETTER_HEIGHT];
  let page = doc.addPage(pageSize);
  const pageWidth = page.getWidth();
  const centerX = pageWidth / 2;
  const contentWidth = pageWidth - marginX * 2;
  const footerTop = marginBottom;
  let y = page.getHeight() - marginTop;

  if (logo) {
    const maxW = 280;
    const maxH = 72;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawImage(logo, { x: centerX - lw / 2, y: y - lh, width: lw, height: lh });
    y -= lh + 8;
  } else if (branding.companyName.trim()) {
    drawCenteredText(page, branding.companyName, centerX, y - COMPANY_NAME_SIZE, bold, COMPANY_NAME_SIZE);
    y -= COMPANY_NAME_SIZE + 8;
  }

  page.drawLine({
    start: { x: marginX, y },
    end: { x: pageWidth - marginX, y },
    thickness: 1.5,
    color: TEXT,
  });
  y -= 10;

  const contact = (branding.companyContactLine || branding.companyInfo).trim();
  if (contact) {
    y = drawCenteredWrappedText(
      page,
      contact,
      centerX,
      y,
      contentWidth,
      font,
      COMPANY_CONTACT_SIZE,
      COMPANY_CONTACT_SIZE + 3,
    );
    y -= 14;
  }

  page.drawText(formatLongDate(), {
    x: marginX,
    y: y - BODY_SIZE,
    size: BODY_SIZE,
    font,
    color: TEXT,
  });

  const po = poNumber?.trim() ?? "";
  if (po) {
    const badge = `PO# ${po}`;
    const badgeSize = BODY_SIZE;
    const badgePadX = 10;
    const badgePadY = 5;
    const badgeW = bold.widthOfTextAtSize(badge, badgeSize) + badgePadX * 2;
    const badgeH = badgeSize + badgePadY * 2;
    const badgeX = pageWidth - marginX - badgeW;
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

  drawCenteredText(page, title, centerX, y - TITLE_SIZE, bold, TITLE_SIZE);
  const titleW = bold.widthOfTextAtSize(title, TITLE_SIZE);
  page.drawLine({
    start: { x: centerX - titleW / 2, y: y - TITLE_SIZE - 4 },
    end: { x: centerX + titleW / 2, y: y - TITLE_SIZE - 4 },
    thickness: 1,
    color: TEXT,
  });
  y -= 40;

  for (const row of infoRows) {
    const line = `${row.label}: ${row.value}`.trim();
    if (!line || line === `${row.label}:`) continue;
    y = drawWrappedText(page, line, marginX, y, contentWidth, font, BODY_SIZE, BODY_LINE);
    y -= 2;
  }
  y -= 8;

  let state: PdfTableState = { doc, page, y, font, bold };
  state = drawSectionTitle(state, detailsSectionTitle, footerTop, marginX, marginTop);

  if (!table.rows.length) {
    state = ensureSpace(state, 28, footerTop, marginTop);
    state.page.drawText("No items have been added to this order form yet.", {
      x: marginX,
      y: state.y - BODY_SIZE,
      size: BODY_SIZE,
      font,
      color: MUTED,
    });
    state = { ...state, y: state.y - 28 };
  } else {
    state = drawDataTable(
      state,
      marginX,
      table.columns,
      table.colWeights,
      table.rows,
      table.fontSize ?? BODY_SIZE,
      footerTop,
      { aligns: table.aligns, borders: table.borders, padY: table.padY, headerPadY: table.headerPadY, marginTop },
    );
  }

  state = drawSectionTitle(state, "DELIVERY SCHEDULING INFORMATION", footerTop, marginX, marginTop);

  type DeliveryLine =
    | { kind: "text"; text: string; bold?: boolean; size?: number }
    | { kind: "labeled"; label: string; value: string; size?: number };

  const deliveryLines: DeliveryLine[] = [
    { kind: "text", text: "Warehouse Contact Info:", bold: true, size: BODY_SIZE },
    {
      kind: "text",
      text: `  o  ${ds.warehouse_contact_name} - ${ds.warehouse_contact_email} - Cell: ${ds.warehouse_contact_cell}`,
      size: BODY_SIZE,
    },
    { kind: "text", text: `  o  Main Office: ${ds.warehouse_main_office}`, size: BODY_SIZE },
    { kind: "labeled", label: "Receiving Hours:", value: ds.receiving_hours, size: BODY_SIZE },
    { kind: "labeled", label: "Dock Restrictions:", value: ds.dock_restrictions, size: BODY_SIZE },
    { kind: "labeled", label: "Is a lift gate needed?", value: ds.lift_gate_needed, size: BODY_SIZE },
    { kind: "text", text: "", size: BODY_SIZE },
    { kind: "text", text: ds.closing_note, size: BODY_SIZE },
  ];

  for (const entry of deliveryLines) {
    const size = entry.size ?? BODY_SIZE;
    if (entry.kind === "text") {
      const useBold = Boolean(entry.bold);
      const lines = wrapLines(entry.text, useBold ? state.bold : state.font, size, contentWidth);
      for (const wrapped of lines.length ? lines : [""]) {
        state = ensureSpace(state, size + 4, footerTop, marginTop);
        if (wrapped) {
          state.page.drawText(wrapped, {
            x: marginX,
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
      state = ensureSpace(state, size + 4, footerTop, marginTop);
      if (index === 0) {
        state.page.drawText(label, {
          x: marginX,
          y: state.y - size,
          size,
          font: state.bold,
          color: TEXT,
        });
        if (wrapped) {
          state.page.drawText(wrapped, {
            x: marginX + labelWidth,
            y: state.y - size,
            size,
            font: state.font,
            color: TEXT,
          });
        }
      } else if (wrapped) {
        state.page.drawText(wrapped, {
          x: marginX + labelWidth,
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
  state = drawOrderThankYouInFlow(state, branding, footerTop, marginX, marginTop);

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
  marginX: number,
  marginTop: number,
): PdfTableState {
  const lines = orderThankYouLines(branding);
  const lineHeight = BODY_LINE;
  const thankYouSize = BODY_SIZE;
  const signerSize = BODY_SIZE;
  const gapAfterClosing = 20;
  const gapAfterThankYou = 18;
  const blockHeight =
    gapAfterClosing + thankYouSize + gapAfterThankYou + Math.max(lines.length, 1) * lineHeight;

  let next = ensureSpace(state, blockHeight, contentBottom, marginTop);
  next = { ...next, y: next.y - gapAfterClosing };

  next.page.drawText("Thank you,", {
    x: marginX,
    y: next.y - thankYouSize,
    size: thankYouSize,
    font: next.bold,
    color: TEXT,
  });
  next = { ...next, y: next.y - thankYouSize - gapAfterThankYou };

  for (const line of lines) {
    next.page.drawText(line, {
      x: marginX,
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

function drawSectionTitle(
  state: PdfTableState,
  title: string,
  footerTop: number,
  marginX: number,
  marginTop: number,
): PdfTableState {
  const height = 22;
  let next = ensureSpace(state, height + 8, footerTop, marginTop);
  const pageWidth = next.page.getWidth();
  const width = pageWidth - marginX * 2;
  next.page.drawRectangle({
    x: marginX,
    y: next.y - height,
    width,
    height,
    color: rgb(0.94, 0.94, 0.94),
  });
  next.page.drawRectangle({
    x: marginX,
    y: next.y - height,
    width: 4,
    height,
    color: rgb(0.2, 0.2, 0.2),
  });
  next.page.drawText(title, {
    x: marginX + 12,
    y: next.y - height + 6,
    size: BODY_SIZE,
    font: next.bold,
    color: TEXT,
  });
  return { ...next, y: next.y - height - 10 };
}

function ensureSpace(
  state: PdfTableState,
  need: number,
  footerTop: number,
  marginTop: number,
): PdfTableState {
  if (state.y - need >= footerTop) return state;
  const page = state.doc.addPage([state.page.getWidth(), state.page.getHeight()]);
  return { ...state, page, y: page.getHeight() - marginTop };
}
