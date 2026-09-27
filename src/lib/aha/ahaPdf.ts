import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { downloadPdfBytes } from "../pdfDownload";
import {
  createLetterPdfFonts,
  drawCenteredText,
  drawRightAlignedText,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  MUTED,
  PDF_MARGIN_TOP,
  PDF_MARGIN_X,
  TEXT,
  truncate,
  wrapLines,
} from "../pdfDrawCore";
import { formatLongDate } from "../printCore";
import { AHA_CONSIDERATIONS } from "./considerations";
import { AHA_PROBABILITIES, AHA_SEVERITIES, RAC_KEY, cleanAhaStep, formatOshaRef } from "./display";
import type { AhaEmergencyInfo } from "./emergency";
import { combinedPpe } from "./ppe";
import { RAC_COLORS, ahaNumber, overallRac, racFor } from "./rac";
import type { AhaQualification, AhaStep, ProjectAha, RacLevel } from "./types";

export type AhaPdfInput = {
  aha: ProjectAha;
  jobNumber: string;
  jobName: string;
  address: string;
  gc: string;
  preparedBy: string;
  filename: string;
  /** Company lines already filtered by Settings → Company & letterhead “In PDF” toggles. */
  letterhead: {
    companyName: string;
    companyAddress: string;
  };
  emergency: AhaEmergencyInfo;
  /** Printed site address: override, or the project address when the override is blank. */
  siteAddress: string;
  standardPpe: string[];
};

const DOC_TITLE = "Activity Hazard Analysis (AHA)";
const JHA_TITLE = "Job Hazard Analysis (JHA)";
const FOOTER_LEFT = "Crew acknowledgment on attached AHA signature log";
const JHA_FOOTER_LEFT = "Crew acknowledgment on signature table above";
const MATRIX_NOTE =
  "Review each hazard with its controls and assign a RAC (probability \u00d7 severity). Annotate the highest RAC at the top.";
const STOP_WORK =
  "Stop-work authority: any worker may stop work for an unsafe condition without retaliation.";
const JHA_FLOOR = 48;

const BADGE_SIZE = 10;
const BADGE_PAD_X = 10;
const BADGE_PAD_Y = 5;
const BADGE_H = BADGE_SIZE + BADGE_PAD_Y * 2;

const RULE = rgb(0.75, 0.75, 0.75);
const LABEL_BG = rgb(0.96, 0.96, 0.96);
const STRIP_HEAD = rgb(0.93, 0.93, 0.93);
const WHITE = rgb(1, 1, 1);

const HEADER_H = 18;
const HEADER_SIZE = 8;
const NAME_SIZE = 9;
const NAME_LH = 12;
const BODY_SIZE = 8;
const BODY_LH = 10.5;
const REF_SIZE = 6.5;
const REF_LH = 9;
const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;
const INFO_ROW_PAD = 5.1;
const COMPETENT_LINE = 180;
const RAC_SQUARE = 16;
const STEP_W = 190;
const RAC_W = 48;

const SIG_LABEL_Y = 68;
const SIG_LINE_Y = 58;
const SIG_CAPTION_Y = 46;
const FOOTER_RULE_Y = 34;
const FOOTER_TEXT_Y = 20;
const CONTENT_BOTTOM = 86;

const SIGNATURES = ["SSHO", "Superintendent", "QC manager", "Foreman"] as const;

type Fonts = {
  font: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
};

type DrawCtx = {
  doc: PDFDocument;
  fonts: Fonts;
  page: PDFPage;
  y: number;
  ahaNum: string;
  companyName: string;
  companyAddress: string;
  subtitle: string;
  title: string;
  badge: string;
  floor: number;
};

type Col = { key: "step" | "hazards" | "controls" | "rac"; title: string; x: number; w: number };

function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else if (ch === "\u2018" || ch === "\u2019") out += "'";
    else if (ch === "\u201C" || ch === "\u201D") out += '"';
    else if (ch === "\u2013" || ch === "\u2014" || ch === "\u2022") out += "-";
    else if (ch === "\u2026") out += "...";
    else if (ch === "\u00A0") out += " ";
    else out += "?";
  }
  return out;
}

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function joinParts(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" · ");
}

function isCalOsha(input: AhaPdfInput): boolean {
  return input.aha.options.standard === "calosha";
}

function fitLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const safe = pdfSafe(text).trim();
  if (!safe || width <= 0) return [];
  return wrapLines(safe, font, size, width).map((line) => truncate(line, font, size, width));
}

function contentBox(page: PDFPage) {
  const left = PDF_MARGIN_X;
  const right = page.getWidth() - PDF_MARGIN_X;
  return { left, right, width: right - left, center: page.getWidth() / 2 };
}

function titleGeometry(page: PDFPage) {
  const top = page.getHeight() - PDF_MARGIN_TOP;
  return {
    top,
    companyY: top - 15,
    divisionY: top - 27,
    titleY: top - 14,
    subtitleY: top - 29,
    pageLabelY: top - 40,
    ruleY: top - 50,
    contentY: top - 62,
    badgeBottom: top - BADGE_H,
  };
}

function refLine(step: AhaStep, includeEm: boolean, showRefs: boolean): string {
  if (!showRefs) return "";
  const osha = formatOshaRef(step.osha_refs);
  const em = includeEm ? step.em385_refs.trim() : "";
  if (osha && em) return `${osha} · EM 385-1-1 § ${em}`;
  if (osha) return osha;
  if (em) return `EM 385-1-1 § ${em}`;
  return "";
}

function drawBadge(page: PDFPage, bold: PDFFont, label: string, right: number, bottom: number): void {
  const text = pdfSafe(label);
  const width = bold.widthOfTextAtSize(text, BADGE_SIZE) + BADGE_PAD_X * 2;
  const x = right - width;
  page.drawRectangle({ x, y: bottom, width, height: BADGE_H, color: rgb(0, 0, 0) });
  page.drawText(text, {
    x: x + BADGE_PAD_X,
    y: bottom + BADGE_PAD_Y,
    size: BADGE_SIZE,
    font: bold,
    color: WHITE,
  });
}

function docSubtitle(standard: string): string {
  return standard === "calosha"
    ? "Prepared per Cal/OSHA Title 8 and company IIPP"
    : "Prepared per EM 385-1-1";
}

