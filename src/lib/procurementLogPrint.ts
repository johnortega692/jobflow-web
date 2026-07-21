import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildProcurementLogRowsFromLines, type ProcurementLogRow } from "./procurementLog";
import { formatLongDate, type PrintBranding } from "./printCore";
import { procurementLogFilename } from "./pdfFilenames";
import { downloadPdfBytes } from "./pdfDownload";
import {
  createLetterPdfFonts,
  drawBrandingSignatureFooter,
  drawCenteredText,
  embedLogoImage,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  measureBrandingSignatureFooterHeight,
  MUTED,
  PDF_MARGIN_TOP,
  PDF_MARGIN_X,
  TEXT,
  wrapLines,
} from "./pdfDrawCore";

// Landscape letter — the 8-column log needs the width.
const PAGE_W = LETTER_HEIGHT;
const PAGE_H = LETTER_WIDTH;

const HEADER_BG = rgb(0.2, 0.2, 0.2);
const ROW_ALT = rgb(0.98, 0.98, 0.98);
const BORDER = rgb(0.85, 0.85, 0.85);

const COLUMNS = [
  "Finish",
  "Product",
  "Lead Time (Wks)",
  "Approval Received",
  "Date Ordered",
  "Ship Date",
  "Received/Tracking",
  "Notes",
];
const COL_WEIGHTS = [7, 20, 7, 9, 9, 9, 13, 26];

const FONT_SIZE = 8.5;
const LINE_H = FONT_SIZE + 3;
const PAD_X = 4;
const PAD_Y = 4;
const CONTENT_BOTTOM = 40;

type TableCtx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  colWidths: number[];
  usable: number;
};

function rowCellLines(cells: string[], font: PDFFont, colWidths: number[]): string[][] {
  return cells.map((cell, i) => {
    const lines = wrapLines(cell, font, FONT_SIZE, colWidths[i]! - PAD_X * 2);
    return lines.length ? lines : [""];
  });
}

/** Dark header band matching the submittal table style. */
function drawHeaderRow(ctx: TableCtx): void {
  const lines = rowCellLines(COLUMNS, ctx.bold, ctx.colWidths);
  const height = Math.max(...lines.map((l) => l.length)) * LINE_H + PAD_Y * 2;
  ctx.page.drawRectangle({
    x: PDF_MARGIN_X,
    y: ctx.y - height,
    width: ctx.usable,
    height,
    color: HEADER_BG,
  });
  let x = PDF_MARGIN_X;
  lines.forEach((cellLines, i) => {
    cellLines.forEach((line, li) => {
      ctx.page.drawText(line, {
        x: x + PAD_X,
        y: ctx.y - PAD_Y - (li + 1) * LINE_H + 3,
        size: FONT_SIZE,
        font: ctx.bold,
        color: rgb(1, 1, 1),
      });
    });
    x += ctx.colWidths[i]!;
  });
  ctx.y -= height;
}

function drawBodyRow(ctx: TableCtx, cells: string[], alt: boolean): void {
  const lines = rowCellLines(cells, ctx.font, ctx.colWidths);
  const height = Math.max(...lines.map((l) => l.length)) * LINE_H + PAD_Y * 2;

  if (ctx.y - height < CONTENT_BOTTOM) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.y = ctx.page.getHeight() - PDF_MARGIN_TOP;
    drawHeaderRow(ctx);
  }

  if (alt) {
    ctx.page.drawRectangle({
      x: PDF_MARGIN_X,
      y: ctx.y - height,
      width: ctx.usable,
      height,
      color: ROW_ALT,
    });
  }

  let x = PDF_MARGIN_X;
  lines.forEach((cellLines, i) => {
    ctx.page.drawRectangle({
      x,
      y: ctx.y - height,
      width: ctx.colWidths[i]!,
      height,
      borderColor: BORDER,
      borderWidth: 0.25,
    });
    cellLines.forEach((line, li) => {
      if (!line) return;
      ctx.page.drawText(line, {
        x: x + PAD_X,
        y: ctx.y - PAD_Y - (li + 1) * LINE_H + 3,
        size: FONT_SIZE,
        font: ctx.font,
        color: TEXT,
      });
    });
    x += ctx.colWidths[i]!;
  });
  ctx.y -= height;
}

function rowToCells(row: ProcurementLogRow): string[] {
  return [
    row.finish,
    row.product,
    row.leadTime,
    row.approvalReceived,
    row.dateOrdered,
    row.shipDate,
    row.dateReceivedTracking,
    row.notes,
  ];
}

