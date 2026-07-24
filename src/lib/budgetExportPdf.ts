import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { budgetHoursPdfFilename, budgetPdfFilename, budgetPdfJobTitle } from "./pdfFilenames";
import {
  buildHoursExportRows,
  buildSummaryRows,
  computeSummaryMetrics,
  exportFooterText,
  type HoursExportRow,
} from "./budgetMakerCore";
import { resolvePrintBranding } from "./letterheadSettings";
import type { LetterheadSettings } from "../types/letterheadSettings";
import type { BudgetLibrary, BudgetMakerData } from "../types/budgetMaker";

const HEADER = rgb(68 / 255, 114 / 255, 196 / 255);
const HIGHLIGHT = rgb(1, 241 / 255, 118 / 255);
const TOTAL_BG = rgb(231 / 255, 238 / 255, 248 / 255);
const ROW_ALT = rgb(0.96, 0.96, 0.96);
const BORDER = rgb(0.75, 0.75, 0.75);
const RULE = rgb(0.55, 0.55, 0.55);
const RULE_STRONG = rgb(0.25, 0.25, 0.25);
const MUTED = rgb(0.4, 0.4, 0.4);
const GRAND_TOTAL_TEXT = rgb(0, 128 / 255, 0);

const TOTAL_WEIGHTS = [1.6, 2.0, 0.45, 0.55, 0.45, 0.6, 0.35, 1.2];
const HOURS_WEIGHTS = [2.2, 0.55, 0.7, 1.6];
const HOURS_RIGHT_ALIGN = new Set([1, 2]);
const HOURS_FOOTER_H = 28;

function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function addPage(doc: PDFDocument, landscape: boolean) {
  return doc.addPage(landscape ? [792, 612] : [612, 792]);
}

function drawTable(
  doc: PDFDocument,
  startPage: ReturnType<PDFDocument["addPage"]>,
  landscape: boolean,
  margin: number,
  font: PDFFont,
  bold: PDFFont,
  fontSize: number,
  columns: string[],
  rows: string[][],
  colWeights: number[],
  options?: {
    highlightRow?: (row: string[]) => boolean;
    totalRow?: string[];
    rowStyle?: (row: string[], index: number) => "normal" | "highlight" | "subtotal" | "grandtotal";
    /** Distance from page top to table header (defaults to margin). */
    contentTop?: number;
  },
): void {
  const rowHeight = fontSize + 6;
  const headerHeight = rowHeight + 2;
  let page = startPage;
  let pageWidth = page.getWidth();
  let pageHeight = page.getHeight();
  let y = pageHeight - (options?.contentTop ?? margin);

  const usable = pageWidth - margin * 2;
  const weightSum = colWeights.reduce((a, b) => a + b, 0);
  const colWidths = colWeights.map((w) => (usable * w) / weightSum);

  function drawHeader() {
    if (y - headerHeight < margin) {
      page = addPage(doc, landscape);
      pageWidth = page.getWidth();
      pageHeight = page.getHeight();
      y = pageHeight - margin;
    }
    let x = margin;
    columns.forEach((col, i) => {
      page.drawRectangle({ x, y: y - headerHeight, width: colWidths[i], height: headerHeight, color: HEADER });
      page.drawText(truncate(col, bold, fontSize, colWidths[i] - 4), {
        x: x + 2,
        y: y - headerHeight + 3,
        size: fontSize,
        font: bold,
        color: rgb(1, 1, 1),
      });
      x += colWidths[i];
    });
    y -= headerHeight;
  }

  drawHeader();

  let fieldStripe = 0;
  rows.forEach((row, ri) => {
    if (y - rowHeight < margin) {
      page = addPage(doc, landscape);
      pageWidth = page.getWidth();
      pageHeight = page.getHeight();
      y = pageHeight - margin;
      drawHeader();
    }
    const style =
      options?.rowStyle?.(row, ri) ??
      (options?.highlightRow?.(row) ? "highlight" : "normal");
    if (style === "highlight") {
      page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: HIGHLIGHT });
    } else if (style === "subtotal" || style === "grandtotal") {
      page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: TOTAL_BG });
    } else if (fieldStripe % 2 === 1) {
      page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: ROW_ALT });
    }
    if (style === "normal") fieldStripe += 1;

    const useBold = style !== "normal";
    const textColor = style === "grandtotal" ? GRAND_TOTAL_TEXT : rgb(0, 0, 0);
    let x = margin;
    row.forEach((cell, ci) => {
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width: colWidths[ci],
        height: rowHeight,
        borderColor: BORDER,
        borderWidth: 0.25,
      });
      page.drawText(truncate(cell, useBold ? bold : font, fontSize, colWidths[ci] - 4), {
        x: x + 2,
        y: y - rowHeight + 3,
        size: fontSize,
        font: useBold ? bold : font,
        color: textColor,
      });
      x += colWidths[ci];
    });
    y -= rowHeight;
  });

  if (options?.totalRow) {
    if (y - rowHeight < margin) {
      page = addPage(doc, landscape);
      y = page.getHeight() - margin;
    }
    page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: TOTAL_BG });
    let x = margin;
    options.totalRow.forEach((cell, ci) => {
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width: colWidths[ci],
        height: rowHeight,
        borderColor: BORDER,
        borderWidth: 0.25,
      });
      page.drawText(truncate(cell, bold, fontSize, colWidths[ci] - 4), {
        x: x + 2,
        y: y - rowHeight + 3,
        size: fontSize,
        font: bold,
      });
      x += colWidths[ci];
    });
  }
}

