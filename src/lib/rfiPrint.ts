import type { Project, RfiFormData } from "../types/database";

const COMPANY_NAME = import.meta.env.VITE_COMPANY_NAME?.trim() || "Plan B Apps";
const COMPANY_ADDR = import.meta.env.VITE_COMPANY_ADDRESS?.trim() || "";
const COMPANY_PHONE = import.meta.env.VITE_COMPANY_PHONE?.trim() || "";
const LOGO_URL = import.meta.env.VITE_LOGO_URL?.trim() || "";

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
@media print {
  body { padding: 0; }
  .no-print { display: none !important; }
}
`;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

export type RfiPrintInput = {
  project: Pick<
    Project,
    "job_number" | "job_name" | "job_address" | "job_address2" | "contractor" | "architect" | "owner"
  >;
  rfi_number: string;
  subject: string;
  form: RfiFormData;
};

export function buildRfiPrintHtml({ project, rfi_number, subject, form }: RfiPrintInput): string {
  const logoBlock = LOGO_URL
    ? `<img src="${esc(LOGO_URL)}" alt="${esc(COMPANY_NAME)}"/>`
    : `<div class="hdr-logo-text">${esc(COMPANY_NAME)}</div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>RFI ${esc(rfi_number)}</title>
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
      <td class="hdr-center"><span class="co-name">${esc(COMPANY_NAME)}</span></td>
      <td class="hdr-meta-cell"><span class="meta-lbl">RFI #:</span><span class="meta-val" style="font-weight:bold;font-size:12pt;">${esc(rfi_number)}</span></td>
    </tr>
    <tr>
      <td class="hdr-center">${COMPANY_ADDR ? `<span class="co-addr">${esc(COMPANY_ADDR)}</span>` : ""}</td>
      <td class="hdr-meta-cell"><span class="meta-lbl">Date:</span><span class="meta-val">${esc(form.rfi_date)}</span></td>
    </tr>
    <tr>
      <td class="hdr-center"></td>
      <td class="hdr-meta-cell">${COMPANY_PHONE ? `<span class="meta-lbl">Phone:</span><span class="meta-val">${esc(COMPANY_PHONE)}</span>` : ""}</td>
    </tr>
  </table>
  <table class="form-block">
    <tr>
      <td style="width:50%;vertical-align:middle;padding:0;">
        <table class="left-fields" style="height:100%;">
          <tr><td class="lf-lbl" style="border-bottom:none;">Project:</td><td class="lf-val" style="border-bottom:none;">${esc(project.job_name || "")}</td></tr>
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
              <div class="cb-item">${cb(form.reason_insufficient)}Insufficient Information</div>
              <div class="cb-item">${cb(form.reason_conflict)}Engineering Conflict</div>
              <div class="cb-item">${cb(form.reason_alternate)}Alternate Proposal</div>
            </td>
            <td>
              <div class="cb-hdr">ACTION REQUESTED</div>
              <div class="cb-item">${cb(form.action_clarification)}Clarification</div>
              <div class="cb-item">${cb(form.action_direction)}Direction</div>
              <div class="cb-item">${cb(form.action_approval)}Approval</div>
            </td>
            <td>
              <div class="cb-hdr">PROBABLE EFFECT</div>
              <div class="cb-item">${cb(form.effect_increase_cost)}Increase Cost</div>
              <div class="cb-item">${cb(form.effect_decrease_cost)}Decrease Cost</div>
              <div class="cb-item">${cb(form.effect_unknown_cost)}Unknown Cost</div>
              <div class="cb-item">${cb(form.effect_increase_time)}Increase Time</div>
              <div class="cb-item">${cb(form.effect_decrease_time)}Decrease Time</div>
              <div class="cb-item">${cb(form.effect_unknown_time)}Unknown Time</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="width:50%;border-top:1px solid #000;padding:4px;">
        <span class="lf-lbl">From:</span>&nbsp;&nbsp;${esc(form.from_name)}
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
  <div class="lined-box resp-box">${wlines(form.impact_notes, 10)}</div>`
      : ""
  }
  <table class="sig-tbl">
    <tr>
      <td style="width:38%;"><div class="sig-line"></div>AUTHORIZED SIGNATURE</td>
      <td style="width:38%;"><div class="sig-line"></div>COMPANY</td>
      <td style="width:24%;"><div class="sig-line"></div>DATE</td>
    </tr>
  </table>
</body>
</html>`;
}

export function printRfi(input: RfiPrintInput): void {
  const html = buildRfiPrintHtml(input);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px;top:0;";
  document.body.appendChild(frame);

  const win = frame.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    frame.remove();
    throw new Error("Could not open print view. Try Chrome or Edge instead of an embedded preview.");
  }

  doc.open();
  doc.write(html);
  doc.close();

  const runPrint = () => {
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 1500);
  };

  if (doc.readyState === "complete") {
    window.setTimeout(runPrint, 150);
  } else {
    frame.onload = () => window.setTimeout(runPrint, 150);
  }
}
