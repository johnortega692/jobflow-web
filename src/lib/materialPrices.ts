import { supabase } from "./supabase";

export type MaterialPriceSection = "sundry" | "paint_product";

export type MaterialPriceItem = {
  id: string;
  section: MaterialPriceSection;
  category: string;
  name: string;
  productId: string;
  unitCost: number | null;
  sheenCosts: Record<string, number>;
  sheens: string[];
  vendorNames: string[];
};

export type MaterialPriceDraft = {
  unitCost: string;
  sheenCosts: Record<string, string>;
};

type ListResult = {
  ok?: boolean;
  error?: string;
  items?: unknown;
};

type SaveResult = {
  ok?: boolean;
  error?: string;
  updated?: number;
};

type TaxResult = {
  ok?: boolean;
  error?: string;
  tax_percent?: number | string;
};

function asRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (key.trim() && Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export function moneyInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

export function draftFromItem(item: MaterialPriceItem): MaterialPriceDraft {
  const sheenCosts: Record<string, string> = {};
  for (const sheen of item.sheens) sheenCosts[sheen] = moneyInput(item.sheenCosts[sheen]);
  for (const [sheen, price] of Object.entries(item.sheenCosts)) {
    if (!(sheen in sheenCosts)) sheenCosts[sheen] = moneyInput(price);
  }
  return { unitCost: moneyInput(item.unitCost), sheenCosts };
}

/** Blank clears the price. Undefined means the text is not a price. */
/** Blank is not a tax rate. 0 turns tax off. Above 25 is rejected. */
export function parseTaxPercent(raw: string): number | null {
  const text = raw.trim().replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const n = Math.round(Number(text) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > 25) return null;
  return n;
}

export function parsePriceInput(raw: string): number | null | undefined {
  const text = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  return Math.round(Number(text) * 100) / 100;
}

export function parsePricePaste(text: string): { productId: string; price: string }[] {
  const rows: { productId: string; price: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(product|sku|item|name)\b/i.test(line)) continue;
    const parts = line.split(/\t|,|\s{2,}/).map((part) => part.trim()).filter(Boolean);
    const cells = parts.length >= 2 ? parts : line.split(/\s+/);
    if (cells.length < 2) continue;
    const price = cells[cells.length - 1]?.replace(/^\$/, "") ?? "";
    const productId = cells.slice(0, -1).join(" ").trim();
    if (!productId || !/^\d+(\.\d{1,2})?$/.test(price)) continue;
    rows.push({ productId, price });
  }
  return rows;
}

export async function listMaterialPrices(): Promise<MaterialPriceItem[]> {
  const { data, error } = await supabase.rpc("jobflow_admin_list_material_prices" as never);
  if (error) throw new Error(error.message);
  const result = data as ListResult | null;
  if (!result?.ok || !Array.isArray(result.items)) {
    throw new Error(result?.error || "Could not load material prices.");
  }
  return result.items.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const section = item.section === "paint_product" ? "paint_product" : item.section === "sundry" ? "sundry" : null;
    const id = typeof item.id === "string" ? item.id : "";
    const name = typeof item.name === "string" ? item.name : "";
    if (!section || !id || !name) return [];
    const unit = item.unit_cost == null || item.unit_cost === "" ? null : Number(item.unit_cost);
    return [{
      id,
      section,
      category: typeof item.category === "string" ? item.category : "",
      name,
      productId: typeof item.product_id === "string" ? item.product_id : "",
      unitCost: unit != null && Number.isFinite(unit) ? unit : null,
      sheenCosts: asRecord(item.sheen_costs),
      sheens: asStringList(item.sheens),
      vendorNames: asStringList(item.vendor_names),
    }];
  });
}

export async function saveMaterialPrices(
  rows: { id: string; section: MaterialPriceSection; unitCost: number | null; sheenCosts: Record<string, number> }[],
): Promise<number> {
  const payload = rows.map((row) =>
    row.section === "paint_product"
      ? { id: row.id, sheen_costs: row.sheenCosts }
      : { id: row.id, unit_cost: row.unitCost },
  );
  const { data, error } = await supabase.rpc("jobflow_admin_save_material_prices" as never, {
    p_rows: payload,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as SaveResult | null;
  if (!result?.ok) throw new Error(result?.error || "Could not save material prices.");
  return result.updated ?? rows.length;
}

function taxFromResult(result: TaxResult | null): number {
  const n = typeof result?.tax_percent === "number" ? result.tax_percent : Number(result?.tax_percent);
  return Number.isFinite(n) ? n : 10.25;
}

export async function getMaterialTax(): Promise<number> {
  const { data, error } = await supabase.rpc("jobflow_admin_material_tax" as never, {} as never);
  if (error) throw new Error(error.message);
  const result = data as TaxResult | null;
  if (!result?.ok) throw new Error(result?.error || "Could not load the sales tax.");
  return taxFromResult(result);
}

export async function saveMaterialTax(taxPercent: number): Promise<number> {
  const { data, error } = await supabase.rpc("jobflow_admin_material_tax" as never, {
    p_tax_percent: taxPercent,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as TaxResult | null;
  if (!result?.ok) throw new Error(result?.error || "Could not save the sales tax.");
  return taxFromResult(result);
}
