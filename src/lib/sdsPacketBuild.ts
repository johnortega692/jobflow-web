import { PDFDocument, PDFImage, PDFPage, RGB, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { wrapLines } from "./pdfDrawCore";
import { setPdfOutlines, type PdfOutlineItem } from "./pdfOutlines";
import { addInternalPageLink } from "./pdfPageLinks";
import { paintItemsForPackageSchedule } from "./paintPackageLink";
import { buildPaintSystemSchedule, paintScheduleFromSnapshot, type PaintSystemSchedule } from "./paintSystemSchedule";
import type { PaintProduct } from "./paintCatalog";
import type { PaintItem, SdsPacketData, SdsSection } from "../types/tradeDocuments";
import { companyLetterheadLine, formatSubmittalNumberDisplay, type PrintBranding } from "./printCore";
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
  sdsPacketSpecSectionsLabel,
  sortSdsSectionsBySpec,
  tocAttachmentLabel,
  tocSectionTitle,
} from "./sdsSectionModel";
import {
  packetEndPageLabel,
  packetHeaderLine,
  resolveCoverPurpose,
  resolveCoverTitle,
} from "./sdsPacketPresets";

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

const STAMP_RED = rgb(0.75, 0.08, 0.1);

function sectionTitle(section: SdsSection): string {
  const product = section.product.trim() || "—";
  const finish = section.finish_type.trim() || "—";
  if (product !== "—" && finish !== "—") return `${product} – ${finish}`;
  return product !== "—" ? product : "Section";
}

