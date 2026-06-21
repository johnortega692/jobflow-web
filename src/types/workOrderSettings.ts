/** Work Order Manager — user_settings keys and defaults (desktop materials.txt / labor_rates.txt). */

export type WorkOrderMaterialCatalogItem = {
  name: string;
  price: number;
  markup_percent: number;
  tax_percent: number;
  category: string;
};

export type WorkOrderLaborRateItem = {
  name: string;
  billing_rate: number;
  raw_cost_per_hour: number;
};

export type WorkOrderFontSettings = {
  material: number;
  labor: number;
  material_total1: number;
  material_total2: number;
  labor_total: number;
  labor_total2: number;
  grand_total: number;
  overlay_color: string;
};

export const WORK_ORDER_MATERIALS_KEY = "work_order_materials";
export const WORK_ORDER_LABOR_RATES_KEY = "work_order_labor_rates";
export const WORK_ORDER_FONTS_KEY = "work_order_fonts";
export const WORK_ORDER_DISPLAY_KEY = "work_order_display";
export const WORK_ORDER_SCAN_BOXES_KEY = "work_order_scan_boxes";
export const WORK_ORDER_TOTAL_POSITIONS_KEY = "work_order_total_positions";
export const WORK_ORDER_TEXT_SPACING_KEY = "work_order_text_spacing";

export const DEFAULT_WORK_ORDER_MATERIALS: WorkOrderMaterialCatalogItem[] = [
  { name: "DTM Primer", price: 46.55, markup_percent: 0, tax_percent: 0, category: "Primer" },
  { name: "Eggshell Paint", price: 41.45, markup_percent: 0, tax_percent: 0, category: "Paint" },
  { name: "White Paint", price: 35.99, markup_percent: 0, tax_percent: 0, category: "Paint" },
  { name: "Gray Paint", price: 38.99, markup_percent: 0, tax_percent: 0, category: "Paint" },
];

export const DEFAULT_WORK_ORDER_LABOR_RATES: WorkOrderLaborRateItem[] = [
  { name: "Journeyman Reg", billing_rate: 129.61, raw_cost_per_hour: 65 },
  { name: "Journeyman 1.5", billing_rate: 165.05, raw_cost_per_hour: 72 },
  { name: "Journeyman DD", billing_rate: 205.1, raw_cost_per_hour: 85 },
  { name: "Forman Reg", billing_rate: 140.6, raw_cost_per_hour: 96 },
  { name: "Forman 1.5", billing_rate: 176.05, raw_cost_per_hour: 105 },
  { name: "Forman DD", billing_rate: 216.1, raw_cost_per_hour: 110 },
  { name: "Budget Rate 1", billing_rate: 96, raw_cost_per_hour: 65 },
  { name: "Budget Rate 2", billing_rate: 91, raw_cost_per_hour: 65 },
];

export function defaultWorkOrderFontSettings(): WorkOrderFontSettings {
  return {
    material: 14,
    labor: 14,
    material_total1: 14,
    material_total2: 14,
    labor_total: 14,
    labor_total2: 14,
    grand_total: 14,
    overlay_color: "#FF0000",
  };
}

export function normalizeMaterialCatalog(raw: unknown): WorkOrderMaterialCatalogItem[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORK_ORDER_MATERIALS];
  const items = raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      if (!name) return null;
      return {
        name,
        price: Number(o.price) || 0,
        markup_percent: Number(o.markup_percent) || 0,
        tax_percent: Number(o.tax_percent) || 0,
        category: String(o.category ?? "General").trim() || "General",
      };
    })
    .filter((x): x is WorkOrderMaterialCatalogItem => x !== null);
  return items.length ? items : [...DEFAULT_WORK_ORDER_MATERIALS];
}

export function normalizeLaborRates(raw: unknown): WorkOrderLaborRateItem[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORK_ORDER_LABOR_RATES];
  const items = raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      if (!name) return null;
      return {
        name,
        billing_rate: Number(o.billing_rate ?? o.rate) || 0,
        raw_cost_per_hour: Number(o.raw_cost_per_hour) || 0,
      };
    })
    .filter((x): x is WorkOrderLaborRateItem => x !== null);
  return items.length ? items : [...DEFAULT_WORK_ORDER_LABOR_RATES];
}

export function normalizeFontSettings(raw: unknown): WorkOrderFontSettings {
  const base = defaultWorkOrderFontSettings();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const num = (key: keyof WorkOrderFontSettings, fallback: number) => {
    const v = Number(o[key]);
    return v > 0 ? v : fallback;
  };
  return {
    material: num("material", base.material),
    labor: num("labor", base.labor),
    material_total1: num("material_total1", base.material_total1),
    material_total2: num("material_total2", base.material_total2),
    labor_total: num("labor_total", base.labor_total),
    labor_total2: num("labor_total2", base.labor_total2),
    grand_total: num("grand_total", base.grand_total),
    overlay_color: String(o.overlay_color ?? base.overlay_color),
  };
}

export function materialUnitPrice(item: WorkOrderMaterialCatalogItem): number {
  const withMarkup = item.price * (1 + item.markup_percent / 100);
  return withMarkup * (1 + item.tax_percent / 100);
}
