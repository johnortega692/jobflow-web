import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  buildWeeklyHoursGrid,
  formatWeeklyPrintQuantity,
  PEOPLE_PRINT_KEY,
  printDateLabel,
  printWeekDayIsos,
  printWeekLabel,
  weekdayShort,
  type WeeklyPrintCell,
  type WeeklyPrintColumn,
  type WeeklyPrintLayout,
  type WeeklyPrintMeasure,
  type WeeklyPrintPhase,
  type WeeklyPrintGrid,
} from "./weeklyHoursPrint.ts";

const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN_X = 32;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 22;
const NAME_W = 118;
const TOTAL_W = 34;
const TOTAL_ROW_H = 14;

const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.35, 0.38, 0.44);
const WHITE = rgb(1, 1, 1);
const HEADER = rgb(0.16, 0.2, 0.27);
const HEADER_WEEKEND = rgb(0.28, 0.31, 0.36);
const HEADER_HOLIDAY = rgb(0.45, 0.32, 0.18);
const LINE = rgb(0.78, 0.8, 0.84);
const LINE_STRONG = rgb(0.28, 0.32, 0.38);
const WEEKEND = rgb(0.94, 0.94, 0.95);
const HOLIDAY = rgb(1, 0.94, 0.86);
const FILLED = rgb(0.86, 0.92, 0.98);
const FILLED_WEEKEND = rgb(0.82, 0.86, 0.9);
const TOTAL_BG = rgb(0.93, 0.94, 0.96);

export type WeeklyHoursPdfInput = {
  jobNumber: string;
  jobName: string;
  contractLabel: string;
  weekStarts: string[];
  phases: WeeklyPrintPhase[];
  cells: WeeklyPrintCell[];
  holidays: string[];
  measure: WeeklyPrintMeasure;
  layout: WeeklyPrintLayout;
};

