import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { embedLogoImage, type OrderBranding } from "../field-tools-submit-order/branding.ts";
import { resolveDisplayCompanyName } from "../displayCompanyName.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const NAVY = rgb(0.102, 0.227, 0.361);
const MUTED = rgb(0.35, 0.35, 0.35);

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

export async function buildTailgatePdf(input: TailgatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  if (input.topicPdfBase64) {
    try {
      const src = await PDFDocument.load(base64ToBytes(input.topicPdfBase64));
      const copied = await doc.copyPages(src, src.getPageIndices());
      copied.forEach((page) => doc.addPage(page));
    } catch {
      /* skip unreadable source PDF */
    }
  }

  const contentPage = newPage(doc);
  let y = PAGE_H - MARGIN;
  const logo = await embedLogoImage(doc, input.branding.logoUrl);
  if (logo) {
    const scale = Math.min(40 / logo.height, 140 / logo.width, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    contentPage.drawImage(logo, { x: MARGIN, y: y - lh, width: lw, height: lh });
    y -= lh + 10;
  } else {
    contentPage.drawText(resolveDisplayCompanyName(input.branding.companyName, 28), {
      x: MARGIN,
      y: y - 12,
      size: 11,
      font: fontBold,
      color: MUTED,
    });
    y -= 22;
  }

  contentPage.drawText("Safety Tailgate Sign-in", {
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
    contentPage.drawText(`${label}:`, { x: MARGIN, y, size: 10, font: fontBold, color: MUTED });
    const lines = wrapText(value, font, 11, PAGE_W - MARGIN * 2 - 90);
    contentPage.drawText(lines[0] ?? "", { x: MARGIN + 90, y, size: 11, font, color: NAVY });
    y -= 16;
    for (let i = 1; i < lines.length; i++) {
      contentPage.drawText(lines[i]!, { x: MARGIN + 90, y, size: 11, font, color: NAVY });
      y -= 14;
    }
  }

  if (input.bodyText.trim()) {
    y -= 8;
    contentPage.drawText("Talking points", { x: MARGIN, y, size: 12, font: fontBold, color: NAVY });
    y -= 16;
    for (const para of input.bodyText.split(/\n+/)) {
      const lines = wrapText(para, font, 11, PAGE_W - MARGIN * 2);
      for (const line of lines) {
        if (y < 80) {
          y = PAGE_H - MARGIN;
          // fall through; remaining text continues on sign-in if needed
        }
        if (y < 80) break;
        contentPage.drawText(line, { x: MARGIN, y, size: 11, font, color: rgb(0.15, 0.15, 0.15) });
        y -= 14;
      }
      y -= 6;
    }
  }

  if (input.notes.trim()) {
    y -= 4;
    contentPage.drawText("Notes", { x: MARGIN, y, size: 12, font: fontBold, color: NAVY });
    y -= 16;
    for (const line of wrapText(input.notes, font, 11, PAGE_W - MARGIN * 2)) {
      contentPage.drawText(line, { x: MARGIN, y, size: 11, font });
      y -= 14;
    }
  }

  if (input.topicImageBase64) {
    try {
      const img = await embedRaster(doc, input.topicImageBase64, input.topicImageMime);
      const page = newPage(doc);
      const maxW = PAGE_W - MARGIN * 2;
      const maxH = PAGE_H - MARGIN * 2 - 24;
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

  let signPage = newPage(doc);
  let sy = PAGE_H - MARGIN;
  signPage.drawText("Crew sign-in", { x: MARGIN, y: sy - 14, size: 16, font: fontBold, color: NAVY });
  sy -= 36;

  for (const person of input.attendees) {
    const name = person.name.trim();
    const sigRaw = (person.signature_png || person.signature || "").trim();
    if (sy < 120) {
      signPage = newPage(doc);
      sy = PAGE_H - MARGIN;
    }
    signPage.drawText(name || "Signed", { x: MARGIN, y: sy, size: 12, font: fontBold, color: NAVY });
    sy -= 10;
    if (sigRaw) {
      try {
        const sig = await embedRaster(doc, sigRaw, "image/png");
        const w = 220;
        const h = Math.min(56, (sig.height / sig.width) * w);
        signPage.drawImage(sig, { x: MARGIN, y: sy - h, width: w, height: h });
        sy -= h + 18;
      } catch {
        sy -= 18;
      }
    } else {
      sy -= 18;
    }
    signPage.drawLine({
      start: { x: MARGIN, y: sy + 8 },
      end: { x: PAGE_W - MARGIN, y: sy + 8 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
  }

  return doc.save();
}