function fitStampLines(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const lines = wrapLines(text, font, size, maxWidth);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? "";
  while (last && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[maxLines - 1] = last ? `${last}…` : "…";
  return kept;
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

function wrapCellLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const source = text.trim();
  if (!source || source === "—") return ["—"];
  const wrapped = wrapLines(source, font, size, maxWidth);
  const lines: string[] = [];
  for (const line of wrapped) {
    if (font.widthOfTextAtSize(line, size) <= maxWidth) {
      lines.push(line);
      continue;
    }
    let rest = line;
    while (rest) {
      let end = rest.length;
      while (end > 1 && font.widthOfTextAtSize(rest.slice(0, end), size) > maxWidth) end -= 1;
      lines.push(rest.slice(0, end));
      rest = rest.slice(end);
    }
  }
  return lines.length ? lines : ["—"];
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
  colorSchedule?: string,
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
  const coverSpecs = sdsPacketSpecSectionsLabel(packet.sections);
  if (coverSpecs) {
    coverRows.push([coverSpecs.includes(";") ? "Spec Sections" : "Spec Section", coverSpecs]);
  }
  if (colorSchedule?.trim()) {
    coverRows.push(["Color schedule", colorSchedule.trim()]);
  }
  coverRows.push(
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

type ProductSummaryColumn = {
  header: string;
  weight: number;
  cell: (section: SdsSection, rowNum: number) => string;
};

function summaryCell(value: string): string {
  const trimmed = value.trim();
  return trimmed === "—" ? "" : trimmed;
}

function productSummaryColumns(sections: SdsSection[]): ProductSummaryColumn[] {
  const showSpec = sections.some((section) => section.spec_section.trim());
  const candidates: (ProductSummaryColumn & { optional: boolean })[] = [
    { header: "#", weight: 0.04, optional: false, cell: (_section: SdsSection, rowNum) => String(rowNum) },
    {
      header: "System / Material",
      weight: showSpec ? 0.14 : 0.16,
      optional: true,
      cell: (section) => summaryCell(section.system_material),
    },
  ];
  if (showSpec) {
    candidates.push({
      header: "Spec",
      weight: 0.13,
      optional: false,
      cell: (section) => summaryCell(section.spec_section),
    });
  }
  candidates.push(
    {
      header: "Product",
      weight: showSpec ? 0.16 : 0.17,
      optional: true,
      cell: (section) => summaryCell(section.product),
    },
    {
      header: "Mfg",
      weight: 0.1,
      optional: true,
      cell: (section) => summaryCell(section.manufacturer),
    },
    {
      header: "Finish",
      weight: 0.08,
      optional: true,
      cell: (section) => summaryCell(section.finish_type),
    },
    {
      header: "Color / Pattern / Finish",
      weight: showSpec ? 0.15 : 0.2,
      optional: true,
      cell: (section) => summaryCell(section.color),
    },
    {
      header: "Notes",
      weight: showSpec ? 0.14 : 0.2,
      optional: true,
      cell: (section) => summaryCell(notesFromAttachments(section)),
    },
  );
  return candidates
    .filter((col) => !col.optional || sections.some((section) => col.cell(section, 1).trim()))
    .map(({ header, weight, cell }) => ({ header, weight, cell }));
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

  const ordered = sortSdsSectionsBySpec(packet.sections);
  const cols = productSummaryColumns(ordered);
  const widths = columnWidthsFromWeights(
    tableWidth,
    cols.map((col) => col.weight),
  );
  const tableRight = tableLeft + tableWidth;
  const headerSize = 7;
  const cellSize = 6.5;
  const cellPad = 4;

  const headerLineHeight = headerSize + 2;
  const headerLines = cols.map((col, i) =>
    col.header === "#"
      ? [col.header]
      : wrapCellLines(col.header, bold, headerSize, Math.max(8, widths[i]! - cellPad)),
  );
  const headerLineCount = Math.max(1, ...headerLines.map((lines) => lines.length));
  const headerH = 14 + (headerLineCount - 1) * headerLineHeight;
  const headerBottom = y - 2 - (headerLineCount - 1) * headerLineHeight;

  let x = tableLeft;
  for (let i = 0; i < cols.length; i++) {
    page.drawRectangle({ x, y: headerBottom, width: widths[i]!, height: headerH, color: rgb(0.2, 0.2, 0.2) });
    headerLines[i]!.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: x + 2,
        y: y - lineIndex * headerLineHeight,
        size: headerSize,
        font: bold,
        color: rgb(1, 1, 1),
      });
    });
    x += widths[i]!;
  }
  y = headerBottom - 14;

  let rowNum = 0;
  let lastBand: string | null = null;
  const lineHeight = cellSize + 2;

  for (const section of ordered) {
    const band = cols.some((col) => col.header === "Spec")
      ? section.spec_section.trim() || "(No spec section)"
      : "";
    if (band && band !== lastBand) {
      lastBand = band;
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
      page.drawText(band.toUpperCase(), {
        x: tableLeft + 4,
        y: y - 10,
        size: 7,
        font: bold,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= 14;
    }

    rowNum += 1;
    const row = cols.map((col) => col.cell(section, rowNum) || "—");
    const wrapped = row.map((text, i) => {
      if (cols[i]!.header === "#") return [text];
      const source = cols[i]!.header === "Spec" ? text.replace(/\s+-\s+/g, "\n") : text;
      return wrapCellLines(source, font, cellSize, Math.max(8, widths[i]! - cellPad));
    });
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const rowH = Math.max(14, lineCount * lineHeight + 4);
    const rowBottom = y + 2 - rowH;
    const rowTop = rowBottom + rowH;
    rowRects.push([tableLeft, rowBottom, tableRight, rowTop]);

    x = tableLeft;
    const fill = rowNum % 2 === 0 ? rgb(0.98, 0.98, 0.98) : rgb(1, 1, 1);
    for (let i = 0; i < row.length; i++) {
      page.drawRectangle({
        x,
        y: rowBottom,
        width: widths[i]!,
        height: rowH,
        color: fill,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.5,
      });
      const lines = wrapped[i]!;
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + 2,
          y: rowTop - 3 - cellSize - lineIndex * lineHeight,
          size: cellSize,
          font,
          color: rgb(0, 0, 0),
        });
      });
      x += widths[i]!;
    }
    y = rowBottom - 2;
  }

  drawPageFooter(page, ctx, branding, packet.preparer);
  return rowRects;
}

function specGroupKey(section: SdsSection): string {
  return section.spec_section.trim();
}

function specDividerParts(spec: string): { kicker: string; title: string } {
  const trimmed = spec.trim();
  if (!trimmed) return { kicker: "", title: "No spec section" };
  const dash = trimmed.indexOf(" - ");
  if (dash === -1) return { kicker: "", title: trimmed };
  return {
    kicker: trimmed.slice(0, dash).trim(),
    title: trimmed.slice(dash + 3).trim() || trimmed,
  };
}