function drawTitleBand(ctx: DrawCtx): number {
  const page = ctx.page;
  const fonts = ctx.fonts;
  const box = contentBox(page);
  const geo = titleGeometry(page);
  const leftMax = box.center - box.left - 130;
  const lines = [
    ctx.companyName ? { text: ctx.companyName.toUpperCase(), font: fonts.bold, size: 9 } : null,
    ctx.companyAddress ? { text: ctx.companyAddress, font: fonts.font, size: 8 } : null,
  ].filter((line): line is { text: string; font: PDFFont; size: number } => Boolean(line));
  lines.forEach((line, index) => {
    page.drawText(truncate(pdfSafe(line.text), line.font, line.size, leftMax), {
      x: box.left,
      y: geo.companyY - index * 12,
      size: line.size,
      font: line.font,
      color: TEXT,
    });
  });
  drawCenteredText(page, ctx.title, box.center, geo.titleY, fonts.bold, 12);
  drawCenteredText(page, ctx.subtitle, box.center, geo.subtitleY, fonts.font, 8, MUTED);
  drawBadge(page, fonts.bold, ctx.badge, box.right, geo.badgeBottom);
  page.drawLine({
    start: { x: box.left, y: geo.ruleY },
    end: { x: box.right, y: geo.ruleY },
    thickness: 2,
    color: TEXT,
  });
  return geo.contentY;
}

function drawPageLabel(page: PDFPage, font: PDFFont, index: number, total: number): void {
  const box = contentBox(page);
  const geo = titleGeometry(page);
  drawRightAlignedText(page, `Page ${index} of ${total}`, box.right, geo.pageLabelY, font, 8, TEXT);
}

function drawFooter(page: PDFPage, fonts: Fonts, filename: string, left: string): void {
  const box = contentBox(page);
  page.drawLine({
    start: { x: box.left, y: FOOTER_RULE_Y },
    end: { x: box.right, y: FOOTER_RULE_Y },
    thickness: 0.6,
    color: TEXT,
  });
  page.drawText(left, {
    x: box.left,
    y: FOOTER_TEXT_Y,
    size: 8,
    font: fonts.font,
    color: MUTED,
  });
  const name = truncate(pdfSafe(filename), fonts.font, 8, box.width * 0.42);
  drawRightAlignedText(page, name, box.right, FOOTER_TEXT_Y, fonts.font, 8, MUTED);
}

function drawSignatures(page: PDFPage, fonts: Fonts): void {
  const box = contentBox(page);
  const colW = box.width / SIGNATURES.length;
  SIGNATURES.forEach((role, index) => {
    const x = box.left + index * colW;
    const lineLeft = x + 8;
    const lineRight = x + colW - 10;
    page.drawText(role, {
      x: lineLeft,
      y: SIG_LABEL_Y,
      size: 8,
      font: fonts.bold,
      color: TEXT,
    });
    page.drawLine({
      start: { x: lineLeft, y: SIG_LINE_Y },
      end: { x: lineRight, y: SIG_LINE_Y },
      thickness: 0.7,
      color: TEXT,
    });
    page.drawText("signature / date", {
      x: lineLeft,
      y: SIG_CAPTION_Y,
      size: 7,
      font: fonts.font,
      color: MUTED,
    });
  });
}

function drawRacSquare(page: PDFPage, cx: number, cy: number, size: number, level: RacLevel, bold: PDFFont): void {
  const colors = RAC_COLORS[level];
  const fontSize = size * 0.58;
  page.drawRectangle({
    x: cx - size / 2,
    y: cy - size / 2,
    width: size,
    height: size,
    color: hexToRgb(colors.background),
  });
  const width = bold.widthOfTextAtSize(level, fontSize);
  page.drawText(level, {
    x: cx - width / 2,
    y: cy - fontSize * 0.35,
    size: fontSize,
    font: bold,
    color: hexToRgb(colors.color),
  });
}

function drawOverallRac(page: PDFPage, x: number, top: number, width: number, level: RacLevel, fonts: Fonts): number {
  const height = 108;
  page.drawRectangle({
    x,
    y: top - height,
    width,
    height,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  const square = 40;
  const stack = 14 + 8 + square + 8 + 12;
  let cursor = top - Math.max(8, (height - stack) / 2);
  drawCenteredText(page, "OVERALL RAC", x + width / 2, cursor - 9, fonts.bold, 8);
  cursor -= 14 + 8;
  drawRacSquare(page, x + width / 2, cursor - square / 2, square, level, fonts.bold);
  cursor -= square + 8;
  drawCenteredText(page, "Highest step code", x + width / 2, cursor - 8, fonts.font, 7, MUTED);
  return height;
}

type InfoRow = { label: string; lines: string[]; underline: boolean };

function infoRowHeight(lines: number): number {
  return INFO_ROW_PAD + lines * 10;
}

function layoutInfo(
  rows: { label: string; value: string }[],
  fonts: Fonts,
  width: number,
): { height: number; labelW: number; rows: InfoRow[] } {
  const labelSize = 7.5;
  let labelW = 0;
  for (const row of rows) labelW = Math.max(labelW, fonts.bold.widthOfTextAtSize(pdfSafe(row.label), labelSize));
  labelW = Math.min(width * 0.48, labelW + 12);
  const valueW = Math.max(20, width - labelW - 10);
  const laid = rows.map((row) => {
    const value = row.value.trim();
    if (!value) return { label: pdfSafe(row.label), lines: [""], underline: true };
    const lines = fitLines(value, fonts.font, 8, valueW);
    return { label: pdfSafe(row.label), lines: lines.length ? lines : [""], underline: !lines.length };
  });
  const height = laid.reduce((sum, row) => sum + infoRowHeight(row.lines.length), 0);
  return { height, labelW, rows: laid };
}

function drawInfoTable(
  page: PDFPage,
  x: number,
  top: number,
  width: number,
  layout: { height: number; labelW: number; rows: InfoRow[] },
  fonts: Fonts,
): void {
  const bottom = top - layout.height;
  page.drawRectangle({ x, y: bottom, width, height: layout.height, color: WHITE });
  page.drawRectangle({ x, y: bottom, width: layout.labelW, height: layout.height, color: LABEL_BG });
  let cursor = top;
  layout.rows.forEach((row, index) => {
    const rowH = infoRowHeight(row.lines.length);
    const firstBaseline = cursor - INFO_ROW_PAD / 2 - 8;
    page.drawText(row.label, { x: x + 5, y: firstBaseline, size: 7.5, font: fonts.bold, color: TEXT });
    if (row.underline) {
      const lineW = Math.min(COMPETENT_LINE, Math.max(24, width - layout.labelW - 12));
      page.drawLine({
        start: { x: x + layout.labelW + 6, y: firstBaseline },
        end: { x: x + layout.labelW + 6 + lineW, y: firstBaseline },
        thickness: 0.7,
        color: TEXT,
      });
    } else {
      row.lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: x + layout.labelW + 6,
          y: firstBaseline - lineIndex * 10,
          size: 8,
          font: fonts.font,
          color: TEXT,
        });
      });
    }
    cursor -= rowH;
    if (index < layout.rows.length - 1) {
      page.drawLine({
        start: { x, y: cursor },
        end: { x: x + width, y: cursor },
        thickness: 0.4,
        color: RULE,
      });
    }
  });
  page.drawRectangle({
    x,
    y: bottom,
    width,
    height: layout.height,
    borderColor: RULE,
    borderWidth: 0.7,
  });
  page.drawLine({
    start: { x: x + layout.labelW, y: bottom },
    end: { x: x + layout.labelW, y: top },
    thickness: 0.4,
    color: RULE,
  });
}

