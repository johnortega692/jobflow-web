import { PDFDocument, PDFImage, PDFPage, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import {
  normalizeLogoUrl,
  submittalFooterCompanyLines,
  submittalFooterSignerLines,
  type PrintBranding,
} from "./printCore";

export const LETTER_WIDTH = 612;
export const LETTER_HEIGHT = 792;
export const PDF_MARGIN_X = 39;
export const PDF_MARGIN_TOP = 25;
export const PDF_MARGIN_BOTTOM = 36;
/** @deprecated Use PDF_MARGIN_TOP / PDF_MARGIN_BOTTOM */
export const PDF_MARGIN_Y = PDF_MARGIN_BOTTOM;

const HEADER_BG = rgb(0.2, 0.2, 0.2);
const ROW_ALT = rgb(0.98, 0.98, 0.98);
const BORDER = rgb(0.85, 0.85, 0.85);
const TEXT = rgb(0, 0, 0);
const MUTED = rgb(0.35, 0.35, 0.35);

export function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let s = value;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const out: string[] = [];
  for (const paragraph of normalized.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = words[0]!;
    for (let i = 1; i < words.length; i += 1) {
      const next = `${line} ${words[i]!}`;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else {
        out.push(line);
        line = words[i]!;
      }
    }
    out.push(line);
  }
  return out;
}

export async function embedLogoImage(doc: PDFDocument, logoUrl: string): Promise<PDFImage | null> {
  const url = normalizeLogoUrl(logoUrl.trim());
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("png") || url.toLowerCase().includes(".png")) return doc.embedPng(bytes);
    return doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

export function drawCheckbox(page: PDFPage, x: number, baselineY: number, size: number, checked: boolean): void {
  page.drawRectangle({
    x,
    y: baselineY - 1,
    width: size,
    height: size,
    borderColor: TEXT,
    borderWidth: 0.75,
  });
  if (!checked) return;
  drawPdfCheckmark(page, x, baselineY, size, TEXT);
}

function drawPdfCheckmark(page: PDFPage, x: number, baselineY: number, size: number, color: ReturnType<typeof rgb>) {
  const footY = baselineY + 1;
  page.drawLine({
    start: { x, y: footY },
    end: { x: x + size * 0.38, y: footY - size * 0.38 },
    thickness: 1.1,
    color,
  });
  page.drawLine({
    start: { x: x + size * 0.38, y: footY - size * 0.38 },
    end: { x: x + size, y: footY + size * 0.45 },
    thickness: 1.1,
    color,
  });
}

export function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  topY: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight = size + 3,
): number {
  let y = topY;
  for (const line of wrapLines(text, font, size, maxWidth)) {
    if (line) page.drawText(line, { x, y: y - size, size, font, color: TEXT });
    y -= lineHeight;
  }
  return y;
}

export function drawCenteredText(
  page: PDFPage,
  text: string,
  centerX: number,
  y: number,
  font: PDFFont,
  size: number,
  color = TEXT,
): void {
  const value = text.trim();
  if (!value) return;
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: centerX - width / 2, y, size, font, color });
}

export function drawRightAlignedText(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color = TEXT,
): void {
  const value = text.trim();
  if (!value) return;
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: rightX - width, y, size, font, color });
}

export function measureBrandingSignatureFooterHeight(branding: PrintBranding): number {
  const leftCount = submittalFooterSignerLines(branding).length;
  const rightCount = submittalFooterCompanyLines(branding).length;
  const rowCount = Math.max(leftCount, rightCount, 1);
  return PDF_MARGIN_BOTTOM + 14 + 10 + rowCount * 13 + 4;
}

export function drawBrandingSignatureFooter(
  page: PDFPage,
  pageWidth: number,
  font: PDFFont,
  bold: PDFFont,
  branding: PrintBranding,
): void {
  const rightX = pageWidth - PDF_MARGIN_X;
  const leftLines = submittalFooterSignerLines(branding);
  const rightLines = submittalFooterCompanyLines(branding);
  if (!leftLines.length && !rightLines.length) return;

  const signerSize = 10.5;
  const companySize = 9;
  const lineHeight = 13;
  const padAfterRule = 10;
  const rowCount = Math.max(leftLines.length, rightLines.length, 1);
  const ruleY = PDF_MARGIN_BOTTOM + rowCount * lineHeight + padAfterRule;

  page.drawLine({
    start: { x: PDF_MARGIN_X, y: ruleY },
    end: { x: rightX, y: ruleY },
    thickness: 0.75,
    color: TEXT,
  });

  const firstBaseline = ruleY - padAfterRule - signerSize * 0.85;
  const rightOffset = Math.max(0, leftLines.length - rightLines.length);

  leftLines.forEach((line, index) => {
    page.drawText(line, {
      x: PDF_MARGIN_X,
      y: firstBaseline - index * lineHeight,
      size: signerSize,
      font: index === 0 ? bold : font,
      color: TEXT,
    });
  });

  rightLines.forEach((line, index) => {
    drawRightAlignedText(
      page,
      line,
      rightX,
      firstBaseline - (index + rightOffset) * lineHeight,
      font,
      companySize,
      MUTED,
    );
  });
}

export type PdfTableState = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
};

export function drawDataTable(
  state: PdfTableState,
  margin: number,
  columns: string[],
  colWeights: number[],
  rows: string[][],
  fontSize = 9,
): PdfTableState {
  const rowHeight = fontSize + 6;
  const headerHeight = rowHeight + 2;
  let { doc, page, y, font, bold } = state;
  const pageWidth = page.getWidth();
  const usable = pageWidth - margin * 2;
  const weightSum = colWeights.reduce((a, b) => a + b, 0);
  const colWidths = colWeights.map((w) => (usable * w) / weightSum);

  function newPageIfNeeded(need: number) {
    if (y - need >= margin) return;
    page = doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    y = page.getHeight() - margin;
  }

  function drawHeader() {
    newPageIfNeeded(headerHeight);
    let x = margin;
    columns.forEach((col, i) => {
      page.drawRectangle({
        x,
        y: y - headerHeight,
        width: colWidths[i]!,
        height: headerHeight,
        color: HEADER_BG,
      });
      page.drawText(truncate(col, bold, fontSize, colWidths[i]! - 4), {
        x: x + 3,
        y: y - headerHeight + 3,
        size: fontSize,
        font: bold,
        color: rgb(1, 1, 1),
      });
      x += colWidths[i]!;
    });
    y -= headerHeight;
  }

  drawHeader();

  rows.forEach((row, ri) => {
    newPageIfNeeded(rowHeight);
    if (ri % 2 === 1) {
      page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: ROW_ALT });
    }
    let x = margin;
    row.forEach((cell, ci) => {
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width: colWidths[ci]!,
        height: rowHeight,
        borderColor: BORDER,
        borderWidth: 0.25,
      });
      page.drawText(truncate(cell, font, fontSize, colWidths[ci]! - 4), {
        x: x + 3,
        y: y - rowHeight + 3,
        size: fontSize,
        font,
        color: TEXT,
      });
      x += colWidths[ci]!;
    });
    y -= rowHeight;
  });

  return { doc, page, y: y - 8, font, bold };
}

export async function createLetterPdfFonts(doc: PDFDocument) {
  return {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

export { MUTED, TEXT };
