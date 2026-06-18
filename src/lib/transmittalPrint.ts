import { cb, esc, getPrintBranding, logoBlock, printHtml } from "./printCore";
import type { TransmittalData } from "../types/tradeDocuments";

const CSS = `
@page { size: letter; margin: 0.15in 0.4in 0.75in 0.4in; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #000; line-height: 1.3; }
table { border-collapse: collapse; width: 100%; }
.hr { border: none; border-top: 1px solid #000; margin: 0; }
.header-table td { border: none; padding: 4px 0 6px; vertical-align: bottom; }
.hdr-title { text-align: right; font-size: 20pt; font-weight: bold; letter-spacing: 1px; }
.logo-frame { text-align: center; max-width: 280px; }
.logo-frame img { max-width: 100%; max-height: 124px; }
.logo-text { font-family: "Times New Roman", Georgia, serif; font-weight: bold; font-size: 10.5pt; line-height: 1.2; }
.split-2 td { border: none; padding: 6px 10px 8px; width: 50%; vertical-align: top; }
.split-left { border-right: 1px solid #000 !important; }
.addr-body { min-height: 44px; white-space: pre-line; font-size: 10.5pt; }
.phone-line { font-size: 10.5pt; padding-top: 6px; }
.proj-fields td { border: none !important; padding: 1px 0; font-size: 10.5pt; }
.dm-plain td { border: none !important; padding: 1px 14px 1px 0; font-size: 10.5pt; }
.line-text { padding: 5px 2px; font-size: 10.5pt; }
.sent-opt { display: inline-block; margin-right: 28px; }
.cb { display: inline-block; width: 10px; height: 10px; border: 1px solid #000; margin-right: 3px; vertical-align: middle; position: relative; }
.cb.checked::after { content: "✓"; position: absolute; left: -1px; top: -5px; font-size: 12pt; font-weight: bold; }
.cb-grid td { border: none; padding: 2px 8px 2px 2px; font-size: 10pt; white-space: nowrap; }
.items-table { border: 1px solid #000; margin-top: 10px; table-layout: fixed; }
.items-table th, .items-table td { border: 1px solid #000; padding: 2px 5px; font-size: 10pt; vertical-align: top; }
.items-table th { font-weight: bold; text-align: center; }
.remarks-block { padding: 6px 2px 8px; }
.remarks-body, .copies-to-body { min-height: 32px; margin-top: 4px; white-space: pre-wrap; font-size: 10.5pt; }
.footer-table td { border: none; padding: 6px 2px; vertical-align: top; font-size: 10.5pt; }
.sig-gap { margin-top: 28px; }
.recv-line { margin-top: 18px; }
.recv-line .uline { display: inline-block; border-bottom: 1px solid #000; min-width: 180px; margin-left: 4px; }
@media print { .no-print { display: none !important; } }
`;

type ProjectInfo = { job_number: string; job_name: string };