function matrixKeyLines(fonts: Fonts, width: number): string[] {
  const key = RAC_KEY.map((item) => `${item.level} ${item.label}`).join(" · ");
  const lines = fitLines(key, fonts.font, 7, width - 10);
  return lines.length ? lines : [key];
}

function matrixNoteLines(fonts: Fonts, width: number): string[] {
  const lines = fitLines(MATRIX_NOTE, fonts.font, 6, width - 10);
  return lines.length ? lines : [pdfSafe(MATRIX_NOTE)];
}

function matrixHeight(fonts: Fonts, width: number): {
  height: number;
  labelW: number;
  cellW: number;
  headerH: number;
  rowH: number;
  keyH: number;
} {
  const labelW = 76;
  const cellW = (width - labelW) / AHA_PROBABILITIES.length;
  const headerLines = Math.max(
    1,
    ...AHA_PROBABILITIES.map((prob) => fitLines(prob.label, fonts.bold, 6.5, cellW - 4).length),
  );
  const headerH = headerLines * 8 + 6;
  const rowH = 16;
  const keyH = matrixKeyLines(fonts, width).length * 9 + matrixNoteLines(fonts, width).length * 8 + 10;
  return { height: headerH + AHA_SEVERITIES.length * rowH + keyH, labelW, cellW, headerH, rowH, keyH };
}

function drawMatrix(page: PDFPage, x: number, top: number, width: number, fonts: Fonts): number {
  const layout = matrixHeight(fonts, width);
  const bottom = top - layout.height;
  page.drawRectangle({
    x,
    y: bottom,
    width,
    height: layout.height,
    borderColor: RULE,
    borderWidth: 0.7,
  });
  drawCenteredText(page, "Severity", x + layout.labelW / 2, top - layout.headerH + 6, fonts.bold, 6.5, MUTED);
  AHA_PROBABILITIES.forEach((prob, index) => {
    const lines = fitLines(prob.label, fonts.bold, 6.5, layout.cellW - 4);
    const center = x + layout.labelW + index * layout.cellW + layout.cellW / 2;
    let lineTop = top - 4;
    for (const line of lines) {
      drawCenteredText(page, line, center, lineTop - 6.5, fonts.bold, 6.5);
      lineTop -= 8;
    }
  });
  AHA_SEVERITIES.forEach((sev, rowIndex) => {
    const rowTop = top - layout.headerH - rowIndex * layout.rowH;
    const rowBottom = rowTop - layout.rowH;
    const label = truncate(pdfSafe(sev.label), fonts.font, 7, layout.labelW - 8);
    page.drawText(label, {
      x: x + 4,
      y: rowBottom + (layout.rowH - 7) / 2,
      size: 7,
      font: fonts.font,
      color: TEXT,
    });
    AHA_PROBABILITIES.forEach((prob, colIndex) => {
      const cellX = x + layout.labelW + colIndex * layout.cellW;
      const level = racFor(prob.value, sev.value);
      const colors = RAC_COLORS[level];
      const inset = 1;
      page.drawRectangle({
        x: cellX + inset,
        y: rowBottom + inset,
        width: layout.cellW - inset * 2,
        height: layout.rowH - inset * 2,
        color: hexToRgb(colors.background),
      });
      const fontSize = 8;
      const letterW = fonts.bold.widthOfTextAtSize(level, fontSize);
      page.drawText(level, {
        x: cellX + (layout.cellW - letterW) / 2,
        y: rowBottom + (layout.rowH - fontSize) / 2 + 0.5,
        size: fontSize,
        font: fonts.bold,
        color: hexToRgb(colors.color),
      });
    });
  });
  const keyLines = matrixKeyLines(fonts, width);
  const noteLines = matrixNoteLines(fonts, width);
  const noteBlock = noteLines.length * 8;
  noteLines.forEach((line, index) => {
    drawCenteredText(
      page,
      line,
      x + width / 2,
      bottom + 3 + (noteLines.length - 1 - index) * 8,
      fonts.font,
      6,
      MUTED,
    );
  });
  keyLines.forEach((line, index) => {
    drawCenteredText(
      page,
      line,
      x + width / 2,
      bottom + 5 + noteBlock + (keyLines.length - 1 - index) * 9,
      fonts.font,
      7,
      MUTED,
    );
  });
  return layout.height;
}

function drawHeaderRow(ctx: DrawCtx, input: AhaPdfInput): void {
  const box = contentBox(ctx.page);
  const showMatrix = input.aha.options.matrix;
  const gap = 8;
  const racW = 120;
  const matrixW = showMatrix ? 288 : 0;
  const gaps = showMatrix ? gap * 2 : gap;
  const infoW = box.width - racW - matrixW - gaps;
  const infoX = box.left;
  const racX = infoX + infoW + gap;
  const matrixX = racX + racW + gap;
  const activity = joinParts([input.aha.name || "Untitled", input.aha.csi]);
  const optional = (label: string, value: string) => (value.trim() ? [{ label, value: value.trim() }] : []);
  const rows = isCalOsha(input)
    ? [
        { label: "Activity / work task", value: activity },
        { label: "Project", value: input.jobName.trim() },
        { label: "General contractor", value: input.gc.trim() },
        { label: "Project location", value: input.address.trim() },
        { label: "Project manager", value: input.aha.project_manager.trim() },
        ...optional("Superintendent", input.aha.superintendent),
        ...optional("Foreman", input.aha.foreman),
        { label: "Date prepared", value: formatLongDate() },
        { label: "Prepared by", value: input.preparedBy.trim() },
        ...optional("JHA reviewed by", input.aha.reviewed_by),
      ]
    : [
        { label: "Activity / work task", value: activity },
        { label: "Project", value: joinParts([input.jobName, input.address]) },
        { label: "Prime / GC", value: input.gc.trim() },
        { label: "Date prepared", value: formatLongDate() },
        { label: "Prepared by", value: input.preparedBy.trim() },
        { label: "Competent person", value: input.aha.competent_person.trim() },
      ];
  const info = layoutInfo(rows, ctx.fonts, infoW);
  const level = overallRac(input.aha.steps);
  const racH = drawOverallRac(ctx.page, racX, ctx.y, racW, level, ctx.fonts);
  drawInfoTable(ctx.page, infoX, ctx.y, infoW, info, ctx.fonts);
  const matrixH = showMatrix ? drawMatrix(ctx.page, matrixX, ctx.y, matrixW, ctx.fonts) : 0;
  ctx.y -= Math.max(info.height, racH, matrixH) + 12;
}

