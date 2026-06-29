import { PDFDocument, StandardFonts, rgb, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import { embedLogoImage, type OrderBranding } from "./branding.ts";
import { resolveDisplayCompanyName } from "../displayCompanyName.ts";
import { formatDateTime } from "./dates.ts";
import { buildAuditItemGroups, buildAuditMetaLines, orderTypeLabel, type AuditOrder } from "./order-groups.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const FOOTER_H = 44;
const NAVY = rgb(0.102, 0.227, 0.361);
const MUTED = rgb(0.35, 0.35, 0.35);
const BORDER = rgb(0.85, 0.85, 0.85);
const ROW_ALT = rgb(0.98, 0.98, 0.98);

type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;

function fontAscent(size: number): number {
  return size * 0.72;
}

function baselineBelowTop(topY: number, fontSize: number, padding: number): number {
  return topY - padding - fontAscent(fontSize);
}

function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (!words.length || (words.length === 1 && !words[0])) return [];
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

function truncate(text: string, font: PdfFont, size: number, maxWidth: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let s = value;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

async function drawBrandedHeader(
  doc: PDFDocument,
  page: PDFPage,
  font: PdfFont,
  fontBold: PdfFont,
  y: number,
  branding: OrderBranding,
  title: string,
  subtitle?: string,
): Promise<number> {
  let cursorY = y;
  let textX = MARGIN;
  const titleSize = 17;
  const logo = await embedLogoImage(doc, branding.logoUrl);
  let headerTop = cursorY;
  let headerBottom = cursorY - 28;

  if (logo) {
    const maxH = 46;
    const scale = Math.min(maxH / logo.height, 150 / logo.width, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
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
  page.drawText(title, {
    x: textX,
    y: headerMid - titleSize * 0.35,
    size: titleSize,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  if (subtitle) {
    page.drawText(subtitle, {
      x: textX,
      y: headerMid - titleSize * 0.35 - 16,
      size: 10,
      font,
      color: MUTED,
    });
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

function drawFooter(page: PDFPage, font: PdfFont, branding: OrderBranding, pageNum: number, total: number): void {
  page.drawText(`Page ${pageNum} of ${total}`, {
    x: PAGE_W - MARGIN - font.widthOfTextAtSize(`Page ${pageNum} of ${total}`, 8),
    y: MARGIN,
    size: 8,
    font,
    color: MUTED,
  });
  page.drawText(branding.companyName, { x: MARGIN, y: MARGIN, size: 8, font, color: MUTED });
}

type PageCtx = {
  doc: PDFDocument;
  page: PDFPage;
  font: PdfFont;
  fontBold: PdfFont;
  branding: OrderBranding;
  y: number;
  pages: PDFPage[];
};

function ensureSpace(ctx: PageCtx, needed: number): void {
  if (ctx.y - needed >= MARGIN + FOOTER_H) return;
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(page);
  ctx.page = page;
  ctx.y = PAGE_H - MARGIN;
}

function drawWrappedLines(
  ctx: PageCtx,
  text: string,
  size: number,
  font: PdfFont,
  color: ReturnType<typeof rgb>,
  indent = 0,
): void {
  const maxW = PAGE_W - MARGIN * 2 - indent;
  for (const line of wrapText(text, font, size, maxW)) {
    ensureSpace(ctx, size + 6);
    ctx.page.drawText(line, { x: MARGIN + indent, y: ctx.y, size, font, color });
    ctx.y -= size + 4;
  }
}

function drawOrderSection(ctx: PageCtx, order: AuditOrder, index: number): void {
  ensureSpace(ctx, 120);

  const heading = [
    `Order ${index + 1}`,
    order.po_number ? `PO# ${order.po_number}` : null,
    orderTypeLabel(order.order_type),
  ]
    .filter(Boolean)
    .join("  ·  ");

  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 18,
    width: PAGE_W - MARGIN * 2,
    height: 20,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: BORDER,
    borderWidth: 0.5,
  });
  ctx.page.drawText(heading, {
    x: MARGIN + 8,
    y: ctx.y - 14,
    size: 11,
    font: ctx.fontBold,
    color: NAVY,
  });
  ctx.y -= 30;

  const summary = [
    `Submitted: ${formatDateTime(order.created_at)} by ${order.submitted_by_name}`,
    `Status: ${order.status}${order.email_status ? ` (email: ${order.email_status})` : ""}`,
  ];
  for (const line of summary) {
    drawWrappedLines(ctx, line, 9, ctx.font, MUTED);
  }
  ctx.y -= 4;

  for (const line of buildAuditMetaLines(order)) {
    drawWrappedLines(ctx, line, 9, ctx.font, rgb(0.15, 0.15, 0.15));
  }

  const groups = buildAuditItemGroups(order);
  if (!groups.length) {
    drawWrappedLines(ctx, "No line items recorded.", 9, ctx.font, MUTED);
    ctx.y -= 8;
    return;
  }

  ctx.y -= 6;
  const tableW = PAGE_W - MARGIN * 2;

  for (const group of groups) {
    ensureSpace(ctx, 40);
    ctx.page.drawText(group.section.toUpperCase(), {
      x: MARGIN,
      y: ctx.y,
      size: 9,
      font: ctx.fontBold,
      color: NAVY,
    });
    ctx.y -= 14;

    const headerH = 16;
    const headerTop = ctx.y;
    const headerBottom = headerTop - headerH;
    ctx.page.drawRectangle({ x: MARGIN, y: headerBottom, width: tableW, height: headerH, color: ROW_ALT });
    const headerBaseline = baselineBelowTop(headerTop, 8, 4);
    ctx.page.drawText("Qty", { x: MARGIN + 6, y: headerBaseline, size: 8, font: ctx.fontBold, color: MUTED });
    ctx.page.drawText("Item", { x: MARGIN + 48, y: headerBaseline, size: 8, font: ctx.fontBold, color: MUTED });
    ctx.y = headerBottom - 4;

    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i]!;
      const rowH = 15;
      ensureSpace(ctx, rowH + 4);
      const rowTop = ctx.y;
      const rowBottom = rowTop - rowH;
      if (i % 2 === 1) {
        ctx.page.drawRectangle({ x: MARGIN, y: rowBottom, width: tableW, height: rowH, color: rgb(0.99, 0.99, 0.99) });
      }
      const rowBaseline = baselineBelowTop(rowTop, 8, 4);
      const qty = item.quantity ?? "";
      const name = item.detail ? `${item.name} — ${item.detail}` : item.name;
      ctx.page.drawText(truncate(qty, ctx.font, 8, 38), { x: MARGIN + 6, y: rowBaseline, size: 8, font: ctx.font });
      ctx.page.drawText(truncate(name, ctx.font, 8, tableW - 58), {
        x: MARGIN + 48,
        y: rowBaseline,
        size: 8,
        font: ctx.font,
      });
      ctx.page.drawLine({
        start: { x: MARGIN, y: rowBottom },
        end: { x: MARGIN + tableW, y: rowBottom },
        thickness: 0.25,
        color: BORDER,
      });
      ctx.y = rowBottom - 2;
    }
    ctx.y -= 8;
  }
  ctx.y -= 6;
}

export type AuditPdfInput = {
  branding: OrderBranding;
  jobNumber: string;
  jobName: string;
  orders: AuditOrder[];
};

export async function buildAuditPdf(input: AuditPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const firstPage = doc.addPage([PAGE_W, PAGE_H]);
  const pages: PDFPage[] = [firstPage];

  const ctx: PageCtx = {
    doc,
    page: firstPage,
    font,
    fontBold,
    branding: input.branding,
    y: PAGE_H - MARGIN,
    pages,
  };

  const jobLabel = `${input.jobNumber}${input.jobName ? ` — ${input.jobName}` : ""}`;
  ctx.y = await drawBrandedHeader(doc, firstPage, font, fontBold, ctx.y, input.branding, "Project Order Audit", jobLabel);

  const range =
    input.orders.length > 0
      ? `${formatDateTime(input.orders[input.orders.length - 1]!.created_at)} – ${formatDateTime(input.orders[0]!.created_at)}`
      : "—";

  drawWrappedLines(ctx, `${input.orders.length} order${input.orders.length === 1 ? "" : "s"} on record`, 11, fontBold, rgb(0.1, 0.1, 0.1));
  drawWrappedLines(ctx, `Date range: ${range}`, 10, font, MUTED);
  drawWrappedLines(ctx, `Generated ${new Date().toLocaleString()}`, 9, font, MUTED);
  ctx.y -= 12;

  input.orders.forEach((order, index) => {
    drawOrderSection(ctx, order, index);
  });

  const total = pages.length;
  pages.forEach((page, i) => drawFooter(page, font, input.branding, i + 1, total));

  return doc.save();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