function drawFittedCentered(
  page: PDFPage,
  text: string,
  y: number,
  font: BuildContext["bold"],
  maxSize: number,
  color: RGB,
) {
  const maxWidth = LETTER[0] - 108;
  let size = maxSize;
  while (size > 12 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  page.drawText(text, {
    x: LETTER[0] / 2 - font.widthOfTextAtSize(text, size) / 2,
    y,
    size,
    font,
    color,
  });
}

function addSpecDivider(
  spec: string,
  packet: SdsPacketData,
  project: ProjectInfo,
  branding: PrintBranding,
  ctx: BuildContext,
) {
  const page = ctx.doc.addPage(LETTER);
  const w = LETTER[0];
  const { kicker, title } = specDividerParts(spec);
  drawRunningHeader(page, ctx, branding, packet, project);

  const titleY = kicker ? LETTER[1] / 2 + 8 : LETTER[1] / 2 + 20;
  if (kicker) {
    page.drawText(kicker, {
      x: w / 2 - ctx.font.widthOfTextAtSize(kicker, 12) / 2,
      y: LETTER[1] / 2 + 36,
      size: 12,
      font: ctx.font,
      color: rgb(0.33, 0.33, 0.33),
    });
  }
  drawFittedCentered(page, title.toUpperCase(), titleY, ctx.bold, 26, rgb(0.1, 0.1, 0.18));
  page.drawText("Product sections follow", {
    x: w / 2 - ctx.font.widthOfTextAtSize("Product sections follow", 11) / 2,
    y: titleY - 28,
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
  const spec = section.spec_section.trim() || "—";

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
    ["Spec:", spec],
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
      const size = 8;
      const maxWidth = width - 16;
      const lines = fitStampLines(stamp, ctx.bold, size, maxWidth, 2);
      const bannerHeight = lines.length > 1 ? 26 : 16;
      const border = 1.25;
      page.drawRectangle({
        x: border / 2,
        y: height - bannerHeight,
        width: width - border,
        height: bannerHeight - border / 2,
        color: rgb(1, 1, 1),
        borderColor: STAMP_RED,
        borderWidth: border,
      });
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: 8,
          y: height - 11 - index * 10,
          size,
          font: ctx.bold,
          color: STAMP_RED,
        });
      });
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
    doc.insertPage(tocInsertIndex + p, LETTER);
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

const PAINT_SCHEDULE_INTRO =
  "Each finish product is listed with the primer it goes over. Product data (TDS and SDS) for every product follows this page, primer directly before its finish.";
const PAINT_SCHEDULE_NOTE =
  "Colors are submitted separately as brush-outs; primers are not color-approved.";

