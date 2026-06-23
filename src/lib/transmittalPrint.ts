import { esc, logoBlock, pdfSignerDisplayName, printHtml, type PrintBranding } from "./printCore";
import { pdfTitleFromFilename, transmittalFilename } from "./pdfFilenames";
import type { TransmittalData } from "../types/tradeDocuments";

const CSS = `
@page { size: letter; margin: 0.15in 0.4in 0.4in 0.4in; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000; line-height: 1.3; }
table { border-collapse: collapse; width: 100%; }
.hr { border: none; border-top: 1px solid #000; margin: 0; height: 0; }
.header-table td { border: none; padding: 4px 0 6px; vertical-align: bottom; }
.hdr-logo { width: 40%; }
.hdr-title { width: 60%; text-align: right; font-size: 20pt; font-weight: bold; letter-spacing: 1px; padding-right: 4px; line-height: 1; vertical-align: bottom; }
.logo-frame { border: none; padding: 8px 12px 0; text-align: center; display: inline-block; width: 100%; max-width: 280px; vertical-align: bottom; }
.logo-frame img { max-width: 100%; max-height: 124px; }
.logo-text { font-family: "Times New Roman", Georgia, serif; font-weight: bold; font-size: 10.5pt; line-height: 1.2; }
.split-2 td { border: none; padding: 6px 10px 8px; width: 50%; vertical-align: top; }
.split-left { border-right: 1px solid #000 !important; }
.addr-body { min-height: 44px; padding: 2px 0; white-space: pre-line; font-size: 10.5pt; }
.phone-line { font-size: 10.5pt; padding-top: 6px; white-space: nowrap; }
.proj-fields .proj-label { white-space: nowrap; padding-right: 6px; font-size: 10.5pt; vertical-align: top; }
.proj-fields .proj-value { font-size: 10.5pt; vertical-align: top; }
.inner-plain td { border: none !important; padding: 1px 0; font-size: 10.5pt; }
.dm-plain td { border: none !important; padding: 1px 14px 1px 0; font-size: 10.5pt; white-space: nowrap; }
.line-text { display: flex; align-items: center; flex-wrap: wrap; padding: 5px 2px; font-size: 10.5pt; }
.sent-prompt { font-size: 10.5pt; font-weight: normal; white-space: nowrap; }
.sent-choices { display: inline; padding-left: 28px; }
.sent-opt { display: inline-block; white-space: nowrap; vertical-align: middle; }
.sent-opt-spaced { margin-left: 40px; }
.transmit-label { padding: 5px 2px 3px; font-size: 10.5pt; }
.cb { display: inline-block; width: 10px; height: 10px; border: 1px solid #000; margin-right: 3px; vertical-align: middle; position: relative; top: -1px; }
.cb.checked::after { content: "✓"; position: absolute; left: -1px; top: -5px; font-size: 12pt; font-weight: bold; }
.cb-grid td { border: none; padding: 2px 8px 2px 2px; font-size: 10pt; white-space: nowrap; vertical-align: top; }
.items-table-spacer { height: 10px; }
.items-table { border: 1px solid #000; table-layout: fixed; margin-top: 0; }
.items-table th, .items-table td { border: 1px solid #000; padding: 2px 5px; font-size: 10pt; vertical-align: top; }
.items-table th { font-weight: bold; text-align: center; padding: 3px 4px; }
.items-table tbody td { height: 17px; }
.w-item { width: 54px; max-width: 54px; text-align: center; white-space: nowrap; }
.w-copies { width: 52px; max-width: 52px; text-align: center; white-space: nowrap; }
.w-for { width: 11%; text-align: center; }
.w-desc { text-align: left; word-wrap: break-word; }
.remarks-block { padding: 6px 2px 8px; }
.remarks-body { min-height: 48px; margin-top: 4px; white-space: pre-wrap; word-wrap: break-word; font-size: 10.5pt; }
.footer-table td { border: none; padding: 6px 2px; vertical-align: top; font-size: 10.5pt; }
.copies-block { width: 58%; }
.copies-to-body { min-height: 32px; margin-top: 4px; white-space: pre-wrap; word-wrap: break-word; font-size: 10.5pt; }
.sig-block { width: 42%; text-align: left; font-size: 10.5pt; }
.sig-gap { margin-top: 28px; }
.sig-by-line { margin-top: 2px; }
.sig-contact { margin-top: 4px; line-height: 1.35; }
.recv-line { margin-top: 18px; font-size: 10.5pt; }
.recv-line + .recv-line { margin-top: 4px; }
.recv-line .uline { display: inline-block; border-bottom: 1px solid #000; min-width: 180px; margin-left: 4px; }
.transmittal-page-one {
  display: flex;
  flex-direction: column;
  min-height: calc(11in - 0.15in - 0.4in);
}
.transmittal-main { flex: 1 0 auto; }
.transmittal-closing {
  flex: 0 0 auto;
  margin-top: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}
.transmittal-continued {
  page-break-before: always;
  padding-top: 0.15in;
}
.continued-label {
  font-size: 10pt;
  font-weight: bold;
  margin-bottom: 6px;
}
@media print {
  .transmittal-page-one.has-continued {
    page-break-after: always;
  }
  .no-print { display: none !important; }
}
@media screen {
  .no-print { display: block; }
}
`;

