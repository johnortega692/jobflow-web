import { create as createQr } from "qrcode";
import { logoToBlackAndWhitePng } from "./sampleLabelLogo";
import { withPngPhys } from "./pngPhys";
import { SHEET_LABEL_COLUMN_PAD, SHEET_LABEL_COLUMN_RATIO, SHEET_LABEL_PX_H, SHEET_LABEL_PX_W } from "./sheetLabelTemplate";
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
  SAMPLE_LABEL_LANDSCAPE_WIDTH,
  SAMPLE_LABEL_LOGO_MAX_H,
  SAMPLE_LABEL_MARGIN,
  SAMPLE_LABEL_QR_PX,
  SAMPLE_LABEL_QR_QUIET,
  SAMPLE_LABEL_WIDTH,
  qrModuleGeometry,
  sampleLabelBlockOn,
  sampleLabelQrCaption,
  sampleLabelSpecLines,
  wrapTextLines,
  type SampleLabelInput,
} from "./sampleLabelContent";

const SANS = "Arial, Helvetica, sans-serif";
const MONO = "Consolas, 'Courier New', monospace";
const CAPTION_MAX_W = 148;
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

function captionText(input: SampleLabelInput): string {
  if (input.qrKind === "none") return "";
  return sampleLabelQrCaption(input.qrKind, input.companyName);
}

function qrCaptionHeight(ctx: CanvasRenderingContext2D, input: SampleLabelInput): number {
  ctx.font = font(12);
  const captionLines = linesOf(ctx, captionText(input), CAPTION_MAX_W, 2).length || 1;
  return 4 + captionLines * 14;
}

function headerHeight(state: DrawState): number {
  const { ctx, logo, showQr, input } = state;
  if (!showQr) return logo?.height ?? 0;
  return SAMPLE_LABEL_QR_PX + qrCaptionHeight(ctx, input);
}

function drawHeader(state: DrawState, y: number): void {
  const { ctx, logo, showQr, input } = state;
  if (!showQr) {
    if (!logo) return;
    const x = SAMPLE_LABEL_MARGIN + Math.round((CONTENT_W - logo.width) / 2);
    ctx.drawImage(logo, x, y);
    return;
  }
  const blockH = SAMPLE_LABEL_QR_PX + qrCaptionHeight(ctx, input);
  if (logo) {
    const areaW = CONTENT_W - SAMPLE_LABEL_QR_PX - 12;
    const x = SAMPLE_LABEL_MARGIN + Math.round((areaW - logo.width) / 2);
    const logoY = y + Math.round((blockH - logo.height) / 2);
    ctx.drawImage(logo, x, logoY);
  }
  const qrX = SAMPLE_LABEL_WIDTH - SAMPLE_LABEL_MARGIN - SAMPLE_LABEL_QR_PX;
  drawQr(ctx, input.qrUrl, qrX, y);
  ctx.font = font(12);
  ctx.fillStyle = BLACK;
  const lines = linesOf(ctx, captionText(input), CAPTION_MAX_W, 2);
  const widest = lines.reduce((max, line) => Math.max(max, measure(ctx, line)), 0);
  const rightLimit = SAMPLE_LABEL_WIDTH - SAMPLE_LABEL_MARGIN;
  let captionX = qrX + SAMPLE_LABEL_QR_PX / 2;
  if (captionX + widest / 2 > rightLimit) captionX = rightLimit - widest / 2;
  drawLines(ctx, lines, captionX, y + SAMPLE_LABEL_QR_PX + 4, 14, "center");
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
): void {
  const pad = 14;
  const gap = 12;
  const inner = Math.max(40, width - pad * 2);
  ctx.fillStyle = WHITE;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = font(16);
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
    ctx.font = font(16);
    ctx.fillText(heading, cursor, centerY);
  }
}

