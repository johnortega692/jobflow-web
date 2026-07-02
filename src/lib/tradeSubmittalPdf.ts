import { PDFDocument, rgb } from "pdf-lib";
import { downloadPdfBytes } from "./pdfDownload";
import {
  createLetterPdfFonts,
  drawBrandingSignatureFooter,
  drawCenteredText,
  drawDataTable,
  drawWrappedText,
  embedLogoImage,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  measureBrandingSignatureFooterHeight,
  MUTED,
  PDF_MARGIN_TOP,
  PDF_MARGIN_X,
  TEXT,
  truncate,
  wrapLines,
} from "./pdfDrawCore";
import { formatSubmittalDisplayDate } from "./dateInputUtils";
import type { ProjectPrintInfo } from "./jobInfo";
import {
  formatRevisionNumberDisplay,
  formatSubmittalNumberDisplay,
  isSubmittalRevision,
  submittalProjectInfoLines,
  type PrintBranding,
} from "./printCore";

export type SubmittalPdfFloorSection = {
  floorLabel?: string;
  columns: string[];
  colWeights: number[];
  rows: string[][];
};

export type TradeSubmittalPdfOptions = {
  filename: string;
  project: ProjectPrintInfo;
  branding: PrintBranding;
  date: string;
  subject: string;
  submittalNumber?: number | string;
  revisionNumber?: number | string;
  revisionNote?: string;
  sections: SubmittalPdfFloorSection[];
};

export async function buildTradeSubmittalPdfBytes(
  options: Omit<TradeSubmittalPdfOptions, "filename">,
): Promise<Uint8Array> {
  const { project, branding, date, subject, submittalNumber, revisionNumber, revisionNote, sections } = options;
  const doc = await PDFDocument.create();
  const { font, bold } = await createLetterPdfFonts(doc);
  const logo = await embedLogoImage(doc, branding.logoUrl);
  let page = doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  const pageWidth = page.getWidth();
  const centerX = pageWidth / 2;
  const contentWidth = pageWidth - PDF_MARGIN_X * 2;
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

  const companyFontSize = 8;
  const headerLineToCompanyGap = 3;
  let companyY =
    y - 1.5 / 2 - headerLineToCompanyGap - companyFontSize * 0.72;

  const companyLine = (branding.companyContactLine || branding.companyInfo).trim();
  if (companyLine) {
    for (const line of wrapLines(companyLine, font, companyFontSize, contentWidth)) {
      drawCenteredText(page, line, centerX, companyY, font, companyFontSize, MUTED);
      companyY -= 11;
    }
    y = companyY - 4;
  } else {
    y -= headerLineToCompanyGap + 1.5 / 2;
  }

  const detailFontSize = 10;
  const detailLineHeight = 13;

  const dateLines: string[] = [];
  if (date.trim()) dateLines.push(`Date: ${formatSubmittalDisplayDate(date)}`);
  if (submittalNumber !== undefined && submittalNumber !== null && String(submittalNumber).trim() !== "") {
    dateLines.push(`Submittal No: ${formatSubmittalNumberDisplay(submittalNumber)}`);
    if (isSubmittalRevision(revisionNumber)) {
      dateLines.push(`Revision: ${formatRevisionNumberDisplay(revisionNumber)}`);
    }
  }
  for (const line of dateLines) {
    page.drawText(line, { x: PDF_MARGIN_X, y: y - detailFontSize, size: detailFontSize, font, color: TEXT });
    y -= detailLineHeight;
  }
  y -= 8;

  const title = "Submittals";
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

  const infoLines = submittalProjectInfoLines(project);

  for (const line of infoLines) {
    page.drawText(truncate(line, font, detailFontSize, contentWidth), {
      x: PDF_MARGIN_X,
      y: y - detailFontSize,
      size: detailFontSize,
      font,
      color: TEXT,
    });
    y -= detailLineHeight;
  }

  y -= detailLineHeight;
  page.drawText(truncate(`Subject: ${subject.trim()}`, font, detailFontSize, contentWidth), {
    x: PDF_MARGIN_X,
    y: y - detailFontSize,
    size: detailFontSize,
    font,
    color: TEXT,
  });
  y -= detailLineHeight;

  const note = revisionNote?.trim();
  if (note && isSubmittalRevision(revisionNumber)) {
    y -= 4;
    page.drawText("Revision Note:", {
      x: PDF_MARGIN_X,
      y: y - detailFontSize,
      size: detailFontSize,
      font: bold,
      color: TEXT,
    });
    y -= detailLineHeight;
    y = drawWrappedText(page, note, PDF_MARGIN_X, y, contentWidth, font, detailFontSize) - 4;
  }

  y -= 8;

  let state = { doc, page, y, font, bold };
  if (!sections.length || sections.every((s) => !s.rows.length)) {
    page.drawText("No items.", {
      x: PDF_MARGIN_X,
      y: y - 11,
      size: 11,
      font,
      color: MUTED,
    });
    y -= 20;
    state = { ...state, y };
  } else {
    for (const section of sections) {
      if (!section.rows.length) continue;
      if (section.floorLabel?.trim()) {
        state.page.drawText(section.floorLabel.trim().toUpperCase(), {
          x: PDF_MARGIN_X,
          y: state.y - 11,
          size: 11,
          font: state.bold,
          color: rgb(0.2, 0.2, 0.2),
        });
        state.y -= 16;
      }
      state = drawDataTable(
        state,
        PDF_MARGIN_X,
        section.columns,
        section.colWeights,
        section.rows,
        9,
      );
    }
  }

  const footerTop = measureBrandingSignatureFooterHeight(branding) + 10;
  if (state.y < footerTop) {
    page = doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    state = { ...state, page, y: page.getHeight() - PDF_MARGIN_TOP };
  }

  drawBrandingSignatureFooter(state.page, pageWidth, state.font, state.bold, branding);

  return doc.save();
}

export async function downloadTradeSubmittalPdf(options: TradeSubmittalPdfOptions): Promise<void> {
  const { filename, ...rest } = options;
  downloadPdfBytes(await buildTradeSubmittalPdfBytes(rest), filename);
}