/** Item rows on page 1 — matches Ironwood Excel transmittal layout. */
const PAGE_ONE_ITEM_ROWS = 10;

type ItemRow = { num: string; copies: string; for_field: string; description: string };

function emptyItemRow(): ItemRow {
  return { num: "", copies: "", for_field: "", description: "" };
}

function buildItemRows(
  included: { copies: string; for_field: string; description: string }[],
  showForColumn: boolean,
): { pageOne: ItemRow[]; overflow: ItemRow[] } {
  const mapped = included.map((row, i) => ({
    num: String(i + 1),
    copies: row.copies || "1",
    for_field: showForColumn ? row.for_field : "",
    description: row.description,
  }));
  const pageOne = mapped.slice(0, PAGE_ONE_ITEM_ROWS);
  while (pageOne.length < PAGE_ONE_ITEM_ROWS) pageOne.push(emptyItemRow());
  const overflow = mapped.slice(PAGE_ONE_ITEM_ROWS).map((row, i) => ({
    ...row,
    num: String(PAGE_ONE_ITEM_ROWS + i + 1),
  }));
  return { pageOne, overflow };
}

function itemsTableHtml(rows: ItemRow[], showForColumn: boolean): string {
  const headHtml = showForColumn
    ? `<tr><th class="w-item">Item #.</th><th class="w-copies">Copies</th><th class="w-for">For</th><th class="w-desc">Description/Remark</th></tr>`
    : `<tr><th class="w-item">Item #.</th><th class="w-copies">Copies</th><th class="w-desc" colspan="2">Description/Remark</th></tr>`;
  const rowHtml = rows
    .map((row) => {
      if (showForColumn) {
        return `<tr>
          <td class="w-item">${esc(row.num)}</td>
          <td class="w-copies">${esc(row.copies)}</td>
          <td class="w-for">${esc(row.for_field)}</td>
          <td class="w-desc">${esc(row.description)}</td>
        </tr>`;
      }
      return `<tr>
        <td class="w-item">${esc(row.num)}</td>
        <td class="w-copies">${esc(row.copies)}</td>
        <td class="w-desc" colspan="2">${esc(row.description)}</td>
      </tr>`;
    })
    .join("");
  return `<table class="items-table"><thead>${headHtml}</thead><tbody>${rowHtml}</tbody></table>`;
}

function closingBlockHtml(data: TransmittalData, signerLine: string, sigContact: string): string {
  return `<div class="transmittal-closing">
  <hr class="hr">
  <div class="remarks-block"><strong>Remarks:</strong><div class="remarks-body">${esc(data.remarks)}</div></div>
  <hr class="hr">
  <table class="footer-table"><tr>
    <td class="copies-block"><strong>Copies To:</strong><div class="copies-to-body">${esc(data.copies_to)}</div>
      <div class="recv-line"><strong>Received By:</strong><span class="uline"></span></div>
      <div class="recv-line"><strong>Date:</strong><span class="uline"></span></div>
    </td>
    <td class="sig-block">Sincerely,<div class="sig-gap">
      <div class="sig-by-line"><strong>By:</strong> ${signerLine}</div>
      ${sigContact}
    </div></td>
  </tr></table>
</div>`;
}

type ProjectInfo = { job_number: string; job_name: string };

function logoFallbackText(branding: PrintBranding): string {
  return branding.companyName || "Company Name";
}

function enclosureDescription(row: { description: string; digital_copy: boolean }): string {
  const base = row.description.trim();
  if (!row.digital_copy) return base;
  return base ? `${base} (Digital Copy)` : "(Digital Copy)";
}

