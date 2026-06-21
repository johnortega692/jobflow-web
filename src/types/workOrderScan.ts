/** PDF-space rectangle for OCR scan regions (matches desktop bounding_boxes.txt). */
export type ScanBBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ScanEnhanceSettings = {
  /** Darken ink / raise black point (0–100). */
  ink: number;
  /** Lighten paper / lower white point (0–100). */
  paper: number;
  /** Contrast boost (0–100; 50 = identity). */
  contrast: number;
  /** Sharpness (0–100; 50 = identity). */
  sharpness: number;
};

export type WorkOrderDisplayPrefs = {
  show_material_names: boolean;
  show_material_quantity: boolean;
  show_hours: boolean;
  show_supervision_hours: boolean;
  show_total_labels: boolean;
  /** Show labor rate name (e.g. Journeyman Reg) on document rows. */
  show_labor_names: boolean;
  /** Include Material/Labor/Grand total labels on exported PDFs. */
  export_totals: boolean;
  /** Inline total above material table (Material Total 1). */
  show_material_total_1: boolean;
  /** Inline total in labor section (Labor Total). */
  show_labor_total: boolean;
};

export type WorkOrderScanBoxes = {
  ewo: ScanBBox | null;
  job: ScanBBox | null;
  date: ScanBBox | null;
  /** Page size when boxes were saved — scales boxes on different raster sizes. */
  template_width: number;
  template_height: number;
};

export type ScanBoxKind = "ewo" | "job" | "date";

export const DEFAULT_SCAN_ENHANCE: ScanEnhanceSettings = {
  ink: 0,
  paper: 0,
  contrast: 50,
  sharpness: 50,
};

export const DEFAULT_DISPLAY_PREFS: WorkOrderDisplayPrefs = {
  show_material_names: true,
  show_material_quantity: true,
  show_hours: true,
  show_supervision_hours: true,
  show_total_labels: true,
  show_labor_names: true,
  export_totals: false,
  show_material_total_1: true,
  show_labor_total: true,
};

export const DEFAULT_EWO_SCAN_BOX: ScanBBox = { x1: 450, y1: 40, x2: 550, y2: 80 };
export const DEFAULT_JOB_SCAN_BOX: ScanBBox = { x1: 465, y1: 135, x2: 615, y2: 165 };
/** Typical header date field — left of EWO # on standard C&D-style forms. */
export const DEFAULT_EWO_DATE_SCAN_BOX: ScanBBox = { x1: 300, y1: 38, x2: 430, y2: 88 };

export function defaultWorkOrderScanBoxes(pageWidth = 612, pageHeight = 792): WorkOrderScanBoxes {
  return {
    ewo: null,
    job: null,
    date: null,
    template_width: pageWidth,
    template_height: pageHeight,
  };
}

export function normalizeScanBBox(raw: unknown): ScanBBox | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x1 = Number(o.x1);
  const y1 = Number(o.y1);
  const x2 = Number(o.x2);
  const y2 = Number(o.y2);
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null;
  return { x1, y1, x2, y2 };
}

export function normalizeScanEnhance(raw: unknown): ScanEnhanceSettings {
  const base = DEFAULT_SCAN_ENHANCE;
  if (!raw || typeof raw !== "object") return { ...base };
  const o = raw as Record<string, unknown>;
  const clamp = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
  };
  return {
    ink: clamp(o.ink, base.ink),
    paper: clamp(o.paper, base.paper),
    contrast: clamp(o.contrast, base.contrast),
    sharpness: clamp(o.sharpness, base.sharpness),
  };
}

export function normalizeDisplayPrefs(raw: unknown): WorkOrderDisplayPrefs {
  const base = DEFAULT_DISPLAY_PREFS;
  if (!raw || typeof raw !== "object") return { ...base };
  const o = raw as Record<string, unknown>;
  return {
    show_material_names: o.show_material_names != null ? Boolean(o.show_material_names) : base.show_material_names,
    show_material_quantity:
      o.show_material_quantity != null ? Boolean(o.show_material_quantity) : base.show_material_quantity,
    show_hours: o.show_hours != null ? Boolean(o.show_hours) : base.show_hours,
    show_supervision_hours:
      o.show_supervision_hours != null ? Boolean(o.show_supervision_hours) : base.show_supervision_hours,
    show_total_labels: o.show_total_labels != null ? Boolean(o.show_total_labels) : base.show_total_labels,
    show_labor_names: o.show_labor_names != null ? Boolean(o.show_labor_names) : base.show_labor_names,
    export_totals: o.export_totals != null ? Boolean(o.export_totals) : base.export_totals,
    show_material_total_1:
      o.show_material_total_1 != null ? Boolean(o.show_material_total_1) : base.show_material_total_1,
    show_labor_total: o.show_labor_total != null ? Boolean(o.show_labor_total) : base.show_labor_total,
  };
}

export function normalizeScanBoxes(raw: unknown, pageWidth = 612, pageHeight = 792): WorkOrderScanBoxes {
  const base = defaultWorkOrderScanBoxes(pageWidth, pageHeight);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    ewo: normalizeScanBBox(o.ewo),
    job: normalizeScanBBox(o.job),
    date: normalizeScanBBox(o.date),
    template_width: Number(o.template_width) || pageWidth,
    template_height: Number(o.template_height) || pageHeight,
  };
}

export function isDefaultScanEnhance(s: ScanEnhanceSettings): boolean {
  return (
    s.ink === DEFAULT_SCAN_ENHANCE.ink &&
    s.paper === DEFAULT_SCAN_ENHANCE.paper &&
    s.contrast === DEFAULT_SCAN_ENHANCE.contrast &&
    s.sharpness === DEFAULT_SCAN_ENHANCE.sharpness
  );
}