function tableColumns(page: PDFPage): Col[] {
  const box = contentBox(page);
  const rest = box.width - STEP_W - RAC_W;
  const hazardW = Math.round(rest * 0.42);
  const controlW = rest - hazardW;
  const specs: { key: Col["key"]; title: string; w: number }[] = [
    { key: "step", title: "Job steps", w: STEP_W },
    { key: "hazards", title: "Hazards", w: hazardW },
    { key: "controls", title: "Controls", w: controlW },
    { key: "rac", title: "RAC", w: RAC_W },
  ];
  let x = box.left;
  return specs.map((spec) => {
    const col = { ...spec, x };
    x += spec.w;
    return col;
  });
}

function bulletHeight(items: string[], font: PDFFont, width: number): number {
  if (!items.length) return 0;
  const textW = Math.max(8, width - 10);
  return items.reduce((sum, item) => sum + Math.max(fitLines(item, font, BODY_SIZE, textW).length, 1) * BODY_LH, 0);
}

function measureStep(step: AhaStep, index: number, cols: Col[], fonts: Fonts, includeEm: boolean, showRefs: boolean): number {
  const stepCol = cols[0]!;
  const hazardCol = cols[1]!;
  const controlCol = cols[2]!;
  const stepInner = stepCol.w - CELL_PAD_X * 2;
  const name = `${index + 1}. ${step.name.trim() || "Untitled step"}`;
  const stepH = Math.max(fitLines(name, fonts.bold, NAME_SIZE, stepInner).length, 1) * NAME_LH;
  const hazardH = bulletHeight(step.hazards, fonts.font, hazardCol.w - CELL_PAD_X * 2);
  let controlH = bulletHeight(step.controls, fonts.font, controlCol.w - CELL_PAD_X * 2);
  const refs = refLine(step, includeEm, showRefs);
  if (refs) {
    if (controlH > 0) controlH += 2;
    const refW = controlCol.w - CELL_PAD_X * 2;
    controlH += Math.max(fitLines(refs, fonts.mono, REF_SIZE, refW).length, 1) * REF_LH;
  }
  return Math.max(stepH, hazardH, controlH, RAC_SQUARE) + CELL_PAD_Y * 2;
}

function drawStepHeader(ctx: DrawCtx, cols: Col[]): void {
  const top = ctx.y;
  const bottom = top - HEADER_H;
  const width = cols.reduce((sum, col) => sum + col.w, 0);
  ctx.page.drawRectangle({
    x: cols[0]!.x,
    y: bottom,
    width,
    height: HEADER_H,
    color: rgb(0, 0, 0),
  });
  const baseline = bottom + (HEADER_H - HEADER_SIZE) / 2;
  for (const col of cols) {
    const label = truncate(col.title, ctx.fonts.bold, HEADER_SIZE, col.w - 8);
    if (col.key === "rac") {
      drawCenteredText(ctx.page, label, col.x + col.w / 2, baseline, ctx.fonts.bold, HEADER_SIZE, WHITE);
    } else {
      ctx.page.drawText(label, {
        x: col.x + 4,
        y: baseline,
        size: HEADER_SIZE,
        font: ctx.fonts.bold,
        color: WHITE,
      });
    }
  }
  ctx.y = bottom;
}

function drawBullets(page: PDFPage, items: string[], x: number, top: number, width: number, font: PDFFont): number {
  let cursor = top;
  const textW = Math.max(8, width - 10);
  for (const item of items) {
    const lines = fitLines(item, font, BODY_SIZE, textW);
    const drawn = lines.length ? lines : ["-"];
    drawn.forEach((line, lineIndex) => {
      const baseline = cursor - BODY_SIZE;
      if (lineIndex === 0) {
        page.drawCircle({ x: x + 3, y: baseline + BODY_SIZE * 0.32, size: 1.25, color: TEXT });
      }
      if (line) {
        page.drawText(line, { x: x + 8, y: baseline, size: BODY_SIZE, font, color: TEXT });
      }
      cursor -= BODY_LH;
    });
  }
  return cursor;
}

function drawStepRow(
  ctx: DrawCtx,
  step: AhaStep,
  index: number,
  cols: Col[],
  rowH: number,
  includeEm: boolean,
  showRefs: boolean,
): void {
  const top = ctx.y;
  const bottom = top - rowH;
  const width = cols.reduce((sum, col) => sum + col.w, 0);
  const left = cols[0]!.x;
  ctx.page.drawLine({
    start: { x: left, y: bottom },
    end: { x: left + width, y: bottom },
    thickness: 0.4,
    color: RULE,
  });
  cols.forEach((col, colIndex) => {
    ctx.page.drawLine({
      start: { x: col.x, y: bottom },
      end: { x: col.x, y: top },
      thickness: 0.35,
      color: RULE,
    });
    if (colIndex === cols.length - 1) {
      ctx.page.drawLine({
        start: { x: col.x + col.w, y: bottom },
        end: { x: col.x + col.w, y: top },
        thickness: 0.35,
        color: RULE,
      });
    }
  });
  const textTop = top - CELL_PAD_Y;
  const stepCol = cols[0]!;
  const name = `${index + 1}. ${step.name.trim() || "Untitled step"}`;
  let cursor = textTop;
  for (const line of fitLines(name, ctx.fonts.bold, NAME_SIZE, stepCol.w - CELL_PAD_X * 2)) {
    ctx.page.drawText(line, {
      x: stepCol.x + CELL_PAD_X,
      y: cursor - NAME_SIZE,
      size: NAME_SIZE,
      font: ctx.fonts.bold,
      color: TEXT,
    });
    cursor -= NAME_LH;
  }
  const hazardCol = cols[1]!;
  drawBullets(ctx.page, step.hazards, hazardCol.x + CELL_PAD_X, textTop, hazardCol.w - CELL_PAD_X * 2, ctx.fonts.font);
  const controlCol = cols[2]!;
  let controlCursor = drawBullets(
    ctx.page,
    step.controls,
    controlCol.x + CELL_PAD_X,
    textTop,
    controlCol.w - CELL_PAD_X * 2,
    ctx.fonts.font,
  );
  const refs = refLine(step, includeEm, showRefs);
  if (refs) {
    if (step.controls.length) controlCursor -= 2;
    for (const line of fitLines(refs, ctx.fonts.mono, REF_SIZE, controlCol.w - CELL_PAD_X * 2)) {
      ctx.page.drawText(line, {
        x: controlCol.x + CELL_PAD_X,
        y: controlCursor - REF_SIZE,
        size: REF_SIZE,
        font: ctx.fonts.mono,
        color: MUTED,
      });
      controlCursor -= REF_LH;
    }
  }
  const racCol = cols[3]!;
  drawRacSquare(
    ctx.page,
    racCol.x + racCol.w / 2,
    bottom + rowH / 2,
    RAC_SQUARE,
    racFor(step.prob, step.sev),
    ctx.fonts.bold,
  );
  ctx.y = bottom;
}

