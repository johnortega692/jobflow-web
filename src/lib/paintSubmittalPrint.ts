import {
  esc,
  logoBlock,
  submittalRevisionNoteHtml,
  submittalSubjectSpecBannerHtml,
  SUBMITTAL_SIGNATURE_FOOTER_CSS,
  submittalDateSectionHtml,
  submittalFooterHtml,
  submittalProjectInfoHtml,
  type PrintBranding,
} from "./printCore";
import { paintSubmittalFilename, pdfTitleFromFilename } from "./pdfFilenames";
import type { ProjectPrintInfo } from "./jobInfo";
import type { PaintItem, PaintSubmittalData } from "../types/tradeDocuments";
import {
  paintItemSpecScope,
  paintSecondarySpecEnabled,
  paintSecondarySpecLabel,
} from "../types/tradeDocuments";
import { downloadTradeSubmittalPdf, type SubmittalPdfFloorSection } from "./tradeSubmittalPdf";
import { paintRevisionChangeLabel } from "./paintBrushouts";

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
.subject-spec-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  background: #f0f0f0;
  border-left: 4px solid #1f1f1f;
  padding: 6px 12px;
  margin: 12px 0 8px;
  font-size: 11pt;
  line-height: 1.3;
}
.subject-spec-bar-subject { font-weight: bold; color: #000; }
.subject-spec-bar-sep { color: #444; }
.subject-spec-bar-spec { font-weight: normal; color: #444; }
.floor-section-title { font-weight: bold; font-size: 11pt; margin: 18px 0 8px; color: #333; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
table th { background: #333; color: #fff; padding: 6px 10px; text-align: left; font-size: 10pt; }
table td { padding: 6px 10px; border: 1px solid #ddd; font-size: 10pt; vertical-align: top; overflow-wrap: break-word; word-wrap: break-word; }
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

function paintTableRows(
  items: PaintItem[],
  isSub: boolean,
  previousItems: PaintItem[],
  showLocation: boolean,
): string {
  const markRevision = !isSub && previousItems.some((row) => row.color.trim() || row.label.trim());
  return items
    .map((item, i) => {
      const displayColor = item.color.trim();
      const locationCell = showLocation ? `<td>${esc(item.floor)}</td>` : "";
      if (isSub) {
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(item.label)}</td>
          ${locationCell}
          <td>${esc(item.previous_color)}</td>
          <td><strong>${esc(displayColor)}</strong></td>
          <td>${esc(item.product)}</td>
          <td>${esc(item.sheen)}</td>
        </tr>`;
      }
      const change = markRevision ? paintRevisionChangeLabel(item, previousItems) : null;
      const changeCell =
        change === "NEW" || change === "REVISED" || change === "Removed"
          ? `<td><strong>${esc(change)}</strong></td>`
          : change
            ? `<td>${esc(change)}</td>`
            : "";
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(item.label)}</td>
        ${locationCell}
        <td><strong>${esc(displayColor)}</strong></td>
        <td>${esc(item.product)}</td>
        <td>${esc(item.sheen)}</td>
        ${changeCell}
      </tr>`;
    })
    .join("");
}

function paintTableHead(isSub: boolean, markRevision: boolean, showLocation: boolean): string {
  const locationHead = showLocation ? `<th>Location</th>` : "";
  if (isSub) {
    return `<tr>
      <th style="width:5%">#</th>
      <th>Label</th>
      ${locationHead}
      <th>Previous Color</th>
      <th>New Color</th>
      <th>Product</th>
      <th>Sheen</th>
    </tr>`;
  }
  if (markRevision) {
    return `<tr>
      <th style="width:5%">#</th>
      <th>Label</th>
      ${locationHead}
      <th>Color</th>
      <th>Product</th>
      <th>Sheen</th>
      <th>Status</th>
    </tr>`;
  }
  return `<tr>
    <th style="width:5%">#</th>
    <th>Label</th>
    ${locationHead}
    <th>Color</th>
    <th>Product</th>
    <th>Sheen</th>
  </tr>`;
}

function paintItemRowsForPdf(
  items: PaintItem[],
  isSub: boolean,
  previousItems: PaintItem[],
  showLocation: boolean,
): string[][] {
  const markRevision = !isSub && previousItems.some((row) => row.color.trim() || row.label.trim());
  return items.map((item, i) => {
    const displayColor = item.color.trim();
    const location = showLocation ? [item.floor.trim()] : [];
    if (isSub) {
      return [
        String(i + 1),
        item.label.trim(),
        ...location,
        item.previous_color.trim(),
        displayColor,
        item.product.trim(),
        item.sheen.trim(),
      ];
    }
    const row = [
      String(i + 1),
      item.label.trim(),
      ...location,
      displayColor,
      item.product.trim(),
      item.sheen.trim(),
    ];
    if (markRevision) row.push(paintRevisionChangeLabel(item, previousItems) ?? "");
    return row;
  });
}

const PAINT_WRAP_HEADERS = new Set(["Location", "Color", "Product", "Sheen", "Previous Color", "New Color"]);

function paintSectionColumns(
  isSub: boolean,
  markRevision: boolean,
  showLocation: boolean,
): Pick<SubmittalPdfFloorSection, "columns" | "colWeights" | "wrapColumns"> {
  const location = showLocation ? ["Location"] : [];
  const columns = isSub
    ? ["#", "Label", ...location, "Previous Color", "New Color", "Product", "Sheen"]
    : markRevision
      ? ["#", "Label", ...location, "Color", "Product", "Sheen", "Status"]
      : ["#", "Label", ...location, "Color", "Product", "Sheen"];
  const colWeights = isSub
    ? showLocation
      ? [0.05, 0.08, 0.2, 0.16, 0.18, 0.22, 0.11]
      : [0.06, 0.1, 0.22, 0.24, 0.26, 0.12]
    : markRevision
      ? showLocation
        ? [0.05, 0.08, 0.2, 0.22, 0.18, 0.1, 0.17]
        : [0.06, 0.1, 0.28, 0.24, 0.12, 0.2]
      : showLocation
        ? [0.06, 0.1, 0.19, 0.28, 0.25, 0.12]
        : [0.07, 0.12, 0.34, 0.3, 0.17];
  return {
    columns,
    colWeights,
    wrapColumns: columns.flatMap((name, index) => (PAINT_WRAP_HEADERS.has(name) ? [index] : [])),
  };
}

export function buildPaintSubmittalSections(
  data: PaintSubmittalData,
  previousItems: PaintItem[] = [],
): SubmittalPdfFloorSection[] {
  const isSub = data.submittal_type === "substitution";
  const markRevision = !isSub && previousItems.some((row) => row.color.trim() || row.label.trim());
  const showLocation = data.show_floor === true;
  const cols = paintSectionColumns(isSub, markRevision, showLocation);
  const items = data.items.filter((i) => !i.pdf_hidden && (i.color.trim() || i.label.trim()));
  const secondaryOn = paintSecondarySpecEnabled(data);
  const primaryItems = secondaryOn
    ? items.filter((i) => paintItemSpecScope(i) === "primary")
    : items;
  const secondaryItems = secondaryOn
    ? items.filter((i) => paintItemSpecScope(i) === "secondary")
    : [];

  const sections: SubmittalPdfFloorSection[] = [];
  if (primaryItems.length) {
    sections.push({
      ...cols,
      rows: paintItemRowsForPdf(primaryItems, isSub, previousItems, showLocation),
    });
  }

  if (secondaryItems.length) {
    const secondaryCols = paintSectionColumns(isSub, markRevision, false);
    sections.push({
      bannerSubject: paintSecondarySpecLabel(data),
      bannerSpec: data.spec_section_secondary,
      ...secondaryCols,
      rows: paintItemRowsForPdf(secondaryItems, isSub, previousItems, false),
    });
  }

  return sections;
}

export async function downloadPaintSubmittal(
  project: ProjectInfo,
  data: PaintSubmittalData,
  branding: PrintBranding,
  previousItems: PaintItem[] = [],
  relatedNote?: string,
): Promise<void> {
  const filename = paintSubmittalFilename(
    project.job_name,
    project.job_number,
    data.submittal_number,
    data.submittal_type,
    data.spec_section,
  );
  await downloadTradeSubmittalPdf({
    filename,
    project,
    branding,
    date: data.date,
    subject: data.subject,
    specSection: data.spec_section,
    submittalNumber: data.submittal_number,
    revisionNumber: data.revision_number,
    revisionNote: data.revision_note,
    submittalType: data.submittal_type,
    relatedNote,
    sections: buildPaintSubmittalSections(data, previousItems),
  });
}

/** @deprecated Use downloadPaintSubmittal — kept for HTML preview helpers only. */
export function buildPaintSubmittalHtml(
  project: ProjectInfo,
  data: PaintSubmittalData,
  branding: PrintBranding,
  saveFilename?: string,
  previousItems: PaintItem[] = [],
): string {
  const isSub = data.submittal_type === "substitution";
  const markRevision = !isSub && previousItems.some((row) => row.color.trim() || row.label.trim());
  const items = data.items.filter((i) => !i.pdf_hidden && (i.color.trim() || i.label.trim()));
  const secondaryOn = paintSecondarySpecEnabled(data);
  const primaryItems = secondaryOn
    ? items.filter((i) => paintItemSpecScope(i) === "primary")
    : items;
  const secondaryItems = secondaryOn
    ? items.filter((i) => paintItemSpecScope(i) === "secondary")
    : [];

  const showLocation = data.show_floor === true;
  const primaryTables = primaryItems.length
    ? `<table><thead>${paintTableHead(isSub, markRevision, showLocation)}</thead><tbody>${paintTableRows(primaryItems, isSub, previousItems, showLocation)}</tbody></table>`
    : "";

  const secondaryTables =
    secondaryItems.length === 0
      ? ""
      : `${submittalSubjectSpecBannerHtml(paintSecondarySpecLabel(data), data.spec_section_secondary ?? "")}
      <table><thead>${paintTableHead(isSub, markRevision, false)}</thead><tbody>${paintTableRows(secondaryItems, isSub, previousItems, false)}</tbody></table>`;

  const bodyTables =
    !primaryTables && !secondaryTables
      ? `<div style="text-align:center;color:#999;font-style:italic;padding:30px;">No paint items.</div>`
      : `${primaryTables}${secondaryTables}`;

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
    ${submittalRevisionNoteHtml(data.revision_number, data.revision_note, data.submittal_type)}
  </div>
  ${submittalSubjectSpecBannerHtml(data.subject, data.spec_section)}
  ${bodyTables}
  </div>
  <div class="print-footer-spacer" aria-hidden="true"></div>
  <div class="footer-section">${submittalFooterHtml(branding)}</div>
  </div>
</body></html>`;
}
