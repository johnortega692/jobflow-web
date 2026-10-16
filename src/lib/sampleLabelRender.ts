import { create as createQr } from "qrcode";
import { logoToBlackAndWhitePng } from "./sampleLabelLogo";
import { withPngPhys } from "./pngPhys";
import {
  SHEET_LABEL_COLUMN_PAD,
  SHEET_LABEL_COLUMN_RATIO,
  SHEET_LABEL_DPI,
  SHEET_LABEL_PX_H,
  SHEET_LABEL_PX_W,
  SHEET_LABEL_RULE_PAD,
} from "./sheetLabelTemplate";
import {
  SAMPLE_LABEL_BAND_H,
  SAMPLE_LABEL_DPI,
  SAMPLE_LABEL_HEIGHT,
  SAMPLE_LABEL_LANDSCAPE_BAND_H,
  SAMPLE_LABEL_LANDSCAPE_COL_PAD,
  SAMPLE_LABEL_LANDSCAPE_COL_W,
  SAMPLE_LABEL_LANDSCAPE_HEIGHT,
  SAMPLE_LABEL_LANDSCAPE_LOGO_MAX_W,
  SAMPLE_LABEL_LANDSCAPE_MARGIN_BOTTOM,
  SAMPLE_LABEL_LANDSCAPE_MARGIN_TOP,
  SAMPLE_LABEL_LANDSCAPE_MARGIN_X,
  SAMPLE_LABEL_LANDSCAPE_QR,
  SAMPLE_LABEL_LANDSCAPE_RULE,
  SAMPLE_LABEL_LANDSCAPE_RULE_PAD,
  SAMPLE_LABEL_LANDSCAPE_WIDTH,
  SAMPLE_LABEL_LOGO_MAX_H,
  SAMPLE_LABEL_MARGIN,
  SAMPLE_LABEL_QR_PX,
  SAMPLE_LABEL_QR_QUIET,
  SAMPLE_LABEL_WIDTH,
  qrModuleGeometry,
  sampleLabelBlockOn,
  sampleLabelSpecLines,
  wrapTextLines,
  type SampleLabelInput,
} from "./sampleLabelContent";

const SANS = "Arial, Helvetica, sans-serif";
const MONO = "Consolas, 'Courier New', monospace";
const CONTENT_W = SAMPLE_LABEL_WIDTH - SAMPLE_LABEL_MARGIN * 2;
const BLACK = "#000000";
const WHITE = "#ffffff";

function font(px: number, mono = false): string {
  return `bold ${px}px ${mono ? MONO : SANS}`;
}

async function ensureLabelFonts(): Promise<void> {
  const faces = [44, 40, 24, 22, 21, 17, 16, 15, 12, 11, 10].map((px) => font(px, px === 44 || px === 40));
  await Promise.all(faces.map((face) => document.fonts.load(face).catch(() => undefined)));
  await document.fonts.ready;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read logo"));
    image.src = url;
  });
}

function thresholdCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, cutoff: number): void {
  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0;
    const luminance =
      alpha < 16 ? 255 : 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    const value = luminance < cutoff ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
}

async function loadLogoElement(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load logo");
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    return await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Scale the logo to an integer box. Thermal marks are forced to black or white; sheet logos keep their color. */
async function fittedLogo(url: string, maxW: number, maxH: number, color = false): Promise<HTMLCanvasElement | null> {
  const trimmed = url.trim();
  if (!trimmed || maxW < 1 || maxH < 1) return null;
  const image = color ? await loadLogoElement(trimmed) : await loadImage(await logoToBlackAndWhitePng(trimmed));
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  if (!srcW || !srcH) return null;
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = color;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(image, 0, 0, dw, dh);
  if (!color) thresholdCanvas(ctx, dw, dh, 200);
  return canvas;
}

function measure(ctx: CanvasRenderingContext2D, value: string): number {
  return ctx.measureText(value).width;
}

function linesOf(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  return wrapTextLines(text, maxWidth, maxLines, (value) => measure(ctx, value));
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  align: CanvasTextAlign,
): number {
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  return lines.length * lineHeight;
}

type DrawState = {
  ctx: CanvasRenderingContext2D;
  input: SampleLabelInput;
  logo: HTMLCanvasElement | null;
  showQr: boolean;
};

function headerHeight(state: DrawState): number {
  const { logo, showQr } = state;
  if (!showQr) return logo?.height ?? 0;
  return SAMPLE_LABEL_QR_PX;
}

function drawHeader(state: DrawState, y: number): void {
  const { ctx, logo, showQr, input } = state;
  if (!showQr) {
    if (!logo) return;
    const x = SAMPLE_LABEL_MARGIN + Math.round((CONTENT_W - logo.width) / 2);
    ctx.drawImage(logo, x, y);
    return;
  }
  const blockH = SAMPLE_LABEL_QR_PX;
  if (logo) {
    const areaW = CONTENT_W - SAMPLE_LABEL_QR_PX - 12;
    const x = SAMPLE_LABEL_MARGIN + Math.round((areaW - logo.width) / 2);
    const logoY = y + Math.round((blockH - logo.height) / 2);
    ctx.drawImage(logo, x, logoY);
  }
  const qrX = SAMPLE_LABEL_WIDTH - SAMPLE_LABEL_MARGIN - SAMPLE_LABEL_QR_PX;
  drawQr(ctx, input.qrUrl, qrX, y);
}

function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, boxPx = SAMPLE_LABEL_QR_PX): void {
  const symbol = createQr(url, { errorCorrectionLevel: "M" });
  const count = symbol.modules.size;
  const geo = qrModuleGeometry(count, boxPx, SAMPLE_LABEL_QR_QUIET);
  const origin = {
    x: x + geo.offset + SAMPLE_LABEL_QR_QUIET * geo.modulePx,
    y: y + geo.offset + SAMPLE_LABEL_QR_QUIET * geo.modulePx,
  };
  ctx.fillStyle = BLACK;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!symbol.modules.get(row, col)) continue;
      ctx.fillRect(
        origin.x + col * geo.modulePx,
        origin.y + row * geo.modulePx,
        geo.modulePx,
        geo.modulePx,
      );
    }
  }
}

function bandHeading(input: SampleLabelInput): string {
  if (input.bandText === undefined) return "WALLCOVERING SAMPLE";
  return input.bandText.trim().toUpperCase();
}

function drawBandRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  width: number,
  itemLabel: string,
  subtitle: string,
  codePx: number,
  mark = "",
  metrics: { pad?: number; gap?: number; headingPx?: number } = {},
): void {
  const pad = metrics.pad ?? 14;
  const gap = metrics.gap ?? 12;
  const headingPx = metrics.headingPx ?? 16;
  const markText = mark.trim();
  ctx.fillStyle = WHITE;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let markW = 0;
  if (markText) {
    ctx.font = font(22);
    markW = measure(ctx, markText);
  }
  const inner = Math.max(40, width - pad * 2 - (markW > 0 ? markW + gap : 0));
  ctx.font = font(headingPx);
  let heading = subtitle.trim();
  if (heading && measure(ctx, heading) > inner) heading = linesOf(ctx, heading, inner, 1)[0] ?? "";
  let headingW = heading ? measure(ctx, heading) : 0;
  const code = itemLabel.trim();
  if (code && heading && headingW + gap + 40 > inner) {
    heading = linesOf(ctx, heading, Math.max(40, inner - gap - 40), 1)[0] ?? "";
    headingW = heading ? measure(ctx, heading) : 0;
  }
  const codeMax = heading ? Math.max(40, inner - headingW - gap) : inner;
  ctx.font = font(codePx, true);
  const codeText = code ? linesOf(ctx, code, codeMax, 1)[0] ?? "" : "";
  let cursor = x + pad;
  if (codeText) {
    ctx.fillText(codeText, cursor, centerY);
    cursor += measure(ctx, codeText) + (heading ? gap : 0);
  }
  if (heading) {
    ctx.font = font(headingPx);
    ctx.fillText(heading, cursor, centerY);
  }
  if (markText) {
    ctx.font = font(22);
    ctx.textAlign = "right";
    ctx.fillText(markText, x + width - pad, centerY);
  }
}

function drawBand(
  ctx: CanvasRenderingContext2D,
  y: number,
  itemLabel: string,
  subtitle: string,
  mark = "",
): void {
  ctx.fillStyle = BLACK;
  fillRoundRect(ctx, SAMPLE_LABEL_MARGIN, y, CONTENT_W, SAMPLE_LABEL_BAND_H, 4);
  drawBandRow(ctx, SAMPLE_LABEL_MARGIN, y + SAMPLE_LABEL_BAND_H / 2, CONTENT_W, itemLabel, subtitle, 44, mark);
}

function fieldBlockHeight(
  ctx: CanvasRenderingContext2D,
  value: string,
  valuePx: number,
  valueLine: number,
  width = CONTENT_W,
): number {
  const text = value.trim();
  if (!text) return 14;
  ctx.font = font(valuePx);
  const lines = linesOf(ctx, text, width, 2);
  return 14 + 2 + lines.length * valueLine;
}

function drawField(
  ctx: CanvasRenderingContext2D,
  y: number,
  label: string,
  value: string,
  valuePx: number,
  valueLine: number,
  width = CONTENT_W,
  x = SAMPLE_LABEL_MARGIN,
): number {
  ctx.fillStyle = BLACK;
  ctx.font = font(12);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x, y);
  const text = value.trim();
  if (!text) return 14;
  ctx.font = font(valuePx);
  const lines = linesOf(ctx, text, width, 2);
  drawLines(ctx, lines, x, y + 16, valueLine, "left");
  return 14 + 2 + lines.length * valueLine;
}

function footerLines(ctx: CanvasRenderingContext2D, input: SampleLabelInput): string[] {
  if (!sampleLabelBlockOn(input, "footer")) return [];
  ctx.font = font(12);
  const lines: string[] = [];
  if (input.address.trim()) {
    const paragraphs = input.address.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      const room = 3 - lines.length;
      if (room <= 0) break;
      lines.push(...linesOf(ctx, paragraph, CONTENT_W, room));
    }
  }
  if (input.officeLine.trim() && lines.length < 4) {
    lines.push(...linesOf(ctx, input.officeLine, CONTENT_W, 1));
  }
  return lines;
}

function footerHeight(ctx: CanvasRenderingContext2D, input: SampleLabelInput): number {
  const lines = footerLines(ctx, input);
  if (!lines.length) return 0;
  return 1 + 8 + lines.length * 14 + Math.max(0, lines.length - 1) * 2 + SAMPLE_LABEL_MARGIN;
}

function drawFooter(ctx: CanvasRenderingContext2D, input: SampleLabelInput): void {
  const lines = footerLines(ctx, input);
  if (!lines.length) return;
  const height = footerHeight(ctx, input);
  const top = SAMPLE_LABEL_HEIGHT - height;
  ctx.fillStyle = BLACK;
  ctx.fillRect(SAMPLE_LABEL_MARGIN, top, CONTENT_W, 1);
  ctx.font = font(12);
  let y = top + 1 + 8;
  lines.forEach((line, index) => {
    drawLines(ctx, [line], SAMPLE_LABEL_WIDTH / 2, y, 14, "center");
    y += 14 + (index < lines.length - 1 ? 2 : 0);
  });
}

function showQr(input: SampleLabelInput): boolean {
  return sampleLabelBlockOn(input, "qr") && input.qrKind !== "none" && Boolean(input.qrUrl.trim());
}

function logoMaxWidth(input: SampleLabelInput): number {
  if (!showQr(input)) return CONTENT_W;
  return SAMPLE_LABEL_WIDTH - SAMPLE_LABEL_MARGIN - SAMPLE_LABEL_QR_PX - 12 - SAMPLE_LABEL_MARGIN;
}

function landscapeFooterText(input: SampleLabelInput): string {
  if (!sampleLabelBlockOn(input, "footer")) return "";
  const parts: string[] = [];
  const address = input.address.replace(/\s*\n+\s*/g, " ").trim();
  if (address) parts.push(address);
  const office = input.officeLine.trim();
  if (office) parts.push(office);
  return parts.join(" · ");
}

function fitLandscapeFooter(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): { px: number; text: string } {
  for (let px = 12; px >= 10; px -= 1) {
    ctx.font = font(px);
    if (measure(ctx, text) <= maxWidth) return { px, text };
  }
  ctx.font = font(10);
  return { px: 10, text: linesOf(ctx, text, maxWidth, 1)[0] ?? "" };
}

function drawContainedLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLCanvasElement,
  x: number,
  y: number,
  size: { w: number; h: number },
): void {
  if (size.w === logo.width && size.h === logo.height) ctx.drawImage(logo, x, y);
  else ctx.drawImage(logo, x, y, size.w, size.h);
}

function containedLogoSize(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  if (srcW <= maxW && srcH <= maxH) return { w: srcW, h: srcH };
  const scale = Math.min(maxW / srcW, maxH / srcH);
  return {
    w: Math.max(1, Math.floor(srcW * scale)),
    h: Math.max(1, Math.floor(srcH * scale)),
  };
}

function drawLandscapeBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  itemLabel: string,
  subtitle: string,
  mark = "",
): void {
  ctx.fillStyle = BLACK;
  fillRoundRect(ctx, x, y, width, SAMPLE_LABEL_LANDSCAPE_BAND_H, 4);
  drawBandRow(ctx, x, y + SAMPLE_LABEL_LANDSCAPE_BAND_H / 2, width, itemLabel, subtitle, 40, mark, {
    pad: 8,
    gap: 8,
    headingPx: 14,
  });
}

function specValueLines(
  ctx: CanvasRenderingContext2D,
  section: string,
  width: number,
  valuePx: number,
): string[] {
  ctx.font = font(valuePx);
  return sampleLabelSpecLines(section)
    .map((line) => linesOf(ctx, line, width, 1)[0] ?? "")
    .filter(Boolean);
}

