import { supabase } from "./supabase";

export type MaterialPriceSection = "sundry" | "paint_product";

export type MaterialPriceItem = {
  id: string;
  section: MaterialPriceSection;
  category: string;
  name: string;
  productId: string;
  akas: string[];
  nickname: string;
  unitCost: number | null;
  sheenCosts: Record<string, number>;
  sheens: string[];
  vendorNames: string[];
};

export type MaterialPriceDraft = {
  unitCost: string;
  sheenCosts: Record<string, string>;
  productId: string;
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
  return { unitCost: moneyInput(item.unitCost), sheenCosts, productId: item.productId };
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

function itemFromRow(row: unknown): MaterialPriceItem | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const section = item.section === "paint_product" ? "paint_product" : item.section === "sundry" ? "sundry" : null;
  const id = typeof item.id === "string" ? item.id : "";
  const name = typeof item.name === "string" ? item.name : "";
  if (!section || !id || !name) return null;
  const unit = item.unit_cost == null || item.unit_cost === "" ? null : Number(item.unit_cost);
  return {
    id,
    section,
    category: typeof item.category === "string" ? item.category : "",
    name,
    productId: typeof item.product_id === "string" ? item.product_id : "",
    akas: asStringList(item.akas),
    nickname: typeof item.nickname === "string" ? item.nickname : "",
    unitCost: unit != null && Number.isFinite(unit) ? unit : null,
    sheenCosts: asRecord(item.sheen_costs),
    sheens: asStringList(item.sheens),
    vendorNames: asStringList(item.vendor_names),
  };
}

export async function listSundryCategories(): Promise<string[]> {
  const { data, error } = await supabase.rpc("jobflow_admin_list_sundry_categories" as never);
  if (error) throw new Error(error.message);
  const result = data as { ok?: boolean; error?: string; categories?: unknown } | null;
  if (!result?.ok || !Array.isArray(result.categories)) {
    throw new Error(result?.error || "Could not load sundry categories.");
  }
  return result.categories.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
}

export async function listMaterialPrices(): Promise<MaterialPriceItem[]> {
  const { data, error } = await supabase.rpc("jobflow_admin_list_material_prices" as never);
  if (error) throw new Error(error.message);
  const result = data as ListResult | null;
  if (!result?.ok || !Array.isArray(result.items)) {
    throw new Error(result?.error || "Could not load material prices.");
  }
  return result.items.flatMap((row) => {
    const item = itemFromRow(row);
    return item ? [item] : [];
  });
}

export type SundryLibraryPhoto = {
  id: string;
  name: string;
  imageUrl: string;
};

export async function listSundryPhotos(query: string, after: string | null): Promise<{ photos: SundryLibraryPhoto[]; next: string | null }> {
  const { data, error } = await supabase.rpc("jobflow_admin_list_sundry_photos" as never, {
    p_query: query,
    p_after: after,
    p_limit: 20,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as { ok?: boolean; error?: string; photos?: unknown; next?: unknown } | null;
  if (!result?.ok || !Array.isArray(result.photos)) {
    throw new Error(result?.error || "Could not load the photo library.");
  }
  const photos = result.photos.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const photo = row as Record<string, unknown>;
    const id = typeof photo.id === "string" ? photo.id : "";
    const imageUrl = typeof photo.image_url === "string" ? photo.image_url : "";
    const name = typeof photo.name === "string" ? photo.name.trim() : "";
    return id && imageUrl.startsWith("data:image/") ? [{ id, name: name || "Photo", imageUrl }] : [];
  });
  return { photos, next: typeof result.next === "string" ? result.next : null };
}

export async function addMaterialPriceItem(input: {
  section: MaterialPriceSection;
  name: string;
  category: string;
  productId: string;
  vendorName: string;
  unitCost: string;
  imageUrl?: string;
}): Promise<MaterialPriceItem> {
  const payload: Record<string, string> = {
    section: input.section,
    name: input.name.trim(),
    category: input.category.trim(),
    product_id: input.productId.trim(),
    vendor_name: input.vendorName.trim(),
  };
  const price = input.unitCost.trim().replace(/^\$/, "");
  if (input.section === "sundry" && price) payload.unit_cost = price;
  if (input.section === "sundry" && input.imageUrl?.trim()) payload.image_url = input.imageUrl.trim();
  const { data, error } = await supabase.rpc("jobflow_admin_add_material_item" as never, {
    p_item: payload,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as { ok?: boolean; error?: string; item?: unknown } | null;
  const item = result?.ok ? itemFromRow(result.item) : null;
  if (!item) throw new Error(result?.error || "Could not add that item.");
  return item;
}

export async function saveMaterialAkas(id: string, akas: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc("jobflow_admin_set_material_akas" as never, {
    p_id: id,
    p_akas: akas,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as { ok?: boolean; error?: string; akas?: unknown } | null;
  if (!result?.ok) throw new Error(result?.error || "Could not save those AKAs.");
  return asStringList(result.akas);
}

export async function saveMaterialPrices(
  rows: { id: string; section: MaterialPriceSection; unitCost: number | null; sheenCosts: Record<string, number>; productId: string; name?: string }[],
): Promise<number> {
  const payload = rows.map((row) => {
    const price = row.section === "paint_product"
      ? { id: row.id, sheen_costs: row.sheenCosts, product_id: row.productId }
      : { id: row.id, unit_cost: row.unitCost, product_id: row.productId };
    return row.name == null ? price : { ...price, name: row.name };
  });
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
