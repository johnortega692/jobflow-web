import { esc, groupByFloor, logoBlock, printHtml, type PrintBranding } from "./printCore";
import type { WallcoveringItem, WallcoveringSubmittalData } from "../types/tradeDocuments";

const SUBMITTAL_CSS = `
@page { size: letter; margin: 0.5in 0.55in; }

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: Calibri, Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #000;
}

.print-doc {
  display: flex;
  flex-direction: column;
}
.print-main {
  flex: 0 0 auto;
}
.print-footer-spacer {
  flex: 1 1 auto;
  min-height: 0.5in;
}
.footer-section {
  flex: 0 0 auto;
  font-size: 10.5pt;
  page-break-inside: avoid;
  break-inside: avoid;
}
.footer-section p { margin-bottom: 3px; }

.company-logo { text-align: center; margin-bottom: 5px; }
.company-logo img { max-width: 400px; height: auto; }
.logo-text { font-weight: bold; font-size: 14pt; }
.company-info { text-align: center; font-size: 9pt; margin-bottom: 10px; }
.header-line { border-bottom: 2px solid #000; margin-bottom: 8px; }
.date-section { font-size: 10pt; margin-bottom: 20px; }
.form-title { text-align: center; font-size: 16pt; font-weight: bold; text-decoration: underline; margin-bottom: 25px; }
.project-info { margin-bottom: 20px; line-height: 1.15; }
.info-row { font-size: 11pt; line-height: 1.15; }
.info-row-subject { margin-top: 0.85em; }
.floor-section-title { font-weight: bold; font-size: 11pt; margin: 18px 0 8px; color: #333; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
table th { background: #333; color: #fff; padding: 6px 10px; text-align: left; font-size: 10pt; }
table td { padding: 6px 10px; border: 1px solid #ddd; font-size: 10pt; vertical-align: top; }
table tr:nth-child(even) { background: #f9f9f9; }
table tr { page-break-inside: avoid; break-inside: avoid; }

@media screen {
  body { padding: 30px 40px; }
}

@media print {
  body { padding: 0; min-height: 0; display: block; }
  .no-print { display: none !important; }
  .print-doc {
    min-height: 100vh;
    page-break-after: auto;
  }
}
`;

type ProjectInfo = { job_number: string; job_name: string; job_address: string };

function wcRows(items: WallcoveringItem[], substitution: boolean): string {
  return items
    .map((item, i) => {
      if (substitution) {
        return `<tr>
      <td>${i + 1}</td>
      <td>${esc(item.label)}</td>
      <td>${esc(item.previous_color)}</td>
      <td><strong>${esc(item.color)}</strong></td>
      <td>${esc(item.manufacturer)}</td>
      <td>${esc(item.product)}</td>
      <td>${esc(item.qty)}</td>
    </tr>`;
      }
      return `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(item.manufacturer)}</strong></td>
      <td>${esc(item.product)}</td>
      <td>${esc(item.color)}</td>
      <td>${esc(item.label)}</td>
      <td>${esc(item.qty)}</td>
    </tr>`;
    })
    .join("");
}

function wcTableHead(substitution: boolean): string {
  if (substitution) {
    return `<tr>
          <th style="width:5%">#</th>
          <th style="width:10%">Label</th>
          <th style="width:20%">Previous</th>
          <th style="width:20%">New Color</th>
          <th style="width:18%">Manufacturer</th>
          <th style="width:17%">Product</th>
          <th style="width:10%">Qty</th>
        </tr>`;
  }
  return `<tr>
          <th style="width:5%">#</th>
          <th style="width:22%">Manufacturer</th>
          <th style="width:22%">Product</th>
          <th style="width:26%">Color</th>
          <th style="width:15%">Label</th>
          <th style="width:10%">Qty</th>
        </tr>`;
}

export function buildWallcoveringSubmittalHtml(
  project: ProjectInfo,
  data: WallcoveringSubmittalData,
  branding: PrintBranding,
): string {
  const substitution = data.submittal_type === "substitution";
  const groups = groupByFloor(
    data.items.filter(
      (i) =>
        i.include_in_submittal !== false &&
        (i.manufacturer.trim() || i.color.trim() || i.label.trim()),
    ),
  );
  const bodyTables =
    groups.length === 0
      ? `<div style="text-align:center;color:#999;font-style:italic;padding:30px;">No wallcovering items.</div>`
      : groups
          .map(
            ([floor, items]) => `
      ${floor ? `<div class="floor-section-title">${esc(floor.toUpperCase())}</div>` : ""}
      <table>
        <thead>${wcTableHead(substitution)}</thead>
        <tbody>${wcRows(items, substitution)}</tbody>
      </table>`,
          )
          .join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Wallcovering Submittal</title><style>${SUBMITTAL_CSS}</style></head><body>
  <p class="no-print" style="font-family:Arial,sans-serif;font-size:11pt;margin-bottom:12px;">
    Choose <strong>Save as PDF</strong> as the printer.
  </p>
  <div class="print-doc">
  <div class="print-main">
  <div class="company-logo">${logoBlock(branding)}</div>
  <div class="header-line"></div>
  <div class="company-info">${esc(branding.companyContactLine || branding.companyInfo)}</div>
  <div class="date-section">${esc(data.date)}</div>
  <div class="form-title">Submittals</div>
  <div class="project-info">
    <p class="info-row">Project: ${esc(project.job_name)}</p>
    <p class="info-row">Address: ${esc(project.job_address)}</p>
    <p class="info-row">Job Number: ${esc(project.job_number)}</p>
    <p class="info-row info-row-subject">Subject: ${esc(data.subject)}</p>
  </div>
  ${bodyTables}
  </div>
  <div class="print-footer-spacer" aria-hidden="true"></div>
  <div class="footer-section">
    <p>Thank you,</p><p>&nbsp;</p>
    <p>${esc(branding.footerName)}</p>
    <p>${esc(branding.footerPhone)}</p>
    ${branding.footerEmail ? `<p>${esc(branding.footerEmail)}</p>` : ""}
  </div>
  </div>
</body></html>`;
}

export function printWallcoveringSubmittal(
  project: ProjectInfo,
  data: WallcoveringSubmittalData,
  branding: PrintBranding,
): void {
  printHtml(buildWallcoveringSubmittalHtml(project, data, branding));
}
