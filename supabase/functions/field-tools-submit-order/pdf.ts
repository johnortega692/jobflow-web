import { PDFDocument, StandardFonts, rgb, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import { embedLogoImage, type OrderBranding } from "./branding.ts";
import { resolveDisplayCompanyName } from "../displayCompanyName.ts";
import { formatDateNeeded } from "./dates.ts";

export type LineItem = {
  name: string;
  quantity?: string;
  detail?: string;
  raw?: string;
};

export type MaterialPdfInput = {
  branding: OrderBranding;
  jobCode: string;
  jobName: string;
  poNumber: string;
  siteContact: string;
  siteContactLabel?: string;
  vendor: string;
  pm: string;
  super: string;
  dateNeeded: string;
  notes: string;
  paint: LineItem[];
  sundries: LineItem[];
  additional: LineItem[];
};

export type ListPdfInput = {
  branding: OrderBranding;
  title: string;
  jobCode: string;
  jobName: string;
  poNumber?: string;
  siteContact: string;
  siteContactLabel?: string;
  dateNeeded: string;
  notes: string;
  sectionLabel: string;
  items: LineItem[];
  vendorOrRep?: string;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const LINE = 14;
const NAVY = rgb(0.102, 0.227, 0.361);
const MUTED = rgb(0.35, 0.35, 0.35);
const BORDER = rgb(0.85, 0.85, 0.85);
const ROW_ALT = rgb(0.98, 0.98, 0.98);
const HEADER_BG = rgb(0.973, 0.976, 0.98);
/** Minimum y (from bottom) reserved for footer content. */
const FOOTER_TOP = 78;
const TABLE_ROW_H = 18;
const TABLE_HEADER_BLOCK_H = 24;

type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;
type TableCol = { key: "qty" | "name" | "detail"; label: string; width: number };

type PageLayout = {
  doc: PDFDocument;
  page: PDFPage;
  font: PdfFont;
  fontBold: PdfFont;
  y: number;
  branding: OrderBranding;
  docTitle: string;
  totalItems: number;
  generatedAt: string;
};

type OrderSummaryParts = {
  totalItems: number;
  breakdown?: string;
};

/** Approximate ascender height for Helvetica (baseline → top of caps). */
function fontAscent(size: number): number {
  return size * 0.72;
}

/** Baseline y so cap height sits `padding` below a top edge at `topY`. */
function baselineBelowTop(topY: number, fontSize: number, padding: number): number {
  return topY - padding - fontAscent(fontSize);
}

function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (!words.length || (words.length === 1 && !words[0])) return [""];
  const lines: string[] = [];
  let cur = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const next = `${cur} ${words[i]!}`;
    if (font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(cur);
      cur = words[i]!;
    } else {
      cur = next;
    }
  }
  lines.push(cur);
  return lines;
}

