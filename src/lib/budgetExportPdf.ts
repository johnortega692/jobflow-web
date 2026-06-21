import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { budgetHoursPdfFilename, budgetPdfFilename } from "./pdfFilenames";
import {
  bucketDisplay,
  buildHoursExportRows,
  buildSummaryRows,
  computeSummaryMetrics,
  exportFooterText,
  fmtCell,
} from "./budgetMakerCore";
import type { BudgetLibrary, BudgetMakerData } from "../types/budgetMaker";
import { PUSH_COLS } from "../types/budgetMaker";

const HEADER = rgb(68 / 255, 114 / 255, 196 / 255);
const HIGHLIGHT = rgb(1, 241 / 255, 118 / 255);
const TOTAL_BG = rgb(231 / 255, 238 / 255, 248 / 255);
const ROW_ALT = rgb(0.96, 0.96, 0.96);
const BORDER = rgb(0.75, 0.75, 0.75);

const LINE_WEIGHTS = [2.4, 0.75, 0.55, 2.1, 0.5, 0.32, 0.55, 0.58, 0.5, 1.4];
const TOTAL_WEIGHTS = [1.6, 2.0, 0.45, 0.55, 0.45, 0.6, 0.35, 1.2];
const HOURS_WEIGHTS = [1.5, 1.8, 0.55, 0.65, 0.65];

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
  options?: { highlightRow?: (row: string[]) => boolean; totalRow?: string[] },
): void {
  const rowHeight = fontSize + 6;
  const headerHeight = rowHeight + 2;
  let page = startPage;
  let pageWidth = page.getWidth();
  let pageHeight = page.getHeight();
  let y = pageHeight - margin;

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

  rows.forEach((row, ri) => {
    if (y - rowHeight < margin) {
      page = addPage(doc, landscape);
      pageWidth = page.getWidth();
      pageHeight = page.getHeight();
      y = pageHeight - margin;
      drawHeader();
    }
    const highlight = options?.highlightRow?.(row) ?? false;
    if (highlight) {
      page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: HIGHLIGHT });
    } else if (ri % 2 === 1) {
      page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: ROW_ALT });
    }
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
      page.drawText(truncate(cell, highlight ? bold : font, fontSize, colWidths[ci] - 4), {
        x: x + 2,
        y: y - rowHeight + 3,
        size: fontSize,
        font: highlight ? bold : font,
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

  const visible = data.lines.filter((l) => !l.Hidden);
  const lineCols = [...PUSH_COLS];
  const lineRows = visible.map((line) =>
    lineCols.map((col) => {
      if (col === "Bucket") return bucketDisplay(line.Bucket, data.buckets, lib);
      if (col === "Quantity" || col === "Unit Cost" || col === "Amount" || col === "Man Hours") {
        return fmtCell(line[col as keyof typeof line]);
      }
      return String(line[col as keyof typeof line] ?? "");
    }),
  );

  const summary = buildSummaryRows(data.buckets, data.lines, lib, data.hide_zero_amounts);
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
  const title = data.job_name.trim() || "Budget Export";

  let page = addPage(doc, true);
  let y = page.getHeight() - margin;
  page.drawText(title, { x: margin, y: y - 14, size: 14, font: bold });
  y -= 22;
  if (footer) {
    page.drawText(truncate(footer.replace(/   \|   /g, " | "), font, 8, page.getWidth() - margin * 2), {
      x: margin,
      y: y - 10,
      size: 8,
      font,
    });
  }

  page = addPage(doc, true);
  page.drawText("Scanned PDF Lines", { x: margin, y: page.getHeight() - margin - 12, size: 11, font: bold });
  drawTable(doc, page, true, margin, font, bold, 7, lineCols, lineRows, LINE_WEIGHTS);

  page = addPage(doc, true);
  page.drawText("Bucket Totals", { x: margin, y: page.getHeight() - margin - 12, size: 11, font: bold });
  drawTable(doc, page, true, margin, font, bold, 7, totalCols, totalRows, TOTAL_WEIGHTS);

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
  const { rows, totalHours, totalMaterial } = buildHoursExportRows(data, lib);
  const columns = ["Cost Code", "Work Item", "Hours", "Amount", "Total Hours"];
  const tableRows = rows.map((r) => [r.costCode, r.workItem, r.hours, r.amount, ""]);
  const totalRow = [
    "",
    "Total",
    totalHours ? totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "",
    totalMaterial
      ? `$${totalMaterial.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "",
    totalHours ? totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "",
  ];

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 43;
  const job = data.job_name.trim();
  const title = job ? `${job} - Field Hours` : "Field Hours";

  const page = addPage(doc, false);
  page.drawText(title, { x: margin, y: page.getHeight() - margin - 16, size: 16, font: bold });

  drawTable(doc, page, false, margin, font, bold, 10, columns, tableRows, HOURS_WEIGHTS, {
    highlightRow: (row) => (row[0]?.match(/^(\d+)/)?.[1] ?? "") === "990",
    totalRow,
  });

  downloadPdfBytes(
    await doc.save(),
    budgetHoursPdfFilename(data.job_name, jobNumber),
  );
}
