import { PDFDocument, PDFPage, type PDFFont } from "pdf-lib";
import { formatSubmittalDisplayDate } from "./dateInputUtils";
import { downloadPdfBytes } from "./pdfDownload";
import { rfiFilename } from "./pdfFilenames";
import {
  createLetterPdfFonts,
  drawCheckbox,
  embedLogoImage,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  TEXT,
  truncate,
} from "./pdfDrawCore";
import {
  RFI_ACTION_LABELS,
  RFI_EFFECT_LABELS,
  RFI_REASON_LABELS,
} from "./rfiFormLabels";
import type { RfiPrintInput } from "./rfiPrint";
import { pdfSignerDisplayName } from "./printCore";

const M = 18;
const LINE_H = 14;
const FS = 9;
const FS_SM = 7.5;
const FS_HDR = 7;
const CB = 9;

function drawCenteredInRegion(
  page: PDFPage,
  text: string,
  left: number,
  width: number,
  baselineY: number,
  font: PDFFont,
  size: number,
): void {
  const value = text.trim();
  if (!value) return;
  const w = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: left + Math.max(0, (width - w) / 2), y: baselineY, size, font, color: TEXT });
}

function drawLabelValue(
  page: PDFPage,
  x: number,
  baselineY: number,
  label: string,
  value: string,
  font: PDFFont,
  bold: PDFFont,
  labelW: number,
  maxValW: number,
): void {
  page.drawText(label, { x, y: baselineY, size: FS_HDR, font: bold, color: TEXT });
  page.drawText(truncate(value, font, FS, maxValW), {
    x: x + labelW,
    y: baselineY,
    size: FS,
    font,
    color: TEXT,
  });
}

function drawCheckboxItem(
  page: PDFPage,
  x: number,
  baselineY: number,
  checked: boolean,
  label: string,
  font: PDFFont,
  maxW: number,
): number {
  drawCheckbox(page, x, baselineY, CB, checked);
  page.drawText(truncate(label, font, FS_SM, maxW - CB - 4), {
    x: x + CB + 3,
    y: baselineY - 1,
    size: FS_SM,
    font,
    color: TEXT,
  });
  return baselineY - LINE_H;
}

function drawLinedBox(
  page: PDFPage,
  x: number,
  topY: number,
  width: number,
  minHeight: number,
  text: string,
  font: PDFFont,
): number {
  const rawLines = text.trim() ? text.replace(/\r\n/g, "\n").split("\n") : [];
  const minLines = Math.max(2, Math.ceil(minHeight / LINE_H));
  const totalLines = Math.max(rawLines.length + 2, minLines);
  const height = totalLines * LINE_H + 4;
  const bottomY = topY - height;
  page.drawRectangle({ x, y: bottomY, width, height, borderColor: TEXT, borderWidth: 1 });

  let ly = topY - 4 - FS * 0.85;
  for (let i = 0; i < totalLines; i += 1) {
    const line = rawLines[i]?.trim() ?? "";
    if (line) {
      page.drawText(truncate(line, font, FS, width - 8), { x: x + 4, y: ly, size: FS, font, color: TEXT });
    }
    ly -= LINE_H;
  }
  return bottomY - 4;
}

function drawSignatureBlock(
  page: PDFPage,
  x: number,
  width: number,
  topY: number,
  prefill: string,
  caption: string,
  font: PDFFont,
  bold: PDFFont,
): void {
  const prefillY = topY - FS;
  if (prefill.trim()) {
    page.drawText(truncate(prefill, font, FS, width - 4), { x, y: prefillY, size: FS, font, color: TEXT });
  }
  const lineY = prefillY - 16;
  page.drawLine({
    start: { x, y: lineY },
    end: { x: x + width, y: lineY },
    thickness: 1,
    color: TEXT,
  });
  page.drawText(caption, { x, y: lineY - FS_HDR - 2, size: FS_HDR, font: bold, color: TEXT });
}

function formatRfiDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return formatSubmittalDisplayDate(trimmed);
}