function pdfSafe(value: string): string {
  return value.replace(/[^\x20-\x7E\u00BC\u00BD\u00BE]/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = pdfSafe(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let next = clean;
  while (next.length > 1 && font.widthOfTextAtSize(`${next}...`, size) > maxWidth) next = next.slice(0, -1);
  return `${next}...`;
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  x: number,
  bottom: number,
  width: number,
  height: number,
  color = INK,
) {
  const clean = pdfSafe(text);
  if (!clean) return;
  let drawSize = size;
  const maxWidth = Math.max(4, width - 2);
  while (drawSize > 5.5 && font.widthOfTextAtSize(clean, drawSize) > maxWidth) drawSize -= 0.5;
  const textWidth = font.widthOfTextAtSize(clean, drawSize);
  page.drawText(clean, {
    x: x + Math.max(1, (width - textWidth) / 2),
    y: bottom + (height - drawSize) / 2 + 1,
    size: drawSize,
    font,
    color,
  });
}

function dateLabel(iso: string): string {
  return printDateLabel(iso);
}

function jobLine(input: WeeklyHoursPdfInput): string {
  const job = [input.jobNumber.trim(), input.jobName.trim()].filter(Boolean).join("  ");
  const contract = input.contractLabel.trim();
  return [job || "Labor projection", contract].filter(Boolean).join("  ·  ").replace(/·/g, "-");
}

function rangeLine(weekStarts: string[], measure: WeeklyPrintMeasure): string {
  const measureText = measure === "people" ? "People" : "Hours";
  if (weekStarts.length === 0) return measureText;
  const first = weekStarts[0]!;
  const lastDays = printWeekDayIsos(weekStarts[weekStarts.length - 1]!);
  const last = lastDays[6] ?? weekStarts[weekStarts.length - 1]!;
  return `${dateLabel(first)} - ${dateLabel(last)}    ${measureText}`;
}

function columnPlan(layout: WeeklyPrintLayout, columnCount: number, available: number) {
  if (columnCount <= 0) return { perPage: 1, width: 28 };
  if (layout === "days") {
    const group = 7;
    const weeks = Math.ceil(columnCount / group);
    const minDay = 10;
    const maxDay = 16;
    const perPageWeeks = Math.max(1, Math.min(weeks, Math.floor(available / (minDay * group))));
    const width = Math.min(maxDay, available / (perPageWeeks * group));
    return { perPage: perPageWeeks * group, width };
  }
  const minWeek = 22;
  const maxWeek = 36;
  const perPage = Math.max(1, Math.min(columnCount, Math.floor(available / minWeek)));
  const width = Math.min(maxWeek, available / perPage);
  return { perPage, width };
}

function headerHeight(layout: WeeklyPrintLayout, colWidth: number): number {
  if (layout !== "days") return 16;
  return colWidth < 14 ? 26 : 32;
}

type Slice = {
  colStart: number;
  colCount: number;
  rowStart: number;
  rowCount: number;
};

function slicesFor(grid: WeeklyPrintGrid, perPage: number, rowsPerPage: number): Slice[] {
  const colCount = Math.max(grid.columns.length, 1);
  const rowCount = Math.max(grid.rows.length, 1);
  const pages: Slice[] = [];
  for (let rowStart = 0; rowStart < rowCount; rowStart += rowsPerPage) {
    for (let colStart = 0; colStart < colCount; colStart += perPage) {
      pages.push({
        colStart,
        colCount: Math.min(perPage, grid.columns.length - colStart),
        rowStart,
        rowCount: Math.min(rowsPerPage, grid.rows.length - rowStart),
      });
    }
  }
  return pages.length > 0 ? pages : [{ colStart: 0, colCount: 0, rowStart: 0, rowCount: 0 }];
}

function fillFor(column: WeeklyPrintColumn, value: number): ReturnType<typeof rgb> | null {
  if (column.holiday && column.dayIndex != null) return HOLIDAY;
  if (value > 0 && column.weekend) return FILLED_WEEKEND;
  if (value > 0) return FILLED;
  if (column.weekend) return WEEKEND;
  return null;
}

function drawTable(
  page: PDFPage,
  grid: WeeklyPrintGrid,
  slice: Slice,
  font: PDFFont,
  bold: PDFFont,
  top: number,
  colWidth: number,
  rowH: number,
  headH: number,
) {
  const cellSize = colWidth < 14 ? 6 : 7;
  const cols = grid.columns.slice(slice.colStart, slice.colStart + slice.colCount);
  const tableW = NAME_W + cols.length * colWidth + TOTAL_W;
  const x0 = MARGIN_X;

  function rect(x: number, bottom: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    page.drawRectangle({ x, y: bottom, width: w, height: h, color });
  }
  function border(x: number, bottom: number, w: number, h: number, color = LINE, width = 0.4) {
    page.drawRectangle({ x, y: bottom, width: w, height: h, borderColor: color, borderWidth: width });
  }

  const headBottom = top - headH;
  rect(x0, headBottom, tableW, headH, HEADER);
  drawCentered(page, "Cost code", bold, cellSize, x0, headBottom, NAME_W, headH, WHITE);

  if (grid.layout === "days") {
    const bandH = colWidth < 14 ? 11 : 13;
    const dayH = headH - bandH;
    let groupStart = 0;
    while (groupStart < cols.length) {
      const week = cols[groupStart]!.weekStart;
      let groupEnd = groupStart;
      while (groupEnd < cols.length && cols[groupEnd]!.weekStart === week) groupEnd += 1;
      const x = x0 + NAME_W + groupStart * colWidth;
      const w = (groupEnd - groupStart) * colWidth;
      rect(x, headBottom + dayH, w, bandH, HEADER);
      border(x, headBottom + dayH, w, bandH, LINE_STRONG, 0.8);
      drawCentered(
        page,
        truncate(printWeekLabel(week), bold, cellSize, Math.max(8, w - 2)),
        bold,
        cellSize,
        x,
        headBottom + dayH,
        w,
        bandH,
        WHITE,
      );
      groupStart = groupEnd;
    }
    cols.forEach((column, index) => {
      const x = x0 + NAME_W + index * colWidth;
      const headerColor = column.holiday ? HEADER_HOLIDAY : column.weekend ? HEADER_WEEKEND : HEADER;
      rect(x, headBottom, colWidth, dayH, headerColor);
      const day = column.dayIndex ?? 0;
      const [, month, date] = (printWeekDayIsos(column.weekStart)[day] ?? "").split("-");
      const dayLabel = colWidth < 14 ? weekdayShort(day).slice(0, 1) : weekdayShort(day);
      drawCentered(page, dayLabel, bold, cellSize, x, headBottom + (colWidth < 14 ? 0 : dayH * 0.35), colWidth, colWidth < 14 ? dayH : dayH * 0.65, WHITE);
      if (colWidth >= 14) {
        drawCentered(page, month && date ? `${Number(month)}/${Number(date)}` : "", font, 6, x, headBottom, colWidth, dayH * 0.5, WHITE);
      }
      border(x, headBottom, colWidth, dayH, column.dayIndex === 0 ? LINE_STRONG : LINE, column.dayIndex === 0 ? 0.9 : 0.4);
    });
  } else {
    cols.forEach((column, index) => {
      const x = x0 + NAME_W + index * colWidth;
      drawCentered(page, printWeekLabel(column.weekStart), bold, cellSize, x, headBottom, colWidth, headH, WHITE);
      border(x, headBottom, colWidth, headH, LINE, 0.4);
    });
  }

  const totalX = x0 + NAME_W + cols.length * colWidth;
  rect(totalX, headBottom, TOTAL_W, headH, HEADER);
  drawCentered(page, "Total", bold, cellSize, totalX, headBottom, TOTAL_W, headH, WHITE);
  border(x0, headBottom, NAME_W, headH, LINE_STRONG, 0.6);
  border(totalX, headBottom, TOTAL_W, headH, LINE_STRONG, 0.6);

  const rows = grid.rows.slice(slice.rowStart, slice.rowStart + slice.rowCount);
  const shownColumnTotal = (index: number) =>
    rows.reduce((sum, row) => sum + (row.values[slice.colStart + index] ?? 0), 0);
  const shownGrand = rows.reduce((sum, row) => sum + row.total, 0);
  rows.forEach((row, rowIndex) => {
    const bottom = headBottom - (rowIndex + 1) * rowH;
    border(x0, bottom, NAME_W, rowH);
    page.drawText(truncate(row.label, font, cellSize, NAME_W - 6), {
      x: x0 + 3,
      y: bottom + Math.max(2, (rowH - cellSize) / 2),
      size: cellSize,
      font,
      color: INK,
    });
    cols.forEach((column, index) => {
      const value = row.values[slice.colStart + index] ?? 0;
      const x = x0 + NAME_W + index * colWidth;
      const fill = fillFor(column, value);
      if (fill) rect(x, bottom, colWidth, rowH, fill);
      border(x, bottom, colWidth, rowH, column.dayIndex === 0 ? LINE_STRONG : LINE, column.dayIndex === 0 ? 0.8 : 0.35);
      drawCentered(page, formatWeeklyPrintQuantity(value, grid.measure), font, cellSize, x, bottom, colWidth, rowH);
    });
    rect(totalX, bottom, TOTAL_W, rowH, TOTAL_BG);
    border(totalX, bottom, TOTAL_W, rowH, LINE_STRONG, 0.5);
    drawCentered(page, formatWeeklyPrintQuantity(row.total, grid.measure), bold, cellSize, totalX, bottom, TOTAL_W, rowH);
  });

  const totalBottom = headBottom - rows.length * rowH - TOTAL_ROW_H;
  rect(x0, totalBottom, tableW, TOTAL_ROW_H, TOTAL_BG);
  border(x0, totalBottom, tableW, TOTAL_ROW_H, LINE_STRONG, 0.8);
  page.drawText("Total", { x: x0 + 3, y: totalBottom + 3, size: cellSize, font: bold, color: INK });
  cols.forEach((column, index) => {
    const value = shownColumnTotal(index);
    const x = x0 + NAME_W + index * colWidth;
    border(x, totalBottom, colWidth, TOTAL_ROW_H, column.dayIndex === 0 ? LINE_STRONG : LINE, column.dayIndex === 0 ? 0.8 : 0.35);
    drawCentered(page, formatWeeklyPrintQuantity(value, grid.measure), bold, cellSize, x, totalBottom, colWidth, TOTAL_ROW_H);
  });
  drawCentered(page, formatWeeklyPrintQuantity(shownGrand, grid.measure), bold, cellSize, totalX, totalBottom, TOTAL_W, TOTAL_ROW_H);
}

export async function buildWeeklyHoursPdf(input: WeeklyHoursPdfInput): Promise<Uint8Array> {
  const grid = buildWeeklyHoursGrid(input);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const available = PAGE_W - MARGIN_X * 2 - NAME_W - TOTAL_W;
  const plan = columnPlan(grid.layout, grid.columns.length, available);
  const headH = headerHeight(grid.layout, plan.width);
  const titleBlock = grid.measure === "people" ? 52 : 40;
  const tableTop = PAGE_H - MARGIN_TOP - titleBlock;
  const bodyHeight = tableTop - headH - TOTAL_ROW_H - (MARGIN_BOTTOM + 10);
  const naturalRow = 13;
  const rowCount = Math.max(grid.rows.length, 1);
  const rowH = rowCount * naturalRow <= bodyHeight ? naturalRow : Math.max(11, bodyHeight / rowCount);
  const rowsPerPage = Math.max(1, Math.floor(bodyHeight / rowH));
  const pages = slicesFor(grid, plan.perPage, rowsPerPage);
  const layoutLabel = grid.layout === "days" ? "Monday through Sunday" : "Week totals";
  const title = grid.measure === "people" ? "Weekly Manpower" : "Weekly hours";
  const showHolidayLegend = grid.columns.some((column) => column.holiday && column.dayIndex != null);

  pages.forEach((slice, index) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawText(title, { x: MARGIN_X, y: PAGE_H - MARGIN_TOP - 12, size: 14, font: bold, color: INK });
    page.drawText(truncate(layoutLabel, font, 9, 220), {
      x: PAGE_W - MARGIN_X - font.widthOfTextAtSize(layoutLabel, 9),
      y: PAGE_H - MARGIN_TOP - 11,
      size: 9,
      font,
      color: MUTED,
    });
    page.drawText(truncate(jobLine(input), font, 9, PAGE_W - MARGIN_X * 2), {
      x: MARGIN_X,
      y: PAGE_H - MARGIN_TOP - 26,
      size: 9,
      font,
      color: INK,
    });
    const legendLabel = "Holiday";
    const legendSize = 8;
    const legendBox = 8;
    const legendWidth = showHolidayLegend ? legendBox + 4 + font.widthOfTextAtSize(legendLabel, legendSize) : 0;
    page.drawText(truncate(rangeLine(input.weekStarts, grid.measure), font, 8, PAGE_W - MARGIN_X * 2 - legendWidth - 12), {
      x: MARGIN_X,
      y: PAGE_H - MARGIN_TOP - 38,
      size: 8,
      font,
      color: MUTED,
    });
    if (showHolidayLegend) {
      const legendX = PAGE_W - MARGIN_X - legendWidth;
      const legendY = PAGE_H - MARGIN_TOP - 39;
      page.drawRectangle({
        x: legendX,
        y: legendY,
        width: legendBox,
        height: legendBox,
        color: HOLIDAY,
        borderColor: HEADER_HOLIDAY,
        borderWidth: 0.75,
      });
      page.drawText(legendLabel, {
        x: legendX + legendBox + 4,
        y: legendY + 1,
        size: legendSize,
        font,
        color: INK,
      });
    }
    if (grid.measure === "people") {
      page.drawText(truncate(PEOPLE_PRINT_KEY, font, 8, PAGE_W - MARGIN_X * 2), {
        x: MARGIN_X,
        y: PAGE_H - MARGIN_TOP - 50,
        size: 8,
        font,
        color: MUTED,
      });
    }

    if (grid.columns.length > 0 && grid.rows.length > 0) {
      drawTable(page, grid, slice, font, bold, tableTop, plan.width, rowH, headH);
    } else {
      page.drawText("No weekly hours to print.", {
        x: MARGIN_X,
        y: tableTop - 16,
        size: 10,
        font,
        color: MUTED,
      });
    }

    const foot = MARGIN_BOTTOM - 12;
    const cols = grid.columns.slice(slice.colStart, slice.colStart + slice.colCount);
    const firstWeek = cols[0]?.weekStart;
    const lastWeek = cols[cols.length - 1]?.weekStart;
    const coversEveryColumn = slice.colStart === 0 && slice.colCount >= grid.columns.length;
    const notes: string[] = [];
    if (grid.seededMonday) notes.push("A week with no day plan prints its hours on Monday.");
    if (!coversEveryColumn && firstWeek && lastWeek) {
      notes.push(`Weeks of ${printWeekLabel(firstWeek)} through ${printWeekLabel(lastWeek)}. Total is every week.`);
    } else if (pages.length > 1 && firstWeek && lastWeek) {
      notes.push(`Weeks of ${printWeekLabel(firstWeek)} through ${printWeekLabel(lastWeek)}`);
    }
    const footLeft = notes.join("  ");
    if (footLeft) {
      page.drawText(truncate(footLeft, font, 7.5, 520), {
        x: MARGIN_X,
        y: foot,
        size: 7.5,
        font,
        color: MUTED,
      });
    }
    const pageLabel = `${index + 1} of ${pages.length}`;
    page.drawText(pageLabel, {
      x: PAGE_W - MARGIN_X - font.widthOfTextAtSize(pageLabel, 8),
      y: foot,
      size: 8,
      font,
      color: MUTED,
    });
  });

  const documentTitle = pdfSafe([input.jobNumber, input.jobName, title].filter((part) => part.trim()).join(" - "));
  doc.setTitle(documentTitle || title);
  return doc.save();
}