export function buildTransmittalHtml(
  project: ProjectInfo,
  data: TransmittalData,
  branding: PrintBranding,
  saveFilename?: string,
): string {
  const toBlock = [data.to_name, data.gc_name, data.to_address].filter((p) => p.trim()).join("\n");
  const fromBlock = data.from_block.trim() || branding.fromBlock;
  const fromPhone = data.from_phone.trim() || branding.fromPhone;
  const signer = data.signer_name.trim() || (branding.pdfShow.signer_name ? branding.signerName : "");
  const sigPhone = branding.pdfShow.signer_phone ? branding.signerPhone.trim() : "";
  const sigEmail = branding.pdfShow.signer_email ? branding.signerEmail.trim() : "";

  const included = data.enclosures
    .filter((e) => e.included && e.description.trim())
    .slice(0, 19)
    .map((row) => ({
      copies: row.copies || "1",
      for_field: data.show_for_column ? row.for_field : "",
      description: enclosureDescription(row),
    }));
  const { pageOne, overflow } = buildItemRows(included, data.show_for_column);

  const dm = data.delivery_method;

  const cbCell = (label: string, on: boolean) =>
    `<td><span class="cb${on ? " checked" : ""}"></span> ${label}</td>`;

  const sigContact =
    sigPhone || sigEmail
      ? `<div class="sig-contact">${sigPhone ? esc(sigPhone) : ""}${sigPhone && sigEmail ? "<br>" : ""}${sigEmail ? esc(sigEmail) : ""}</div>`
      : "";

  const signerLine = esc(pdfSignerDisplayName({ ...branding, signerName: signer }));

  const continuedHtml = overflow.length
    ? `<div class="transmittal-continued">
  <div class="continued-label">Transmittal — enclosures (continued)</div>
  ${itemsTableHtml(overflow, data.show_for_column)}
</div>`
    : "";

  const pageTitle = pdfTitleFromFilename(saveFilename ?? "Transmittal");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(pageTitle)}</title><style>${CSS}</style></head><body>
  <p class="no-print" style="font-family:Arial,sans-serif;font-size:11pt;margin-bottom:12px;">
    Choose <strong>Save as PDF</strong> as the printer.
  </p>
  <div class="transmittal-page-one${overflow.length ? " has-continued" : ""}">
  <div class="transmittal-main">
  <table class="header-table"><tr>
    <td class="hdr-logo"><div class="logo-frame">${logoBlock(branding, logoFallbackText(branding))}</div></td>
    <td class="hdr-title">TRANSMITTAL - ${esc(data.transmittal_number)}</td>
  </tr></table>
  <hr class="hr">
  <table class="split-2"><tr>
    <td class="split-left"><strong>To:</strong><div class="addr-body">${esc(toBlock)}</div><div class="phone-line">Phone: ${esc(data.to_phone)}</div></td>
    <td><strong>From:</strong><div class="addr-body">${esc(fromBlock)}</div><div class="phone-line">Phone: ${esc(fromPhone)}</div></td>
  </tr></table>
  <hr class="hr">
  <table class="split-2"><tr>
    <td class="split-left"><table class="inner-plain proj-fields">
      <tr><td class="proj-label">Project:</td><td class="proj-value">${esc(project.job_name)}</td></tr>
      <tr><td class="proj-label">Job #:</td><td class="proj-value">${esc(project.job_number)}</td></tr>
      <tr><td class="proj-label">Transmittal #:</td><td class="proj-value">${esc(data.transmittal_number)}</td></tr>
      <tr><td class="proj-label">Date:</td><td class="proj-value">${esc(data.date)}</td></tr>
    </table></td>
    <td><span class="sent-prompt">Delivery Method:</span><table class="dm-plain" style="margin-top:3px"><tr>
      ${cbCell("Fedex", dm === "FedEx")}${cbCell("Hand Delivered", dm === "Hand Delivered")}
    </tr><tr>
      ${cbCell("UPS", dm === "UPS")}${cbCell(`Other: ${esc(data.delivery_other_text)}`, dm === "Other")}
    </tr><tr>
      ${cbCell("Courier", dm === "Courier")}<td></td>
    </tr></table></td>
  </tr></table>
  <hr class="hr">
  <div class="line-text">
    <span class="sent-prompt">Items listed are being sent:</span>
    <span class="sent-choices">
      <span class="sent-opt"><span class="cb${data.cb_enclosed ? " checked" : ""}"></span> Enclosed</span>
      <span class="sent-opt sent-opt-spaced"><span class="cb${data.cb_under_sep_cover ? " checked" : ""}"></span> Under Separate Cover</span>
      <span class="sent-opt sent-opt-spaced"><span class="cb${data.cb_via ? " checked" : ""}"></span> Via</span>
    </span>
  </div>
  <div class="transmit-label">We are transmitting the following to you:</div>
  <table class="cb-grid">
    <tr>${cbCell("Product Data", data.cb_product_data)}${cbCell("Samples", data.cb_samples)}${cbCell("Submittal", data.cb_submittal)}${cbCell("O&amp;M Manuals", data.cb_om_manuals)}${cbCell("Plans", data.cb_plans)}</tr>
    <tr>${cbCell("Architectural Drawings", data.cb_arch_drawings)}${cbCell("Letters", data.cb_letters)}${cbCell("Shop Drawings", data.cb_shop_drawings)}${cbCell("Prints", data.cb_prints)}${cbCell("Addenda", data.cb_addenda)}</tr>
    <tr>${cbCell("Engineering Drawings", data.cb_eng_drawings)}${cbCell("Change Orders", data.cb_change_orders)}${cbCell("Specifications", data.cb_specifications)}${cbCell("Invoices", data.cb_invoices)}${cbCell("SDS/Safety", data.cb_sds_safety)}</tr>
  </table>
  <div class="items-table-spacer" aria-hidden="true"></div>
  ${itemsTableHtml(pageOne, data.show_for_column)}
  </div>
  ${closingBlockHtml(data, signerLine, sigContact)}
  </div>
  ${continuedHtml}
</body></html>`;
}

export function printTransmittal(
  project: ProjectInfo,
  data: TransmittalData,
  branding: PrintBranding,
): void {
  const filename = transmittalFilename(project.job_name, project.job_number, data.transmittal_number);
  printHtml(buildTransmittalHtml(project, data, branding, filename), pdfTitleFromFilename(filename), branding.logoUrl);
}
