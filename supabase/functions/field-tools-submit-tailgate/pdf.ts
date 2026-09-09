import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { embedLogoImage, type OrderBranding } from "../field-tools-submit-order/branding.ts";
import { resolveDisplayCompanyName } from "../displayCompanyName.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const BOTTOM = 56;
const FOOTER_H = 28;
const FOOTER_Y = 16;
const NAVY = rgb(0.102, 0.227, 0.361);
const MUTED = rgb(0.35, 0.35, 0.35);
const BODY = rgb(0.15, 0.15, 0.15);
const WHITE = rgb(1, 1, 1);

export type TailgateAttendee = {
  name: string;
  signature_png?: string;
  signature?: string;
};

export type TailgatePdfInput = {
  branding: OrderBranding;
  title: string;
  bodyText: string;
  jobCode: string;
  jobName: string;
  conductedBy: string;
  completedAt: string;
  notes: string;
  attendees: TailgateAttendee[];
  topicImageBase64?: string | null;
  topicImageMime?: string | null;
  topicPdfBase64?: string | null;
};

type Flow = { page: PDFPage; y: number };

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (!words.length || (words.length === 1 && !words[0])) return [""];
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

function base64ToBytes(raw: string): Uint8Array {
  let v = raw.trim();
  const comma = v.indexOf(",");
  if (v.startsWith("data:") && comma >= 0) v = v.slice(comma + 1);
  const bin = atob(v);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function embedRaster(doc: PDFDocument, raw: string, mime?: string | null) {
  const bytes = base64ToBytes(raw);
  const kind = (mime ?? "").toLowerCase();
  if (kind.includes("png") || raw.startsWith("data:image/png")) return doc.embedPng(bytes);
  try {
    return await doc.embedJpg(bytes);
  } catch {
    return doc.embedPng(bytes);
  }
}

function newPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_W, PAGE_H]);
}

function ensureSpace(doc: PDFDocument, flow: Flow, needed = 18) {
  if (flow.y < BOTTOM + needed) {
    flow.page = newPage(doc);
    flow.y = PAGE_H - MARGIN;
  }
}

async function drawHeader(
  doc: PDFDocument,
  page: PDFPage,
  input: TailgatePdfInput,
  font: PDFFont,
  fontBold: PDFFont,
): Promise<number> {
  let y = PAGE_H - MARGIN;
  const logo = await embedLogoImage(doc, input.branding.logoUrl);
  if (logo) {
    const scale = Math.min(40 / logo.height, 140 / logo.width, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawImage(logo, { x: MARGIN, y: y - lh, width: lw, height: lh });
    y -= lh + 10;
  } else {
    page.drawText(resolveDisplayCompanyName(input.branding.companyName, 28), {
      x: MARGIN,
      y: y - 12,
      size: 11,
      font: fontBold,
      color: MUTED,
    });
    y -= 22;
  }

  page.drawText("Safety Tailgate Sign-in", {
    x: MARGIN,
    y: y - 16,
    size: 18,
    font: fontBold,
    color: NAVY,
  });
  y -= 36;

  const jobLabel = [input.jobCode, input.jobName].filter(Boolean).join(" ");
  const meta = [
    ["Topic", input.title],
    ["Job", jobLabel],
    ["Conducted by", input.conductedBy],
    ["Date", input.completedAt],
  ];
  for (const [label, value] of meta) {
    if (!value.trim()) continue;
    page.drawText(`${label}:`, { x: MARGIN, y, size: 10, font: fontBold, color: MUTED });
    const lines = wrapText(value, font, 11, PAGE_W - MARGIN * 2 - 90);
    page.drawText(lines[0] ?? "", { x: MARGIN + 90, y, size: 11, font, color: NAVY });
    y -= 16;
    for (let i = 1; i < lines.length; i++) {
      page.drawText(lines[i]!, { x: MARGIN + 90, y, size: 11, font, color: NAVY });
      y -= 14;
    }
  }
  return y;
}

function stampPageFooters(doc: PDFDocument, font: PDFFont, fontBold: PDFFont) {
  const pages = doc.getPages();
  const total = pages.length;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const { width } = page.getSize();
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: FOOTER_H,
      color: WHITE,
    });
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_H },
      end: { x: width - MARGIN, y: FOOTER_H },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
    const label = `Page ${i + 1} of ${total}`;
    const size = 8;
    const labelW = fontBold.widthOfTextAtSize(label, size);
    page.drawText("Safety Tailgate", {
      x: MARGIN,
      y: FOOTER_Y,
      size,
      font,
      color: MUTED,
    });
    page.drawText(label, {
      x: (width - labelW) / 2,
      y: FOOTER_Y,
      size,
      font: fontBold,
      color: NAVY,
    });
  }
}