export async function buildProcurementLogPdfBytes(options: {
  jobNumber: string;
  jobName: string;
  lines: import("../types/fieldTracker").WcTrackerLineState[];
  branding: PrintBranding;
  lastUpdate?: Date;
}): Promise<Uint8Array> {
  const { jobNumber, jobName, lines, branding, lastUpdate = new Date() } = options;
  const logRows = buildProcurementLogRowsFromLines(lines);

  const doc = await PDFDocument.create();
  const { font, bold } = await createLetterPdfFonts(doc);
  const logo = await embedLogoImage(doc, branding.logoUrl);
  let page = doc.addPage([PAGE_W, PAGE_H]);
  const pageWidth = page.getWidth();
  const centerX = pageWidth / 2;
  const contentWidth = pageWidth - PDF_MARGIN_X * 2;
  let y = page.getHeight() - PDF_MARGIN_TOP;

  // Letterhead header — same layout as the submittal export.
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

  const companyFontSize = 8;
  let companyY = y - 1.5 / 2 - 3 - companyFontSize * 0.72;
  const companyLine = (branding.companyContactLine || branding.companyInfo).trim();
  if (companyLine) {
    for (const line of wrapLines(companyLine, font, companyFontSize, contentWidth)) {
      drawCenteredText(page, line, centerX, companyY, font, companyFontSize, MUTED);
      companyY -= 11;
    }
    y = companyY - 4;
  } else {
    y -= 3 + 1.5 / 2;
  }

  const detailFontSize = 10;
  const detailLineHeight = 13;

  page.drawText(`Date: ${formatLongDate(lastUpdate)}`, {
    x: PDF_MARGIN_X,
    y: y - detailFontSize,
    size: detailFontSize,
    font,
    color: TEXT,
  });
  y -= detailLineHeight + 8;

  // Centered underlined title — matches the submittal export.
  const title = "Procurement Log";
  const titleSize = 16;
  drawCenteredText(page, title, centerX, y - titleSize, bold, titleSize);
  const titleW = bold.widthOfTextAtSize(title, titleSize);
  page.drawLine({
    start: { x: centerX - titleW / 2, y: y - titleSize - 2 },
    end: { x: centerX + titleW / 2, y: y - titleSize - 2 },
    thickness: 0.75,
    color: TEXT,
  });
  y -= titleSize + 18;

  const infoLines = [
    `Project: ${jobName.trim()}`,
    ...(jobNumber.trim() ? [`Project Number: ${jobNumber.trim()}`] : []),
    `Last Update: ${formatLongDate(lastUpdate)}`,
  ];
  for (const line of infoLines) {
    page.drawText(line, {
      x: PDF_MARGIN_X,
      y: y - detailFontSize,
      size: detailFontSize,
      font,
      color: TEXT,
    });
    y -= detailLineHeight;
  }
  y -= 10;

  const weightSum = COL_WEIGHTS.reduce((a, b) => a + b, 0);
  const colWidths = COL_WEIGHTS.map((w) => (contentWidth * w) / weightSum);
  const ctx: TableCtx = { doc, page, y, font, bold, colWidths, usable: contentWidth };

  drawHeaderRow(ctx);
  if (!logRows.length) {
    ctx.page.drawText("No wallcovering materials found for this job.", {
      x: PDF_MARGIN_X,
      y: ctx.y - 14,
      size: 10,
      font,
      color: MUTED,
    });
    ctx.y -= 24;
  } else {
    logRows.forEach((row, i) => drawBodyRow(ctx, rowToCells(row), i % 2 === 1));
  }

  const footerNeed = measureBrandingSignatureFooterHeight(branding) + 10;
  if (ctx.y < footerNeed) {
    ctx.page = doc.addPage([PAGE_W, PAGE_H]);
    ctx.y = ctx.page.getHeight() - PDF_MARGIN_TOP;
  }
  drawBrandingSignatureFooter(ctx.page, pageWidth, font, bold, branding);

  return doc.save();
}

export async function downloadProcurementLogPdf(options: {
  jobNumber: string;
  jobName: string;
  lines: import("../types/fieldTracker").WcTrackerLineState[];
  branding: PrintBranding;
  lastUpdate?: Date;
}): Promise<void> {
  const bytes = await buildProcurementLogPdfBytes(options);
  downloadPdfBytes(bytes, procurementLogFilename(options.jobName, options.jobNumber));
}
