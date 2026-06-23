import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { budgetHoursPdfFilename, budgetPdfFilename, budgetPdfJobTitle } from "./pdfFilenames";
import {
  bucketDisplay,
  buildHoursExportRows,
  buildSummaryRows,
  computeSummaryMetrics,
  exportFooterText,
  fmtCell,
  type HoursExportRow,
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
    tableRows.push([row.costCode, row.workItem, row.hours, row.amount, ""]);
    rowKinds.push("field");
  }

  tableRows.push(["", "Sub Total Field Used Only", fmtHours(totalHours), fmtMaterial(totalMaterial), fmtHours(totalHours)]);
  rowKinds.push("subtotal");

  for (const row of supervisionRows) {
    tableRows.push([row.costCode, row.workItem, row.hours, row.amount, ""]);
    rowKinds.push("supervision");
  }

  tableRows.push([
    "",
    "Grand Total",
    fmtHours(grandTotalHours),
    fmtMaterial(totalMaterial),
    fmtHours(grandTotalHours),
  ]);
  rowKinds.push("grandtotal");

  return { tableRows, rowKinds };
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

  let page = addPage(doc, true);
  let y = page.getHeight() - margin;
  page.drawText(truncate(jobTitle, bold, 14, page.getWidth() - margin * 2), {
    x: margin,
    y: y - 14,
    size: 14,
    font: bold,
  });
  y -= 20;
  page.drawText("Budget", { x: margin, y: y - 12, size: 11, font });
  y -= 20;
  if (footer) {
    page.drawText(truncate(footer.replace(/   \|   /g, " | "), font, 8, page.getWidth() - margin * 2), {
      x: margin,
      y: y - 10,
      size: 8,
      font,
    });
  }

  page = addPage(doc, true);
  y = page.getHeight() - margin;
  page.drawText(truncate(jobTitle, bold, 11, page.getWidth() - margin * 2), {
    x: margin,
    y: y - 11,
    size: 11,
    font: bold,
  });
  page.drawText("Scanned PDF Lines", { x: margin, y: y - 26, size: 11, font: bold });
  drawTable(doc, page, true, margin, font, bold, 7, lineCols, lineRows, LINE_WEIGHTS, {
    contentTop: margin + 30,
  });

  page = addPage(doc, true);
  y = page.getHeight() - margin;
  page.drawText(truncate(jobTitle, bold, 11, page.getWidth() - margin * 2), {
    x: margin,
    y: y - 11,
    size: 11,
    font: bold,
  });
  page.drawText("Bucket Totals", { x: margin, y: y - 26, size: 11, font: bold });
  drawTable(doc, page, true, margin, font, bold, 7, totalCols, totalRows, TOTAL_WEIGHTS, {
    contentTop: margin + 30,
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
  const columns = ["Cost Code", "Work Item", "Hours", "Amount", "Total Hours"];

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 43;
  const jobTitle = budgetPdfJobTitle(jobNumber, data.job_name);

  const page = addPage(doc, false);
  let y = page.getHeight() - margin;
  page.drawText(truncate(jobTitle, bold, 16, page.getWidth() - margin * 2), {
    x: margin,
    y: y - 16,
    size: 16,
    font: bold,
  });
  y -= 22;
  page.drawText("Field Hours", { x: margin, y: y - 12, size: 12, font });

  drawTable(doc, page, false, margin, font, bold, 10, columns, tableRows, HOURS_WEIGHTS, {
    contentTop: margin + 50,
    rowStyle: (_row, index) => {
      const kind = rowKinds[index];
      if (kind === "supervision") return "highlight";
      if (kind === "subtotal") return "subtotal";
      if (kind === "grandtotal") return "grandtotal";
      return "normal";
    },
  });

  downloadPdfBytes(
    await doc.save(),
    budgetHoursPdfFilename(data.job_name, jobNumber),
  );
}