export type FieldHoursPdfRowKind = "field" | "subtotal" | "supervision" | "grandtotal";

export function buildFieldHoursPdfTable(
  rows: HoursExportRow[],
  totalHours: number,
  totalMaterial: number,
  supervisionHours: number,
): { tableRows: string[][]; rowKinds: FieldHoursPdfRowKind[] } {
  const fieldRows = rows.filter((r) => !r.highlight990);
  const supervisionRows = rows.filter((r) => r.highlight990);
  const grandTotalHours = totalHours + supervisionHours;
  const fmtHours = (n: number) =>
    n ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "";
  const fmtMaterial = (n: number) =>
    n
      ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "";

  const tableRows: string[][] = [];
  const rowKinds: FieldHoursPdfRowKind[] = [];

  for (const row of fieldRows) {
    tableRows.push([row.costCode, row.hours, row.amount, row.notes]);
    rowKinds.push("field");
  }

  tableRows.push([
    "Subtotal — field used only",
    fmtHours(totalHours),
    fmtMaterial(totalMaterial),
    "",
  ]);
  rowKinds.push("subtotal");

  for (const row of supervisionRows) {
    tableRows.push([row.costCode, row.hours, row.amount, row.notes]);
    rowKinds.push("supervision");
  }

  tableRows.push([
    "Grand total",
    fmtHours(grandTotalHours),
    fmtMaterial(totalMaterial),
    "",
  ]);
  rowKinds.push("grandtotal");

  return { tableRows, rowKinds };
}

function hoursPdfCompanyName(): string {
  try {
    const raw = localStorage.getItem("jobflow-letterhead-v1");
    if (raw) {
      const name = resolvePrintBranding(JSON.parse(raw) as LetterheadSettings).companyName.trim();
      if (name) return name;
    }
  } catch {
    /* ignore */
  }
  return resolvePrintBranding().companyName.trim() || "Ironwood Commercial Builders";
}