function drawPortraitSpec(
  ctx: CanvasRenderingContext2D,
  y: number,
  section: string,
  width = CONTENT_W,
  x = SAMPLE_LABEL_MARGIN,
): number {
  const lines = specValueLines(ctx, section, width, 17);
  ctx.fillStyle = BLACK;
  ctx.font = font(12);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("SPEC", x, y);
  if (!lines.length) return 14;
  ctx.font = font(17);
  drawLines(ctx, lines, x, y + 16, 20, "left");
  return 14 + 2 + lines.length * 20;
}

function portraitSpecHeight(ctx: CanvasRenderingContext2D, section: string, width = CONTENT_W): number {
  const lines = specValueLines(ctx, section, width, 17);
  if (!lines.length) return 14;
  return 14 + 2 + lines.length * 20;
}

function drawLandscapeSpec(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  section: string,
): number {
  const valuePx = 15;
  const step = valuePx + 2;
  const lines = specValueLines(ctx, section, width, valuePx);
  ctx.fillStyle = BLACK;
  ctx.font = font(12);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("SPEC", x, y);
  if (!lines.length) return 14;
  ctx.font = font(valuePx);
  lines.forEach((line, index) => ctx.fillText(line, x, y + 14 + index * step));
  return 14 + lines.length * step;
}

function drawLandscapeField(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  valuePx: number,
): number {
  ctx.fillStyle = BLACK;
  ctx.font = font(12);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x, y);
  const text = value.trim();
  const valueY = y + 14;
  if (text) {
    ctx.font = font(valuePx);
    const line = linesOf(ctx, text, width, 1)[0] ?? "";
    if (line) ctx.fillText(line, x, valueY);
  }
  return 14 + valuePx + 2;
}