function addPage(ctx: DrawCtx): void {
  ctx.page = ctx.doc.addPage([LETTER_HEIGHT, LETTER_WIDTH]);
  ctx.y = drawTitleBand(ctx);
}

function sumIndexed(heights: number[], indexes: number[]): number {
  return indexes.reduce((sum, index) => sum + heights[index]!, 0);
}

function rowsThatFit(heights: number[], start: number, space: number): number {
  let used = 0;
  let count = 0;
  for (let index = start; index < heights.length; index++) {
    const height = heights[index]!;
    if (used + height > space) break;
    used += height;
    count++;
  }
  return count;
}

/** Pack step rows so a continuation page starts with at least two rows when the next page can hold them. */
function packRowPages(heights: number[], firstSpace: number, nextSpace: number): number[][] {
  const total = heights.length;
  const pages: number[][] = [[]];
  let space = firstSpace;
  let index = 0;

  while (index < total) {
    const page = pages[pages.length - 1]!;
    const remaining = total - index;
    let count = rowsThatFit(heights, index, space);

    if (count === 0) {
      if (page.length === 0 && space === nextSpace) {
        page.push(index);
        space -= heights[index]!;
        index += 1;
        continue;
      }
      pages.push([]);
      space = nextSpace;
      continue;
    }

    if (count < remaining && remaining - count < 2) {
      const kept = count - 1;
      const nextRemaining = remaining - kept;
      const nextCount = rowsThatFit(heights, index + kept, nextSpace);
      if (nextCount >= Math.min(2, nextRemaining)) count = kept;
    }

    if (count === 0) {
      if (page.length === 0 && space === nextSpace) {
        count = 1;
      } else {
        pages.push([]);
        space = nextSpace;
        continue;
      }
    }

    if (count >= remaining) {
      for (let cursor = index; cursor < total; cursor++) page.push(cursor);
      break;
    }

    for (let taken = 0; taken < count; taken++) {
      page.push(index);
      space -= heights[index]!;
      index++;
    }
    pages.push([]);
    space = nextSpace;
  }

  while (pages.length > 1 && pages[pages.length - 1]!.length === 0) pages.pop();
  return pages;
}

/** Keep the requirements strip on the same page as the trailing step rows. */
function keepTailWithRows(
  pages: number[][],
  heights: number[],
  firstSpace: number,
  nextSpace: number,
  tail: number,
): number[][] {
  const result = pages.map((page) => page.slice());
  while (result.length > 1 && result[result.length - 1]!.length === 0) result.pop();
  if (!result.length) result.push([]);
  const room = (pageIndex: number) => (pageIndex === 0 ? firstSpace : nextSpace);

  for (let guard = 0; guard < heights.length + 2; guard++) {
    const lastIndex = result.length - 1;
    const last = result[lastIndex]!;
    if (tail <= room(lastIndex) - sumIndexed(heights, last)) return result;

    let move = 0;
    for (const want of [2, 1]) {
      if (last.length < want) continue;
      if (sumIndexed(heights, last.slice(last.length - want)) + tail <= nextSpace) {
        move = want;
        break;
      }
    }
    if (move === 0) return result;
    if (last.length === move && room(lastIndex) >= nextSpace) return result;

    const moved = last.splice(last.length - move, move);
    if (last.length === 0 && result.length > 1) result.pop();
    result.push(moved);
  }
  return result;
}

function drawStepTable(ctx: DrawCtx, input: AhaPdfInput, tailHeight: number): void {
  const showRefs = input.aha.options.show_refs;
  const includeEm = input.aha.options.standard === "em385";
  const steps = input.aha.steps.map(cleanAhaStep);
  const cols = tableColumns(ctx.page);

  if (!steps.length) {
    const rowH = 24;
    if (ctx.y - HEADER_H - rowH < ctx.floor) addPage(ctx);
    drawStepHeader(ctx, cols);
    const top = ctx.y;
    const bottom = top - rowH;
    const width = cols.reduce((sum, col) => sum + col.w, 0);
    ctx.page.drawLine({
      start: { x: cols[0]!.x, y: bottom },
      end: { x: cols[0]!.x + width, y: bottom },
      thickness: 0.4,
      color: RULE,
    });
    ctx.page.drawText("No job steps.", {
      x: cols[0]!.x + CELL_PAD_X,
      y: bottom + 8,
      size: 8,
      font: ctx.fonts.font,
      color: MUTED,
    });
    ctx.y = bottom;
    return;
  }

  const heights = steps.map((step, index) => measureStep(step, index, cols, ctx.fonts, includeEm, showRefs));
  const firstSpace = ctx.y - ctx.floor - HEADER_H;
  const nextSpace = titleGeometry(ctx.page).contentY - ctx.floor - HEADER_H;
  const pages = keepTailWithRows(packRowPages(heights, firstSpace, nextSpace), heights, firstSpace, nextSpace, tailHeight);

  pages.forEach((group, pageIndex) => {
    if (pageIndex > 0) addPage(ctx);
    if (!group.length) return;
    const pageCols = tableColumns(ctx.page);
    drawStepHeader(ctx, pageCols);
    for (const index of group) {
      drawStepRow(ctx, steps[index]!, index, pageCols, heights[index]!, includeEm, showRefs);
    }
  });
}

const CONS_SIZE = 10;
const CONS_LH = 13;

type CellLine = { text: string; font: PDFFont; size: number; color: RGB; advance: number };
type TableCell = { lines: CellLine[]; center?: boolean };
type TableBodyRow = { height: number; cells: TableCell[] };
type ColSpec = { title: string; w: number; x: number };

function pageRoom(ctx: DrawCtx): number {
  return titleGeometry(ctx.page).contentY - ctx.floor;
}

function leadIn(ctx: DrawCtx, gap: number, blockH: number): void {
  if (ctx.y - gap - blockH < ctx.floor && gap + blockH < pageRoom(ctx)) addPage(ctx);
  else if (ctx.y - gap >= ctx.floor) ctx.y -= gap;
}

function textLines(text: string, font: PDFFont, size: number, advance: number, width: number, color: RGB): CellLine[] {
  const lines = fitLines(text, font, size, Math.max(8, width - CELL_PAD_X * 2));
  const drawn = lines.length ? lines : text.trim() ? [truncate(pdfSafe(text), font, size, width - CELL_PAD_X * 2)] : [];
  return drawn.map((line) => ({ text: line, font, size, color, advance }));
}

