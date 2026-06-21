import { buildProcurementLogRowsFromLines, type ProcurementLogRow } from "./procurementLog";
import { esc, formatLongDate, logoBlock, printHtml, type PrintBranding } from "./printCore";
import { pdfTitleFromFilename, procurementLogFilename } from "./pdfFilenames";
import type { WcTrackerLineState } from "../types/fieldTracker";

const CSS = `
@page { size: landscape letter; margin: 0.35in 0.45in; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Calibri, Arial, sans-serif; font-size: 9pt; line-height: 1.35; color: #000; }
.header-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
.header-table td { border: none; vertical-align: top; padding: 0; }
.hdr-logo { width: 52%; }
.hdr-contact { width: 48%; text-align: right; font-size: 9pt; line-height: 1.5; color: #222; padding-top: 2px; }
.hdr-contact p { margin: 0; }
.logo-frame img { max-width: 300px; max-height: 72px; height: auto; display: block; }
.logo-text {
  font-family: "Times New Roman", Georgia, serif;
  font-weight: bold;
  font-size: 15pt;
  line-height: 1.12;
  text-align: left;
  max-width: 300px;
}
.header-rule { border: none; border-top: 1px solid #000; margin: 10px 0 12px; height: 0; }
.job-grid { width: 100%; border-collapse: collapse; margin-bottom: 14px; table-layout: fixed; }
.job-grid td { border: none; vertical-align: top; width: 33.33%; padding: 0 12px 0 0; }
.job-label {
  font-size: 7.5pt;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 3px;
}
.job-value { font-size: 11pt; font-weight: bold; color: #000; }
.proc-title {
  background: #1a2332;
  color: #fff;
  text-align: center;
  font-weight: bold;
  font-size: 11pt;
  padding: 8px 8px;
  margin: 0 0 0;
  letter-spacing: 0.06em;
}
table.data { width: 100%; border-collapse: collapse; margin-top: 0; }
th {
  background: #f0f0f0;
  color: #000;
  font-weight: bold;
  font-size: 8.5pt;
  padding: 6px 5px;
  border: 1px solid #bbb;
  text-align: left;
  vertical-align: bottom;
}
td {
  padding: 5px;
  border: 1px solid #ccc;
  vertical-align: top;
  font-size: 8.5pt;
  word-break: break-word;
}
tr:nth-child(even) td { background: #f3f3f3; }
.col-finish { width: 7%; }
.col-product { width: 22%; }
.col-lead { width: 9%; }
.col-date { width: 9%; }
.col-track { width: 14%; }
.col-notes { width: 22%; }
.empty { text-align: center; color: #666; font-style: italic; padding: 24px; }
`;

function procurementContactHtml(branding: PrintBranding): string {
  const addrLines = branding.companyAddress
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lines: string[] = [...addrLines];

  const phone = branding.companyPhone.trim();
  const license = branding.companyLicense.trim();
  const meta: string[] = [];
  if (phone) meta.push(/^office\s*:/i.test(phone) ? phone : `Office: ${phone}`);
  if (license) {
    if (/^license\s*#/i.test(license) || /^license/i.test(license)) meta.push(license);
    else meta.push(`License #${license.replace(/^#/, "")}`);
  }
  if (meta.length) lines.push(meta.join(" | "));

  if (!lines.length) return "";
  return lines.map((line) => `<p>${esc(line)}</p>`).join("");
}

function tableRows(lines: ProcurementLogRow[]): string {
  if (!lines.length) {
    return `<tr><td colspan="8" class="empty">No wallcovering materials found for this job.</td></tr>`;
  }
  return lines
    .map(
      (row) => `<tr>
      <td class="col-finish">${esc(row.finish)}</td>
      <td class="col-product">${esc(row.product)}</td>
      <td class="col-lead">${esc(row.leadTime)}</td>
      <td class="col-date">${esc(row.approvalReceived)}</td>
      <td class="col-date">${esc(row.dateOrdered)}</td>
      <td class="col-date">${esc(row.shipDate)}</td>
      <td class="col-track">${esc(row.dateReceivedTracking)}</td>
      <td class="col-notes">${esc(row.notes)}</td>
    </tr>`,
    )
    .join("");
}

export function buildProcurementLogHtml(options: {
  jobNumber: string;
  jobName: string;
  lines: WcTrackerLineState[];
  branding: PrintBranding;
  lastUpdate?: Date;
}): string {
  const { jobNumber, jobName, lines, branding, lastUpdate = new Date() } = options;
  const logRows = buildProcurementLogRowsFromLines(lines);
  const logoHtml = logoBlock(branding, branding.companyName);
  const contactHtml = procurementContactHtml(branding);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Procurement Log</title>
<style>${CSS}</style></head><body>
<table class="header-table"><tr>
  <td class="hdr-logo"><div class="logo-frame">${logoHtml}</div></td>
  <td class="hdr-contact">${contactHtml}</td>
</tr></table>
<hr class="header-rule">
<table class="job-grid"><tr>
  <td><div class="job-label">Job Number</div><div class="job-value">${esc(jobNumber)}</div></td>
  <td><div class="job-label">Project</div><div class="job-value">${esc(jobName)}</div></td>
  <td><div class="job-label">Last Update</div><div class="job-value">${esc(formatLongDate(lastUpdate))}</div></td>
</tr></table>
<div class="proc-title">PROCUREMENT LOG</div>
<table class="data">
  <thead><tr>
    <th class="col-finish">Finish</th>
    <th class="col-product">Product</th>
    <th class="col-lead">Lead Time in Weeks</th>
    <th class="col-date">Approval Received</th>
    <th class="col-date">Date Ordered</th>
    <th class="col-date">Ship Date</th>
    <th class="col-track">Date Received/Tracking</th>
    <th class="col-notes">Notes</th>
  </tr></thead>
  <tbody>${tableRows(logRows)}</tbody>
</table>
</body></html>`;
}

export function printProcurementLog(options: {
  jobNumber: string;
  jobName: string;
  lines: WcTrackerLineState[];
  branding: PrintBranding;
  lastUpdate?: Date;
}): void {
  const filename = procurementLogFilename(options.jobName, options.jobNumber);
  printHtml(buildProcurementLogHtml(options), pdfTitleFromFilename(filename));
}
