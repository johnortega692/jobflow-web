import {
  esc,
  groupByFloor,
  logoBlock,
  submittalRevisionNoteHtml,
  submittalSubjectSpecBannerHtml,
  SUBMITTAL_SIGNATURE_FOOTER_CSS,
  submittalDateSectionHtml,
  submittalFooterHtml,
  submittalProjectInfoHtml,
  type PrintBranding,
} from "./printCore";
import { pdfTitleFromFilename, wallcoveringSubmittalFilename } from "./pdfFilenames";
import type { ProjectPrintInfo } from "./jobInfo";
import {
  paintSpecSectionShortLabel,
  wcDualSpecEnabled,
  wcItemSpecScope,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments";
import { downloadTradeSubmittalPdf, type SubmittalPdfFloorSection } from "./tradeSubmittalPdf";
import { isTrackInfillItem } from "./wcTrackInfill";

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

function wcPrintableItems(items: WallcoveringItem[]): WallcoveringItem[] {
  return items.filter(
    (i) =>
      !isTrackInfillItem(i) &&
      i.include_in_submittal !== false &&
      (i.manufacturer.trim() || i.color.trim() || i.label.trim()),
  );
}

function wcSectionColumns(substitution: boolean): Pick<SubmittalPdfFloorSection, "columns" | "colWeights"> {
  return substitution
    ? {
        columns: ["#", "Label", "Previous", "New Color", "Manufacturer", "Product", "Qty"],
        colWeights: [0.05, 0.1, 0.2, 0.2, 0.18, 0.17, 0.1],
      }
    : {
        columns: ["#", "Manufacturer", "Product", "Color", "Label", "Qty"],
        colWeights: [0.05, 0.22, 0.22, 0.26, 0.15, 0.1],
      };
}

function wcItemRowsForPdf(items: WallcoveringItem[], substitution: boolean): string[][] {
  return items.map((item, i) => {
    if (substitution) {
      return [
        String(i + 1),
        item.label.trim(),
        item.previous_color.trim(),
        item.color.trim(),
        item.manufacturer.trim(),
        item.product.trim(),
        item.qty.trim(),
      ];
    }
    return [
      String(i + 1),
      item.manufacturer.trim(),
      item.product.trim(),
      item.color.trim(),
      item.label.trim(),
      item.qty.trim(),
    ];
  });
}

export function buildWallcoveringSubmittalSections(
  data: WallcoveringSubmittalData,
): SubmittalPdfFloorSection[] {
  const substitution = data.submittal_type === "substitution";
  const cols = wcSectionColumns(substitution);
  const items = wcPrintableItems(data.items);
  const secondaryOn = wcDualSpecEnabled(data);
  const primaryItems = secondaryOn
    ? items.filter((i) => wcItemSpecScope(i) === "primary")
    : items;
  const secondaryItems = secondaryOn
    ? items.filter((i) => wcItemSpecScope(i) === "secondary")
    : [];

  const primaryGroups = groupByFloor(primaryItems);

  const sections: SubmittalPdfFloorSection[] = primaryGroups
    .filter(([, floorItems]) => floorItems.length > 0)
    .map(([floor, floorItems]) => ({
      floorLabel: floor || undefined,
      ...cols,
      rows: wcItemRowsForPdf(floorItems, substitution),
    }));

  if (secondaryItems.length) {
    sections.push({
      bannerSubject: paintSpecSectionShortLabel(data.spec_sections?.[1] ?? ""),
      bannerSpec: data.spec_sections?.[1],
      ...cols,
      rows: wcItemRowsForPdf(secondaryItems, substitution),
    });
  }

  return sections;
}

export async function downloadWallcoveringSubmittal(
  project: ProjectInfo,
  data: WallcoveringSubmittalData,
  branding: PrintBranding,
): Promise<void> {
  const filename = wallcoveringSubmittalFilename(
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
    sections: buildWallcoveringSubmittalSections(data),
  });
}

export function buildWallcoveringSubmittalHtml(
  project: ProjectInfo,
  data: WallcoveringSubmittalData,
  branding: PrintBranding,
  saveFilename?: string,
): string {
  const substitution = data.submittal_type === "substitution";
  const items = wcPrintableItems(data.items);
  const secondaryOn = wcDualSpecEnabled(data);
  const primaryItems = secondaryOn
    ? items.filter((i) => wcItemSpecScope(i) === "primary")
    : items;
  const secondaryItems = secondaryOn
    ? items.filter((i) => wcItemSpecScope(i) === "secondary")
    : [];

  const primaryGroups = groupByFloor(primaryItems);

  const primaryTables =
    primaryGroups.length === 0 || primaryItems.length === 0
      ? ""
      : primaryGroups
          .filter(([, floorItems]) => floorItems.length > 0)
          .map(
            ([floor, floorItems]) => `
      ${floor ? `<div class="floor-section-title">${esc(floor.toUpperCase())}</div>` : ""}
      <table>
        <thead>${wcTableHead(substitution)}</thead>
        <tbody>${wcRows(floorItems, substitution)}</tbody>
      </table>`,
          )
          .join("");

  const secondaryTables =
    secondaryItems.length === 0
      ? ""
      : `${submittalSubjectSpecBannerHtml(
          paintSpecSectionShortLabel(data.spec_sections?.[1] ?? ""),
          data.spec_sections?.[1] ?? "",
        )}
      <table>
        <thead>${wcTableHead(substitution)}</thead>
        <tbody>${wcRows(secondaryItems, substitution)}</tbody>
      </table>`;

  const bodyTables =
    !primaryTables && !secondaryTables
      ? `<div style="text-align:center;color:#999;font-style:italic;padding:30px;">No wallcovering items.</div>`
      : `${primaryTables}${secondaryTables}`;

  const pageTitle = pdfTitleFromFilename(saveFilename ?? "Wallcovering_Submittal");

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
