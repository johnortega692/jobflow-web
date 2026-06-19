import { PDFDocument, PDFImage, PDFPage, RGB, StandardFonts, rgb } from "pdf-lib";
import { setPdfOutlines, type PdfOutlineItem } from "./pdfOutlines";
import { addInternalPageLink } from "./pdfPageLinks";
import { companyLetterheadLine, type PrintBranding } from "./printCore";
import { downloadSdsPdf } from "./sdsFileStorage";
import {
  attachmentStampLabel,
  countSectionPdfPages,
  notesFromAttachments,
  packetDocumentCount,
  packetProductCount,
  sectionAttachmentKinds,
  sectionIncludedDocuments,
  sectionHasAnyAttachment,
  sectionsGroupedByCategory,
  tocAttachmentLabel,
  tocSectionTitle,
  type SdsSectionCategory,
} from "./sdsSectionModel";
import {
  packetEndPageLabel,
  packetHeaderLine,
  resolveCoverPurpose,
  resolveCoverTitle,
} from "./sdsPacketPresets";
import type { SdsPacketData, SdsSection } from "../types/tradeDocuments";

const LETTER: [number, number] = [612, 792];
const LETTER_LANDSCAPE: [number, number] = [792, 612];

type ProjectInfo = {
  job_name: string;
  job_number: string;
  job_address: string;
};

export type BuildProgress = {
  step: string;
  percent: number;
};

type RowRect = [number, number, number, number];

type BuildContext = {
  doc: PDFDocument;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  logo: PDFImage | null;
};

function headerLine(packet: SdsPacketData): string {
  return packetHeaderLine(packet.packet_type, packet.cover_title);
}

function sectionTitle(section: SdsSection): string {
  const product = section.product.trim() || "—";
  const finish = section.finish_type.trim() || "—";
  if (product !== "—" && finish !== "—") return `${product} – ${finish}`;
  return product !== "—" ? product : "Section";
}

function categoriesInPacket(sections: SdsSection[]): SdsSectionCategory[] {
  const seen = new Set<SdsSectionCategory>();
  const out: SdsSectionCategory[] = [];
  for (const section of sectionsGroupedByCategory(sections)) {
    if (!seen.has(section.category)) {
      seen.add(section.category);
      out.push(section.category);
    }
  }
  return out;
}

async function embedLogo(doc: PDFDocument, logoUrl: string): Promise<PDFImage | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("png") || logoUrl.toLowerCase().includes(".png")) {
      return doc.embedPng(bytes);
    }
    return doc.embedJpg(bytes);
  } catch {
    return null;
  }
}


function drawPdfCheckmark(page: PDFPage, x: number, baselineY: number, size: number, color: RGB) {
  const footY = baselineY + 2;
  page.drawLine({
    start: { x, y: footY },
    end: { x: x + size * 0.38, y: footY - size * 0.38 },
    thickness: 1.25,
    color,
  });
  page.drawLine({
    start: { x: x + size * 0.38, y: footY - size * 0.38 },
    end: { x: x + size, y: footY + size * 0.5 },
    thickness: 1.25,
    color,
  });
}