export async function buildRfiPdfBytes(input: RfiPrintInput): Promise<Uint8Array> {
  const { project, rfi_number, subject, form, branding } = input;
  const doc = await PDFDocument.create();
  const { font, bold } = await createLetterPdfFonts(doc);
  const logo = await embedLogoImage(doc, branding.logoUrl);
  const page = doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);

  const contentW = LETTER_WIDTH - M * 2;
  const logoColW = contentW * 0.18;
  const centerColW = contentW * 0.55;
  const metaColW = contentW * 0.27;
  const logoX = M;
  const centerX = M + logoColW + 6;
  const metaX = centerX + centerColW + 4;

  let y = LETTER_HEIGHT - M;

  const headerBottom = y - 88;
  if (logo) {
    const maxH = 78;
    const maxW = logoColW - 8;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawImage(logo, {
      x: logoX + (logoColW - lw) / 2,
      y: y - lh,
      width: lw,
      height: lh,
    });
  } else if (branding.companyName.trim()) {
    drawCenteredInRegion(page, branding.companyName, logoX, logoColW, y - 24, bold, 11);
  }

  let rowY = y - 12;
  drawCenteredInRegion(page, "REQUEST FOR INFORMATION", centerX, centerColW, rowY, bold, 14);
  rowY -= 16;
  drawCenteredInRegion(page, branding.companyName, centerX, centerColW, rowY, bold, 10);
  drawLabelValue(page, metaX, rowY, "RFI #:", rfi_number, font, bold, 36, metaColW - 40);
  rowY -= 13;
  const contactLine = (branding.companyContactLine || branding.companyAddress || "").trim();
  if (contactLine) {
    drawCenteredInRegion(page, contactLine, centerX, centerColW, rowY, font, 9);
  }
  drawLabelValue(page, metaX, rowY, "Date:", formatRfiDate(form.rfi_date), font, bold, 36, metaColW - 40);
  rowY -= 13;
  if (branding.companyPhone.trim()) {
    drawLabelValue(page, metaX, rowY, "Phone:", branding.companyPhone, font, bold, 36, metaColW - 40);
  }

  y = headerBottom - 6;

  const formTop = y;
  const formLeftW = contentW / 2;
  const formRightW = contentW / 2;
  const formRow1H = 118;
  const formRow2H = 20;
  const formH = formRow1H + formRow2H;

  page.drawRectangle({ x: M, y: formTop - formH, width: contentW, height: formH, borderColor: TEXT, borderWidth: 1 });
  page.drawLine({
    start: { x: M + formLeftW, y: formTop - formH },
    end: { x: M + formLeftW, y: formTop - formRow2H },
    thickness: 1,
    color: TEXT,
  });
  page.drawLine({
    start: { x: M, y: formTop - formRow1H },
    end: { x: M + contentW, y: formTop - formRow1H },
    thickness: 1,
    color: TEXT,
  });

  const lfX = M + 4;
  const lfLabelW = 44;
  const lfValW = formLeftW - lfLabelW - 12;
  let lfY = formTop - 12;
  const leftRows: [string, string][] = [
    ["Project:", project.job_name || ""],
    ["Job #:", project.job_number || ""],
    ["Address:", project.job_address || ""],
    ["", project.job_address2 || ""],
  ];
  for (const [label, value] of leftRows) {
    if (label) drawLabelValue(page, lfX, lfY, label, value, font, bold, lfLabelW, lfValW);
    else if (value) page.drawText(truncate(value, font, 8.5, lfValW), { x: lfX + lfLabelW, y: lfY, size: 8.5, font, color: TEXT });
    lfY -= 13;
  }
  lfY -= 6;
  page.drawLine({ start: { x: M, y: lfY + 8 }, end: { x: M + formLeftW, y: lfY + 8 }, thickness: 1, color: TEXT });
  drawLabelValue(page, lfX, lfY - 4, "To:", form.to_name, font, bold, lfLabelW, lfValW);
  drawLabelValue(page, lfX, lfY - 17, "Attn:", form.attn_name, font, bold, lfLabelW, lfValW);

  const cbX = M + formLeftW;
  const cbColW = formRightW / 3;
  const cbPad = 4;
  let cbY = formTop - 12;
  const colDefs: { title: string; items: { checked: boolean; label: string }[] }[] = [
    {
      title: "REASON FOR REQUEST",
      items: [
        { checked: form.reason_insufficient, label: RFI_REASON_LABELS.reason_insufficient },
        { checked: form.reason_conflict, label: RFI_REASON_LABELS.reason_conflict },
        { checked: form.reason_alternate, label: RFI_REASON_LABELS.reason_alternate },
      ],
    },
    {
      title: "ACTION REQUESTED",
      items: [
        { checked: form.action_clarification, label: RFI_ACTION_LABELS.action_clarification },
        { checked: form.action_direction, label: RFI_ACTION_LABELS.action_direction },
        { checked: form.action_approval, label: RFI_ACTION_LABELS.action_approval },
      ],
    },
    {
      title: "PROBABLE EFFECT",
      items: RFI_EFFECT_LABELS.map(({ key, label }) => ({
        checked: Boolean(form[key]),
        label,
      })),
    },
  ];

  colDefs.forEach((col, index) => {
    const cx = cbX + index * cbColW + cbPad;
    if (index > 0) {
      page.drawLine({
        start: { x: cbX + index * cbColW, y: formTop - formRow1H },
        end: { x: cbX + index * cbColW, y: formTop },
        thickness: 1,
        color: TEXT,
      });
    }
    page.drawText(col.title, { x: cx, y: cbY, size: FS_HDR, font: bold, color: TEXT });
    let itemY = cbY - 12;
    for (const item of col.items) {
      itemY = drawCheckboxItem(page, cx, itemY, item.checked, item.label, font, cbColW - cbPad * 2);
    }
  });

  const fromName =
    form.from_name.trim() || (branding.pdfShow.signer_name ? branding.signerName : "");
  const row2Y = formTop - formRow1H - 14;
  page.drawText("From:", { x: M + 4, y: row2Y, size: FS_HDR, font: bold, color: TEXT });
  page.drawText(truncate(fromName, font, FS, formLeftW - 60), { x: M + 36, y: row2Y, size: FS, font, color: TEXT });
  drawCenteredInRegion(
    page,
    `RESPONSE REQUIRED BY:  ${formatRfiDate(form.due_date)}`,
    M + formLeftW,
    formRightW,
    row2Y,
    bold,
    8.5,
  );

  y = formTop - formH - 2;

  const refH = 18;
  page.drawRectangle({ x: M, y: y - refH, width: contentW, height: refH, borderColor: TEXT, borderWidth: 1 });
  const refW = contentW / 3;
  [0, 1].forEach((i) => {
    page.drawLine({
      start: { x: M + refW * (i + 1), y: y - refH },
      end: { x: M + refW * (i + 1), y: y },
      thickness: 1,
      color: TEXT,
    });
  });
  const refY = y - 13;
  drawLabelValue(page, M + 5, refY, "SPEC SECTION:", form.spec_ref, font, bold, 68, refW - 76);
  drawLabelValue(page, M + refW + 5, refY, "DRAWING NO.:", form.drawing_ref, font, bold, 68, refW - 76);
  drawLabelValue(page, M + refW * 2 + 5, refY, "DETAIL NO.:", form.detail_no, font, bold, 58, refW - 66);
  y -= refH;

  const subjH = 18;
  page.drawRectangle({ x: M, y: y - subjH, width: contentW, height: subjH, borderColor: TEXT, borderWidth: 1 });
  drawLabelValue(page, M + 5, y - 13, "SUBJECT:", subject, font, bold, 52, contentW - 64);
  y -= subjH + 6;

  page.drawText("INFORMATION NEEDED:", { x: M, y: y - FS, size: 8.5, font: bold, color: TEXT });
  y -= 12;
  y = drawLinedBox(page, M, y, contentW, 137, form.question, font);

  if (form.pdf_show_solution) {
    page.drawText("RECOMMENDATION:", { x: M, y: y - FS, size: 8.5, font: bold, color: TEXT });
    y -= 12;
    y = drawLinedBox(page, M, y, contentW, 83, form.solution_text, font);
  }

  if (form.pdf_show_response) {
    page.drawText("RESPONSE:", { x: M, y: y - FS, size: 8.5, font: bold, color: TEXT });
    y -= 12;
    y = drawLinedBox(page, M, y, contentW, 137, "", font);
  }

  const sigTop = Math.min(y - 28, 108);
  const sigW = (contentW - 20) / 3;
  drawSignatureBlock(page, M, sigW, sigTop, pdfSignerDisplayName(branding), "AUTHORIZED SIGNATURE", font, bold);
  drawSignatureBlock(
    page,
    M + sigW + 10,
    sigW,
    sigTop,
    branding.companyName,
    "COMPANY",
    font,
    bold,
  );
  drawSignatureBlock(page, M + (sigW + 10) * 2, sigW, sigTop, formatRfiDate(form.rfi_date), "DATE", font, bold);

  return doc.save();
}

export async function downloadRfiPdf(input: RfiPrintInput): Promise<void> {
  const filename = rfiFilename(input.project.job_name, input.project.job_number, input.rfi_number);
  downloadPdfBytes(await buildRfiPdfBytes(input), filename);
}