function formatReportDate(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function hoursPdfJobTitle(jobNumber: string, jobName: string): string {
  const num = jobNumber.trim();
  const name = jobName.trim();
  if (num && name) return `${num} — ${name}`;
  return name || num || "Project";
}

function drawHoursCellText(
  page: PDFPage,
  text: string,
  x: number,
  width: number,
  y: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  rightAlign: boolean,
) {
  const drawn = truncate(text, font, size, width - 4);
  const textWidth = font.widthOfTextAtSize(drawn, size);
  page.drawText(drawn, {
    x: rightAlign ? x + width - 2 - textWidth : x + 2,
    y,
    size,
    font,
    color,
  });
}

function stampHoursPdfFooters(
  pages: PDFPage[],
  margin: number,
  font: PDFFont,
  footerLeft: string,
) {
  const total = pages.length;
  pages.forEach((page, i) => {
    const pageWidth = page.getWidth();
    const y = 14;
    page.drawText(truncate(footerLeft, font, 8, pageWidth * 0.65), {
      x: margin,
      y,
      size: 8,
      font,
      color: MUTED,
    });
    const right = `Page ${i + 1} of ${total}`;
    const rightW = font.widthOfTextAtSize(right, 8);
    page.drawText(right, {
      x: pageWidth - margin - rightW,
      y,
      size: 8,
      font,
      color: MUTED,
    });
  });
}

/** Hours PDF table: horizontal rules only, right-aligned hours/amount (keeps existing colors). */
function drawHoursFieldTable(
  doc: PDFDocument,
  startPage: PDFPage,
  margin: number,
  font: PDFFont,
  bold: PDFFont,
  fontSize: number,
  columns: string[],
  rows: string[][],
  colWeights: number[],
  rowKinds: FieldHoursPdfRowKind[],
  contentTop: number,
): PDFPage[] {
  const rowHeight = fontSize + 8;
  const headerHeight = rowHeight + 2;
  const pages: PDFPage[] = [startPage];
  let page = startPage;
  let pageWidth = page.getWidth();
  let pageHeight = page.getHeight();
  let y = pageHeight - contentTop;
  const bottom = margin + HOURS_FOOTER_H;

  const usable = pageWidth - margin * 2;
  const weightSum = colWeights.reduce((a, b) => a + b, 0);
  const colWidths = colWeights.map((w) => (usable * w) / weightSum);

  function drawHRule(atY: number, strong: boolean) {
    page.drawLine({
      start: { x: margin, y: atY },
      end: { x: margin + usable, y: atY },
      thickness: strong ? 1 : 0.5,
      color: strong ? RULE_STRONG : RULE,
    });
  }

  function drawColHeaders() {
    if (y - headerHeight < bottom) {
      page = addPage(doc, true);
      pages.push(page);
      pageWidth = page.getWidth();
      pageHeight = page.getHeight();
      y = pageHeight - margin;
    }
    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: usable,
      height: headerHeight,
      color: HEADER,
    });
    let x = margin;
    columns.forEach((col, i) => {
      drawHoursCellText(
        page,
        col,
        x,
        colWidths[i],
        y - headerHeight + 4,
        bold,
        fontSize,
        rgb(1, 1, 1),
        HOURS_RIGHT_ALIGN.has(i),
      );
      x += colWidths[i];
    });
    y -= headerHeight;
  }

  drawColHeaders();

  let fieldStripe = 0;
  rows.forEach((row, ri) => {
    const kind = rowKinds[ri] ?? "field";
    const needsStrongRule = kind === "subtotal" || kind === "grandtotal";
    if (y - rowHeight < bottom) {
      page = addPage(doc, true);
      pages.push(page);
      pageWidth = page.getWidth();
      pageHeight = page.getHeight();
      y = pageHeight - margin;
      drawColHeaders();
      fieldStripe = 0;
    }

    if (needsStrongRule) drawHRule(y, true);

    if (kind === "supervision") {
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: usable,
        height: rowHeight,
        color: HIGHLIGHT,
      });
    } else if (kind === "subtotal") {
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: usable,
        height: rowHeight,
        color: TOTAL_BG,
      });
    } else if (fieldStripe % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: usable,
        height: rowHeight,
        color: ROW_ALT,
      });
    }
    if (kind === "field") fieldStripe += 1;

    const useBold = kind !== "field";
    const textColor = kind === "grandtotal" ? GRAND_TOTAL_TEXT : rgb(0, 0, 0);
    let x = margin;
    row.forEach((cell, ci) => {
      drawHoursCellText(
        page,
        cell,
        x,
        colWidths[ci],
        y - rowHeight + 4,
        useBold ? bold : font,
        fontSize,
        textColor,
        HOURS_RIGHT_ALIGN.has(ci),
      );
      x += colWidths[ci];
    });
    y -= rowHeight;

    if (kind === "grandtotal") drawHRule(y, true);
    else if (kind === "field" || kind === "supervision") drawHRule(y, false);
  });

  return pages;
}