/** Running header with logo (left), optional job band, packet label (right). Returns Y below rule. */
function drawRunningHeader(
  page: PDFPage,
  ctx: BuildContext,
  branding: PrintBranding,
  packet: SdsPacketData,
  project: ProjectInfo,
): number {
  const w = page.getWidth();
  const h = page.getHeight();
  const margin = 36;
  const top = h - margin;
  const showJob = Boolean(project.job_name.trim() || project.job_number.trim());
  const maxLogoW = showJob ? w * 0.28 : w * 0.38;
  const maxLogoH = 28;
  let cursorX = margin;
  let headerBottom = top - 10;

  if (ctx.logo) {
    const scale = Math.min(maxLogoW / ctx.logo.width, maxLogoH / ctx.logo.height, 1);
    const lw = ctx.logo.width * scale;
    const lh = ctx.logo.height * scale;
    page.drawImage(ctx.logo, { x: margin, y: top - lh, width: lw, height: lh });
    cursorX = margin + lw + 10;
    headerBottom = Math.min(headerBottom, top - lh - 4);
  } else {
    page.drawText(branding.companyName.toUpperCase(), {
      x: margin,
      y: top - 10,
      size: 8,
      font: ctx.bold,
      color: rgb(0.1, 0.1, 0.18),
    });
    cursorX = margin + ctx.bold.widthOfTextAtSize(branding.companyName.toUpperCase(), 8) + 12;
  }

  if (showJob) {
    let jobY = top - 10;
    if (project.job_name.trim()) {
      page.drawText(`Job Name: ${project.job_name.trim()}`, {
        x: cursorX,
        y: jobY,
        size: 8,
        font: ctx.font,
        color: rgb(0.1, 0.1, 0.18),
      });
      jobY -= 11;
      headerBottom = Math.min(headerBottom, jobY);
    }
    if (project.job_number.trim()) {
      page.drawText(`Job Number: ${project.job_number.trim()}`, {
        x: cursorX,
        y: jobY,
        size: 8,
        font: ctx.font,
        color: rgb(0.1, 0.1, 0.18),
      });
      jobY -= 11;
      headerBottom = Math.min(headerBottom, jobY);
    }
  }

  const right = headerLine(packet);
  const rw = ctx.font.widthOfTextAtSize(right, 9);
  page.drawText(right, {
    x: w - margin - rw,
    y: top - 10,
    size: 9,
    font: ctx.font,
    color: rgb(0.33, 0.33, 0.33),
  });

  const ruleY = headerBottom - 6;
  page.drawLine({
    start: { x: margin, y: ruleY },
    end: { x: w - margin, y: ruleY },
    thickness: 0.75,
    color: rgb(0.2, 0.2, 0.2),
  });

  return ruleY - 14;
}

function drawPageFooter(page: PDFPage, ctx: BuildContext, branding: PrintBranding, preparer: string) {
  const w = page.getWidth();
  const parts = [branding.companyName, branding.companyPhone, preparer || branding.signerName]
    .filter((p) => p.trim())
    .join("  |  ");
  page.drawLine({
    start: { x: 36, y: 48 },
    end: { x: w - 36, y: 48 },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  const tw = ctx.font.widthOfTextAtSize(parts, 8);
  page.drawText(parts, { x: (w - tw) / 2, y: 34, size: 8, font: ctx.font, color: rgb(0.45, 0.45, 0.45) });
}

function truncateTextToWidth(
  text: string,
  maxWidth: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
): string {
  const t = text.trim();
  if (!t) return t;
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

function columnWidthsFromWeights(tableWidth: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((wt) => Math.floor((tableWidth * wt) / total));
  const used = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1]! += tableWidth - used;
  return widths;
}

function estimateWrappedLineCount(
  text: string,
  maxWidth: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines += 1;
      line = word;
    } else {
      line = test;
    }
  }
  return lines + 1;
}

function drawWrapTextFromTop(
  page: PDFPage,
  text: string,
  x: number,
  top: number,
  maxWidth: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  color: RGB = rgb(0, 0, 0),
): number {
  const words = text.split(/\s+/);
  let line = "";
  let cursorTop = top;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      page.drawText(line, { x, y: LETTER[1] - cursorTop - size, size, font, color });
      cursorTop += size + 4;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: LETTER[1] - cursorTop - size, size, font, color });
    cursorTop += size + 4;
  }
  return cursorTop;
}

function drawCenteredLetterheadLine(
  page: PDFPage,
  ctx: BuildContext,
  text: string,
  top: number,
  pageWidth: number,
  maxWidth: number,
): number {
  const color = rgb(0.35, 0.35, 0.35);
  let size = 9;
  while (size >= 7 && ctx.font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }
  if (ctx.font.widthOfTextAtSize(text, size) <= maxWidth) {
    const lw = ctx.font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (pageWidth - lw) / 2,
      y: LETTER[1] - top - size,
      size,
      font: ctx.font,
      color,
    });
    return top + size + 8;
  }

  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let cursorTop = top;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.font.widthOfTextAtSize(test, size) > maxWidth && line) {
      const lw = ctx.font.widthOfTextAtSize(line, size);
      page.drawText(line, {
        x: (pageWidth - lw) / 2,
        y: LETTER[1] - cursorTop - size,
        size,
        font: ctx.font,
        color,
      });
      cursorTop += size + 4;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    const lw = ctx.font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x: (pageWidth - lw) / 2,
      y: LETTER[1] - cursorTop - size,
      size,
      font: ctx.font,
      color,
    });
    cursorTop += size + 4;
  }
  return cursorTop + 4;
}