function addPaintSystemSchedule(
  project: ProjectInfo,
  packet: SdsPacketData,
  branding: PrintBranding,
  ctx: BuildContext,
  schedule: PaintSystemSchedule,
) {
  const margin = 36;
  const pageW = LETTER[0];
  const tableW = pageW - margin * 2;
  const bottom = 64;
  const ink = rgb(0.1, 0.1, 0.18);
  const muted = rgb(0.35, 0.35, 0.38);
  const rule = rgb(0.75, 0.75, 0.75);
  const headerBg = rgb(0.2, 0.2, 0.2);
  const white = rgb(1, 1, 1);
  const check = rgb(0.12, 0.42, 0.26);

  let page = ctx.doc.addPage(LETTER);

  const drawMasthead = (continued: boolean): number => {
    let y = LETTER[1] - 36;
    const company = branding.companyName.trim();
    if (ctx.logo && !continued) {
      const scale = Math.min(160 / ctx.logo.width, 32 / ctx.logo.height, 1);
      const lw = ctx.logo.width * scale;
      const lh = ctx.logo.height * scale;
      page.drawImage(ctx.logo, { x: margin, y: y - lh + 8, width: lw, height: lh });
      if (company) {
        const cw = ctx.font.widthOfTextAtSize(company, 9);
        page.drawText(company, { x: pageW - margin - cw, y: y - 4, size: 9, font: ctx.font, color: muted });
      }
      y -= lh + 8;
    } else if (company) {
      page.drawText(company, { x: margin, y, size: 9, font: ctx.bold, color: ink });
      y -= 16;
    }
    const title = continued ? "Paint System Schedule (continued)" : "Paint System Schedule";
    const titleSize = continued ? 12 : 16;
    page.drawText(title, { x: margin, y, size: titleSize, font: ctx.bold, color: ink });
    y -= continued ? 16 : 20;
    const jobNo = project.job_number.trim() || "—";
    const jobName = project.job_name.trim() || "—";
    const submittal = formatSubmittalNumberDisplay(packet.submittal_number) || "—";
    const spec = schedule.specSection.trim() || "—";
    page.drawText(`Job # ${jobNo}`, { x: margin, y, size: 9, font: ctx.bold, color: ink });
    page.drawText(jobName, { x: margin + 120, y, size: 9, font: ctx.font, color: ink });
    y -= 13;
    page.drawText(`Submittal # ${submittal}`, { x: margin, y, size: 9, font: ctx.bold, color: ink });
    const specLabel = truncateTextToWidth(`Spec section ${spec}`, tableW - 160, ctx.font, 9);
    page.drawText(specLabel, { x: margin + 160, y, size: 9, font: ctx.font, color: ink });
    y -= 8;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageW - margin, y },
      thickness: 0.75,
      color: rgb(0.2, 0.2, 0.2),
    });
    return y - 16;
  };

  let y = drawMasthead(false);
  const nextPage = () => {
    drawPageFooter(page, ctx, branding, packet.preparer);
    page = ctx.doc.addPage(LETTER);
    y = drawMasthead(true);
  };
  const ensure = (needed: number) => {
    if (y - needed < bottom) nextPage();
  };

  const introLines = wrapLines(PAINT_SCHEDULE_INTRO, ctx.font, 9, tableW);
  ensure(introLines.length * 12 + 10);
  for (const line of introLines) {
    page.drawText(line, { x: margin, y, size: 9, font: ctx.font, color: ink });
    y -= 12;
  }
  y -= 10;

  const drawHeading = (text: string) => {
    ensure(52);
    page.drawText(text, { x: margin, y, size: 11, font: ctx.bold, color: ink });
    y -= 16;
  };

  const drawTableHeader = (headers: string[], widths: number[]) => {
    const height = 16;
    ensure(height + 8);
    let x = margin;
    const rectBottom = y - height + 10;
    for (let i = 0; i < headers.length; i++) {
      page.drawRectangle({ x, y: rectBottom, width: widths[i]!, height, color: headerBg });
      page.drawText(headers[i]!, {
        x: x + 4,
        y: rectBottom + 4,
        size: 8,
        font: ctx.bold,
        color: white,
      });
      x += widths[i]!;
    }
    y = rectBottom - 2;
  };

  const systemWidths = columnWidthsFromWeights(tableW, [3.4, 1.5, 2.2]);
  drawHeading("Systems");
  drawTableHeader(["Finish", "Sheen", "Items"], systemWidths);
  schedule.systems.forEach((system, index) => {
    const finishWidth = Math.max(8, systemWidths[0]! - 8);
    const sheenWidth = Math.max(8, systemWidths[1]! - 8);
    const itemsWidth = Math.max(8, systemWidths[2]! - 8);
    const finishLines = wrapCellLines(system.finishName, ctx.bold, 8, finishWidth);
    const primerLines = wrapCellLines(system.primerLine, ctx.font, 7.5, finishWidth);
    const sheenLines = wrapCellLines(system.sheen || "—", ctx.font, 8, sheenWidth);
    const itemLines = wrapCellLines(system.items || "—", ctx.font, 8, itemsWidth);
    const lineCount = Math.max(finishLines.length + primerLines.length, sheenLines.length, itemLines.length, 1);
    const rowH = lineCount * 10 + 6;
    if (y - rowH < bottom) {
      nextPage();
      drawTableHeader(["Finish", "Sheen", "Items"], systemWidths);
    }
    const rowBottom = y - rowH;
    const fill = index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.97, 0.97, 0.97);
    let x = margin;
    for (const width of systemWidths) {
      page.drawRectangle({
        x,
        y: rowBottom,
        width,
        height: rowH,
        color: fill,
        borderColor: rule,
        borderWidth: 0.4,
      });
      x += width;
    }
    let textY = y - 11;
    for (const line of finishLines) {
      page.drawText(line, { x: margin + 4, y: textY, size: 8, font: ctx.bold, color: ink });
      textY -= 10;
    }
    for (const line of primerLines) {
      page.drawText(line, { x: margin + 4, y: textY, size: 7.5, font: ctx.font, color: muted });
      textY -= 10;
    }
    sheenLines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: margin + systemWidths[0]! + 4,
        y: y - 11 - lineIndex * 10,
        size: 8,
        font: ctx.font,
        color: ink,
      });
    });
    itemLines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: margin + systemWidths[0]! + systemWidths[1]! + 4,
        y: y - 11 - lineIndex * 10,
        size: 8,
        font: ctx.font,
        color: ink,
      });
    });
    y = rowBottom - 1;
  });
  y -= 16;

  const productWidths = columnWidthsFromWeights(tableW, [2.6, 2.4, 0.7, 0.7, 1]);
  drawHeading("Product data included, in order");
  drawTableHeader(["Product", "Use", "TDS", "SDS", "VOC (g/L)"], productWidths);
  schedule.products.forEach((row, index) => {
    const productLines = wrapCellLines(row.product, ctx.font, 8, Math.max(8, productWidths[0]! - 8));
    const useLines = wrapCellLines(row.use, ctx.font, 8, Math.max(8, productWidths[1]! - 8));
    const vocLines = row.voc.trim()
      ? wrapCellLines(row.voc.trim(), ctx.font, 8, Math.max(8, productWidths[4]! - 8))
      : [];
    const lineCount = Math.max(productLines.length, useLines.length, vocLines.length, 1);
    const rowH = lineCount * 10 + 6;
    if (y - rowH < bottom) {
      nextPage();
      drawTableHeader(["Product", "Use", "TDS", "SDS", "VOC (g/L)"], productWidths);
    }
    const rowBottom = y - rowH;
    const fill = index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.97, 0.97, 0.97);
    let x = margin;
    for (const width of productWidths) {
      page.drawRectangle({
        x,
        y: rowBottom,
        width,
        height: rowH,
        color: fill,
        borderColor: rule,
        borderWidth: 0.4,
      });
      x += width;
    }
    productLines.forEach((line, lineIndex) => {
      page.drawText(line, { x: margin + 4, y: y - 11 - lineIndex * 10, size: 8, font: ctx.font, color: ink });
    });
    useLines.forEach((line, lineIndex) => {
      page.drawText(line, {
        x: margin + productWidths[0]! + 4,
        y: y - 11 - lineIndex * 10,
        size: 8,
        font: ctx.font,
        color: ink,
      });
    });
    const mark = (column: number, on: boolean) => {
      if (!on) return;
      const cellX = margin + productWidths.slice(0, column).reduce((sum, width) => sum + width, 0);
      drawPdfCheckmark(page, cellX + productWidths[column]! / 2 - 3.5, rowBottom + rowH / 2 - 2, 7, check);
    };
    mark(2, row.tds);
    mark(3, row.sds);
    vocLines.forEach((line, lineIndex) => {
      const vocX = margin + productWidths.slice(0, 4).reduce((sum, width) => sum + width, 0) + 4;
      page.drawText(line, { x: vocX, y: y - 11 - lineIndex * 10, size: 8, font: ctx.font, color: ink });
    });
    y = rowBottom - 1;
  });
  y -= 16;

  const noteLines = wrapLines(PAINT_SCHEDULE_NOTE, ctx.font, 8, tableW);
  ensure(noteLines.length * 11 + 4);
  for (const line of noteLines) {
    page.drawText(line, { x: margin, y, size: 8, font: ctx.font, color: muted });
    y -= 11;
  }
  drawPageFooter(page, ctx, branding, packet.preparer);
}