export async function downloadBudgetPdf(
  data: BudgetMakerData,
  lib: BudgetLibrary,
  jobNumber = "",
): Promise<void> {
  const metrics = computeSummaryMetrics(data.lines, data.grand_total);
  const footer = exportFooterText(
    metrics.budgetTotal,
    metrics.totalHours,
    metrics.unassignedTotal,
    metrics.userGrandTotal,
  );
  const combineByCostCode = data.combine_cost_codes_on_export !== false;

  const summary = buildSummaryRows(data.buckets, data.lines, lib, data.hide_zero_amounts, {
    combineByCostCode,
  });
  const totalCols = ["Work Item", "Cost Code", "Cost Class", "GL Acct", "Hours", "Amount", "%", "Notes"];
  const totalRows = summary.map((r) => [
    r.workItem,
    r.costCode,
    r.costClass,
    r.glAcct,
    r.hours,
    r.amount ? `$${r.amount.toFixed(2)}` : "",
    r.pct,
    r.notes,
  ]);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 32;
  const jobTitle = budgetPdfJobTitle(jobNumber, data.job_name);

  const page = addPage(doc, true);
  let y = page.getHeight() - margin;
  page.drawText(truncate(jobTitle, bold, 14, page.getWidth() - margin * 2), {
    x: margin,
    y: y - 14,
    size: 14,
    font: bold,
  });
  y -= 20;
  page.drawText("Budget", { x: margin, y: y - 12, size: 11, font });
  y -= 18;
  if (footer) {
    page.drawText(truncate(footer.replace(/   \|   /g, " | "), font, 8, page.getWidth() - margin * 2), {
      x: margin,
      y: y - 10,
      size: 8,
      font,
    });
    y -= 16;
  }
  page.drawText("Bucket Totals", { x: margin, y: y - 12, size: 11, font: bold });
  y -= 18;

  drawTable(doc, page, true, margin, font, bold, 7, totalCols, totalRows, TOTAL_WEIGHTS, {
    contentTop: page.getHeight() - y,
  });

  downloadPdfBytes(
    await doc.save(),
    budgetPdfFilename(data.job_name, jobNumber),
  );
}

export async function downloadHoursPdf(
  data: BudgetMakerData,
  lib: BudgetLibrary,
  jobNumber = "",
): Promise<void> {
  const combineByCostCode = data.combine_cost_codes_on_export !== false;
  const { rows, totalHours, totalMaterial, supervisionHours } = buildHoursExportRows(data, lib, {
    combineByCostCode,
  });
  const { tableRows, rowKinds } = buildFieldHoursPdfTable(
    rows,
    totalHours,
    totalMaterial,
    supervisionHours,
  );
  const columns = ["Cost code", "Hours", "Amount", "Notes"];

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 36;
  const jobTitle = hoursPdfJobTitle(jobNumber, data.job_name);
  const companyName = hoursPdfCompanyName();
  const reportDate = formatReportDate();

  const page = addPage(doc, true);
  const pageWidth = page.getWidth();
  let y = page.getHeight() - margin;

  const titleSize = 16;
  const metaSize = 10;
  page.drawText(truncate(jobTitle, bold, titleSize, pageWidth * 0.58), {
    x: margin,
    y: y - titleSize,
    size: titleSize,
    font: bold,
  });

  const companyW = bold.widthOfTextAtSize(
    truncate(companyName, bold, metaSize, pageWidth * 0.38),
    metaSize,
  );
  page.drawText(truncate(companyName, bold, metaSize, pageWidth * 0.38), {
    x: pageWidth - margin - companyW,
    y: y - metaSize,
    size: metaSize,
    font: bold,
  });
  y -= titleSize + 6;

  page.drawText("Field hours — Paint Division", {
    x: margin,
    y: y - metaSize,
    size: metaSize,
    font,
    color: MUTED,
  });
  const dateLabel = `Report date: ${reportDate}`;
  const dateW = font.widthOfTextAtSize(dateLabel, metaSize);
  page.drawText(dateLabel, {
    x: pageWidth - margin - dateW,
    y: y - metaSize,
    size: metaSize,
    font,
    color: MUTED,
  });
  y -= metaSize + 10;

  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: RULE_STRONG,
  });
  y -= 14;

  const pages = drawHoursFieldTable(
    doc,
    page,
    margin,
    font,
    bold,
    9,
    columns,
    tableRows,
    HOURS_WEIGHTS,
    rowKinds,
    page.getHeight() - y,
  );

  stampHoursPdfFooters(pages, margin, font, `${jobTitle} · Field hours — Paint Division`);

  downloadPdfBytes(
    await doc.save(),
    budgetHoursPdfFilename(data.job_name, jobNumber),
  );
}
