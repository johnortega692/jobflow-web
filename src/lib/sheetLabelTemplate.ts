/** Letter sheet of labels. Measurements are inches. More templates can be added to the list. */
export type SheetLabelTemplate = {
  id: string;
  name: string;
  pageWidthIn: number;
  pageHeightIn: number;
  columns: number;
  rows: number;
  labelWidthIn: number;
  labelHeightIn: number;
  marginTopIn: number;
  marginLeftIn: number;
  columnGapIn: number;
  rowGapIn: number;
};

export const SHEET_LABEL_TEMPLATES: SheetLabelTemplate[] = [
  {
    id: "avery-5163",
    name: "Avery 5163 / 8163 compatible",
    pageWidthIn: 8.5,
    pageHeightIn: 11,
    columns: 2,
    rows: 5,
    labelWidthIn: 4,
    labelHeightIn: 2,
    marginTopIn: 0.5,
    marginLeftIn: 0.15625,
    columnGapIn: 0.1875,
    rowGapIn: 0,
  },
];

export const DEFAULT_SHEET_LABEL_TEMPLATE = SHEET_LABEL_TEMPLATES[0]!;

/** 4" × 2" at 300 dpi. */
export const SHEET_LABEL_DPI = 300;
export const SHEET_LABEL_PX_W = 1200;
export const SHEET_LABEL_PX_H = 600;
/** Left column share of the sheet label. Divider sits on the column's right edge. */
export const SHEET_LABEL_COLUMN_RATIO = 0.26;
export const SHEET_LABEL_COLUMN_PAD = 15;

export function sheetLabelTemplateById(id: string | undefined): SheetLabelTemplate {
  return SHEET_LABEL_TEMPLATES.find((template) => template.id === id) ?? DEFAULT_SHEET_LABEL_TEMPLATE;
}

export type SheetSlotKind = "used" | "empty" | "label";

export type SheetSlot = {
  /** 0-based index on the page, left to right, top to bottom. */
  index: number;
  xIn: number;
  yIn: number;
  kind: SheetSlotKind;
  /** Index into the label list when kind is "label". */
  labelIndex?: number;
};

export function sheetSlotsPerPage(template: SheetLabelTemplate): number {
  return template.columns * template.rows;
}

/** Pages of slots. Spots before `startAt` (1-based) on the first page are used blanks. Later pages start at spot 1. */
export function layoutSheetPages(template: SheetLabelTemplate, labelCount: number, startAt: number): SheetSlot[][] {
  const per = sheetSlotsPerPage(template);
  const start = Math.min(per, Math.max(1, Math.floor(startAt) || 1));
  const pages: SheetSlot[][] = [];
  let labelIndex = 0;
  let page = 0;
  while (labelIndex < labelCount || page === 0) {
    const slots: SheetSlot[] = [];
    for (let index = 0; index < per; index++) {
      const col = index % template.columns;
      const row = Math.floor(index / template.columns);
      const xIn = template.marginLeftIn + col * (template.labelWidthIn + template.columnGapIn);
      const yIn = template.marginTopIn + row * (template.labelHeightIn + template.rowGapIn);
      const skip = page === 0 && index < start - 1;
      let kind: SheetSlotKind = "empty";
      let assigned: number | undefined;
      if (skip) kind = "used";
      else if (labelIndex < labelCount) {
        kind = "label";
        assigned = labelIndex;
        labelIndex += 1;
      }
      slots.push({ index, xIn, yIn, kind, labelIndex: assigned });
    }
    pages.push(slots);
    page += 1;
    if (labelCount === 0) break;
  }
  return pages;
}