function drawBand(ctx: CanvasRenderingContext2D, y: number, itemLabel: string, subtitle: string): void {
  ctx.fillStyle = BLACK;
  fillRoundRect(ctx, SAMPLE_LABEL_MARGIN, y, CONTENT_W, SAMPLE_LABEL_BAND_H, 4);
  drawBandRow(ctx, SAMPLE_LABEL_MARGIN, y + SAMPLE_LABEL_BAND_H / 2, CONTENT_W, itemLabel, subtitle, 44);
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

function drawLandscapeCaption(
  ctx: CanvasRenderingContext2D,
  input: SampleLabelInput,
  qrX: number,
  qrY: number,
  innerLeft: number,
  innerRight: number,
): void {
  ctx.font = font(12);
  ctx.fillStyle = BLACK;
  const maxW = innerRight - innerLeft;
  const lines = linesOf(ctx, captionText(input), maxW, 2);
  const widest = lines.reduce((max, line) => Math.max(max, measure(ctx, line)), 0);
  let captionX = qrX + SAMPLE_LABEL_LANDSCAPE_QR / 2;
  if (captionX - widest / 2 < innerLeft) captionX = innerLeft + widest / 2;
  if (captionX + widest / 2 > innerRight) captionX = innerRight - widest / 2;
  drawLines(ctx, lines, captionX, qrY + SAMPLE_LABEL_LANDSCAPE_QR + 4, 14, "center");
}

function landscapeCaptionHeight(ctx: CanvasRenderingContext2D, input: SampleLabelInput, maxW: number): number {
  ctx.font = font(12);
  const count = linesOf(ctx, captionText(input), maxW, 2).length || 1;
  return 4 + count * 14;
}

function drawLandscapeBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  itemLabel: string,
  subtitle: string,
): void {
  ctx.fillStyle = BLACK;
  fillRoundRect(ctx, x, y, width, SAMPLE_LABEL_LANDSCAPE_BAND_H, 4);
  drawBandRow(ctx, x, y + SAMPLE_LABEL_LANDSCAPE_BAND_H / 2, width, itemLabel, subtitle, 40);
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
  const innerRight = columnRight - pad;
  const innerW = innerRight - innerLeft;
  const rightX = columnRight + SAMPLE_LABEL_LANDSCAPE_RULE;
  const rightLimit = sheet ? SHEET_LABEL_PX_W / sheetScale - pad : width - side;
  const rightW = rightLimit - rightX;
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
  const captionH = qrOn ? landscapeCaptionHeight(ctx, input, innerW) : 0;
  const logoMaxH = qrOn
    ? Math.max(1, columnH - 8 - SAMPLE_LABEL_LANDSCAPE_QR - captionH)
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
      const blockH = SAMPLE_LABEL_LANDSCAPE_QR + captionH;
      const qrY = regionTop + Math.round((footerRuleY - regionTop - blockH) / 2);
      const qrX = place(innerLeft, innerW, SAMPLE_LABEL_LANDSCAPE_QR);
      drawQr(ctx, input.qrUrl, qrX, qrY, SAMPLE_LABEL_LANDSCAPE_QR);
      drawLandscapeCaption(ctx, input, qrX, qrY, innerLeft, innerRight);
    }
  }

  ctx.fillStyle = BLACK;
  ctx.fillRect(columnRight, columnTop, SAMPLE_LABEL_LANDSCAPE_RULE, columnH);

  let y = columnTop;
  if (sampleLabelBlockOn(input, "band")) {
    drawLandscapeBand(ctx, rightX, y, rightW, input.itemLabel, bandHeading(input));
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
    if (drewField) y += 6;
    ctx.fillStyle = BLACK;
    ctx.fillRect(rightX, y, rightW, 1);
    y += 1 + 6;
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
    drawBand(ctx, y, input.itemLabel, bandHeading(input));
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

/**
 * Draw one sample label. Portrait is 384 × 640. Landscape is the 640 × 384 design canvas.
 * Blocks that are toggled off, or have nothing to print, are skipped with no reserved gap.
 */
export async function renderSampleLabel(input: SampleLabelInput): Promise<HTMLCanvasElement> {
  await ensureLabelFonts();
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
    drawBand(ctx, y, input.itemLabel, bandHeading(input));
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