async function renderLandscapeLabel(input: SampleLabelInput, sheet = false): Promise<HTMLCanvasElement> {
  const width = SAMPLE_LABEL_LANDSCAPE_WIDTH;
  const height = SAMPLE_LABEL_LANDSCAPE_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = sheet ? SHEET_LABEL_PX_W : width;
  canvas.height = sheet ? SHEET_LABEL_PX_H : height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not draw sample label");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sheetScale = SHEET_LABEL_PX_H / height;
  if (sheet) {
    ctx.setTransform(sheetScale, 0, 0, sheetScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  const side = SAMPLE_LABEL_LANDSCAPE_MARGIN_X;
  const columnTop = SAMPLE_LABEL_LANDSCAPE_MARGIN_TOP;
  const columnX = sheet ? 0 : side;
  const columnW = sheet ? Math.round(SHEET_LABEL_PX_W * SHEET_LABEL_COLUMN_RATIO) / sheetScale : SAMPLE_LABEL_LANDSCAPE_COL_W;
  const pad = sheet ? SHEET_LABEL_COLUMN_PAD / sheetScale : SAMPLE_LABEL_LANDSCAPE_COL_PAD;
  const columnRight = columnX + columnW;
  const innerLeft = columnX + pad;
  const rulePad = sheet ? SHEET_LABEL_RULE_PAD / sheetScale : SAMPLE_LABEL_LANDSCAPE_RULE_PAD;
  const innerRight = columnRight - rulePad;
  const innerW = innerRight - innerLeft;
  const rightLimit = sheet ? SHEET_LABEL_PX_W / sheetScale - pad : width - side;
  const textX = columnRight + SAMPLE_LABEL_LANDSCAPE_RULE + rulePad;
  const textW = rightLimit - textX;
  const rightX = textX;
  const rightW = textW;
  const contentLeft = sheet ? pad : side;
  const contentW = rightLimit - contentLeft;

  const footerText = landscapeFooterText(input);
  const fittedFooter = footerText ? fitLandscapeFooter(ctx, footerText, contentW) : null;
  const footerRuleY = fittedFooter
    ? height - SAMPLE_LABEL_LANDSCAPE_MARGIN_BOTTOM - 14 - 4 - 1
    : height - SAMPLE_LABEL_LANDSCAPE_MARGIN_BOTTOM;
  const columnH = footerRuleY - columnTop;

  const qrOn = showQr(input);
  const logoOn = sampleLabelBlockOn(input, "logo") && Boolean(input.logoUrl.trim());
  const qrSize = Math.min(SAMPLE_LABEL_LANDSCAPE_QR, Math.floor(innerW), Math.max(1, columnH - 10));
  const logoMaxH = qrOn
    ? Math.max(1, columnH - 10 - qrSize)
    : sheet
      ? Math.max(1, columnH * 0.6)
      : columnH;
  const logoMaxW = sheet ? innerW : Math.min(SAMPLE_LABEL_LANDSCAPE_LOGO_MAX_W, innerW);
  const logo = logoOn ? await fittedLogo(input.logoUrl, logoMaxW, logoMaxH, sheet) : null;
  const logoDraw = logo ? containedLogoSize(logo.width, logo.height, logoMaxW, logoMaxH) : null;
  const place = (start: number, span: number, size: number) => {
    const pos = start + (span - size) / 2;
    return sheet ? pos : Math.round(pos);
  };

  if (logo && logoDraw && !qrOn) {
    const x = place(innerLeft, innerW, logoDraw.w);
    const y = place(columnTop, columnH, logoDraw.h);
    drawContainedLogo(ctx, logo, x, y, logoDraw);
  } else if (logo || qrOn) {
    if (logo && logoDraw) {
      const x = place(innerLeft, innerW, logoDraw.w);
      drawContainedLogo(ctx, logo, x, columnTop, logoDraw);
    }
    if (qrOn) {
      const regionTop = logoDraw ? columnTop + logoDraw.h + 10 : columnTop;
      const blockH = qrSize;
      const qrY = regionTop + Math.round((footerRuleY - regionTop - blockH) / 2);
      const qrX = place(innerLeft, innerW, qrSize);
      drawQr(ctx, input.qrUrl, qrX, qrY, qrSize);
    }
  }

  ctx.fillStyle = BLACK;
  ctx.fillRect(columnRight, columnTop, SAMPLE_LABEL_LANDSCAPE_RULE, columnH);

  let y = columnTop;
  if (sampleLabelBlockOn(input, "band")) {
    drawLandscapeBand(ctx, rightX, y, rightW, input.itemLabel, bandHeading(input), input.packageMark ?? "");
    y += SAMPLE_LABEL_LANDSCAPE_BAND_H + 6;
  }

  const fields: { label: string; value: string; on: boolean }[] = [
    { label: "MANUFACTURER", value: input.manufacturer, on: sampleLabelBlockOn(input, "manufacturer") },
    { label: "PRODUCT", value: input.product, on: sampleLabelBlockOn(input, "product") },
    { label: "COLOR / PATTERN", value: input.color, on: sampleLabelBlockOn(input, "color") },
  ];
  let drewField = false;
  for (const field of fields) {
    if (!field.on || !field.value.trim()) continue;
    if (drewField) y += 4;
    y += drawLandscapeField(ctx, rightX, y, rightW, field.label, field.value, 21);
    drewField = true;
  }

  const metas: { label: string; value: string; on: boolean }[] = [
    { label: "PROJECT", value: input.project, on: sampleLabelBlockOn(input, "project") },
    { label: "SUBMITTAL", value: input.submittal, on: sampleLabelBlockOn(input, "submittal") },
    { label: "DATE", value: input.date, on: sampleLabelBlockOn(input, "date") },
    { label: "SPEC", value: input.spec, on: sampleLabelBlockOn(input, "spec") },
  ];
  const project = metas[0];
  const row = metas.slice(1).filter((field) => field.on && field.value.trim());
  const projectOn = Boolean(project?.on && project.value.trim());
  if (projectOn || row.length) {
    const splitGap = rulePad;
    if (drewField) y += splitGap;
    ctx.fillStyle = BLACK;
    ctx.fillRect(columnRight, y, rightLimit - columnRight, 1);
    y += 1 + splitGap;
    if (projectOn && project) {
      y += drawLandscapeField(ctx, rightX, y, rightW, project.label, project.value, 16);
      if (row.length) y += 4;
    }
    if (row.length) {
      const gap = 8;
      const colW = Math.floor((rightW - gap * (row.length - 1)) / row.length);
      let rowH = 0;
      row.forEach((field, index) => {
        const height =
          field.label === "SPEC"
            ? drawLandscapeSpec(ctx, rightX + index * (colW + gap), y, colW, field.value)
            : drawLandscapeField(ctx, rightX + index * (colW + gap), y, colW, field.label, field.value, 15);
        rowH = Math.max(rowH, height);
      });
      y += rowH;
    }
  }

  if (fittedFooter) {
    ctx.fillStyle = BLACK;
    ctx.fillRect(contentLeft, footerRuleY, contentW, 1);
    ctx.font = font(fittedFooter.px);
    const textY = footerRuleY + 1 + 4 + Math.round((14 - fittedFooter.px) / 2);
    drawLines(ctx, [fittedFooter.text], contentLeft + contentW / 2, textY, fittedFooter.px, "center");
  }

  if (!sheet) thresholdCanvas(ctx, width, height, 128);
  return canvas;
}

/** Landscape layout on a 4" × 2" sheet label at 300 dpi, with the color company logo. */
export async function renderSheetLabel(input: SampleLabelInput): Promise<HTMLCanvasElement> {
  await ensureLabelFonts();
  if (input.packageLayout) return renderPackageSheet(input);
  return renderLandscapeLabel({ ...input, orientation: "landscape" }, true);
}

/** Clockwise, so a 640 × 384 landscape design becomes the 384 × 640 print page. */
function rotateCanvasClockwise(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.height;
  canvas.height = source.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not rotate sample label");
  ctx.imageSmoothingEnabled = false;
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

type PortraitMeta = {
  projectOn: boolean;
  submittalOn: boolean;
  dateOn: boolean;
  specOn: boolean;
};

function portraitMeta(input: SampleLabelInput): PortraitMeta {
  return {
    projectOn: sampleLabelBlockOn(input, "project") && Boolean(input.project.trim()),
    submittalOn: sampleLabelBlockOn(input, "submittal") && Boolean(input.submittal.trim()),
    dateOn: sampleLabelBlockOn(input, "date") && Boolean(input.date.trim()),
    specOn: sampleLabelBlockOn(input, "spec") && Boolean(input.spec.trim()),
  };
}

function portraitMetaHeight(ctx: CanvasRenderingContext2D, input: SampleLabelInput): number {
  const meta = portraitMeta(input);
  if (!meta.projectOn && !meta.submittalOn && !meta.dateOn && !meta.specOn) return 0;
  let height = 1 + 8;
  let drew = false;
  const add = (block: number) => {
    if (drew) height += 6;
    drew = true;
    height += block;
  };
  if (meta.projectOn) add(fieldBlockHeight(ctx, input.project, 17, 20));
  if (meta.submittalOn && meta.dateOn) {
    const colGap = 12;
    const colW = Math.floor((CONTENT_W - colGap) / 2);
    add(
      Math.max(
        fieldBlockHeight(ctx, input.submittal, 16, 18, colW),
        fieldBlockHeight(ctx, input.date, 16, 18, colW),
      ),
    );
  } else if (meta.submittalOn) {
    add(fieldBlockHeight(ctx, input.submittal, 16, 18));
  } else if (meta.dateOn) {
    add(fieldBlockHeight(ctx, input.date, 16, 18));
  }
  if (meta.specOn) add(portraitSpecHeight(ctx, input.spec));
  return height;
}

function drawPortraitMeta(ctx: CanvasRenderingContext2D, input: SampleLabelInput, y: number): void {
  const meta = portraitMeta(input);
  ctx.fillStyle = BLACK;
  ctx.fillRect(SAMPLE_LABEL_MARGIN, y, CONTENT_W, 1);
  y += 1 + 8;
  let drewMeta = false;
  const nextMeta = () => {
    if (drewMeta) y += 6;
    drewMeta = true;
  };
  if (meta.projectOn) {
    nextMeta();
    y += drawField(ctx, y, "PROJECT", input.project, 17, 20);
  }
  if (meta.submittalOn && meta.dateOn) {
    nextMeta();
    const colGap = 12;
    const colW = Math.floor((CONTENT_W - colGap) / 2);
    const leftH = drawField(ctx, y, "SUBMITTAL", input.submittal, 16, 18, colW, SAMPLE_LABEL_MARGIN);
    const rightH = drawField(ctx, y, "DATE", input.date, 16, 18, colW, SAMPLE_LABEL_MARGIN + colW + colGap);
    y += Math.max(leftH, rightH);
  } else if (meta.submittalOn) {
    nextMeta();
    y += drawField(ctx, y, "SUBMITTAL", input.submittal, 16, 18);
  } else if (meta.dateOn) {
    nextMeta();
    y += drawField(ctx, y, "DATE", input.date, 16, 18);
  }
  if (meta.specOn) {
    nextMeta();
    y += drawPortraitSpec(ctx, y, input.spec);
  }
}

/**
 * No QR: larger manufacturer / product / color type, with the freed space split evenly
 * between the field groups that sit above the pinned footer.
 */
function drawPortraitWithoutQr(ctx: CanvasRenderingContext2D, state: DrawState, input: SampleLabelInput): void {
  let y = SAMPLE_LABEL_MARGIN;
  const headerH = headerHeight(state);
  if (headerH > 0) {
    drawHeader(state, y);
    y += headerH + 8;
  }
  if (sampleLabelBlockOn(input, "band")) {
    drawBand(ctx, y, input.itemLabel, bandHeading(input), input.packageMark ?? "");
    y += SAMPLE_LABEL_BAND_H + 8;
  }

  const valuePx = 24;
  const valueLine = 26;
  const fields: { label: string; value: string; on: boolean }[] = [
    { label: "MANUFACTURER", value: input.manufacturer, on: sampleLabelBlockOn(input, "manufacturer") },
    { label: "PRODUCT", value: input.product, on: sampleLabelBlockOn(input, "product") },
    { label: "COLOR / PATTERN", value: input.color, on: sampleLabelBlockOn(input, "color") },
  ];
  const groups: { height: number; draw: (top: number) => void }[] = [];
  for (const field of fields) {
    if (!field.on || !field.value.trim()) continue;
    const height = fieldBlockHeight(ctx, field.value, valuePx, valueLine);
    groups.push({
      height,
      draw: (top) => {
        drawField(ctx, top, field.label, field.value, valuePx, valueLine);
      },
    });
  }
  const metaH = portraitMetaHeight(ctx, input);
  if (metaH > 0) {
    groups.push({
      height: metaH,
      draw: (top) => drawPortraitMeta(ctx, input, top),
    });
  }
  if (groups.length === 0) return;

  const footerTop = SAMPLE_LABEL_HEIGHT - footerHeight(ctx, input);
  const contentH = groups.reduce((sum, group) => sum + group.height, 0);
  const gapCount = groups.length - 1;
  const room = Math.max(0, footerTop - y - contentH);
  const gap = gapCount > 0 ? Math.floor(room / gapCount) : 0;
  groups.forEach((group, index) => {
    if (index > 0) y += gap;
    group.draw(y);
    y += group.height;
  });
}

const PKG_CAPTION = "Scan for specs & submittal";

function pxFromPt(points: number): number {
  return Math.max(1, Math.round((points * SAMPLE_LABEL_DPI) / 72));
}

function fontFace(px: number, weight: "bold" | "normal" = "bold"): string {
  return `${weight} ${px}px ${SANS}`;
}

/** Word wrap at the spec size. Shrink only when the words would be cut. */
function fitWords(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  startPx: number,
  minPx: number,
  weight: "bold" | "normal" = "bold",
): { px: number; lines: string[] } {
  const clean = text.trim();
  if (!clean || maxWidth < 4 || maxLines < 1) return { px: startPx, lines: [] };
  const floor = Math.max(1, Math.min(startPx, minPx));
  for (let px = startPx; px >= floor; px -= 1) {
    ctx.font = fontFace(px, weight);
    const lines = wrapTextLines(clean, maxWidth, maxLines, (value) => measure(ctx, value));
    const cut = lines.some((line) => line.includes("…"));
    const drawn = lines.join(" ").replace(/…/g, "").trim();
    const complete = drawn.split(/\s+/).filter(Boolean).length >= clean.split(/\s+/).filter(Boolean).length;
    if (!cut && complete) return { px, lines };
  }
  ctx.font = fontFace(floor, weight);
  return { px: floor, lines: wrapTextLines(clean, maxWidth, maxLines, (value) => measure(ctx, value)) };
}

type PackageField = {
  label: string;
  value: string;
  valuePx: number;
  maxLines: number;
  weight: "bold" | "normal";
  minPx: number;
};

type LaidField = PackageField & { labelPx: number; lines: string[]; lineH: number; height: number };

function layField(ctx: CanvasRenderingContext2D, field: PackageField, width: number, labelPx: number): LaidField {
  const fitted = fitWords(ctx, field.value, width, field.maxLines, field.valuePx, field.minPx, field.weight);
  const lineH = Math.round(fitted.px * 1.12);
  const lines = fitted.lines;
  const height = labelPx + 2 + Math.max(1, lines.length) * lineH;
  return { ...field, valuePx: fitted.px, labelPx, lines, lineH, height: field.value.trim() ? height : labelPx };
}

function drawLaidField(ctx: CanvasRenderingContext2D, field: LaidField, x: number, y: number): void {
  ctx.fillStyle = BLACK;
  ctx.font = fontFace(field.labelPx);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(field.label, x, y);
  if (!field.lines.length) return;
  ctx.font = fontFace(field.valuePx, field.weight);
  drawLines(ctx, field.lines, x, y + field.labelPx + 2, field.lineH, "left");
}

function packageFields(input: SampleLabelInput, sizes: { color: number; product: number; manufacturer: number }): PackageField[] {
  const fields: (PackageField & { on: boolean })[] = [
    {
      label: "COLOR / PATTERN",
      value: input.color,
      valuePx: sizes.color,
      maxLines: 2,
      weight: "bold",
      minPx: pxFromPt(11),
      on: sampleLabelBlockOn(input, "color"),
    },
    {
      label: "PRODUCT",
      value: input.product,
      valuePx: sizes.product,
      maxLines: 2,
      weight: "bold",
      minPx: pxFromPt(8),
      on: sampleLabelBlockOn(input, "product"),
    },
    {
      label: "MANUFACTURER",
      value: input.manufacturer,
      valuePx: sizes.manufacturer,
      maxLines: 2,
      weight: "normal",
      minPx: pxFromPt(8),
      on: sampleLabelBlockOn(input, "manufacturer"),
    },
  ];
  return fields.filter((field) => field.on && field.value.trim()).map(({ on: _on, ...field }) => field);
}

function fitFieldStack(
  ctx: CanvasRenderingContext2D,
  fields: PackageField[],
  width: number,
  maxHeight: number,
  labelPx: number,
  gap: number,
): LaidField[] {
  let drop = 0;
  let laid = fields.map((field) => layField(ctx, field, width, labelPx));
  const heightOf = (rows: LaidField[]) => rows.reduce((sum, row) => sum + row.height, 0) + gap * Math.max(0, rows.length - 1);
  while (heightOf(laid) > maxHeight && drop < 8) {
    drop += 1;
    laid = fields.map((field) =>
      layField(ctx, { ...field, valuePx: Math.max(field.minPx, field.valuePx - drop) }, width, labelPx),
    );
  }
  return laid;
}

function drawPackageBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  code: string,
  heading: string,
  mark: string,
  codePx: number,
  markPx: number,
): void {
  ctx.fillStyle = BLACK;
  ctx.fillRect(x, y, width, height);
  const pad = 10;
  const headingPx = pxFromPt(7.5);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = WHITE;
  const headingText = heading.trim();
  const markText = mark.trim();
  let stackW = 0;
  if (headingText) {
    ctx.font = fontFace(headingPx);
    stackW = Math.max(stackW, measure(ctx, headingText));
  }
  if (markText) {
    ctx.font = fontFace(markPx);
    stackW = Math.max(stackW, measure(ctx, markText));
  }
  const stackGap = headingText && markText ? 3 : 0;
  const stackH = (headingText ? headingPx : 0) + (markText ? markPx : 0) + stackGap;
  let stackY = y + Math.round((height - stackH) / 2);
  const stackRight = x + width - pad;
  if (headingText) {
    ctx.font = fontFace(headingPx);
    ctx.fillText(headingText, stackRight, stackY);
    stackY += headingPx + stackGap;
  }
  if (markText) {
    ctx.font = fontFace(markPx);
    ctx.fillText(markText, stackRight, stackY);
  }
  const codeMax = Math.max(24, width - pad * 2 - (stackW > 0 ? stackW + 12 : 0));
  const fitted = fitWords(ctx, code, codeMax, 2, codePx, Math.round(codePx * 0.55));
  if (!fitted.lines.length) return;
  const lineH = Math.round(fitted.px * 1.05);
  const blockH = fitted.lines.length * lineH;
  ctx.font = fontFace(fitted.px);
  ctx.textAlign = "left";
  ctx.fillStyle = WHITE;
  drawLines(ctx, fitted.lines, x + pad, y + Math.round((height - blockH) / 2), lineH, "left");
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  px: number,
): number {
  const fitted = fitWords(ctx, text, width, 3, px, pxFromPt(5));
  if (!fitted.lines.length) return 0;
  const lineH = Math.round(fitted.px * 1.15);
  ctx.fillStyle = BLACK;
  ctx.font = fontFace(fitted.px);
  drawLines(ctx, fitted.lines, x + width / 2, y, lineH, "center");
  return fitted.lines.length * lineH;
}

async function loadPackageLogo(
  url: string,
  maxW: number,
  maxH: number,
  color = false,
): Promise<HTMLCanvasElement | null> {
  if (!url.trim() || maxW < 2 || maxH < 2) return null;
  return fittedLogo(url, maxW, maxH, color);
}

function sheetPxFromPt(points: number): number {
  return Math.max(1, Math.round((points * SHEET_LABEL_DPI) / 72));
}

/** Same logo/QR footprint the scaled landscape sheet path used today. */
function packageSheetMarkSizes(): { columnW: number; pad: number; logoW: number; logoH: number; qrSize: number } {
  const sheetScale = SHEET_LABEL_PX_H / SAMPLE_LABEL_LANDSCAPE_HEIGHT;
  const columnW = Math.round(SHEET_LABEL_PX_W * SHEET_LABEL_COLUMN_RATIO);
  const pad = SHEET_LABEL_COLUMN_PAD;
  const logoW = columnW - pad - SHEET_LABEL_RULE_PAD;
  const qrSize = Math.min(Math.round(SAMPLE_LABEL_LANDSCAPE_QR * sheetScale), logoW);
  const columnH = SHEET_LABEL_PX_H - pad * 2;
  const logoH = Math.max(1, columnH - 10 - qrSize);
  return { columnW, pad, logoW, logoH, qrSize };
}

/**
 * Avery 5163 package label at full 4" × 2" / 300 dpi.
 * Same layout as the NIIMBOT landscape package label, with the mockup type sizes
 * and the existing sheet logo/QR footprint.
 */
async function renderPackageSheet(input: SampleLabelInput): Promise<HTMLCanvasElement> {
  const labelPx = sheetPxFromPt(5.5);
  const faces = [26, 16, 11, 10, 8, 5.5].map((pt) =>
    fontFace(sheetPxFromPt(pt), pt === 10 ? "normal" : "bold"),
  );
  await Promise.all(faces.map((face) => document.fonts.load(face).catch(() => undefined)));
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_LABEL_PX_W;
  canvas.height = SHEET_LABEL_PX_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not draw sheet label");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { columnW, pad, logoW, logoH, qrSize } = packageSheetMarkSizes();
  const ruleX = columnW;
  const textX = ruleX + SAMPLE_LABEL_LANDSCAPE_RULE + SHEET_LABEL_RULE_PAD;
  const textW = canvas.width - pad - textX;
  const bandH = Math.round((11 / 50.8) * SHEET_LABEL_PX_H);
  const qrOn = showQr(input);
  const columnBottom = canvas.height - pad;
  const logoY = pad;
  ctx.font = fontFace(labelPx);
  const captionH = qrOn ? captionBlockHeight(ctx, qrSize, labelPx) : 0;
  const qrY = qrOn ? columnBottom - (captionH ? 4 + captionH : 0) - qrSize : columnBottom;
  const safeLogoH = Math.min(logoH, Math.max(1, qrY - 10 - logoY));
  const logo = await loadPackageLogo(input.logoUrl, logoW, safeLogoH, true);
  const logoDraw = logo ? containedLogoSize(logo.width, logo.height, logoW, safeLogoH) : null;

  const projectValue = fitWords(ctx, input.project, textW, 2, sheetPxFromPt(8), sheetPxFromPt(7));
  const projectLine = Math.round(projectValue.px * 1.12);
  const projectOn = sampleLabelBlockOn(input, "project") && Boolean(input.project.trim());
  const projectH = projectOn ? labelPx + 2 + Math.max(1, projectValue.lines.length) * projectLine : 0;
  const projectTop = canvas.height - pad - projectH;
  const ruleY = projectOn ? projectTop - 10 : canvas.height - pad;
  const fieldTop = pad + (sampleLabelBlockOn(input, "band") ? bandH + 8 : 0);
  const fieldRoom = Math.max(48, ruleY - 10 - fieldTop);
  const fields = fitFieldStack(
    ctx,
    packageFields(input, {
      color: sheetPxFromPt(16),
      product: sheetPxFromPt(11),
      manufacturer: sheetPxFromPt(10),
    }),
    textW,
    fieldRoom,
    labelPx,
    8,
  );

  if (logo && logoDraw) {
    drawContainedLogo(
      ctx,
      logo,
      pad + Math.round((logoW - logoDraw.w) / 2),
      logoY,
      logoDraw,
    );
  }
  if (qrOn) {
    const qrX = pad + Math.round((logoW - qrSize) / 2);
    drawQr(ctx, input.qrUrl, qrX, qrY, qrSize);
    if (captionH) drawCaption(ctx, PKG_CAPTION, qrX, qrY + qrSize + 4, qrSize, labelPx);
  }

  ctx.fillStyle = BLACK;
  ctx.fillRect(ruleX, pad, SAMPLE_LABEL_LANDSCAPE_RULE, canvas.height - pad * 2);

  if (sampleLabelBlockOn(input, "band")) {
    drawPackageBand(
      ctx,
      textX,
      pad,
      textW,
      bandH,
      input.itemLabel,
      bandHeading(input),
      input.packageMark ?? "",
      sheetPxFromPt(26),
      sheetPxFromPt(11),
    );
  }

  let y = fieldTop;
  fields.forEach((field, index) => {
    if (index > 0) y += 8;
    drawLaidField(ctx, field, textX, y);
    y += field.height;
  });

  if (projectOn) {
    ctx.fillStyle = BLACK;
    ctx.fillRect(textX, ruleY, textW, 1);
    ctx.font = fontFace(labelPx);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("PROJECT", textX, projectTop);
    ctx.font = fontFace(projectValue.px);
    drawLines(ctx, projectValue.lines, textX, projectTop + labelPx + 2, projectLine, "left");
  }

  return canvas;
}

/** Logo fills the old bordered box. The stroke and the inset padding are gone. */
function drawLogoBox(
  ctx: CanvasRenderingContext2D,
  logo: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const size = containedLogoSize(logo.width, logo.height, width, height);
  drawContainedLogo(ctx, logo, x + Math.round((width - size.w) / 2), y + Math.round((height - size.h) / 2), size);
}

function captionBlockHeight(ctx: CanvasRenderingContext2D, width: number, labelPx: number): number {
  ctx.font = fontFace(labelPx);
  const lines = wrapTextLines(PKG_CAPTION, width, 3, (value) => measure(ctx, value));
  if (!lines.length) return 0;
  return lines.length * Math.round(labelPx * 1.15);
}

/** Largest square QR that still clears the type above it and the caption under it. */
function fitPackageQr(
  ctx: CanvasRenderingContext2D,
  maxSize: number,
  topLimit: number,
  bottom: number,
  labelPx: number,
): { size: number; y: number; captionH: number } {
  const floor = 64;
  let size = Math.max(floor, Math.floor(maxSize));
  while (size > floor) {
    const captionH = captionBlockHeight(ctx, size, labelPx);
    const blockH = size + (captionH ? 4 + captionH : 0);
    const y = bottom - blockH;
    if (y >= topLimit) return { size, y, captionH };
    size -= 1;
  }
  const captionH = captionBlockHeight(ctx, floor, labelPx);
  const blockH = floor + (captionH ? 4 + captionH : 0);
  return { size: floor, y: bottom - blockH, captionH };
}

async function renderPackagePortrait(input: SampleLabelInput): Promise<HTMLCanvasElement> {
  const labelPx = pxFromPt(5.5);
  const faces = [32, 15, 12, 11, 10, 8, 7.5, 5.5].map((pt) => fontFace(pxFromPt(pt), pt === 10 ? "normal" : "bold"));
  await Promise.all(faces.map((face) => document.fonts.load(face).catch(() => undefined)));
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_LABEL_WIDTH;
  canvas.height = SAMPLE_LABEL_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not draw sample label");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const margin = 10;
  const bandH = Math.round((16 / 80) * SAMPLE_LABEL_HEIGHT);
  const bandY = margin;
  const logoW = Math.round((24 / 50) * SAMPLE_LABEL_WIDTH);
  const logoH = Math.round((11 / 80) * SAMPLE_LABEL_HEIGHT);
  const contentW = SAMPLE_LABEL_WIDTH - margin * 2;
  const logo = await loadPackageLogo(input.logoUrl, logoW, logoH);

  ctx.font = fontFace(labelPx);
  const projectValue = fitWords(ctx, input.project, contentW, 2, pxFromPt(8), pxFromPt(7));
  const projectLine = Math.round(projectValue.px * 1.12);
  const projectOn = sampleLabelBlockOn(input, "project") && Boolean(input.project.trim());
  const projectH = projectOn ? labelPx + 2 + Math.max(1, projectValue.lines.length) * projectLine : 0;
  const fieldTop = bandY + bandH + 8;
  const fields = fitFieldStack(
    ctx,
    packageFields(input, { color: pxFromPt(15), product: pxFromPt(11), manufacturer: pxFromPt(10) }),
    contentW,
    10000,
    labelPx,
    8,
  );

  if (sampleLabelBlockOn(input, "band")) {
    drawPackageBand(
      ctx,
      margin,
      bandY,
      contentW,
      bandH,
      input.itemLabel,
      bandHeading(input),
      input.packageMark ?? "",
      pxFromPt(32),
      pxFromPt(12),
    );
  }

  let y = fieldTop;
  fields.forEach((field, index) => {
    if (index > 0) y += 8;
    drawLaidField(ctx, field, margin, y);
    y += field.height;
  });
  if (fields.length) {
    y += 6;
    ctx.fillStyle = BLACK;
    ctx.fillRect(margin, y, contentW, 1);
    y += 1;
  }

  const qrOn = showQr(input);
  const footerX = margin;
  const bottom = SAMPLE_LABEL_HEIGHT - margin;
  const projectY = projectOn ? y + 10 : y;
  if (projectOn) {
    ctx.fillStyle = BLACK;
    ctx.font = fontFace(labelPx);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("PROJECT", footerX, projectY);
    ctx.font = fontFace(projectValue.px);
    drawLines(ctx, projectValue.lines, footerX, projectY + labelPx + 2, projectLine, "left");
  }

  const rowTop = (projectOn ? projectY + projectH : y) + 10;
  let qrFit: { size: number; y: number; captionH: number } | null = null;
  if (qrOn) {
    const beside = logo ? footerX + logoW + 8 : footerX;
    const qrMaxW = SAMPLE_LABEL_WIDTH - margin - beside;
    qrFit = fitPackageQr(ctx, Math.max(48, qrMaxW), rowTop, bottom, labelPx);
    const qrX = SAMPLE_LABEL_WIDTH - margin - qrFit.size;
    drawQr(ctx, input.qrUrl, qrX, qrFit.y, qrFit.size);
    if (qrFit.captionH) drawCaption(ctx, PKG_CAPTION, qrX, qrFit.y + qrFit.size + 4, qrFit.size, labelPx);
  }
  if (logo) {
    // Sit beside the QR, vertically centered on the code (not the caption).
    const logoY = qrFit
      ? Math.round(qrFit.y + (qrFit.size - logoH) / 2)
      : bottom - logoH;
    drawLogoBox(ctx, logo, footerX, Math.max(rowTop, Math.min(logoY, bottom - logoH)), logoW, logoH);
  }

  thresholdCanvas(ctx, canvas.width, canvas.height, 128);
  return canvas;
}

async function renderPackageLandscape(input: SampleLabelInput): Promise<HTMLCanvasElement> {
  const labelPx = pxFromPt(5.5);
  const faces = [24, 13, 10, 9, 8, 7.5, 5.5].map((pt) => fontFace(pxFromPt(pt), pt === 9 ? "normal" : "bold"));
  await Promise.all(faces.map((face) => document.fonts.load(face).catch(() => undefined)));
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_LABEL_LANDSCAPE_WIDTH;
  canvas.height = SAMPLE_LABEL_LANDSCAPE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not draw sample label");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const margin = 8;
  const columnW = Math.round((23 / 80) * SAMPLE_LABEL_LANDSCAPE_WIDTH);
  const ruleX = columnW;
  const textX = ruleX + SAMPLE_LABEL_LANDSCAPE_RULE + 8;
  const textW = canvas.width - margin - textX;
  const bandH = Math.round((11 / 50) * SAMPLE_LABEL_LANDSCAPE_HEIGHT);
  const logoH = Math.round((11 / 50) * SAMPLE_LABEL_LANDSCAPE_HEIGHT);
  const logoW = columnW - margin * 2;
  const logo = await loadPackageLogo(input.logoUrl, logoW, logoH);
  const qrOn = showQr(input);

  ctx.font = fontFace(labelPx);
  const projectValue = fitWords(ctx, input.project, textW, 2, pxFromPt(8), pxFromPt(7));
  const projectLine = Math.round(projectValue.px * 1.12);
  const projectOn = sampleLabelBlockOn(input, "project") && Boolean(input.project.trim());
  const projectH = projectOn ? labelPx + 2 + Math.max(1, projectValue.lines.length) * projectLine : 0;
  const projectTop = canvas.height - margin - projectH;
  const ruleY = projectOn ? projectTop - 8 : canvas.height - margin;
  const fieldTop = margin + (sampleLabelBlockOn(input, "band") ? bandH + 6 : 0);
  const fieldRoom = Math.max(36, ruleY - 8 - fieldTop);
  const fields = fitFieldStack(
    ctx,
    packageFields(input, { color: pxFromPt(13), product: pxFromPt(10), manufacturer: pxFromPt(9) }),
    textW,
    fieldRoom,
    labelPx,
    5,
  );

  const columnBottom = canvas.height - margin;
  const logoY = margin;
  if (logo) drawLogoBox(ctx, logo, margin, logoY, logoW, logoH);
  if (qrOn) {
    const logoBottom = logoY + (logo ? logoH : 0);
    const qrFit = fitPackageQr(ctx, logoW, logoBottom + 4, columnBottom, labelPx);
    const qrX = margin + Math.round((logoW - qrFit.size) / 2);
    drawQr(ctx, input.qrUrl, qrX, qrFit.y, qrFit.size);
    if (qrFit.captionH) drawCaption(ctx, PKG_CAPTION, qrX, qrFit.y + qrFit.size + 4, qrFit.size, labelPx);
  }

  ctx.fillStyle = BLACK;
  ctx.fillRect(ruleX, margin, SAMPLE_LABEL_LANDSCAPE_RULE, canvas.height - margin * 2);

  if (sampleLabelBlockOn(input, "band")) {
    drawPackageBand(
      ctx,
      textX,
      margin,
      textW,
      bandH,
      input.itemLabel,
      bandHeading(input),
      input.packageMark ?? "",
      pxFromPt(24),
      pxFromPt(10),
    );
  }

  let y = fieldTop;
  fields.forEach((field, index) => {
    if (index > 0) y += 5;
    drawLaidField(ctx, field, textX, y);
    y += field.height;
  });

  if (projectOn) {
    ctx.fillStyle = BLACK;
    ctx.fillRect(textX, ruleY, textW, 1);
    ctx.font = fontFace(labelPx);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("PROJECT", textX, projectTop);
    ctx.font = fontFace(projectValue.px);
    drawLines(ctx, projectValue.lines, textX, projectTop + labelPx + 2, projectLine, "left");
  }

  thresholdCanvas(ctx, canvas.width, canvas.height, 128);
  return canvas;
}

/**
 * Draw one sample label. Portrait is 384 × 640. Landscape is the 640 × 384 design canvas.
 * Blocks that are toggled off, or have nothing to print, are skipped with no reserved gap.
 */
export async function renderSampleLabel(input: SampleLabelInput): Promise<HTMLCanvasElement> {
  await ensureLabelFonts();
  if (input.packageLayout) {
    return input.orientation === "landscape" ? renderPackageLandscape(input) : renderPackagePortrait(input);
  }
  if (input.orientation === "landscape") return renderLandscapeLabel(input);
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_LABEL_WIDTH;
  canvas.height = SAMPLE_LABEL_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not draw sample label");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, SAMPLE_LABEL_WIDTH, SAMPLE_LABEL_HEIGHT);

  const qrOn = showQr(input);
  const logoOn = sampleLabelBlockOn(input, "logo") && Boolean(input.logoUrl.trim());
  const logo = logoOn ? await fittedLogo(input.logoUrl, logoMaxWidth(input), SAMPLE_LABEL_LOGO_MAX_H) : null;
  const state: DrawState = { ctx, input, logo, showQr: qrOn };

  if (!qrOn) {
    drawPortraitWithoutQr(ctx, state, input);
    drawFooter(ctx, input);
    thresholdCanvas(ctx, SAMPLE_LABEL_WIDTH, SAMPLE_LABEL_HEIGHT, 128);
    return canvas;
  }

  let y = SAMPLE_LABEL_MARGIN;
  const headerH = headerHeight(state);
  if (headerH > 0) {
    drawHeader(state, y);
    y += headerH + 8;
  }

  if (sampleLabelBlockOn(input, "band")) {
    drawBand(ctx, y, input.itemLabel, bandHeading(input), input.packageMark ?? "");
    y += SAMPLE_LABEL_BAND_H + 8;
  }

  const fields: { label: string; value: string; on: boolean }[] = [
    { label: "MANUFACTURER", value: input.manufacturer, on: sampleLabelBlockOn(input, "manufacturer") },
    { label: "PRODUCT", value: input.product, on: sampleLabelBlockOn(input, "product") },
    { label: "COLOR / PATTERN", value: input.color, on: sampleLabelBlockOn(input, "color") },
  ];
  let drewField = false;
  for (const field of fields) {
    if (!field.on || !field.value.trim()) continue;
    if (drewField) y += 6;
    y += drawField(ctx, y, field.label, field.value, 22, 24);
    drewField = true;
  }

  const projectOn = sampleLabelBlockOn(input, "project") && Boolean(input.project.trim());
  const submittalOn = sampleLabelBlockOn(input, "submittal") && Boolean(input.submittal.trim());
  const dateOn = sampleLabelBlockOn(input, "date") && Boolean(input.date.trim());
  const specOn = sampleLabelBlockOn(input, "spec") && Boolean(input.spec.trim());
  if (projectOn || submittalOn || dateOn || specOn) {
    if (drewField) y += 8;
    ctx.fillStyle = BLACK;
    ctx.fillRect(SAMPLE_LABEL_MARGIN, y, CONTENT_W, 1);
    y += 1 + 8;
    let drewMeta = false;
    const nextMeta = () => {
      if (drewMeta) y += 6;
      drewMeta = true;
    };
    if (projectOn) {
      nextMeta();
      y += drawField(ctx, y, "PROJECT", input.project, 17, 20);
    }
    if (submittalOn && dateOn) {
      nextMeta();
      const colGap = 12;
      const colW = Math.floor((CONTENT_W - colGap) / 2);
      const leftH = drawField(ctx, y, "SUBMITTAL", input.submittal, 16, 18, colW, SAMPLE_LABEL_MARGIN);
      const rightH = drawField(ctx, y, "DATE", input.date, 16, 18, colW, SAMPLE_LABEL_MARGIN + colW + colGap);
      y += Math.max(leftH, rightH);
    } else if (submittalOn) {
      nextMeta();
      y += drawField(ctx, y, "SUBMITTAL", input.submittal, 16, 18);
    } else if (dateOn) {
      nextMeta();
      y += drawField(ctx, y, "DATE", input.date, 16, 18);
    }
    if (specOn) {
      nextMeta();
      y += drawPortraitSpec(ctx, y, input.spec);
    }
  }

  drawFooter(ctx, input);
  thresholdCanvas(ctx, SAMPLE_LABEL_WIDTH, SAMPLE_LABEL_HEIGHT, 128);
  return canvas;
}

export async function renderSampleLabelPng(input: SampleLabelInput): Promise<Blob> {
  const drawn = await renderSampleLabel(input);
  const canvas = input.orientation === "landscape" ? rotateCanvasClockwise(drawn) : drawn;
  const raw = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export sample label"))), "image/png");
  });
  const stamped = withPngPhys(new Uint8Array(await raw.arrayBuffer()), SAMPLE_LABEL_DPI);
  return new Blob([stamped], { type: "image/png" });
}