async function drawBrandedHeader(
  doc: PDFDocument,
  page: PDFPage,
  font: PdfFont,
  fontBold: PdfFont,
  y: number,
  branding: OrderBranding,
  title: string,
  poNumber?: string,
): Promise<number> {
  let cursorY = y;
  let textX = MARGIN;
  const titleSize = 17;
  const logo = await embedLogoImage(doc, branding.logoUrl);
  let logoLh = 0;
  let headerTop = cursorY;
  let headerBottom = cursorY - 28;

  if (logo) {
    const maxH = 46;
    const scale = Math.min(maxH / logo.height, 150 / logo.width, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    logoLh = lh;
    page.drawImage(logo, { x: MARGIN, y: cursorY - lh, width: lw, height: lh });
    textX = MARGIN + lw + 14;
    headerBottom = cursorY - lh;
  } else {
    page.drawText(resolveDisplayCompanyName(branding.companyName, 22), {
      x: MARGIN,
      y: cursorY - 12,
      size: 11,
      font: fontBold,
      color: MUTED,
    });
    headerBottom = cursorY - 24;
  }

  const headerMid = (headerTop + headerBottom) / 2;
  const titleBaseline = headerMid - titleSize * 0.35;
  page.drawText(title, { x: textX, y: titleBaseline, size: titleSize, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

  if (poNumber) {
    const badge = `PO# ${poNumber}`;
    const badgeH = 16;
    const badgeW = fontBold.widthOfTextAtSize(badge, 10) + 14;
    const badgeX = PAGE_W - MARGIN - badgeW;
    const badgeY = headerMid - badgeH / 2;
    page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: NAVY });
    page.drawText(badge, { x: badgeX + 7, y: badgeY + 4, size: 10, font: fontBold, color: rgb(1, 1, 1) });
  }

  const lineY = headerBottom - 10;
  page.drawLine({
    start: { x: MARGIN, y: lineY },
    end: { x: PAGE_W - MARGIN, y: lineY },
    thickness: 0.75,
    color: BORDER,
  });
  return lineY - 14;
}

function startNewPage(
  layout: PageLayout,
  continuedSection?: string,
  sectionProgress?: { itemStart: number; itemTotal: number },
): void {
  layout.page = layout.doc.addPage([PAGE_W, PAGE_H]);
  layout.y = PAGE_H - MARGIN;

  if (continuedSection) {
    let label = `${continuedSection} (continued)`;
    if (sectionProgress) {
      label =
        `${continuedSection} (continued — items ${sectionProgress.itemStart}–${sectionProgress.itemTotal} of ${sectionProgress.itemTotal})`;
    }
    layout.page.drawText(label, {
      x: MARGIN,
      y: layout.y - 10,
      size: 10,
      font: layout.fontBold,
      color: MUTED,
    });
    layout.y -= 26;
    layout.page.drawLine({
      start: { x: MARGIN, y: layout.y },
      end: { x: PAGE_W - MARGIN, y: layout.y },
      thickness: 0.5,
      color: BORDER,
    });
    layout.y -= 12;
  }
}

function ensureVerticalSpace(layout: PageLayout, needed: number): void {
  if (layout.y - needed < FOOTER_TOP) {
    startNewPage(layout, layout.docTitle);
  }
}

function drawMetaBlock(
  layout: PageLayout,
  rows: { label: string; value: string; bold?: boolean }[],
): number {
  const labelW = 78;
  const valueMaxW = PAGE_W - MARGIN * 2 - labelW - 8;

  for (const row of rows) {
    if (!row.value.trim()) continue;
    const valueFont = row.bold ? layout.fontBold : layout.font;
    const valueColor = row.bold ? rgb(0.82, 0.14, 0.16) : rgb(0.15, 0.15, 0.15);
    const lines = wrapText(row.value, valueFont, 10, valueMaxW);
    ensureVerticalSpace(layout, lines.length * LINE + 2);

    layout.page.drawText(row.label, { x: MARGIN, y: layout.y, size: 9, font: layout.fontBold, color: MUTED });
    let lineY = layout.y;
    for (const line of lines) {
      layout.page.drawText(line, {
        x: MARGIN + labelW,
        y: lineY,
        size: 10,
        font: valueFont,
        color: valueColor,
      });
      lineY -= LINE;
    }
    layout.y = lineY - 2;
  }
  return layout.y;
}

function drawDeliveryNotesBox(
  layout: PageLayout,
  notes: string,
  label = "Delivery notes:",
  gapBefore = 10,
): number {
  const padX = 12;
  const padTop = 14;
  const padBottom = 12;
  const labelSize = 9;
  const bodySize = 9;
  const labelBodyGap = 6;
  const bodyLeading = 12;
  const boxW = PAGE_W - MARGIN * 2;
  const textW = boxW - padX * 2;
  const bodyLines = wrapText(notes, layout.font, bodySize, textW);

  const contentH = padTop + labelSize + labelBodyGap + bodyLines.length * bodyLeading + padBottom;
  layout.y -= gapBefore;
  ensureVerticalSpace(layout, contentH + 16);

  const boxTop = layout.y;
  const labelBaseline = baselineBelowTop(boxTop, labelSize, padTop);
  let lastBaseline = labelBaseline;
  if (bodyLines.length) {
    lastBaseline = labelBaseline - labelSize - labelBodyGap - (bodyLines.length - 1) * bodyLeading;
  }
  const boxBottom = lastBaseline - bodySize * 0.28 - padBottom;
  const boxH = boxTop - boxBottom;

  layout.page.drawRectangle({
    x: MARGIN,
    y: boxBottom,
    width: boxW,
    height: boxH,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: BORDER,
    borderWidth: 0.75,
  });

  layout.page.drawText(label, {
    x: MARGIN + padX,
    y: labelBaseline,
    size: labelSize,
    font: layout.fontBold,
    color: NAVY,
  });
  let bodyBaseline = labelBaseline - labelSize - labelBodyGap;
  for (const line of bodyLines) {
    layout.page.drawText(line, {
      x: MARGIN + padX,
      y: bodyBaseline,
      size: bodySize,
      font: layout.font,
      color: rgb(0.25, 0.25, 0.25),
    });
    bodyBaseline -= bodyLeading;
  }

  layout.y = boxBottom - 16;
  return layout.y;
}

function sectionTitleBlockH(): number {
  return 10 + fontAscent(12) + 10;
}

function drawSectionTitle(layout: PageLayout, title: string, itemCount?: number): void {
  const titleSize = 12;
  layout.y -= 10;
  const label = itemCount != null && itemCount > 0
    ? `${title} (${itemCount} item${itemCount === 1 ? "" : "s"})`
    : title;
  layout.page.drawText(label, { x: MARGIN, y: layout.y, size: titleSize, font: layout.fontBold, color: NAVY });
  layout.y -= fontAscent(titleSize) + 10;
}

function drawTableColumnHeader(layout: PageLayout, cols: TableCol[], tableW: number): void {
  const headerH = 18;
  const headerTop = layout.y;
  const headerBottom = headerTop - headerH;
  layout.page.drawRectangle({ x: MARGIN, y: headerBottom, width: tableW, height: headerH, color: HEADER_BG });
  layout.page.drawRectangle({
    x: MARGIN,
    y: headerBottom,
    width: tableW,
    height: headerH,
    borderColor: BORDER,
    borderWidth: 0.5,
  });

  let colX = MARGIN + 6;
  const headerBaseline = baselineBelowTop(headerTop, 9, 5);
  for (const col of cols) {
    layout.page.drawText(col.label, {
      x: colX,
      y: headerBaseline,
      size: 9,
      font: layout.fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    colX += col.width;
  }
  layout.y = headerBottom - 6;
}

function drawTableRow(
  layout: PageLayout,
  item: LineItem,
  index: number,
  cols: TableCol[],
  tableW: number,
): void {
  const qty = item.quantity?.trim() || "—";
  const name = item.name || item.raw || "—";
  const detail = item.detail?.trim() || "";
  const rowH = 16;
  const rowTop = layout.y;
  const rowBottom = rowTop - rowH;
  if (index % 2 === 1) {
    layout.page.drawRectangle({ x: MARGIN, y: rowBottom, width: tableW, height: rowH, color: ROW_ALT });
  }

  let x = MARGIN + 6;
  const rowBaseline = baselineBelowTop(rowTop, 9, 4);
  const values = cols.length === 1
    ? [name]
    : cols.length === 2
    ? [qty, name]
    : [qty, name, detail];

  cols.forEach((col, i) => {
    const val = values[i] ?? "";
    const maxW = col.width - 8;
    const clipped = truncate(val, layout.font, 9, maxW);
    layout.page.drawText(clipped, { x, y: rowBaseline, size: 9, font: layout.font, color: rgb(0.1, 0.1, 0.1) });
    x += col.width;
  });

  layout.page.drawLine({
    start: { x: MARGIN, y: rowBottom },
    end: { x: MARGIN + tableW, y: rowBottom },
    thickness: 0.35,
    color: BORDER,
  });
  layout.y = rowBottom - 2;
}

function drawSectionTable(layout: PageLayout, title: string, items: LineItem[], cols: TableCol[]): void {
  if (!items.length) return;

  const tableW = PAGE_W - MARGIN * 2;
  let i = 0;
  let sectionTitleDrawn = false;

  while (i < items.length) {
    const titleH = sectionTitleDrawn ? 0 : sectionTitleBlockH();
    ensureVerticalSpace(layout, titleH + TABLE_HEADER_BLOCK_H + TABLE_ROW_H);

    if (!sectionTitleDrawn) {
      drawSectionTitle(layout, title, items.length);
      sectionTitleDrawn = true;
    }

    drawTableColumnHeader(layout, cols, tableW);

    while (i < items.length) {
      if (layout.y - TABLE_ROW_H < FOOTER_TOP) {
        startNewPage(layout, title, { itemStart: i + 1, itemTotal: items.length });
        break;
      }
      drawTableRow(layout, items[i]!, i, cols, tableW);
      i++;
    }
  }

  layout.y -= 10;
}

function truncate(text: string, font: PdfFont, size: number, maxWidth: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let s = value;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function drawFooter(
  page: PDFPage,
  font: PdfFont,
  fontBold: PdfFont,
  branding: OrderBranding,
  opts: { pageNum: number; totalPages: number; totalItems: number; generatedAt: string },
): void {
  const footerSize = 8;
  const footerY = MARGIN;

  const lines = [branding.companyName, branding.companyAddress, branding.companyPhone].filter(Boolean);
  let y = footerY + 8;
  for (const line of lines) {
    page.drawText(line, { x: MARGIN, y, size: footerSize, font, color: MUTED });
    y += 10;
  }

  const itemsLabel = `${opts.totalItems} item${opts.totalItems === 1 ? "" : "s"} total`;
  const pageLabel = opts.totalPages > 1 ? `Page ${opts.pageNum} of ${opts.totalPages}` : "";
  const centerLine = pageLabel ? `${pageLabel}  ·  ${itemsLabel}` : itemsLabel;
  const centerW = fontBold.widthOfTextAtSize(centerLine, footerSize);
  page.drawText(centerLine, {
    x: (PAGE_W - centerW) / 2,
    y: footerY,
    size: footerSize,
    font: fontBold,
    color: NAVY,
  });

  const generatedLabel = `Generated ${opts.generatedAt}`;
  page.drawText(generatedLabel, {
    x: PAGE_W - MARGIN - font.widthOfTextAtSize(generatedLabel, footerSize),
    y: footerY,
    size: footerSize,
    font,
    color: MUTED,
  });
}

function stampAllPageFooters(
  doc: PDFDocument,
  font: PdfFont,
  fontBold: PdfFont,
  branding: OrderBranding,
  totalItems: number,
  generatedAt: string,
): void {
  const pages = doc.getPages();
  const totalPages = pages.length;
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i]!, font, fontBold, branding, {
      pageNum: i + 1,
      totalPages,
      totalItems,
      generatedAt,
    });
  }
}

function buildOrderSummaryLabel(parts: OrderSummaryParts): string {
  if (!parts.breakdown) {
    return `${parts.totalItems} line item${parts.totalItems === 1 ? "" : "s"}`;
  }
  return `${parts.totalItems} line items (${parts.breakdown})`;
}

function createLayout(
  doc: PDFDocument,
  font: PdfFont,
  fontBold: PdfFont,
  branding: OrderBranding,
  docTitle: string,
  totalItems: number,
): PageLayout {
  return {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    font,
    fontBold,
    y: PAGE_H - MARGIN,
    branding,
    docTitle,
    totalItems,
    generatedAt: new Date().toLocaleString(),
  };
}

export async function buildMaterialPdf(input: MaterialPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const totalItems = input.paint.length + input.sundries.length + input.additional.length;
  const breakdownParts: string[] = [];
  if (input.paint.length) breakdownParts.push(`Paint ${input.paint.length}`);
  if (input.sundries.length) breakdownParts.push(`Sundries ${input.sundries.length}`);
  if (input.additional.length) breakdownParts.push(`Additional ${input.additional.length}`);

  const layout = createLayout(doc, font, fontBold, input.branding, "Material Order", totalItems);

  layout.y = await drawBrandedHeader(
    doc,
    layout.page,
    font,
    fontBold,
    layout.y,
    input.branding,
    "Material Order",
    input.poNumber,
  );

  layout.y = drawMetaBlock(layout, [
    { label: "Job:", value: `${input.jobCode}${input.jobName ? ` — ${input.jobName}` : ""}` },
    { label: "Date needed:", value: formatDateNeeded(input.dateNeeded), bold: true },
    { label: `${input.siteContactLabel ?? "Site contact"}:`, value: input.siteContact },
    { label: "Vendor:", value: input.vendor },
    { label: "PM / Super:", value: [input.pm, input.super].filter(Boolean).join("  |  ") },
    {
      label: "Order total:",
      value: buildOrderSummaryLabel({ totalItems, breakdown: breakdownParts.join(" · ") }),
      bold: true,
    },
  ]);

  if (input.notes.trim()) {
    layout.y = drawDeliveryNotesBox(layout, input.notes);
  }

  const contentW = PAGE_W - MARGIN * 2;
  drawSectionTable(layout, "Paint", input.paint, [
    { key: "qty", label: "Qty", width: 52 },
    { key: "name", label: "Product", width: contentW * 0.42 },
    { key: "detail", label: "Sheen / Color", width: contentW * 0.38 },
  ]);
  drawSectionTable(layout, "Sundries", input.sundries, [
    { key: "qty", label: "Qty", width: 52 },
    { key: "name", label: "Item", width: contentW - 58 },
  ]);
  drawSectionTable(layout, "Additional", input.additional, [
    { key: "name", label: "Item", width: contentW - 12 },
  ]);

  stampAllPageFooters(doc, font, fontBold, input.branding, totalItems, layout.generatedAt);
  return doc.save();
}

export async function buildListPdf(input: ListPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const totalItems = input.items.length;
  const layout = createLayout(doc, font, fontBold, input.branding, input.title, totalItems);

  layout.y = await drawBrandedHeader(
    doc,
    layout.page,
    font,
    fontBold,
    layout.y,
    input.branding,
    input.title,
    input.poNumber,
  );

  layout.y = drawMetaBlock(layout, [
    { label: "Job:", value: `${input.jobCode}${input.jobName ? ` — ${input.jobName}` : ""}` },
    { label: "Date needed:", value: formatDateNeeded(input.dateNeeded), bold: true },
    { label: `${input.siteContactLabel ?? "Site contact"}:`, value: input.siteContact },
    { label: "Vendor / Rep:", value: input.vendorOrRep ?? "" },
    {
      label: "Order total:",
      value: buildOrderSummaryLabel({ totalItems }),
      bold: true,
    },
  ]);

  if (input.notes.trim()) {
    layout.y = drawDeliveryNotesBox(layout, input.notes, "Notes:");
  }

  layout.y -= 6;
  const contentW = PAGE_W - MARGIN * 2;
  drawSectionTable(layout, input.sectionLabel, input.items, [
    { key: "qty", label: "Qty", width: 52 },
    { key: "name", label: "Item", width: contentW * 0.55 },
    { key: "detail", label: "Detail", width: contentW * 0.35 },
  ]);

  stampAllPageFooters(doc, font, fontBold, input.branding, totalItems, layout.generatedAt);
  return doc.save();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