export function buildTransmittalHtml(project: ProjectInfo, data: TransmittalData): string {
  const branding = getPrintBranding();
  const toBlock = [data.to_name, data.gc_name, data.to_address].filter((p) => p.trim()).join("\n");
  const fromBlock = data.from_block.trim() || branding.fromBlock;
  const fromPhone = data.from_phone.trim() || branding.fromPhone;
  const signer = data.signer_name.trim() || branding.signerName;

  const included = data.enclosures.filter((e) => e.included && e.description.trim());
  const rows = included.slice(0, 19).map((row, i) => ({
    num: String(i + 1),
    copies: row.copies || "1",
    for_field: data.show_for_column ? row.for_field : "",
    description: row.description + (row.digital_copy ? " (Digital Copy)" : ""),
  }));
  while (rows.length < 10) rows.push({ num: "", copies: "", for_field: "", description: "" });

  const dm = data.delivery_method;
  const rowHtml = rows
    .map((row) => {
      if (data.show_for_column) {
        return `<tr>
          <td style="text-align:center">${esc(row.num)}</td>
          <td style="text-align:center">${esc(row.copies)}</td>
          <td style="text-align:center">${esc(row.for_field)}</td>
          <td>${esc(row.description)}</td>
        </tr>`;
      }
      return `<tr>
        <td style="text-align:center">${esc(row.num)}</td>
        <td style="text-align:center">${esc(row.copies)}</td>
        <td colspan="2">${esc(row.description)}</td>
      </tr>`;
    })
    .join("");

  const headHtml = data.show_for_column
    ? `<tr><th>Item #.</th><th>Copies</th><th>For</th><th>Description/Remark</th></tr>`
    : `<tr><th>Item #.</th><th>Copies</th><th colspan="2">Description/Remark</th></tr>`;

  const cbRow = (label: string, on: boolean) => `<td>${cb(on)} ${label}</td>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Transmittal</title><style>${CSS}</style></head><body>
  <p class="no-print" style="font-family:Arial,sans-serif;font-size:11pt;margin-bottom:12px;">
    Choose <strong>Save as PDF</strong> as the printer.
  </p>
  <table class="header-table"><tr>
    <td style="width:40%">${`<div class="logo-frame">${logoBlock(branding, "IRONWOOD\nCOMMERCIAL BUILDERS, INC.")}</div>`}</td>
    <td class="hdr-title">TRANSMITTAL</td>
  </tr></table>
  <hr class="hr">
  <table class="split-2"><tr>
    <td class="split-left"><strong>To:</strong><div class="addr-body">${esc(toBlock)}</div><div class="phone-line">Phone: ${esc(data.to_phone)}</div></td>
    <td><strong>From:</strong><div class="addr-body">${esc(fromBlock)}</div><div class="phone-line">Phone: ${esc(fromPhone)}</div></td>
  </tr></table>
  <hr class="hr">
  <table class="split-2"><tr>
    <td class="split-left"><table class="proj-fields">
      <tr><td>Project:</td><td>${esc(project.job_name)}</td></tr>
      <tr><td>Job #:</td><td>${esc(project.job_number)}</td></tr>
      <tr><td>Date:</td><td>${esc(data.date)}</td></tr>
    </table></td>
    <td><strong>Delivery Method:</strong><table class="dm-plain">
      <tr>${cbRow("Fedex", dm === "FedEx")}${cbRow("Hand Delivered", dm === "Hand Delivered")}</tr>
      <tr>${cbRow("UPS", dm === "UPS")}${cbRow(`Other: ${esc(data.delivery_other_text)}`, dm === "Other")}</tr>
      <tr>${cbRow("Courier", dm === "Courier")}<td></td></tr>
    </table></td>
  </tr></table>
  <hr class="hr">
  <div class="line-text">Items listed are being sent:
    <span class="sent-opt">${cb(data.cb_enclosed)} Enclosed</span>
    <span class="sent-opt">${cb(data.cb_under_sep_cover)} Under Separate Cover</span>
    <span class="sent-opt">${cb(data.cb_via)} Via</span>
  </div>
  <div style="padding:5px 2px 3px;font-size:10.5pt">We are transmitting the following to you:</div>
  <table class="cb-grid">
    <tr>${cbRow("Product Data", data.cb_product_data)}${cbRow("Samples", data.cb_samples)}${cbRow("Submittal", data.cb_submittal)}${cbRow("O&M Manuals", data.cb_om_manuals)}${cbRow("Plans", data.cb_plans)}</tr>
    <tr>${cbRow("Architectural Drawings", data.cb_arch_drawings)}${cbRow("Letters", data.cb_letters)}${cbRow("Shop Drawings", data.cb_shop_drawings)}${cbRow("Prints", data.cb_prints)}${cbRow("Addenda", data.cb_addenda)}</tr>
    <tr>${cbRow("Engineering Drawings", data.cb_eng_drawings)}${cbRow("Change Orders", data.cb_change_orders)}${cbRow("Specifications", data.cb_specifications)}${cbRow("Invoices", data.cb_invoices)}${cbRow("SDS/Safety", data.cb_sds_safety)}</tr>
  </table>
  <table class="items-table"><thead>${headHtml}</thead><tbody>${rowHtml}</tbody></table>
  <hr class="hr" style="margin-top:12px">
  <div class="remarks-block"><strong>Remarks:</strong><div class="remarks-body">${esc(data.remarks)}</div></div>
  <hr class="hr">
  <table class="footer-table"><tr>
    <td style="width:58%"><strong>Copies To:</strong><div class="copies-to-body">${esc(data.copies_to)}</div>
      <div class="recv-line"><strong>Received By:</strong><span class="uline"></span></div>
      <div class="recv-line"><strong>Date:</strong><span class="uline"></span></div>
    </td>
    <td>Sincerely,<div class="sig-gap"><strong>By:</strong> ${esc(signer)}<br>
      ${branding.signerPhone ? `${esc(branding.signerPhone)}<br>` : ""}
      ${branding.signerEmail ? esc(branding.signerEmail) : ""}
    </div></td>
  </tr></table>
</body></html>`;
}

export function printTransmittal(project: ProjectInfo, data: TransmittalData): void {
  printHtml(buildTransmittalHtml(project, data));
}
