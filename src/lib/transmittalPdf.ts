import { PDFDocument } from "pdf-lib";
import { downloadPdfBytes } from "./pdfDownload";
import {
  createLetterPdfFonts,
  drawCheckbox,
  drawDataTable,
  drawWrappedText,
  drawRightAlignedText,
  embedLogoImage,
  LETTER_HEIGHT,
  LETTER_WIDTH,
  PDF_MARGIN_TOP,
  PDF_MARGIN_X,
  TEXT,
  truncate,
} from "./pdfDrawCore";
import { pdfSignerDisplayName, type PrintBranding } from "./printCore";
import type { TransmittalData } from "../types/tradeDocuments";

const PAGE_ONE_ITEM_ROWS = 10;

type ProjectInfo = { job_number: string; job_name: string };

function enclosureDescription(row: { description: string; digital_copy: boolean }): string {
  const base = row.description.trim();
  if (!row.digital_copy) return base;
  return base ? `${base} (Digital Copy)` : "(Digital Copy)";
}

function itemRows(data: TransmittalData) {
  return data.enclosures
    .filter((e) => e.included && e.description.trim())
    .slice(0, 19)
    .map((row) => ({
      copies: row.copies || "1",
      for_field: data.show_for_column ? row.for_field : "",
      description: enclosureDescription(row),
    }));
}

