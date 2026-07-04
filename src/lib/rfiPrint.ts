import type { Project, RfiFormData } from "../types/database";
import {
  RFI_ACTION_LABELS,
  RFI_EFFECT_LABELS,
  RFI_REASON_LABELS,
} from "./rfiFormLabels";
import { esc, pdfSignerDisplayName, printHtml, type PrintBranding } from "./printCore";
import { pdfTitleFromFilename, rfiFilename } from "./pdfFilenames";

const PRINT_CSS = `
@page { size: letter; margin: 0.25in 0.25in 0.5in 0.25in; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; padding: 0.25in; }
table.hdr { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
.hdr-logo { width: 18%; padding: 4px 8px 4px 0; text-align: center; vertical-align: top; }
.hdr-logo img { max-height: 104px; width: auto; display: block; margin: 0 auto; }
.hdr-logo-text { font-size: 11pt; font-weight: bold; line-height: 1.3; }
.hdr-center { width: 55%; padding: 2px 8px; vertical-align: top; text-align: center; }
.doc-title { font-size: 14pt; font-weight: bold; letter-spacing: 0.5px; white-space: nowrap; }
.co-name { font-size: 10pt; font-weight: bold; }
.co-addr { font-size: 9pt; color: #222; }
.hdr-meta-cell { width: 27%; padding: 2px 4px; vertical-align: top; font-size: 9pt; white-space: nowrap; }
.meta-lbl { font-weight: bold; display: inline-block; width: 48px; }
table.form-block { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 0; }
table.form-block td { border: 1px solid #000; padding: 0; vertical-align: top; }
table.left-fields { width: 100%; border-collapse: collapse; }
table.left-fields td { border: none; border-bottom: 1px solid #000; padding: 2px 4px; vertical-align: middle; }
table.left-fields tr:last-child td { border-bottom: none; }
.lf-lbl { font-weight: bold; font-size: 8pt; white-space: nowrap; width: 52px; }
.lf-val { font-size: 9pt; width: 100%; }
table.cb-cols { width: 100%; border-collapse: collapse; height: 100%; }
table.cb-cols td { border: none; border-right: 1px solid #000; vertical-align: top; padding: 2px 0; width: 33.3%; }
table.cb-cols td:last-child { border-right: none; }
.cb-hdr { font-size: 7pt; font-weight: bold; text-decoration: underline; padding: 1px 4px 2px; }
.cb-item { font-size: 7.5pt; padding: 1px 4px; display: flex; align-items: center; gap: 3px; line-height: 1.4; }
.cb { display: inline-block; width: 9px; height: 9px; border: 1px solid #000; flex-shrink: 0; text-align: center; line-height: 9px; font-size: 7pt; }
table.ref-row { width: 100%; border-collapse: collapse; border: 1px solid #000; border-top: none; }
table.ref-row td { border-right: 1px solid #000; padding: 2px 5px; font-size: 9pt; vertical-align: middle; }
table.ref-row td:last-child { border-right: none; }
.rl { font-weight: bold; font-size: 8pt; }
table.subj-row { width: 100%; border-collapse: collapse; border: 1px solid #000; border-top: none; margin-bottom: 4px; }
table.subj-row td { padding: 2px 5px; font-size: 9pt; }
.sec-lbl { font-weight: bold; font-size: 8.5pt; margin-top: 4px; margin-bottom: 1px; }
.lined-box { border: 1px solid #000; margin-bottom: 4px; }
.lined-box.info-box { min-height: 1.9in; }
.lined-box.rec-box { min-height: 1.15in; }
.lined-box.resp-box { min-height: 1.9in; }
.wline { height: 19px; padding: 1px 4px; font-size: 9pt; line-height: 17px; }
table.sig-tbl { width: 100%; border-collapse: collapse; margin-top: 28px; }
table.sig-tbl td { padding: 0 10px 0 0; vertical-align: bottom; font-size: 8pt; font-weight: bold; }
table.sig-tbl td:last-child { padding-right: 0; }
.sig-line { border-top: 1px solid #000; margin-top: 18px; margin-bottom: 2px; }
.sig-prefill { font-size: 9pt; font-weight: normal; margin-top: 2px; min-height: 14px; }
@media print {
  body { padding: 0; }
  .no-print { display: none !important; }
}
`;

function cb(checked: boolean): string {
  return `<span class="cb">${checked ? "✓" : ""}</span>`;
}