function linesHeight(lines: CellLine[]): number {
  if (!lines.length) return BODY_LH;
  return lines.reduce((sum, line) => sum + line.advance, 0);
}

function rowFromCells(cells: TableCell[], minH = BODY_LH + CELL_PAD_Y * 2): TableBodyRow {
  const content = Math.max(...cells.map((cell) => linesHeight(cell.lines)), BODY_LH);
  return { height: Math.max(minH, content + CELL_PAD_Y * 2), cells };
}

function placeColumns(left: number, specs: { title: string; w: number }[]): ColSpec[] {
  let x = left;
  return specs.map((spec) => {
    const col = { ...spec, x };
    x += spec.w;
    return col;
  });
}

function drawGridHeader(ctx: DrawCtx, cols: ColSpec[]): void {
  const top = ctx.y;
  const bottom = top - HEADER_H;
  const width = cols.reduce((sum, col) => sum + col.w, 0);
  ctx.page.drawRectangle({
    x: cols[0]!.x,
    y: bottom,
    width,
    height: HEADER_H,
    color: rgb(0, 0, 0),
  });
  const baseline = bottom + (HEADER_H - HEADER_SIZE) / 2;
  for (const col of cols) {
    const label = truncate(pdfSafe(col.title), ctx.fonts.bold, HEADER_SIZE, col.w - 8);
    ctx.page.drawText(label, {
      x: col.x + 4,
      y: baseline,
      size: HEADER_SIZE,
      font: ctx.fonts.bold,
      color: WHITE,
    });
  }
  ctx.y = bottom;
}

function drawGridRow(ctx: DrawCtx, cols: ColSpec[], row: TableBodyRow): void {
  const top = ctx.y;
  const bottom = top - row.height;
  const width = cols.reduce((sum, col) => sum + col.w, 0);
  const left = cols[0]!.x;
  ctx.page.drawLine({
    start: { x: left, y: bottom },
    end: { x: left + width, y: bottom },
    thickness: 0.4,
    color: RULE,
  });
  cols.forEach((col, index) => {
    ctx.page.drawLine({
      start: { x: col.x, y: bottom },
      end: { x: col.x, y: top },
      thickness: 0.35,
      color: RULE,
    });
    if (index === cols.length - 1) {
      ctx.page.drawLine({
        start: { x: col.x + col.w, y: bottom },
        end: { x: col.x + col.w, y: top },
        thickness: 0.35,
        color: RULE,
      });
    }
    const cell = row.cells[index];
    if (!cell) return;
    if (cell.center) {
      const line = cell.lines[0];
      if (line?.text) {
        drawCenteredText(ctx.page, line.text, col.x + col.w / 2, bottom + (row.height - line.size) / 2, line.font, line.size, line.color);
      }
      return;
    }
    let cursor = top - CELL_PAD_Y;
    for (const line of cell.lines) {
      if (line.text) {
        ctx.page.drawText(line.text, {
          x: col.x + CELL_PAD_X,
          y: cursor - line.size,
          size: line.size,
          font: line.font,
          color: line.color,
        });
      }
      cursor -= line.advance;
    }
  });
  ctx.y = bottom;
}

function drawPaginatedTable(ctx: DrawCtx, specs: { title: string; w: number }[], rows: TableBodyRow[]): void {
  let headerOnPage = false;
  const drawHeader = () => {
    drawGridHeader(ctx, placeColumns(contentBox(ctx.page).left, specs));
    headerOnPage = true;
  };
  if (!rows.length) {
    if (ctx.y - HEADER_H < ctx.floor && HEADER_H < pageRoom(ctx)) addPage(ctx);
    drawHeader();
    return;
  }
  for (const row of rows) {
    const needed = (headerOnPage ? 0 : HEADER_H) + row.height;
    if (ctx.y - needed < ctx.floor && (needed < pageRoom(ctx) || headerOnPage)) {
      addPage(ctx);
      headerOnPage = false;
    }
    if (!headerOnPage) drawHeader();
    drawGridRow(ctx, placeColumns(contentBox(ctx.page).left, specs), row);
  }
}

function drawSectionHeading(ctx: DrawCtx, title: string): void {
  const width = contentBox(ctx.page).width;
  const lines = fitLines(title, ctx.fonts.bold, 9, width);
  const drawn = lines.length ? lines : [pdfSafe(title)];
  const height = drawn.length * 12 + 2;
  leadIn(ctx, 10, height + HEADER_H + 22);
  let cursor = ctx.y;
  for (const line of drawn) {
    ctx.page.drawText(line, {
      x: contentBox(ctx.page).left,
      y: cursor - 9,
      size: 9,
      font: ctx.fonts.bold,
      color: TEXT,
    });
    cursor -= 12;
  }
  ctx.y = cursor - 2;
}

function layoutYesNo(
  label: string,
  yes: boolean,
  fonts: Fonts,
  width: number,
): { height: number; runs: { text: string; font: PDFFont; x: number; line: number }[] } {
  const value = yes ? "Yes" : "No";
  const valueFont = yes ? fonts.bold : fonts.font;
  const valueText = pdfSafe(value);
  const valueW = valueFont.widthOfTextAtSize(valueText, CONS_SIZE);
  const words = pdfSafe(label).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (fonts.font.widthOfTextAtSize(next, CONS_SIZE) <= width) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push("");
  const lastIndex = lines.length - 1;
  lines[lastIndex] = `${lines[lastIndex]}:`;
  const runs = lines.map((text, line) => ({ text, font: fonts.font, x: 0, line }));
  const lastW = fonts.font.widthOfTextAtSize(`${lines[lastIndex]} `, CONS_SIZE);
  if (lastW + valueW <= width) runs.push({ text: valueText, font: valueFont, x: lastW, line: lastIndex });
  else runs.push({ text: valueText, font: valueFont, x: 0, line: lastIndex + 1 });
  const lineCount = Math.max(...runs.map((run) => run.line)) + 1;
  return { height: lineCount * CONS_LH, runs };
}

function drawConsiderations(ctx: DrawCtx, input: AhaPdfInput): void {
  const box = contentBox(ctx.page);
  const marked = new Set(input.aha.considerations);
  const colW = box.width / 3;
  const inner = colW - 8;
  const cells = AHA_CONSIDERATIONS.map((item) => layoutYesNo(item.label, marked.has(item.key), ctx.fonts, inner));
  const rowCount = Math.ceil(cells.length / 3);
  const rowHeights: number[] = [];
  for (let row = 0; row < rowCount; row++) {
    rowHeights.push(Math.max(cells[row * 3]?.height ?? CONS_LH, cells[row * 3 + 1]?.height ?? 0, cells[row * 3 + 2]?.height ?? 0));
  }
  const titleH = 14;
  const height = titleH + rowHeights.reduce((sum, row) => sum + row, 0);
  leadIn(ctx, 4, height);
  ctx.page.drawText("Safety & health considerations", {
    x: box.left,
    y: ctx.y - 9,
    size: 9,
    font: ctx.fonts.bold,
    color: TEXT,
  });
  let top = ctx.y - titleH;
  for (let row = 0; row < rowCount; row++) {
    const rowH = rowHeights[row]!;
    for (let col = 0; col < 3; col++) {
      const cell = cells[row * 3 + col];
      if (!cell) continue;
      const x = box.left + col * colW;
      for (const run of cell.runs) {
        ctx.page.drawText(run.text, {
          x: x + run.x,
          y: top - run.line * CONS_LH - CONS_SIZE,
          size: CONS_SIZE,
          font: run.font,
          color: TEXT,
        });
      }
    }
    top -= rowH;
  }
  ctx.y = top;
}

