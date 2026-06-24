import {
  esc,
  groupByFloor,
  logoBlock,
  submittalRevisionNoteHtml,
  SUBMITTAL_SIGNATURE_FOOTER_CSS,
  submittalDateSectionHtml,
  submittalFooterHtml,
  submittalProjectInfoHtml,
  type PrintBranding,
} from "./printCore";
import { paintSubmittalFilename, pdfTitleFromFilename } from "./pdfFilenames";
import { paintColorForPrint } from "./paintImageImport";
import type { ProjectPrintInfo } from "./jobInfo";
import type { PaintItem, PaintSubmittalData } from "../types/tradeDocuments";
import { downloadTradeSubmittalPdf, type SubmittalPdfFloorSection } from "./tradeSubmittalPdf";

const SUBMITTAL_CSS = `
@page { size: letter; margin: 0.5in 0.55in; }

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: Calibri, Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.5;
  color: #000;
}

/* Full letter content height — flex spacer pins footer to bottom of page 1 */
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

type ProjectInfo = ProjectPrintInfo;

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

export function buildPaintSubmittalSections(
  data: PaintSubmittalData,
): SubmittalPdfFloorSection[] {
  const isSub = data.submittal_type === "substitution";
  const groups = groupByFloor(data.items.filter((i) => i.color.trim() || i.label.trim()));
  return groups.map(([floor, items]) => ({
    floorLabel: floor || undefined,
    columns: isSub
      ? ["#", "Label", "Previous Color", "New Color", "Product", "Sheen"]
      : ["#", "Color", "Product", "Sheen", "Label"],
    colWeights: isSub ? [0.05, 0.1, 0.22, 0.22, 0.22, 0.19] : [0.05, 0.25, 0.25, 0.25, 0.2],
    rows: items.map((item, i) => {
      const displayColor = paintColorForPrint(item.manufacturer, item.color);
      if (isSub) {
        return [
          String(i + 1),
          item.label.trim(),
          item.previous_color.trim(),
          displayColor,
          item.product.trim(),
          item.sheen.trim(),
        ];
      }
      return [
        String(i + 1),
        displayColor,
        item.product.trim(),
        item.sheen.trim(),
        item.label.trim(),
      ];
    }),
  }));
}

export async function downloadPaintSubmittal(
  project: ProjectInfo,
  data: PaintSubmittalData,
  branding: PrintBranding,
): Promise<void> {
  const filename = paintSubmittalFilename(
    project.job_name,
    project.job_number,
    data.submittal_number,
    data.submittal_type,
  );
  await downloadTradeSubmittalPdf({
    filename,
    project,
    branding,
    date: data.date,
    subject: data.subject,
    submittalNumber: data.submittal_number,
    revisionNumber: data.revision_number,
    revisionNote: data.revision_note,
    sections: buildPaintSubmittalSections(data),
  });
}

/** @deprecated Use downloadPaintSubmittal — kept for HTML preview helpers only. */
export function buildPaintSubmittalHtml(
  project: ProjectInfo,
  data: PaintSubmittalData,
  branding: PrintBranding,
  saveFilename?: string,
): string {
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

  const pageTitle = pdfTitleFromFilename(saveFilename ?? "Paint_Submittal");

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
  ${bodyTables}
  </div>
  <div class="print-footer-spacer" aria-hidden="true"></div>
  <div class="footer-section">${submittalFooterHtml(branding)}</div>
  </div>
</body></html>`;
}
