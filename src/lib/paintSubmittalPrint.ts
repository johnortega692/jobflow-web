import { esc, getPrintBranding, groupByFloor, logoBlock, printHtml } from "./printCore";
import { paintColorForPrint } from "./paintImageImport";
import type { PaintItem, PaintSubmittalData } from "../types/tradeDocuments";

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

type ProjectInfo = {
  job_number: string;
  job_name: string;
  job_address: string;
};

function paintTableRows(items: PaintItem[], isSub: boolean): string {
  return items
    .map((item, i) => {
      const displayColor = paintColorForPrint(item.manufacturer, item.color);
      if (isSub) {
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(item.label)}</td>
          <td>${esc(item.previous_color)}</td>
          <td><strong>${esc(displayColor)}</strong></td>
          <td>${esc(item.product)}</td>
          <td>${esc(item.sheen)}</td>
        </tr>`;
      }
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${esc(displayColor)}</strong></td>
        <td>${esc(item.product)}</td>
        <td>${esc(item.sheen)}</td>
        <td>${esc(item.label)}</td>
      </tr>`;
    })
    .join("");
}

function paintTableHead(isSub: boolean): string {
  if (isSub) {
    return `<tr>
      <th style="width:5%">#</th>
      <th style="width:10%">Label</th>
      <th style="width:22%">Previous Color</th>
      <th style="width:22%">New Color</th>
      <th style="width:22%">Product</th>
      <th style="width:19%">Sheen</th>
    </tr>`;
  }
  return `<tr>
    <th style="width:5%">#</th>
    <th style="width:25%">Color</th>
    <th style="width:25%">Product</th>
    <th style="width:25%">Sheen</th>
    <th style="width:20%">Label</th>
  </tr>`;
}

export function buildPaintSubmittalHtml(
  project: ProjectInfo,
  data: PaintSubmittalData,
): string {
  const branding = getPrintBranding();
  const isSub = data.submittal_type === "substitution";
  const groups = groupByFloor(data.items.filter((i) => i.color.trim() || i.label.trim()));
  const bodyTables =
    groups.length === 0
      ? `<div style="text-align:center;color:#999;font-style:italic;padding:30px;">No paint items.</div>`
      : groups
          .map(
            ([floor, items]) => `
      ${floor ? `<div class="floor-section-title">${esc(floor.toUpperCase())}</div>` : ""}
      <table><thead>${paintTableHead(isSub)}</thead><tbody>${paintTableRows(items, isSub)}</tbody></table>`,
          )
          .join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Paint Submittal</title><style>${SUBMITTAL_CSS}</style></head><body>
  <p class="no-print" style="font-family:Arial,sans-serif;font-size:11pt;margin-bottom:12px;">
    Choose <strong>Save as PDF</strong> as the printer.
  </p>
  <div class="company-logo">${logoBlock(branding)}</div>
  <div class="header-line"></div>
  <div class="company-info">${esc(branding.companyInfo)}</div>
  <div class="date-section">${esc(data.date)}${data.submittal_number ? `<br>Submittal No: ${data.submittal_number}` : ""}</div>
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

export function printPaintSubmittal(project: ProjectInfo, data: PaintSubmittalData): void {
  printHtml(buildPaintSubmittalHtml(project, data));
}
