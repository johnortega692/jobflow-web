import {
  esc,
  logoBlock,
  submittalRevisionNoteHtml,
  SUBMITTAL_SIGNATURE_FOOTER_CSS,
  submittalDateSectionHtml,
  submittalFooterHtml,
  submittalProjectInfoHtml,
  type PrintBranding,
} from "./printCore";
import { frpSubmittalFilename, pdfTitleFromFilename } from "./pdfFilenames";
import type { ProjectPrintInfo } from "./jobInfo";
import type { FrpItem, FrpSubmittalData } from "../types/tradeDocuments";
import { downloadTradeSubmittalPdf, type SubmittalPdfFloorSection } from "./tradeSubmittalPdf";

const SUBMITTAL_CSS = `
@page { size: letter; margin: 0.5in 0.55in; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
.print-doc { display: flex; flex-direction: column; }
.print-main { flex: 0 0 auto; }
.print-footer-spacer { flex: 1 1 auto; min-height: 0.5in; }
${SUBMITTAL_SIGNATURE_FOOTER_CSS}
.company-logo { text-align: center; margin-bottom: 5px; }
.company-logo img { max-width: 400px; height: auto; }
.logo-text { font-weight: bold; font-size: 14pt; }
.company-info { text-align: center; font-size: 9pt; margin-bottom: 10px; }
.header-line { border-bottom: 2px solid #000; margin-bottom: 8px; }
.date-section { font-size: 10pt; margin-bottom: 20px; }
.form-title { text-align: center; font-size: 16pt; font-weight: bold; text-decoration: underline; margin-bottom: 25px; }
.project-info { margin-bottom: 20px; line-height: 1.15; }
.info-row { font-size: 10pt; line-height: 1.15; }
.info-row-subject { margin-top: 0.85em; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
table th { background: #333; color: #fff; padding: 6px 10px; text-align: left; font-size: 10pt; }
table td { padding: 6px 10px; border: 1px solid #ddd; font-size: 10pt; vertical-align: top; }
table tr:nth-child(even) { background: #f9f9f9; }
table tr { page-break-inside: avoid; break-inside: avoid; }
@media screen { body { padding: 30px 40px; } }
@media print {
  body { padding: 0; min-height: 0; display: block; }
  .no-print { display: none !important; }
  .print-doc { min-height: 100vh; page-break-after: auto; }
}
`;

function frpSubmittalItems(items: FrpItem[]): FrpItem[] {
  return items.filter((i) => i.manufacturer.trim() || i.product.trim() || i.label.trim());
}

function frpRows(items: FrpItem[]): string {
  return items
    .map(
      (item, i) => `<tr>
      <td>${i + 1}</td>
      <td>${esc(item.label)}</td>
      <td>${esc(item.manufacturer)}</td>
      <td>${esc(item.product)}</td>
      <td>${esc(item.color)}</td>
    </tr>`,
    )
    .join("");
}

function frpSubmittalSections(data: FrpSubmittalData): SubmittalPdfFloorSection[] {
  const items = frpSubmittalItems(data.items);
  if (!items.length) return [];
  return [
    {
      columns: ["#", "Label", "Manufacturer", "Product", "Color"],
      colWeights: [0.05, 0.15, 0.25, 0.3, 0.25],
      rows: items.map((item, i) => [
        String(i + 1),
        item.label.trim(),
        item.manufacturer.trim(),
        item.product.trim(),
        item.color.trim(),
      ]),
    },
  ];
}

export async function downloadFrpSubmittal(
  project: ProjectPrintInfo,
  data: FrpSubmittalData,
  branding: PrintBranding,
): Promise<void> {
  const filename = frpSubmittalFilename(project.job_name, project.job_number, data.submittal_number);
  await downloadTradeSubmittalPdf({
    filename,
    project,
    branding,
    date: data.date,
    subject: data.subject,
    submittalNumber: data.submittal_number,
    revisionNumber: data.revision_number,
    revisionNote: data.revision_note,
    sections: frpSubmittalSections(data),
  });
}

export function buildFrpSubmittalHtml(
  project: ProjectPrintInfo,
  data: FrpSubmittalData,
  branding: PrintBranding,
  saveFilename?: string,
): string {
  const items = frpSubmittalItems(data.items);
  const bodyTable =
    items.length === 0
      ? `<div style="text-align:center;color:#999;font-style:italic;padding:30px;">No FRP items.</div>`
      : `<table>
        <thead><tr>
          <th>#</th><th>Label</th><th>Manufacturer</th><th>Product</th><th>Color</th>
        </tr></thead>
        <tbody>${frpRows(items)}</tbody>
      </table>`;

  const pageTitle = pdfTitleFromFilename(saveFilename ?? "FRP_Submittal");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(pageTitle)}</title><style>${SUBMITTAL_CSS}</style></head><body>
  <p class="no-print" style="font-family:Arial,sans-serif;font-size:11pt;margin-bottom:12px;">
    Choose <strong>Save as PDF</strong> as the printer.
  </p>
  <div class="print-doc">
  <div class="print-main">
  <div class="company-logo">${logoBlock(branding)}</div>
  <div class="header-line"></div>
  <div class="company-info">${esc(branding.companyContactLine || branding.companyInfo)}</div>
  <div class="date-section">${submittalDateSectionHtml(data.date, data.submittal_number, data.revision_number)}</div>
  <div class="form-title">Submittals</div>
  <div class="project-info">
    ${submittalProjectInfoHtml(project)}
    <p class="info-row info-row-subject">Subject: ${esc(data.subject)}</p>
    ${submittalRevisionNoteHtml(data.revision_number, data.revision_note)}
  </div>
  ${bodyTable}
  </div>
  <div class="print-footer-spacer" aria-hidden="true"></div>
  <div class="footer-section">${submittalFooterHtml(branding)}</div>
  </div>
</body></html>`;
}