function drawWrappedLine(ctx: DrawCtx, text: string, font: PDFFont, size: number, advance: number): void {
  const box = contentBox(ctx.page);
  const lines = fitLines(text, font, size, box.width);
  const drawn = lines.length ? lines : [""];
  const height = drawn.length * advance;
  leadIn(ctx, 2, height);
  for (const line of drawn) {
    ctx.page.drawText(line, {
      x: box.left,
      y: ctx.y - size,
      size,
      font,
      color: TEXT,
    });
    ctx.y -= advance;
  }
}

function drawPpeAndStopWork(ctx: DrawCtx, input: AhaPdfInput): void {
  const items = combinedPpe(input.standardPpe, input.aha.extra_ppe);
  const ppe = items.length ? `Required PPE: ${items.join(", ")}` : "Required PPE:";
  drawWrappedLine(ctx, ppe, ctx.fonts.font, 9, 12);
  drawWrappedLine(ctx, STOP_WORK, ctx.fonts.bold, 8, 11);
}

function contactLine(contact: AhaEmergencyInfo["emergency_contacts"][number]): string {
  return [contact.name, contact.role, contact.phone].map((part) => part.trim()).filter(Boolean).join(", ");
}

function drawEmergencyBox(ctx: DrawCtx, input: AhaPdfInput): void {
  const box = contentBox(ctx.page);
  const labelW = 118;
  const valueW = box.width - labelW - 16;
  const contactLines = input.emergency.emergency_contacts.map(contactLine).filter(Boolean);
  const rows: { label: string; value: string }[] = [
    { label: "Site address", value: input.siteAddress.trim() },
    { label: "Nearest hospital", value: input.emergency.nearest_hospital.trim() },
    { label: "Occupational clinic", value: input.emergency.occupational_clinic.trim() },
    { label: "Emergency contacts", value: contactLines.join("\n") },
    { label: "Muster point", value: input.emergency.muster_point.trim() },
  ];
  const measured = rows.map((row) => {
    const lines = row.value.split("\n").flatMap((part) => {
      const text = part.trim();
      if (!text) return [""];
      const wrapped = fitLines(text, ctx.fonts.font, 8, valueW);
      return wrapped.length ? wrapped : [""];
    });
    return { ...row, lines: lines.length ? lines : [""] };
  });
  const headerH = 16;
  const bodyH = measured.reduce((sum, row) => sum + Math.max(row.lines.length, 1) * 12 + 4, 0) + 6;
  const height = headerH + bodyH;
  leadIn(ctx, 8, height);
  const top = ctx.y;
  const bottom = top - height;
  ctx.page.drawRectangle({
    x: box.left,
    y: bottom,
    width: box.width,
    height,
    borderColor: RULE,
    borderWidth: 0.7,
  });
  ctx.page.drawRectangle({
    x: box.left,
    y: top - headerH,
    width: box.width,
    height: headerH,
    color: STRIP_HEAD,
  });
  ctx.page.drawText("Emergency information", {
    x: box.left + 8,
    y: top - 11,
    size: 8,
    font: ctx.fonts.bold,
    color: TEXT,
  });
  let cursor = top - headerH - 4;
  for (const row of measured) {
    const rowH = Math.max(row.lines.length, 1) * 12;
    ctx.page.drawText(row.label, {
      x: box.left + 8,
      y: cursor - 9,
      size: 8,
      font: ctx.fonts.font,
      color: MUTED,
    });
    row.lines.forEach((line, index) => {
      const y = cursor - 9 - index * 12;
      if (line) {
        ctx.page.drawText(line, { x: box.left + labelW, y, size: 8, font: ctx.fonts.font, color: TEXT });
      } else {
        const lineW = Math.min(180, valueW);
        ctx.page.drawLine({
          start: { x: box.left + labelW, y: y + 1 },
          end: { x: box.left + labelW + lineW, y: y + 1 },
          thickness: 0.7,
          color: TEXT,
        });
      }
    });
    cursor -= rowH + 4;
  }
  ctx.y = bottom;
}

function drawNotes(ctx: DrawCtx, notes: string): void {
  const text = notes.trim();
  if (!text) return;
  const box = contentBox(ctx.page);
  const lines = fitLines(text, ctx.fonts.font, 8, box.width - 16);
  const headerH = 16;
  const bodyH = Math.max(lines.length, 1) * 11 + 8;
  const height = headerH + bodyH;
  leadIn(ctx, 8, height);
  const top = ctx.y;
  const bottom = top - height;
  ctx.page.drawRectangle({
    x: box.left,
    y: bottom,
    width: box.width,
    height,
    borderColor: RULE,
    borderWidth: 0.7,
  });
  ctx.page.drawRectangle({
    x: box.left,
    y: top - headerH,
    width: box.width,
    height: headerH,
    color: STRIP_HEAD,
  });
  ctx.page.drawText("Notes", {
    x: box.left + 6,
    y: top - 12,
    size: 8,
    font: ctx.fonts.bold,
    color: TEXT,
  });
  lines.forEach((line, index) => {
    ctx.page.drawText(line, {
      x: box.left + 6,
      y: top - headerH - 12 - index * 11,
      size: 8,
      font: ctx.fonts.font,
      color: TEXT,
    });
  });
  ctx.y = bottom;
}

function qualificationLabel(value: AhaQualification): string {
  if (value === "qualified") return "Qualified";
  if (value === "trained") return "Trained";
  if (value === "qualified_licensed") return "Qualified-Licensed";
  return "Competent";
}

function formatReviewDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim();
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function plainCell(text: string, font: PDFFont, width: number, color: RGB = TEXT): TableCell {
  return { lines: textLines(text, font, BODY_SIZE, BODY_LH, width, color) };
}