function drawWrappedSection(
  doc: PDFDocument,
  flow: Flow,
  heading: string,
  text: string,
  font: PDFFont,
  fontBold: PDFFont,
) {
  ensureSpace(doc, flow, 32);
  flow.y -= 8;
  flow.page.drawText(heading, { x: MARGIN, y: flow.y, size: 12, font: fontBold, color: NAVY });
  flow.y -= 16;
  for (const para of text.split(/\n+/)) {
    const lines = wrapText(para, font, 11, PAGE_W - MARGIN * 2);
    for (const line of lines) {
      ensureSpace(doc, flow);
      flow.page.drawText(line, { x: MARGIN, y: flow.y, size: 11, font, color: BODY });
      flow.y -= 14;
    }
    flow.y -= 6;
  }
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let s = value;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

async function drawCrewSignInPages(
  doc: PDFDocument,
  attendees: TailgateAttendee[],
  font: PDFFont,
  fontBold: PDFFont,
) {
  const COLS = 3;
  const COL_GAP = 12;
  const TITLE_H = 28;
  const NAME_SIZE = 9;
  const SIG_H = 40;
  const CELL_H = 14 + 6 + SIG_H + 10;
  const innerW = PAGE_W - MARGIN * 2;
  const colW = (innerW - COL_GAP * (COLS - 1)) / COLS;
  const usableH = PAGE_H - MARGIN - TITLE_H - BOTTOM;
  const rows = Math.max(1, Math.floor(usableH / CELL_H));
  const perPage = rows * COLS;

  const prepared = await Promise.all(
    attendees.map(async (person) => {
      const name = person.name.trim() || "Signed";
      const sigRaw = (person.signature_png || person.signature || "").trim();
      if (!sigRaw) return { name, image: null as Awaited<ReturnType<typeof embedRaster>> | null };
      try {
        return { name, image: await embedRaster(doc, sigRaw, "image/png") };
      } catch {
        return { name, image: null };
      }
    }),
  );

  const total = Math.max(1, prepared.length);
  for (let start = 0; start < total; start += perPage) {
    const page = newPage(doc);
    page.drawText(start === 0 ? "Crew sign-in" : "Crew sign-in (continued)", {
      x: MARGIN,
      y: PAGE_H - MARGIN - 14,
      size: 14,
      font: fontBold,
      color: NAVY,
    });
    const gridTop = PAGE_H - MARGIN - TITLE_H;
    const chunk = prepared.slice(start, start + perPage);
    if (!chunk.length) continue;
    for (let i = 0; i < chunk.length; i++) {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const x = MARGIN + col * (colW + COL_GAP);
      const cellTop = gridTop - row * CELL_H;
      const nameY = cellTop - 12;
      page.drawText(truncate(chunk[i]!.name, fontBold, NAME_SIZE, colW), {
        x,
        y: nameY,
        size: NAME_SIZE,
        font: fontBold,
        color: NAVY,
      });
      const img = chunk[i]!.image;
      if (img) {
        const scale = Math.min(colW / img.width, SIG_H / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x, y: nameY - 4 - h, width: w, height: h });
      } else {
        page.drawLine({
          start: { x, y: nameY - 22 },
          end: { x: x + colW, y: nameY - 22 },
          thickness: 0.6,
          color: rgb(0.75, 0.75, 0.75),
        });
      }
      page.drawLine({
        start: { x, y: cellTop - CELL_H + 6 },
        end: { x: x + colW, y: cellTop - CELL_H + 6 },
        thickness: 0.4,
        color: rgb(0.88, 0.88, 0.88),
      });
    }
  }
}

export async function buildTailgatePdf(input: TailgatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cover = newPage(doc);
  const flow: Flow = { page: cover, y: await drawHeader(doc, cover, input, font, fontBold) };

  let topicSrc: PDFDocument | null = null;
  if (input.topicPdfBase64) {
    try {
      const src = await PDFDocument.load(base64ToBytes(input.topicPdfBase64));
      topicSrc = src.getPageCount() > 0 ? src : null;
    } catch {
      topicSrc = null;
    }
  }

  // Topic PDF already has the talk. Do not reprint it under the header.
  if (!topicSrc && input.bodyText.trim()) {
    drawWrappedSection(doc, flow, "Talking points", input.bodyText, font, fontBold);
  }

  if (input.notes.trim()) {
    drawWrappedSection(doc, flow, "Notes", input.notes, font, fontBold);
  }

  if (topicSrc) {
    const copied = await doc.copyPages(topicSrc, topicSrc.getPageIndices());
    copied.forEach((page) => doc.addPage(page));
  }

  if (input.topicImageBase64) {
    try {
      const img = await embedRaster(doc, input.topicImageBase64, input.topicImageMime);
      const page = newPage(doc);
      const maxW = PAGE_W - MARGIN * 2;
      const maxH = PAGE_H - MARGIN - BOTTOM - 24;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawText("Topic document", {
        x: MARGIN,
        y: PAGE_H - MARGIN - 12,
        size: 12,
        font: fontBold,
        color: NAVY,
      });
      page.drawImage(img, {
        x: MARGIN,
        y: PAGE_H - MARGIN - 24 - h,
        width: w,
        height: h,
      });
    } catch {
      /* skip image */
    }
  }

  await drawCrewSignInPages(doc, input.attendees, font, fontBold);

  stampPageFooters(doc, font, fontBold);
  return doc.save();
}