export type PaintPackageScheduleInput = {
  items: PaintItem[];
  products: PaintProduct[];
  specSection: string;
  /** Sections from other saved packages, so a line assigned there is not pulled into this one. */
  otherPackageSections?: SdsSection[][];
};

export async function buildSdsPacketPdf(
  project: ProjectInfo,
  packet: SdsPacketData,
  branding: PrintBranding,
  onProgress?: (p: BuildProgress) => void,
  extras?: { colorSchedule?: string; paint?: PaintPackageScheduleInput | null },
): Promise<Uint8Array> {
  if (!packet.sections.length) {
    throw new Error("Add at least one section before building the packet.");
  }
  const missingFiles = packet.sections.filter((s) => !sectionHasAnyAttachment(s));
  if (missingFiles.length) {
    throw new Error("Each section needs at least one file attachment (product data, SDS, warranty, etc.).");
  }

  const savedSchedule = packet.paint_schedule
    ? paintScheduleFromSnapshot(packet.paint_schedule, packet.sections)
    : null;
  const packageItems = !packet.paint_schedule && extras?.paint
    ? paintItemsForPackageSchedule(
        extras.paint.items,
        packet.sections,
        extras.paint.otherPackageSections ?? [],
      )
    : [];
  const builtSchedule = !packet.paint_schedule && extras?.paint
    ? buildPaintSystemSchedule(
        packageItems,
        extras.paint.products,
        packet.sections,
        extras.paint.specSection,
      )
    : null;
  // A saved history snapshot draws its own rows. A live draft computes them.
  // Finish rows in this package stay on the schedule when they have no primer ("No primer").
  const chosenSchedule = packet.paint_schedule ? savedSchedule : builtSchedule;
  const paintSchedule = chosenSchedule?.systems.length ? chosenSchedule : null;
  const groupedSections = chosenSchedule?.orderedSections.length
    ? chosenSchedule.orderedSections
    : sortSdsSectionsBySpec(packet.sections);

  const totalSteps =
    (packet.include_cover ? 1 : 0) +
    (paintSchedule ? 1 : 0) +
    (packet.include_toc ? 1 : 0) +
    1 +
    groupedSections.reduce((n, s, i, arr) => {
      const specBreak =
        packet.include_dividers && (i === 0 || specGroupKey(s) !== specGroupKey(arr[i - 1]!)) ? 1 : 0;
      return n + specBreak + (packet.include_dividers ? 1 : 0) + countSectionPdfPages(s);
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
    await addCoverPage(project, packet, branding, ctx, extras?.colorSchedule);
    outlines.push({ title: "Cover", to: pageCount() - 1 });
  }

  let schedulePageCount = 0;
  if (paintSchedule) {
    tick("Paint system schedule");
    const scheduleStart = pageCount();
    addPaintSystemSchedule(project, packet, branding, ctx, paintSchedule);
    schedulePageCount = pageCount() - scheduleStart;
    outlines.push({ title: "Paint System Schedule", to: scheduleStart });
    if (packet.include_toc) {
      tocEntries.push({ level: 0, label: "Paint System Schedule", pageIndex: scheduleStart });
    }
  }

  tick("Product summary");
  summaryRowRects = addMaterialSummaryPage(project, packet, branding, ctx);
  summaryPageIndex = pageCount() - 1;
  outlines.push({ title: "Product Summary", to: summaryPageIndex });
  if (packet.include_toc) {
    tocEntries.push({ level: 0, label: "Product Summary", pageIndex: summaryPageIndex });
  }

  const seenDocPaths = new Set<string>();

  for (let i = 0; i < groupedSections.length; i++) {
    const section = groupedSections[i]!;
    const num = i + 1;

    if (packet.include_dividers && (i === 0 || specGroupKey(section) !== specGroupKey(groupedSections[i - 1]!))) {
      const specLabel = specDividerParts(section.spec_section).title;
      tick(`Spec: ${specLabel}`);
      addSpecDivider(section.spec_section, packet, project, branding, ctx);
    }

    sectionStartPages.push(pageCount());

    if (packet.include_toc) {
      tocEntries.push({ level: 1, label: tocSectionTitle(section), pageIndex: pageCount() });
    }

    if (packet.include_dividers) {
      tick(`Section ${num} divider`);
      addSectionDivider(num, section, packet, project, branding, ctx);
    }

    const stamp = `Section ${num}: ${sectionTitle(section)}`;
    for (const kind of sectionAttachmentKinds(section)) {
      const attachment = section.attachments[kind];
      const path = attachment?.path?.trim();
      if (!path) continue;
      if (paintSchedule) {
        if (seenDocPaths.has(path)) continue;
        seenDocPaths.add(path);
      }
      const label = attachmentStampLabel(kind);
      if (packet.include_toc) {
        tocEntries.push({ level: 2, label: tocAttachmentLabel(kind), pageIndex: pageCount() });
      }
      tick(`Section ${num} ${label}`);
      const bytes = await downloadSdsPdf(path);
      await appendPdfWithStamp(ctx, bytes, `${stamp} — ${label}`, packet.include_stamp);
    }

    outlines.push({ title: `Section ${num}: ${sectionTitle(section)}`, to: sectionStartPages[i]! });
  }

  if (packet.include_end) {
    tick("End page");
    addEndPage(packet, project, branding, ctx);
  }

  let tocPageCount = 0;
  const tocInsertIndex = (packet.include_cover ? 1 : 0) + schedulePageCount;
  if (packet.include_toc && tocEntries.length) {
    tick("Table of contents");
    tocPageCount = insertTableOfContents(doc, ctx, packet, project, branding, tocEntries, tocInsertIndex);
    const summaryOutlineAt = outlines.findIndex((item) => item.title === "Product Summary");
    outlines.splice(summaryOutlineAt === -1 ? tocInsertIndex : summaryOutlineAt, 0, {
      title: "Table of Contents",
      to: tocInsertIndex,
    });
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