async function addCoverPage(
  project: ProjectInfo,
  packet: SdsPacketData,
  branding: PrintBranding,
  ctx: BuildContext,
) {
  const page = ctx.doc.addPage(LETTER);
  const w = LETTER[0];
  const marginX = 54;
  const topMargin = 18;
  const bottomReserve = 72;
  const frameHeight = LETTER[1] - topMargin - bottomReserve;

  let logoW = 0;
  let logoH = 0;
  if (ctx.logo) {
    const scale = Math.min(240 / ctx.logo.width, 90 / ctx.logo.height, 1);
    logoW = ctx.logo.width * scale;
    logoH = ctx.logo.height * scale;
  }

  const purpose = resolveCoverPurpose(packet.packet_type, packet.cover_purpose);
  const purposeLines = estimateWrappedLineCount(purpose, w - 108, 10, ctx.font);
  const letterheadLine = companyLetterheadLine(branding);
  const letterheadBlockHeight = letterheadLine
    ? estimateWrappedLineCount(letterheadLine, w - marginX * 2, 9, ctx.font) * 13 + 8
    : 0;

  const lineReturn = 14;
  const headerTitleGap = 4 * lineReturn;
  const titlePurposeGap = 4 * lineReturn;
  const tableTopExtra = 28;

  const coverRows: [string, string][] = [
    ["Project Name", project.job_name || "—"],
    ["Job Number", project.job_number || "—"],
    ["Project Address", project.job_address || "—"],
  ];
  if (packet.spec_section.trim()) {
    coverRows.push(["Spec Section", packet.spec_section.trim()]);
  }
  coverRows.push(
    ["Categories", categoriesInPacket(packet.sections).join(", ") || "—"],
    ["Products Included", String(packetProductCount(packet.sections))],
    ["Documents Included", String(packetDocumentCount(packet.sections))],
    ["Contractor", branding.companyName || "—"],
    ["Prepared By", packet.preparer || branding.signerName || "—"],
    ["Date Submitted", packet.date || "—"],
  );

  const headerHeight =
    (ctx.logo ? logoH + 12 : 28) +
    letterheadBlockHeight +
    16;
  const titleBlockHeight =
    22 + titlePurposeGap + 14 + purposeLines * 14 + 16 + 12 + tableTopExtra;
  const tableHeight = 18 + coverRows.length * 18;
  const layoutSlack = 28 + 16 + 22 + 56;
  const gap = Math.max(
    28,
    (frameHeight - headerHeight - headerTitleGap - titleBlockHeight - tableHeight - layoutSlack) / 2,
  );

  let top = topMargin;

  if (ctx.logo) {
    page.drawImage(ctx.logo, {
      x: (w - logoW) / 2,
      y: LETTER[1] - top - logoH,
      width: logoW,
      height: logoH,
    });
    top += logoH + 12;
  } else {
    page.drawText(branding.companyName.toUpperCase(), {
      x: marginX,
      y: LETTER[1] - top - 14,
      size: 14,
      font: ctx.bold,
      color: rgb(0.1, 0.1, 0.18),
    });
    top += 28;
  }

  if (letterheadLine) {
    top = drawCenteredLetterheadLine(page, ctx, letterheadLine, top, w, w - marginX * 2);
  }

  top += headerTitleGap + gap;

  const title = resolveCoverTitle(packet.packet_type, packet.cover_title);
  const tw = ctx.bold.widthOfTextAtSize(title, 15);
  page.drawText(title, { x: (w - tw) / 2, y: LETTER[1] - top - 15, size: 15, font: ctx.bold });
  top += 22 + titlePurposeGap;

  page.drawText("Purpose:", { x: marginX, y: LETTER[1] - top - 10, size: 10, font: ctx.bold });
  top += 14;
  top = drawWrapTextFromTop(page, purpose, marginX, top, w - 108, 10, ctx.font);
  top += 16;

  page.drawLine({
    start: { x: marginX, y: LETTER[1] - top },
    end: { x: w - marginX, y: LETTER[1] - top },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  top += 12;
  top += gap + tableTopExtra;

  page.drawText("PROJECT INFORMATION", {
    x: marginX,
    y: LETTER[1] - top - 9,
    size: 9,
    font: ctx.bold,
    color: rgb(0.1, 0.1, 0.18),
  });
  top += 18;

  const rows = coverRows;

  const tableX = marginX;
  const labelW = 120;
  const rowH = 18;
  for (let i = 0; i < rows.length; i++) {
    const [label, value] = rows[i]!;
    const rowTop = top + i * rowH;
    const ry = LETTER[1] - rowTop - 10;
    const boxY = LETTER[1] - rowTop - rowH + 4;
    const fill = i % 2 === 0 ? rgb(0.12, 0.12, 0.18) : rgb(0.18, 0.18, 0.24);
    page.drawRectangle({ x: tableX, y: boxY, width: labelW, height: rowH, color: fill });
    page.drawRectangle({
      x: tableX + labelW,
      y: boxY,
      width: w - 108 - labelW,
      height: rowH,
      color: rgb(0.97, 0.97, 0.97),
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 0.5,
    });
    page.drawText(label, { x: tableX + 6, y: ry, size: 8, font: ctx.bold, color: rgb(1, 1, 1) });
    page.drawText(value, { x: tableX + labelW + 6, y: ry, size: 8, font: ctx.font });
  }

  drawPageFooter(page, ctx, branding, packet.preparer);
}

function addMaterialSummaryPage(
  project: ProjectInfo,
  packet: SdsPacketData,
  branding: PrintBranding,
  ctx: BuildContext,
): RowRect[] {
  const page = ctx.doc.addPage(LETTER_LANDSCAPE);
  const font = ctx.font;
  const bold = ctx.bold;
  const w = LETTER_LANDSCAPE[0];
  const rowRects: RowRect[] = [];
  let y = drawRunningHeader(page, ctx, branding, packet, project);

  page.drawText("PRODUCT SUMMARY", { x: w / 2 - bold.widthOfTextAtSize("PRODUCT SUMMARY", 12) / 2, y, size: 12, font: bold });
  y -= 22;

  const tableMargin = 36;
  const tableLeft = tableMargin;
  const tableWidth = w - tableMargin * 2;

  const showSpec = Boolean(packet.spec_section.trim());
  const cols = showSpec
    ? [
        "#",
        "Category",
        "System / Material",
        "Spec",
        "Product",
        "Mfg",
        "Finish",
        "Color / Pattern / Finish",
        "Notes",
      ]
    : [
        "#",
        "Category",
        "System / Material",
        "Product",
        "Mfg",
        "Finish",
        "Color / Pattern / Finish",
        "Notes",
      ];
  const widths = columnWidthsFromWeights(
    tableWidth,
    showSpec
      ? [0.04, 0.09, 0.11, 0.1, 0.16, 0.1, 0.08, 0.1, 0.22]
      : [0.04, 0.09, 0.12, 0.17, 0.1, 0.08, 0.11, 0.29],
  );
  const tableRight = tableLeft + tableWidth;
  const headerSize = 7;
  const cellSize = 6.5;
  const cellPad = 4;

  let x = tableLeft;
  for (let i = 0; i < cols.length; i++) {
    page.drawRectangle({ x, y: y - 2, width: widths[i]!, height: 14, color: rgb(0.2, 0.2, 0.2) });
    const header = truncateTextToWidth(cols[i]!, widths[i]! - cellPad, bold, headerSize);
    page.drawText(header, { x: x + 2, y, size: headerSize, font: bold, color: rgb(1, 1, 1) });
    x += widths[i]!;
  }
  y -= 16;

  const grouped = sectionsGroupedByCategory(packet.sections);
  let rowNum = 0;
  let lastCategory: SdsSectionCategory | null = null;

  for (const section of grouped) {
    if (section.category !== lastCategory) {
      lastCategory = section.category;
      const headerBottom = y - 12;
      page.drawRectangle({
        x: tableLeft,
        y: headerBottom,
        width: tableRight - tableLeft,
        height: 14,
        color: rgb(0.85, 0.85, 0.85),
        borderColor: rgb(0.7, 0.7, 0.7),
        borderWidth: 0.5,
      });
      page.drawText(section.category.toUpperCase(), {
        x: tableLeft + 4,
        y: y - 10,
        size: 7,
        font: bold,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= 14;
    }

    rowNum += 1;
    const specCell = packet.spec_section.trim() || "—";
    const row = showSpec
      ? [
          String(rowNum),
          section.category,
          section.system_material.trim() || "—",
          specCell,
          section.product.trim() || "—",
          section.manufacturer.trim() || "—",
          section.finish_type.trim() || "—",
          section.color.trim() || "—",
          notesFromAttachments(section),
        ]
      : [
          String(rowNum),
          section.category,
          section.system_material.trim() || "—",
          section.product.trim() || "—",
          section.manufacturer.trim() || "—",
          section.finish_type.trim() || "—",
          section.color.trim() || "—",
          notesFromAttachments(section),
        ];
    const rowBottom = y - 12;
    const rowTop = rowBottom + 14;
    rowRects.push([tableLeft, rowBottom, tableRight, rowTop]);

    x = tableLeft;
    const fill = rowNum % 2 === 0 ? rgb(0.98, 0.98, 0.98) : rgb(1, 1, 1);
    for (let i = 0; i < row.length; i++) {
      page.drawRectangle({
        x,
        y: rowBottom,
        width: widths[i]!,
        height: 14,
        color: fill,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.5,
      });
      const cell = truncateTextToWidth(row[i]!, widths[i]! - cellPad, font, cellSize);
      page.drawText(cell, { x: x + 2, y: y - 10, size: cellSize, font, color: rgb(0, 0, 0) });
      x += widths[i]!;
    }
    y -= 14;
  }

  drawPageFooter(page, ctx, branding, packet.preparer);
  return rowRects;
}

function addCategoryDivider(
  category: SdsSectionCategory,
  packet: SdsPacketData,
  project: ProjectInfo,
  branding: PrintBranding,
  ctx: BuildContext,
) {
  const page = ctx.doc.addPage(LETTER);
  const w = LETTER[0];
  drawRunningHeader(page, ctx, branding, packet, project);

  page.drawText(category.toUpperCase(), {
    x: w / 2 - ctx.bold.widthOfTextAtSize(category.toUpperCase(), 28) / 2,
    y: LETTER[1] / 2 + 20,
    size: 28,
    font: ctx.bold,
    color: rgb(0.1, 0.1, 0.18),
  });
  page.drawText("Product sections follow", {
    x: w / 2 - ctx.font.widthOfTextAtSize("Product sections follow", 11) / 2,
    y: LETTER[1] / 2 - 8,
    size: 11,
    font: ctx.font,
    color: rgb(0.4, 0.4, 0.4),
  });
  drawPageFooter(page, ctx, branding, packet.preparer);
}

function addSectionDivider(
  sectionNum: number,
  section: SdsSection,
  packet: SdsPacketData,
  project: ProjectInfo,
  branding: PrintBranding,
  ctx: BuildContext,
) {
  const page = ctx.doc.addPage(LETTER);
  const w = LETTER[0];
  const margin = 54;
  let y = drawRunningHeader(page, ctx, branding, packet, project);

  const title = sectionTitle(section);
  const manufacturer = section.manufacturer.trim() || "—";
  const product = section.product.trim() || "—";
  const finish = section.finish_type.trim() || "—";
  const systemMaterial = section.system_material.trim() || "—";
  const category = section.category || "—";

  page.drawText(`SECTION ${sectionNum}`, {
    x: margin,
    y,
    size: 9,
    font: ctx.font,
    color: rgb(0.33, 0.33, 0.33),
  });
  y -= 28;

  page.drawText(title, {
    x: margin,
    y,
    size: 22,
    font: ctx.bold,
    color: rgb(0.1, 0.1, 0.18),
  });
  y -= 28;

  page.drawLine({
    start: { x: margin, y },
    end: { x: w - margin, y },
    thickness: 0.75,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 18;

  const labelW = 94;
  const valueW = w - margin * 2 - labelW;
  const infoRows: [string, string][] = [
    ["Category:", category],
    ["Manufacturer:", manufacturer],
    ["Product:", product],
    ["Finish / Type:", finish],
    ["System / Material:", systemMaterial],
  ];

  for (let i = 0; i < infoRows.length; i++) {
    const [label, value] = infoRows[i]!;
    const rowY = y - i * 22;
    page.drawRectangle({
      x: margin,
      y: rowY - 18,
      width: labelW,
      height: 20,
      color: rgb(0.94, 0.94, 0.94),
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 0.5,
    });
    page.drawRectangle({
      x: margin + labelW,
      y: rowY - 18,
      width: valueW,
      height: 20,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 0.5,
    });
    page.drawText(label, { x: margin + 8, y: rowY - 12, size: 9, font: ctx.bold, color: rgb(0.1, 0.1, 0.18) });
    page.drawText(value, { x: margin + labelW + 8, y: rowY - 12, size: 9, font: ctx.font, color: rgb(0.2, 0.2, 0.2) });
  }
  y -= infoRows.length * 22 + 16;

  page.drawText("Included Documents", {
    x: margin,
    y,
    size: 10,
    font: ctx.bold,
    color: rgb(0.1, 0.1, 0.18),
  });
  y -= 18;

  const includedDocs = sectionIncludedDocuments(section);
  const checkColor = rgb(0.15, 0.15, 0.15);
  for (const doc of includedDocs) {
    drawPdfCheckmark(page, margin + 8, y, 7, checkColor);
    page.drawText(doc.label, {
      x: margin + 20,
      y,
      size: 9,
      font: ctx.font,
      color: checkColor,
    });
    y -= 14;
  }
  y -= 22;

  const bannerText = "See following page(s) for attached documents";
  const bannerW = w - margin * 2;
  const bannerH = 36;
  page.drawRectangle({
    x: margin,
    y: y - bannerH,
    width: bannerW,
    height: bannerH,
    color: rgb(0.94, 0.94, 0.94),
    borderColor: rgb(0.1, 0.1, 0.18),
    borderWidth: 1.5,
  });
  const btw = ctx.bold.widthOfTextAtSize(bannerText, 10);
  page.drawText(bannerText, {
    x: (w - btw) / 2,
    y: y - bannerH / 2 - 4,
    size: 10,
    font: ctx.bold,
    color: rgb(0.1, 0.1, 0.18),
  });

}

async function appendPdfWithStamp(
  ctx: BuildContext,
  pdfBytes: Uint8Array,
  stamp: string,
  includeStamp: boolean,
) {
  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const copied = await ctx.doc.copyPages(src, src.getPageIndices());
  for (const page of copied) {
    ctx.doc.addPage(page);
    if (includeStamp) {
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: height - 28, width, height: 28, color: rgb(0.95, 0.95, 0.95) });
      page.drawText(stamp, { x: 36, y: height - 20, size: 8, font: ctx.bold, color: rgb(0.15, 0.15, 0.15) });
    }
  }
}

function addEndPage(
  packet: SdsPacketData,
  project: ProjectInfo,
  branding: PrintBranding,
  ctx: BuildContext,
) {
  const page = ctx.doc.addPage(LETTER);
  const w = LETTER[0];
  drawRunningHeader(page, ctx, branding, packet, project);

  const label = packetEndPageLabel(packet.packet_type, packet.cover_title);
  page.drawText("End of packet", {
    x: w / 2 - ctx.bold.widthOfTextAtSize("End of packet", 18) / 2,
    y: LETTER[1] / 2 + 12,
    size: 18,
    font: ctx.bold,
    color: rgb(0.1, 0.1, 0.18),
  });
  page.drawText(`This is the end of the ${label} packet.`, {
    x: w / 2 - ctx.font.widthOfTextAtSize(`This is the end of the ${label} packet.`, 10) / 2,
    y: LETTER[1] / 2 - 8,
    size: 10,
    font: ctx.font,
    color: rgb(0.4, 0.4, 0.4),
  });
  drawPageFooter(page, ctx, branding, packet.preparer);
}

function addMaterialSummaryLinks(
  doc: PDFDocument,
  summaryPageIndex: number,
  rowRects: RowRect[],
  sectionStartPages: number[],
) {
  const summaryPage = doc.getPage(summaryPageIndex);
  for (let i = 0; i < rowRects.length; i++) {
    const target = sectionStartPages[i];
    const rect = rowRects[i];
    if (target === undefined || !rect) continue;
    addInternalPageLink(summaryPage, target, rect);
  }
}

type TocEntry = {
  level: 0 | 1 | 2;
  label: string;
  pageIndex: number;
};

function adjustPageIndexAfterTocInsert(pageIndex: number, tocInsertAt: number, tocPageCount: number): number {
  return pageIndex >= tocInsertAt ? pageIndex + tocPageCount : pageIndex;
}

const TOC_TITLE_BLOCK = 72;
const TOC_BOTTOM_RESERVE = 72;

function tocRowsPerPage(fontSize: number): number {
  const usable = LETTER[1] - TOC_TITLE_BLOCK - TOC_BOTTOM_RESERVE;
  return Math.max(1, Math.floor(usable / (fontSize + 8)));
}

function drawTocRow(
  page: PDFPage,
  ctx: BuildContext,
  y: number,
  leftText: string,
  pageNum: number,
  targetPageIndex: number,
  margin: number,
  contentWidth: number,
  fontSize: number,
  bold: boolean,
): number {
  const font = bold ? ctx.bold : ctx.font;
  const rightText = String(pageNum);
  const leftW = font.widthOfTextAtSize(leftText, fontSize);
  const rightW = ctx.font.widthOfTextAtSize(rightText, fontSize);
  const dotsWidth = contentWidth - leftW - rightW - 12;
  const dotW = ctx.font.widthOfTextAtSize(".", fontSize);
  const dotCount = Math.max(3, Math.floor(dotsWidth / dotW));
  const dots = ".".repeat(dotCount);

  page.drawText(leftText, { x: margin, y, size: fontSize, font });
  page.drawText(dots, {
    x: margin + leftW + 4,
    y,
    size: fontSize,
    font: ctx.font,
    color: rgb(0.55, 0.55, 0.55),
  });
  page.drawText(rightText, { x: margin + contentWidth - rightW, y, size: fontSize, font: ctx.font });

  addInternalPageLink(page, targetPageIndex, [margin, y - 2, margin + contentWidth, y + fontSize + 4]);

  return y - (fontSize + 8);
}

function insertTableOfContents(
  doc: PDFDocument,
  ctx: BuildContext,
  packet: SdsPacketData,
  project: ProjectInfo,
  branding: PrintBranding,
  tocEntries: TocEntry[],
  tocInsertIndex: number,
): number {
  const fontSize = tocEntries.length > 40 ? 8 : 9;
  const rowsPerPage = tocRowsPerPage(fontSize);
  const tocPageCount = Math.max(1, Math.ceil(tocEntries.length / rowsPerPage));

  for (let p = 0; p < tocPageCount; p++) {
    doc.insertPage(tocInsertIndex + p);
  }

  let topLevelNum = 0;
  const numbered = tocEntries.map((entry) => {
    if (entry.level === 0 || entry.level === 1) {
      topLevelNum += 1;
      return { ...entry, displayNumber: topLevelNum };
    }
    return { ...entry, displayNumber: undefined as number | undefined };
  });

  const margin = 54;
  const w = LETTER[0];
  const contentWidth = w - margin * 2;

  for (let p = 0; p < tocPageCount; p++) {
    const page = doc.getPage(tocInsertIndex + p);
    let y = drawRunningHeader(page, ctx, branding, packet, project);

    if (p === 0) {
      const title = "TABLE OF CONTENTS";
      page.drawText(title, {
        x: w / 2 - ctx.bold.widthOfTextAtSize(title, 14) / 2,
        y,
        size: 14,
        font: ctx.bold,
      });
      y -= 28;
    } else {
      y -= 8;
    }

    const slice = numbered.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    for (const entry of slice) {
      const indent = entry.level === 2 ? 24 : 0;
      const prefix = entry.displayNumber !== undefined ? `${entry.displayNumber}. ` : "";
      const label = truncateTextToWidth(
        `${prefix}${entry.label}`,
        contentWidth - indent - ctx.font.widthOfTextAtSize("999. ", fontSize),
        entry.level <= 1 ? ctx.bold : ctx.font,
        fontSize,
      );
      const targetPageIndex = adjustPageIndexAfterTocInsert(entry.pageIndex, tocInsertIndex, tocPageCount);
      const displayPageNum = targetPageIndex + 1;
      y = drawTocRow(
        page,
        ctx,
        y,
        label,
        displayPageNum,
        targetPageIndex,
        margin + indent,
        contentWidth - indent,
        fontSize,
        entry.level <= 1,
      );
    }

    drawPageFooter(page, ctx, branding, packet.preparer);
  }

  return tocPageCount;
}

export async function buildSdsPacketPdf(
  project: ProjectInfo,
  packet: SdsPacketData,
  branding: PrintBranding,
  onProgress?: (p: BuildProgress) => void,
): Promise<Uint8Array> {
  if (!packet.sections.length) {
    throw new Error("Add at least one section before building the packet.");
  }
  const missingFiles = packet.sections.filter((s) => !sectionHasAnyAttachment(s));
  if (missingFiles.length) {
    throw new Error("Each section needs at least one file attachment (product data, SDS, warranty, etc.).");
  }

  const groupedSections = sectionsGroupedByCategory(packet.sections);

  const totalSteps =
    (packet.include_cover ? 1 : 0) +
    (packet.include_toc ? 1 : 0) +
    1 +
    groupedSections.reduce((n, s, i, arr) => {
      const categoryBreak =
        packet.include_dividers && (i === 0 || s.category !== arr[i - 1]!.category) ? 1 : 0;
      return n + categoryBreak + (packet.include_dividers ? 1 : 0) + countSectionPdfPages(s);
    }, 0) +
    (packet.include_end ? 1 : 0);
  let step = 0;
  const tick = (label: string) => {
    step += 1;
    onProgress?.({ step: label, percent: Math.round((step / totalSteps) * 100) });
  };

  const doc = await PDFDocument.create();
  doc.setTitle(`${project.job_name || project.job_number || "Job"} Submittal Package`);
  doc.setAuthor(branding.companyName);
  doc.setCreator("JobFlow Web");

  const ctx: BuildContext = {
    doc,
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    logo: await embedLogo(doc, branding.logoUrl),
  };

  const outlines: PdfOutlineItem[] = [];
  let summaryPageIndex: number | null = null;
  let summaryRowRects: RowRect[] = [];
  const sectionStartPages: number[] = [];
  const tocEntries: TocEntry[] = [];

  const pageCount = () => doc.getPageCount();

  if (packet.include_cover) {
    tick("Cover page");
    await addCoverPage(project, packet, branding, ctx);
    outlines.push({ title: "Cover", to: pageCount() - 1 });
  }

  tick("Product summary");
  summaryRowRects = addMaterialSummaryPage(project, packet, branding, ctx);
  summaryPageIndex = pageCount() - 1;
  outlines.push({ title: "Product Summary", to: summaryPageIndex });
  if (packet.include_toc) {
    tocEntries.push({ level: 0, label: "Product Summary", pageIndex: summaryPageIndex });
  }

  for (let i = 0; i < groupedSections.length; i++) {
    const section = groupedSections[i]!;
    const num = i + 1;
    sectionStartPages.push(pageCount());

    if (packet.include_toc) {
      tocEntries.push({ level: 1, label: tocSectionTitle(section), pageIndex: pageCount() });
    }

    if (packet.include_dividers) {
      if (i === 0 || section.category !== groupedSections[i - 1]!.category) {
        tick(`Category: ${section.category}`);
        addCategoryDivider(section.category, packet, project, branding, ctx);
      }
      tick(`Section ${num} divider`);
      addSectionDivider(num, section, packet, project, branding, ctx);
    }

    const stamp = `Section ${num}: ${sectionTitle(section)}`;
    for (const kind of sectionAttachmentKinds(section)) {
      const attachment = section.attachments[kind];
      if (!attachment?.path) continue;
      const label = attachmentStampLabel(kind);
      if (packet.include_toc) {
        tocEntries.push({ level: 2, label: tocAttachmentLabel(kind), pageIndex: pageCount() });
      }
      tick(`Section ${num} ${label}`);
      const bytes = await downloadSdsPdf(attachment.path);
      await appendPdfWithStamp(ctx, bytes, `${stamp} — ${label}`, packet.include_stamp);
    }

    outlines.push({ title: `Section ${num}: ${sectionTitle(section)}`, to: sectionStartPages[i]! });
  }

  if (packet.include_end) {
    tick("End page");
    addEndPage(packet, project, branding, ctx);
  }

  let tocPageCount = 0;
  const tocInsertIndex = packet.include_cover ? 1 : 0;
  if (packet.include_toc && tocEntries.length) {
    tick("Table of contents");
    tocPageCount = insertTableOfContents(doc, ctx, packet, project, branding, tocEntries, tocInsertIndex);
    outlines.splice(tocInsertIndex, 0, { title: "Table of Contents", to: tocInsertIndex });
    for (const item of outlines) {
      if (item.title !== "Table of Contents") {
        item.to = adjustPageIndexAfterTocInsert(item.to, tocInsertIndex, tocPageCount);
      }
    }
    if (summaryPageIndex !== null) {
      summaryPageIndex = adjustPageIndexAfterTocInsert(summaryPageIndex, tocInsertIndex, tocPageCount);
    }
    for (let i = 0; i < sectionStartPages.length; i++) {
      sectionStartPages[i] = adjustPageIndexAfterTocInsert(sectionStartPages[i]!, tocInsertIndex, tocPageCount);
    }
  }

  if (summaryPageIndex !== null && summaryRowRects.length && sectionStartPages.length) {
    addMaterialSummaryLinks(doc, summaryPageIndex, summaryRowRects, sectionStartPages);
  }

  try {
    setPdfOutlines(doc, outlines);
  } catch {
    // Outlines are optional — do not fail the build.
  }

  onProgress?.({ step: "Saving PDF…", percent: 100 });
  return doc.save();
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