export async function buildTransmittalPdfBytes(
  project: ProjectInfo,
  data: TransmittalData,
  branding: PrintBranding,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { font, bold } = await createLetterPdfFonts(doc);
  const logo = await embedLogoImage(doc, branding.logoUrl);
  let page = doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  const pageWidth = page.getWidth();
  const contentWidth = pageWidth - PDF_MARGIN_X * 2;
  let y = page.getHeight() - PDF_MARGIN_TOP;

  const logoMaxW = contentWidth * 0.38;
  const title = `TRANSMITTAL - ${data.transmittal_number.trim()}`;
  const titleSize = 18;
  const rightEdge = pageWidth - PDF_MARGIN_X;
  const headerTop = y;

  if (logo) {
    const scale = Math.min(logoMaxW / logo.width, 96 / logo.height, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    page.drawImage(logo, { x: PDF_MARGIN_X, y: headerTop - lh, width: lw, height: lh });
    drawRightAlignedText(
      page,
      truncate(title, bold, titleSize, contentWidth - lw - 24),
      rightEdge,
      headerTop - lh / 2 - titleSize * 0.35,
      bold,
      titleSize,
    );
    y = headerTop - lh - 8;
  } else if (branding.companyName.trim()) {
    page.drawText(truncate(branding.companyName, bold, 14, contentWidth * 0.5), {
      x: PDF_MARGIN_X,
      y: headerTop - 14,
      size: 14,
      font: bold,
      color: TEXT,
    });
    drawRightAlignedText(page, truncate(title, bold, titleSize, contentWidth * 0.55), rightEdge, headerTop - titleSize, bold, titleSize);
    y = headerTop - 22;
  } else {
    drawRightAlignedText(page, truncate(title, bold, titleSize, contentWidth), rightEdge, headerTop - titleSize, bold, titleSize);
    y = headerTop - titleSize - 10;
  }

  page.drawLine({
    start: { x: PDF_MARGIN_X, y },
    end: { x: pageWidth - PDF_MARGIN_X, y },
    thickness: 0.75,
    color: TEXT,
  });
  y -= 12;

  const toBlock = [data.to_name, data.gc_name, data.to_address].filter((p) => p.trim()).join("\n");
  const fromBlock = data.from_block.trim() || branding.fromBlock;
  const fromPhone = data.from_phone.trim() || branding.fromPhone;
  const half = contentWidth / 2 - 8;

  const toFromTop = y;
  const fromX = PDF_MARGIN_X + half + 16;

  page.drawText("To:", { x: PDF_MARGIN_X, y: toFromTop - 10, size: 10.5, font: bold, color: TEXT });
  let toBottom = drawWrappedText(page, toBlock, PDF_MARGIN_X, toFromTop - 12, half, font, 10.5) - 4;
  page.drawText(`Phone: ${data.to_phone.trim()}`, { x: PDF_MARGIN_X, y: toBottom - 10, size: 10.5, font, color: TEXT });
  const leftEnd = toBottom - 16;

  page.drawText("From:", { x: fromX, y: toFromTop - 10, size: 10.5, font: bold, color: TEXT });
  let fromBottom = drawWrappedText(page, fromBlock, fromX, toFromTop - 12, half, font, 10.5);
  page.drawText(`Phone: ${fromPhone}`, {
    x: fromX,
    y: fromBottom - 14,
    size: 10.5,
    font,
    color: TEXT,
  });
  const rightEnd = fromBottom - 20;

  y = Math.min(leftEnd, rightEnd);
  page.drawLine({ start: { x: PDF_MARGIN_X, y }, end: { x: pageWidth - PDF_MARGIN_X, y }, thickness: 0.75, color: TEXT });
  y -= 12;

  const leftFields = [
    ["Project:", project.job_name.trim()],
    ["Job #:", project.job_number.trim()],
    ["Transmittal #:", data.transmittal_number.trim()],
    ["Date:", data.date.trim()],
  ];
  let leftY = y;
  for (const [label, value] of leftFields) {
    page.drawText(label, { x: PDF_MARGIN_X, y: leftY - 10, size: 10.5, font, color: TEXT });
    page.drawText(truncate(value, font, 10.5, half - 60), {
      x: PDF_MARGIN_X + 78,
      y: leftY - 10,
      size: 10.5,
      font,
      color: TEXT,
    });
    leftY -= 13;
  }

  const dm = data.delivery_method;
  const dmX = PDF_MARGIN_X + half + 16;
  let dmY = y;
  page.drawText("Delivery Method:", { x: dmX, y: dmY - 10, size: 10.5, font, color: TEXT });
  dmY -= 16;
  const dmOptions: [string, boolean][] = [
    ["Fedex", dm === "FedEx"],
    ["Hand Delivered", dm === "Hand Delivered"],
    ["UPS", dm === "UPS"],
    [`Other: ${data.delivery_other_text.trim()}`, dm === "Other"],
    ["Courier", dm === "Courier"],
  ];
  let col = 0;
  for (const [label, on] of dmOptions) {
    const x = dmX + col * 120;
    drawCheckbox(page, x, dmY - 8, 9, on);
    page.drawText(label, { x: x + 13, y: dmY - 10, size: 10, font, color: TEXT });
    col = col === 0 ? 1 : 0;
    if (col === 0) dmY -= 14;
  }

  y = Math.min(leftY, dmY) - 8;
  page.drawLine({ start: { x: PDF_MARGIN_X, y }, end: { x: pageWidth - PDF_MARGIN_X, y }, thickness: 0.75, color: TEXT });
  y -= 14;

  page.drawText("Items listed are being sent:", { x: PDF_MARGIN_X, y: y - 10, size: 10.5, font, color: TEXT });
  let sentX = PDF_MARGIN_X + 150;
  for (const [label, on] of [
    ["Enclosed", data.cb_enclosed],
    ["Under Separate Cover", data.cb_under_sep_cover],
    ["Via", data.cb_via],
  ] as const) {
    drawCheckbox(page, sentX, y - 8, 9, on);
    page.drawText(label, { x: sentX + 13, y: y - 10, size: 10.5, font, color: TEXT });
    sentX += label === "Enclosed" ? 88 : 130;
  }
  y -= 18;

  page.drawText("We are transmitting the following to you:", {
    x: PDF_MARGIN_X,
    y: y - 10,
    size: 10.5,
    font,
    color: TEXT,
  });
  y -= 16;

  const transmitOptions: [string, boolean][] = [
    ["Product Data", data.cb_product_data],
    ["Samples", data.cb_samples],
    ["Submittal", data.cb_submittal],
    ["O&M Manuals", data.cb_om_manuals],
    ["Plans", data.cb_plans],
    ["Architectural Drawings", data.cb_arch_drawings],
    ["Letters", data.cb_letters],
    ["Shop Drawings", data.cb_shop_drawings],
    ["Prints", data.cb_prints],
    ["Addenda", data.cb_addenda],
    ["Engineering Drawings", data.cb_eng_drawings],
    ["Change Orders", data.cb_change_orders],
    ["Specifications", data.cb_specifications],
    ["Invoices", data.cb_invoices],
    ["SDS/Safety", data.cb_sds_safety],
  ];
  let tx = PDF_MARGIN_X;
  let ty = y;
  transmitOptions.forEach(([label, on], i) => {
    drawCheckbox(page, tx, ty - 8, 8, on);
    page.drawText(label, { x: tx + 12, y: ty - 10, size: 9.5, font, color: TEXT });
    if (i % 5 === 4) {
      tx = PDF_MARGIN_X;
      ty -= 14;
    } else {
      tx += 108;
    }
  });
  y = ty - 18;

  const included = itemRows(data);
  const mapped = included.map((row, i) => [
    String(i + 1),
    row.copies,
    ...(data.show_for_column ? [row.for_field] : []),
    row.description,
  ]);
  const pageOneRows = mapped.slice(0, PAGE_ONE_ITEM_ROWS);
  while (pageOneRows.length < PAGE_ONE_ITEM_ROWS) {
    pageOneRows.push(
      data.show_for_column ? ["", "", "", ""] : ["", "", ""],
    );
  }
  const overflowRows = mapped.slice(PAGE_ONE_ITEM_ROWS);

  const itemColumns = data.show_for_column
    ? ["Item #.", "Copies", "For", "Description/Remark"]
    : ["Item #.", "Copies", "Description/Remark"];
  const itemWeights = data.show_for_column ? [0.12, 0.12, 0.16, 0.6] : [0.12, 0.12, 0.76];

  let state = drawDataTable(
    { doc, page, y, font, bold },
    PDF_MARGIN_X,
    itemColumns,
    itemWeights,
    pageOneRows,
    9,
  );

  y = state.y - 8;
  page = state.page;
  page.drawLine({ start: { x: PDF_MARGIN_X, y }, end: { x: pageWidth - PDF_MARGIN_X, y }, thickness: 0.75, color: TEXT });
  y -= 14;

  page.drawText("Remarks:", { x: PDF_MARGIN_X, y: y - 10, size: 10.5, font: bold, color: TEXT });
  y = drawWrappedText(page, data.remarks.trim(), PDF_MARGIN_X, y - 12, contentWidth, font, 10.5) - 6;
  page.drawLine({ start: { x: PDF_MARGIN_X, y }, end: { x: pageWidth - PDF_MARGIN_X, y }, thickness: 0.75, color: TEXT });
  y -= 14;

  const signer = data.signer_name.trim() || (branding.pdfShow.signer_name ? branding.signerName : "");
  const signerLine = pdfSignerDisplayName({ ...branding, signerName: signer });
  const sigPhone = branding.pdfShow.signer_phone ? branding.signerPhone.trim() : "";
  const sigEmail = branding.pdfShow.signer_email ? branding.signerEmail.trim() : "";

  page.drawText("Copies To:", { x: PDF_MARGIN_X, y: y - 10, size: 10.5, font: bold, color: TEXT });
  const copiesY = drawWrappedText(page, data.copies_to.trim(), PDF_MARGIN_X, y - 12, half, font, 10.5);
  page.drawText("Received By: ____________________", { x: PDF_MARGIN_X, y: copiesY - 18, size: 10.5, font, color: TEXT });
  page.drawText("Date: ____________________", { x: PDF_MARGIN_X, y: copiesY - 32, size: 10.5, font, color: TEXT });

  page.drawText("Sincerely,", { x: PDF_MARGIN_X + half + 16, y: y - 10, size: 10.5, font, color: TEXT });
  page.drawText(`By: ${signerLine}`, {
    x: PDF_MARGIN_X + half + 16,
    y: y - 36,
    size: 10.5,
    font,
    color: TEXT,
  });
  if (sigPhone) {
    page.drawText(sigPhone, { x: PDF_MARGIN_X + half + 16, y: y - 50, size: 10.5, font, color: TEXT });
  }
  if (sigEmail) {
    page.drawText(sigEmail, {
      x: PDF_MARGIN_X + half + 16,
      y: y - (sigPhone ? 64 : 50),
      size: 10.5,
      font,
      color: TEXT,
    });
  }

  if (overflowRows.length) {
    page = doc.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    y = page.getHeight() - PDF_MARGIN_TOP;
    page.drawText("Transmittal — enclosures (continued)", {
      x: PDF_MARGIN_X,
      y: y - 11,
      size: 10,
      font: bold,
      color: TEXT,
    });
    drawDataTable(
      { doc, page, y: y - 16, font, bold },
      PDF_MARGIN_X,
      itemColumns,
      itemWeights,
      overflowRows.map((row, i) =>
        data.show_for_column
          ? [String(PAGE_ONE_ITEM_ROWS + i + 1), row[1]!, row[2]!, row[3]!]
          : [String(PAGE_ONE_ITEM_ROWS + i + 1), row[1]!, row[2]!],
      ),
      9,
    );
  }

  return doc.save();
}

export async function downloadTransmittalPdf(
  project: ProjectInfo,
  data: TransmittalData,
  branding: PrintBranding,
  filename: string,
): Promise<void> {
  downloadPdfBytes(await buildTransmittalPdfBytes(project, data, branding), filename);
}
