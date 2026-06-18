import { esc, getPrintBranding, groupByFloor, logoBlock, printHtml } from "./printCore";
import type { WallcoveringItem, WallcoveringSubmittalData } from "../types/tradeDocuments";

const SUBMITTAL_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; padding: 30px 40px; }
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
.footer-section { margin-top: 40px; font-size: 10.5pt; }
@media print { .no-print { display: none !important; } }
`;

type ProjectInfo = { job_number: string; job_name: string; job_address: string };

function wcRows(items: WallcoveringItem[]): string {
  return items
    .map(
      (item, i) => `<tr>
      <td>${i + 1}</td>
      <td><strong>${esc(item.manufacturer)}</strong></td>
      <td>${esc(item.product)}</td>
      <td>${esc(item.color)}</td>
      <td>${esc(item.label)}</td>
    </tr>`,
    )
    .join("");
}

export function buildWallcoveringSubmittalHtml(
  project: ProjectInfo,
  data: WallcoveringSubmittalData,
): string {
  const branding = getPrintBranding();
  const groups = groupByFloor(
    data.items.filter((i) => i.manufacturer.trim() || i.color.trim() || i.label.trim()),
  );
  const bodyTables =
    groups.length === 0
      ? `<div style="text-align:center;color:#999;font-style:italic;padding:30px;">No wallcovering items.</div>`
      : groups
          .map(
            ([floor, items]) => `
      ${floor ? `<div class="floor-section-title">${esc(floor.toUpperCase())}</div>` : ""}
      <table>
        <thead><tr>
          <th style="width:5%">#</th>
          <th style="width:25%">Manufacturer</th>
          <th style="width:25%">Product</th>
          <th style="width:30%">Color</th>
          <th style="width:15%">Label</th>
        </tr></thead>
        <tbody>${wcRows(items)}</tbody>
      </table>`,
          )
          .join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Wallcovering Submittal</title><style>${SUBMITTAL_CSS}</style></head><body>
  <p class="no-print" style="font-family:Arial,sans-serif;font-size:11pt;margin-bottom:12px;">
    Choose <strong>Save as PDF</strong> as the printer.
  </p>
  <div class="company-logo">${logoBlock(branding)}</div>
  <div class="header-line"></div>
  <div class="company-info">${esc(branding.companyInfo)}</div>
  <div class="date-section">${esc(data.date)}</div>
  <div class="form-title">Submittals</div>
  <div class="project-info">
    <p class="info-row">Project: ${esc(project.job_name)}</p>
    <p class="info-row">Address: ${esc(project.job_address)}</p>
    <p class="info-row">Job Number: ${esc(project.job_number)}</p>
    <p class="info-row info-row-subject">Subject: ${esc(data.subject)}</p>
  </div>
  ${bodyTables}
  <div class="footer-section">
    <p>Thank you,</p><p>&nbsp;</p>
    <p>${esc(branding.footerName)}</p>
    <p>${esc(branding.footerPhone)}</p>
    ${branding.footerEmail ? `<p>${esc(branding.footerEmail)}</p>` : ""}
  </div>
</body></html>`;
}

export function printWallcoveringSubmittal(
  project: ProjectInfo,
  data: WallcoveringSubmittalData,
): void {
  printHtml(buildWallcoveringSubmittalHtml(project, data));
}