function drawProductsTable(ctx: DrawCtx, input: AhaPdfInput): void {
  const products = input.aha.products.filter((row) => row.product.trim() || row.manufacturer.trim());
  if (!products.length) return;
  const width = contentBox(ctx.page).width;
  const sdsW = 72;
  const manufacturerW = 180;
  const productW = width - sdsW - manufacturerW;
  const specs = [
    { title: "Product", w: productW },
    { title: "Manufacturer", w: manufacturerW },
    { title: "SDS on file", w: sdsW },
  ];
  const rows = products.map((row) =>
    rowFromCells([
      plainCell(row.product, ctx.fonts.font, productW),
      plainCell(row.manufacturer, ctx.fonts.font, manufacturerW),
      row.sds_on_file
        ? { center: true, lines: [{ text: "Yes", font: ctx.fonts.bold, size: 8, color: TEXT, advance: BODY_LH }] }
        : plainCell("No", ctx.fonts.font, sdsW),
    ]),
  );
  drawSectionHeading(ctx, "Products used / SDS on file");
  drawPaginatedTable(ctx, specs, rows);
}

function drawEquipmentTable(ctx: DrawCtx, input: AhaPdfInput): void {
  const width = contentBox(ctx.page).width;
  const colW = Math.floor(width / 3);
  const specs = [
    { title: "Equipment to be used", w: colW },
    { title: "Training requirements", w: colW },
    { title: "Inspection requirements", w: width - colW * 2 },
  ];
  const rows = input.aha.equipment_rows.map((row) =>
    rowFromCells([
      plainCell(row.equipment, ctx.fonts.font, specs[0]!.w),
      plainCell(row.training, ctx.fonts.font, specs[1]!.w),
      plainCell(row.inspection, ctx.fonts.font, specs[2]!.w),
    ]),
  );
  leadIn(ctx, 12, HEADER_H + (rows[0]?.height ?? 20));
  drawPaginatedTable(ctx, specs, rows);
}

function drawCompetentTable(ctx: DrawCtx, input: AhaPdfInput): void {
  const people = input.aha.competent_persons.filter(
    (row) => row.activity.trim() || row.note.trim() || row.employee.trim(),
  );
  if (!people.length) return;
  const width = contentBox(ctx.page).width;
  const naW = 42;
  const qualW = 130;
  const employeeW = 160;
  const activityW = width - naW - qualW - employeeW;
  const specs = [
    { title: "Activity", w: activityW },
    { title: "Qualification type", w: qualW },
    { title: "N/A", w: naW },
    { title: "Employee name", w: employeeW },
  ];
  const rows = people.map((row) => {
    const nameLines = textLines(row.activity, ctx.fonts.font, BODY_SIZE, BODY_LH, activityW, TEXT);
    const noteLines = row.note.trim()
      ? textLines(row.note, ctx.fonts.font, 7, 9, activityW, MUTED)
      : [];
    const activity: TableCell = { lines: [...nameLines, ...noteLines] };
    const mark: TableCell = row.na
      ? { center: true, lines: [{ text: "X", font: ctx.fonts.bold, size: 8, color: TEXT, advance: BODY_LH }] }
      : { lines: [] };
    return rowFromCells([
      activity,
      plainCell(qualificationLabel(row.qualification), ctx.fonts.font, qualW),
      mark,
      plainCell(row.employee, ctx.fonts.font, employeeW),
    ]);
  });
  drawSectionHeading(ctx, "Activities requiring a competent or qualified person");
  drawPaginatedTable(ctx, specs, rows);
}

function blankSignatureRows(count: number): TableBodyRow[] {
  return Array.from({ length: count }, () =>
    rowFromCells([{ lines: [] }, { lines: [] }, { lines: [] }], 20),
  );
}

function drawCalOshaSignatures(ctx: DrawCtx, input: AhaPdfInput): void {
  const width = contentBox(ctx.page).width;
  const colW = Math.floor(width / 3);
  const verify = [
    { title: "Name (print)", w: colW },
    { title: "Signature", w: colW },
    { title: "Date", w: width - colW * 2 },
  ];
  drawSectionHeading(ctx, "Signatures / verification of review");
  drawPaginatedTable(ctx, verify, blankSignatureRows(12));
  if (!input.aha.options.reviewLog) return;
  const reviewSpecs = [
    { title: "Name", w: colW },
    { title: "Signature", w: colW },
    { title: "Date", w: width - colW * 2 },
  ];
  drawSectionHeading(ctx, "JHA modified and reviewed");
  const filled = input.aha.review_log.map((entry) =>
    rowFromCells(
      [
        plainCell(entry.name, ctx.fonts.font, reviewSpecs[0]!.w),
        { lines: [] },
        plainCell(formatReviewDate(entry.date), ctx.fonts.font, reviewSpecs[2]!.w),
      ],
      20,
    ),
  );
  const padded = filled.length >= 4 ? filled : [...filled, ...blankSignatureRows(4 - filled.length)];
  drawPaginatedTable(ctx, reviewSpecs, padded);
}

export async function buildAhaPdfBytes(input: AhaPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { font, bold } = await createLetterPdfFonts(doc);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const calosha = isCalOsha(input);
  const number = ahaNumber(input.jobNumber.trim(), input.aha.seq);
  const ctx: DrawCtx = {
    doc,
    fonts: { font, bold, mono },
    page: doc.addPage([LETTER_HEIGHT, LETTER_WIDTH]),
    y: 0,
    ahaNum: number,
    companyName: input.letterhead.companyName.trim(),
    companyAddress: input.letterhead.companyAddress.trim(),
    subtitle: docSubtitle(input.aha.options.standard),
    title: calosha ? JHA_TITLE : DOC_TITLE,
    badge: `${calosha ? "JHA" : "AHA"} ${number}`,
    floor: calosha ? JHA_FLOOR : CONTENT_BOTTOM,
  };
  ctx.y = drawTitleBand(ctx);
  drawHeaderRow(ctx, input);
  drawConsiderations(ctx, input);
  drawPpeAndStopWork(ctx, input);
  drawEmergencyBox(ctx, input);
  drawNotes(ctx, input.aha.notes);
  if (ctx.y - 8 >= ctx.floor) ctx.y -= 8;
  drawStepTable(ctx, input, 0);
  drawProductsTable(ctx, input);
  drawEquipmentTable(ctx, input);
  drawCompetentTable(ctx, input);
  if (calosha) drawCalOshaSignatures(ctx, input);
  const pages = doc.getPages();
  if (!calosha) drawSignatures(pages[pages.length - 1]!, ctx.fonts);
  const footer = calosha ? JHA_FOOTER_LEFT : FOOTER_LEFT;
  pages.forEach((page, index) => {
    drawFooter(page, ctx.fonts, input.filename, footer);
    drawPageLabel(page, ctx.fonts.font, index + 1, pages.length);
  });
  return doc.save();
}

export async function downloadAhaPdf(input: AhaPdfInput): Promise<void> {
  const bytes = await buildAhaPdfBytes(input);
  downloadPdfBytes(bytes, input.filename);
}