function wlines(text: string, totalWhenEmpty: number, minPad = 2): string {
  const lines = text ? text.split("\n") : [];
  if (!lines.length) {
    return Array.from({ length: totalWhenEmpty }, () => '<div class="wline">&nbsp;</div>').join("");
  }
  const rendered = lines
    .map((line) => `<div class="wline">${line.trim() ? esc(line) : "&nbsp;"}</div>`)
    .join("");
  const pad = Math.max(totalWhenEmpty - lines.length, minPad);
  const blanks = Array.from({ length: pad }, () => '<div class="wline">&nbsp;</div>').join("");
  return rendered + blanks;
}

function sigPrefill(text: string): string {
  return text ? `<div class="sig-prefill">${esc(text)}</div>` : `<div class="sig-prefill">&nbsp;</div>`;
}

export type RfiPrintInput = {
  project: Pick<
    Project,
    "job_number" | "job_name" | "job_address" | "job_address2" | "contractor" | "architect" | "owner"
  >;
  rfi_number: string;
  subject: string;
  form: RfiFormData;
  branding: PrintBranding;
};

export function rfiLetterheadContactLines(branding: PrintBranding): { address: string; phoneLicense: string } {
  const address = branding.companyAddress
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
  const phone = branding.companyPhone.trim();
  const license = branding.companyLicense.trim();
  const meta: string[] = [];
  if (phone) meta.push(/^office\s*:/i.test(phone) ? phone : `Office: ${phone}`);
  if (license) {
    if (/^license\s*#/i.test(license) || /^license/i.test(license)) meta.push(license);
    else meta.push(`License #${license.replace(/^#/, "")}`);
  }
  return { address, phoneLicense: meta.join(" | ") };
}

function rfiHeaderContactHtml(branding: PrintBranding): string {
  const { address, phoneLicense } = rfiLetterheadContactLines(branding);
  const lines: string[] = [];
  if (address) lines.push(`<span class="co-addr">${esc(address)}</span>`);
  if (phoneLicense) lines.push(`<span class="co-addr">${esc(phoneLicense)}</span>`);
  return lines.join("<br/>");
}

export function buildRfiPrintHtml(
  { project, rfi_number, subject, form, branding }: RfiPrintInput,
  saveFilename?: string,
): string {
  const logoBlock = branding.logoUrl
    ? `<img src="${esc(branding.logoUrl)}" alt="${esc(branding.logoAlt)}"/>`
    : `<div class="hdr-logo-text">${esc(branding.companyName)}</div>`;

  const fromName = form.from_name.trim() || (branding.pdfShow.signer_name ? branding.signerName : "");
  const signerLine = pdfSignerDisplayName(branding);

  const pageTitle = pdfTitleFromFilename(saveFilename ?? `RFI_${rfi_number}`);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${esc(pageTitle)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <p class="no-print" style="font-family:Arial,sans-serif;font-size:11pt;margin-bottom:12px;">
    Choose <strong>Save as PDF</strong> as the printer, then click Save.
  </p>
  <table class="hdr">
    <tr>
      <td class="hdr-logo" rowspan="4">${logoBlock}</td>
      <td class="hdr-center"><span class="doc-title">REQUEST FOR INFORMATION</span></td>
      <td class="hdr-meta-cell"></td>
    </tr>
    <tr>
      <td class="hdr-center"><span class="co-name">${esc(branding.companyName)}</span></td>
      <td class="hdr-meta-cell"><span class="meta-lbl">RFI #:</span><span class="meta-val" style="font-weight:bold;font-size:12pt;">${esc(rfi_number)}</span></td>
    </tr>
    <tr>
      <td class="hdr-center">${rfiHeaderContactHtml(branding)}</td>
      <td class="hdr-meta-cell"><span class="meta-lbl">Date:</span><span class="meta-val">${esc(form.rfi_date)}</span></td>
    </tr>
    <tr>
      <td class="hdr-center"></td>
      <td class="hdr-meta-cell"></td>
    </tr>
  </table>
  <table class="form-block">
    <tr>
      <td style="width:50%;vertical-align:middle;padding:0;">
        <table class="left-fields" style="height:100%;">
          <tr><td class="lf-lbl" style="border-bottom:none;">Project:</td><td class="lf-val" style="border-bottom:none;">${esc(project.job_name || "")}</td></tr>
          <tr><td class="lf-lbl" style="border-bottom:none;">Job #:</td><td class="lf-val" style="border-bottom:none;">${esc(project.job_number || "")}</td></tr>
          <tr><td class="lf-lbl" style="border-bottom:none;">Address:</td><td class="lf-val" style="border-bottom:none;font-size:8.5pt;">${esc(project.job_address || "")}</td></tr>
          <tr><td class="lf-lbl" style="border-bottom:none;"></td><td class="lf-val" style="border-bottom:none;font-size:8.5pt;">${esc(project.job_address2 || "")}</td></tr>
          <tr style="height:100%;"><td colspan="2" style="border-bottom:none;"></td></tr>
          <tr style="border-top:1px solid #000;">
            <td class="lf-lbl" style="border-bottom:none;padding-top:3px;padding-bottom:2px;">To:</td>
            <td class="lf-val" style="border-bottom:none;padding-top:3px;padding-bottom:2px;">${esc(form.to_name)}</td>
          </tr>
          <tr>
            <td class="lf-lbl" style="border-bottom:none;padding-top:2px;padding-bottom:2px;">Attn:</td>
            <td class="lf-val" style="border-bottom:none;padding-top:2px;padding-bottom:2px;">${esc(form.attn_name)}</td>
          </tr>
        </table>
      </td>
      <td style="width:50%;vertical-align:top;padding:0;border-left:1px solid #000;">
        <table class="cb-cols">
          <tr>
            <td>
              <div class="cb-hdr">REASON FOR REQUEST</div>
              <div class="cb-item">${cb(form.reason_insufficient)}${RFI_REASON_LABELS.reason_insufficient}</div>
              <div class="cb-item">${cb(form.reason_conflict)}${RFI_REASON_LABELS.reason_conflict}</div>
              <div class="cb-item">${cb(form.reason_alternate)}${RFI_REASON_LABELS.reason_alternate}</div>
            </td>
            <td>
              <div class="cb-hdr">ACTION REQUESTED</div>
              <div class="cb-item">${cb(form.action_clarification)}${RFI_ACTION_LABELS.action_clarification}</div>
              <div class="cb-item">${cb(form.action_direction)}${RFI_ACTION_LABELS.action_direction}</div>
              <div class="cb-item">${cb(form.action_approval)}${RFI_ACTION_LABELS.action_approval}</div>
            </td>
            <td>
              <div class="cb-hdr">PROBABLE EFFECT</div>
              ${RFI_EFFECT_LABELS.map(({ key, label }) => `<div class="cb-item">${cb(form[key])}${label}</div>`).join("")}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="width:50%;border-top:1px solid #000;padding:4px;">
        <span class="lf-lbl">From:</span>&nbsp;&nbsp;${esc(fromName)}
      </td>
      <td style="width:50%;border-top:1px solid #000;border-left:1px solid #000;padding:4px 6px;font-size:8.5pt;font-weight:bold;text-align:center;vertical-align:middle;">
        RESPONSE REQUIRED BY: &nbsp;${esc(form.due_date)}
      </td>
    </tr>
  </table>
  <table class="ref-row">
    <tr>
      <td style="width:33%;"><span class="rl">SPEC SECTION:</span> ${esc(form.spec_ref)}</td>
      <td style="width:34%;"><span class="rl">DRAWING NO.:</span> ${esc(form.drawing_ref)}</td>
      <td style="width:33%;"><span class="rl">DETAIL NO.:</span> ${esc(form.detail_no)}</td>
    </tr>
  </table>
  <table class="subj-row">
    <tr><td><span class="rl">SUBJECT:</span> ${esc(subject)}</td></tr>
  </table>
  <div style="height:8px;"></div>
  <div class="sec-lbl">INFORMATION NEEDED:</div>
  <div class="lined-box info-box">${wlines(form.question, 10)}</div>
  ${
    form.pdf_show_solution
      ? `<div class="sec-lbl">RECOMMENDATION:</div>
  <div class="lined-box rec-box">${wlines(form.solution_text, 6)}</div>`
      : ""
  }
  ${
    form.pdf_show_response
      ? `<div class="sec-lbl">RESPONSE:</div>
  <div class="lined-box resp-box">${wlines("", 10)}</div>`
      : ""
  }
  <table class="sig-tbl">
    <tr>
      <td style="width:38%;">${sigPrefill(signerLine)}<div class="sig-line"></div>AUTHORIZED SIGNATURE</td>
      <td style="width:38%;">${sigPrefill(branding.companyName)}<div class="sig-line"></div>COMPANY</td>
      <td style="width:24%;">${sigPrefill(form.rfi_date)}<div class="sig-line"></div>DATE</td>
    </tr>
  </table>
</body>
</html>`;
}

export function printRfi(input: RfiPrintInput): void {
  const filename = rfiFilename(input.project.job_name, input.project.job_number, input.rfi_number);
  printHtml(buildRfiPrintHtml(input, filename), pdfTitleFromFilename(filename), input.branding.logoUrl);
}
