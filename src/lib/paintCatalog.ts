/** Paint product / sheen / color catalogs. Products and sheens come from Field Tools. */

import { loadRawUserSettings, patchOrgSettings } from "./budgetLibrary";
import { supabase } from "./supabase";

export type PaintProduct = { product: string; manufacturer: string; sheens?: string[] };

export const PAINT_PRODUCTS_KEY = "paint_products";
export const PAINT_SHEENS_KEY = "paint_sheens";
export const PAINT_SUBMITTAL_HIDDEN_PRODUCTS_KEY = "paint_submittal_hidden_products";

export const PAINT_MANUFACTURER_OPTIONS = ["PPG", "SW", "BM", "DE", "BEHR", "Vista"] as const;
export type PaintColorEntry = { number: string; name: string; hex?: string };
export type PaintColorsDb = Record<string, PaintColorEntry[]>;
export type PaintColorMatch = { display: string; vendor: string; hex: string };

const PREFIX_MAP: Record<string, string> = {
  BM: "BM",
  DE: "DE",
  BEHR: "BEHR",
  SW: "SW",
  PPG: "PPG",
  VISTA: "Vista",
  SherwinWilliams: "SW",
  BenjaminMoore: "BM",
  Vista: "Vista",
};

const FIELD_TOOLS_VENDOR_TO_MFR: Record<string, string> = {
  "ppg paints": "PPG",
  ppg: "PPG",
  "sherwin williams": "SW",
  "sherwin-williams": "SW",
  sw: "SW",
  "benjamin moore": "BM",
  bm: "BM",
  "dunn edwards": "DE",
  "dunn-edwards": "DE",
  de: "DE",
  "vista paints": "Vista",
  vista: "Vista",
  behr: "BEHR",
};

let defaultProductsCache: PaintProduct[] | null = null;
let defaultSheensCache: string[] | null = null;
let fieldToolsCatalogCache: FieldToolsPaintCatalog | null = null;
let fieldToolsCatalogPromise: Promise<FieldToolsPaintCatalog> | null = null;
let hiddenPaintProductsCache: { userId: string; names: string[] } | null = null;
let colorsCache: PaintColorsDb | null = null;
let colorsLoadPromise: Promise<PaintColorsDb> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json() as Promise<T>;
}

export function normalizePaintProducts(raw: unknown): PaintProduct[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const o = item as Record<string, unknown>;
      const product = typeof o.product === "string" ? o.product.trim() : "";
      const manufacturer = typeof o.manufacturer === "string" ? o.manufacturer.trim() : "";
      if (!product) return null;
      return { product, manufacturer };
    })
    .filter((p): p is PaintProduct => p !== null);
}

export function normalizePaintSheens(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export type FieldToolsPaintCatalog = {
  products: PaintProduct[];
  sheens: string[];
  source: "field-tools" | "defaults";
};

type FieldToolsPaintProductRow = {
  product?: unknown;
  category?: unknown;
  vendor_names?: unknown;
  sheens?: unknown;
};

function manufacturerFromFieldToolsVendor(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const mapped = FIELD_TOOLS_VENDOR_TO_MFR[trimmed.toLowerCase()];
  if (mapped) return mapped;
  const match = PAINT_MANUFACTURER_OPTIONS.find((mfr) => mfr.toLowerCase() === trimmed.toLowerCase());
  return match ?? trimmed;
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function productsFromFieldToolsRows(rows: FieldToolsPaintProductRow[]): PaintProduct[] {
  const out: PaintProduct[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const product = typeof row.product === "string" ? row.product.trim() : "";
    if (!product) continue;
    const sheens = stringList(row.sheens);
    const vendors = stringList(row.vendor_names);
    const category = typeof row.category === "string" ? row.category.trim() : "";
    const vendorList = vendors.length ? vendors : category ? [category] : [""];
    for (const vendor of vendorList) {
      const manufacturer = manufacturerFromFieldToolsVendor(vendor);
      const key = `${product.toLowerCase()}::${manufacturer.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ product, manufacturer, sheens });
    }
  }
  return out;
}

export function clearPaintCatalogCache(): void {
  defaultProductsCache = null;
  defaultSheensCache = null;
  fieldToolsCatalogCache = null;
  fieldToolsCatalogPromise = null;
  hiddenPaintProductsCache = null;
}

export async function loadDefaultPaintProducts(): Promise<PaintProduct[]> {
  if (defaultProductsCache) return defaultProductsCache;
  defaultProductsCache = await fetchJson<PaintProduct[]>("/json/paint_products.json");
  return defaultProductsCache;
}

export async function loadDefaultPaintSheens(): Promise<string[]> {
  if (defaultSheensCache) return defaultSheensCache;
  defaultSheensCache = await fetchJson<string[]>("/json/paint_sheens.json");
  return defaultSheensCache;
}

async function fetchFieldToolsPaintCatalog(): Promise<FieldToolsPaintCatalog> {
  const [defaultProducts, defaultSheens] = await Promise.all([
    loadDefaultPaintProducts(),
    loadDefaultPaintSheens(),
  ]);
  const fallback: FieldToolsPaintCatalog = {
    products: defaultProducts.map((p) => ({ ...p })),
    sheens: [...defaultSheens],
    source: "defaults",
  };

  try {
    const { data, error } = await supabase.rpc("list_field_tools_paint_catalog_for_jobflow" as never);
    if (error || data == null || typeof data !== "object") return fallback;
    const raw = data as { products?: unknown; sheens?: unknown };
    const products = productsFromFieldToolsRows(Array.isArray(raw.products) ? raw.products : []);
    const sheens = normalizePaintSheens(raw.sheens) ?? [];
    if (!products.length && !sheens.length) return fallback;
    return {
      products,
      sheens: sheens.length ? sheens : fallback.sheens,
      source: "field-tools",
    };
  } catch {
    return fallback;
  }
}

export async function loadFieldToolsPaintCatalog(force = false): Promise<FieldToolsPaintCatalog> {
  if (force) {
    fieldToolsCatalogCache = null;
    fieldToolsCatalogPromise = null;
  }
  if (fieldToolsCatalogCache) return fieldToolsCatalogCache;
  if (!fieldToolsCatalogPromise) {
    fieldToolsCatalogPromise = fetchFieldToolsPaintCatalog().then((catalog) => {
      fieldToolsCatalogCache = catalog;
      return catalog;
    });
  }
  try {
    return await fieldToolsCatalogPromise;
  } finally {
    fieldToolsCatalogPromise = null;
  }
}

export async function loadPaintProducts(userId?: string | null): Promise<PaintProduct[]> {
  const catalog = await loadFieldToolsPaintCatalog();
  if (!userId) return catalog.products;
  const hidden = await loadHiddenPaintProductNames(userId);
  return excludeHiddenPaintProducts(catalog.products, hidden);
}

export async function loadPaintSheens(_userId?: string | null): Promise<string[]> {
  const catalog = await loadFieldToolsPaintCatalog();
  return catalog.sheens;
}

export function normalizeHiddenPaintProductNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = typeof item === "string" ? item.trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function paintProductIsHidden(productName: string, hidden: readonly string[]): boolean {
  const key = productName.trim().toLowerCase();
  if (!key) return false;
  return hidden.some((name) => name.trim().toLowerCase() === key);
}

export function excludeHiddenPaintProducts(
  products: PaintProduct[],
  hidden: readonly string[],
): PaintProduct[] {
  if (!hidden.length) return products;
  return products.filter((product) => !paintProductIsHidden(product.product, hidden));
}

export async function loadHiddenPaintProductNames(userId: string): Promise<string[]> {
  if (hiddenPaintProductsCache?.userId === userId) return hiddenPaintProductsCache.names;
  const raw = await loadRawUserSettings(userId);
  const names = normalizeHiddenPaintProductNames(raw[PAINT_SUBMITTAL_HIDDEN_PRODUCTS_KEY]);
  hiddenPaintProductsCache = { userId, names };
  return names;
}

export async function saveHiddenPaintProductNames(
  userId: string,
  names: string[],
): Promise<string | null> {
  const next = normalizeHiddenPaintProductNames(names);
  const err = await patchOrgSettings(userId, { [PAINT_SUBMITTAL_HIDDEN_PRODUCTS_KEY]: next });
  if (err) return err;
  hiddenPaintProductsCache = { userId, names: next };
  return null;
}

export type PaintCatalogSettingsDraft = {
  products: PaintProduct[];
  sheens: string[];
  hiddenProducts: string[];
  source: "field-tools" | "defaults";
};

/** Linked Field Tools catalog for Settings, plus JobFlow hide-from-submittals flags. */
export async function loadPaintCatalogSettingsDraft(userId?: string): Promise<PaintCatalogSettingsDraft> {
  hiddenPaintProductsCache = null;
  const catalog = await loadFieldToolsPaintCatalog(true);
  const hiddenProducts = userId ? await loadHiddenPaintProductNames(userId) : [];
  return {
    products: catalog.products,
    sheens: catalog.sheens,
    hiddenProducts,
    source: catalog.source,
  };
}

/** Select label: skip a redundant `(SW)` suffix when the product already names the brand. */
export function paintProductSelectLabel(product: PaintProduct): string {
  const mfr = product.manufacturer.trim();
  if (!mfr) return product.product;
  const lower = product.product.toLowerCase();
  const mfrLower = mfr.toLowerCase();
  if (lower === mfrLower || lower.startsWith(`${mfrLower} `) || lower.startsWith(`${mfrLower}-`)) {
    return product.product;
  }
  return `${product.product} (${mfr})`;
}

/** Allowed sheens for a product. Empty product sheens means every catalog sheen. */
export function sheensForPaintProduct(
  products: PaintProduct[],
  productName: string,
  allSheens: string[],
): string[] {
  const name = productName.trim().toLowerCase();
  if (!name) return allSheens;
  const match = products.find((p) => p.product.trim().toLowerCase() === name);
  const allowed = (match?.sheens ?? []).map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return allSheens;
  const allowedLower = new Set(allowed.map((s) => s.toLowerCase()));
  const listed = allSheens.filter((s) => allowedLower.has(s.trim().toLowerCase()));
  for (const sheen of allowed) {
    if (!listed.some((s) => s.toLowerCase() === sheen.toLowerCase())) listed.push(sheen);
  }
  return listed;
}

export async function loadPaintColors(): Promise<PaintColorsDb> {
  if (colorsCache) return colorsCache;
  if (!colorsLoadPromise) {
    colorsLoadPromise = fetchJson<PaintColorsDb>("/json/paint_colors.json").then((data) => {
      colorsCache = data;
      return data;
    });
  }
  return colorsLoadPromise;
}

export function getProductDisplayList(products: PaintProduct[], preferredManufacturer = "PPG"): string[] {
  const byManufacturer: Record<string, string[]> = {};
  for (const p of products) {
    const mfr = p.manufacturer || "";
    const display = paintProductSelectLabel(p);
    if (!byManufacturer[mfr]) byManufacturer[mfr] = [];
    byManufacturer[mfr]!.push(display);
  }
  for (const mfr of Object.keys(byManufacturer)) {
    byManufacturer[mfr]!.sort();
  }
  const result: string[] = [];
  if (byManufacturer[preferredManufacturer]) result.push(...byManufacturer[preferredManufacturer]!);
  for (const mfr of Object.keys(byManufacturer).sort()) {
    if (mfr !== preferredManufacturer && mfr !== "") result.push(...byManufacturer[mfr]!);
  }
  if (byManufacturer[""]) result.push(...byManufacturer[""]!);
  return result;
}

export function formatSheenLabel(sheen: string): string {
  return sheen.replace(/,\s*/g, ", ").trim();
}

function foldSheenName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Split stored sheen text like "Flat, Satin and Gloss" into catalog sheens. */
export function parseSheenSelection(raw: string, catalogSheens: string[] = []): string[] {
  const text = raw.trim();
  if (!text) return [];

  const exact = catalogSheens.find((sheen) => foldSheenName(sheen) === foldSheenName(text));
  if (exact) return [exact];

  const chunks = text
    .split(/\s*(?:,|;|\/|&|\band\b)\s*/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const matched: string[] = [];
  for (const chunk of chunks) {
    const hit = catalogSheens.find((sheen) => foldSheenName(sheen) === foldSheenName(chunk));
    if (hit && !matched.includes(hit)) matched.push(hit);
  }
  if (matched.length) return matched;
  return chunks.length ? chunks : [text];
}

/** Store multiple sheens in Field Tools-readable form: "Flat and Satin" / "Flat, Satin and Gloss". */
export function formatSheenSelection(parts: string[]): string {
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")} and ${cleaned[cleaned.length - 1]}`;
}

export function toggleSheenSelection(
  current: string,
  option: string,
  catalogSheens: string[],
): string {
  const selected = parseSheenSelection(current, catalogSheens);
  const next = selected.some((sheen) => foldSheenName(sheen) === foldSheenName(option))
    ? selected.filter((sheen) => foldSheenName(sheen) !== foldSheenName(option))
    : [...selected, option];
  const ordered = [
    ...catalogSheens.filter((sheen) =>
      next.some((picked) => foldSheenName(picked) === foldSheenName(sheen)),
    ),
    ...next.filter(
      (picked) => !catalogSheens.some((sheen) => foldSheenName(sheen) === foldSheenName(picked)),
    ),
  ];
  return formatSheenSelection(ordered);
}

/** Compact display names for the paint items sheen column (UI only; stored/PDF keep full values). */
const SHEEN_COMPACT_LABELS: Record<string, string> = {
  "Semi-Gloss": "S-G",
  "High Gloss": "H-G",
  "Low Lustre": "L-L",
  "Low Sheen": "L-S",
  "Low Gloss": "L-G",
  Eggshell: "Egg",
};

/** Map a stored sheen value to a compact select label (compounds joined with " · "). */
export function compactSheenLabel(sheen: string, catalogSheens: string[] = []): string {
  const parts = parseSheenSelection(sheen, catalogSheens);
  if (!parts.length) return "";
  return parts.map((part) => SHEEN_COMPACT_LABELS[part] ?? part).join(" · ");
}

export type ProductSelectGroup = {
  manufacturer: string;
  items: { display: string; product: string }[];
};

/** Group products for select / optgroup menus (PPG first). */
export function groupProductsForSelect(
  products: PaintProduct[],
  preferredManufacturer = "PPG",
): ProductSelectGroup[] {
  const byManufacturer = new Map<string, PaintProduct[]>();
  for (const p of products) {
    const mfr = p.manufacturer.trim() || "Other";
    const list = byManufacturer.get(mfr) ?? [];
    list.push(p);
    byManufacturer.set(mfr, list);
  }

  const order = [
    preferredManufacturer,
    ...[...byManufacturer.keys()].filter((m) => m !== preferredManufacturer).sort(),
  ];

  return order
    .filter((m) => byManufacturer.has(m))
    .map((manufacturer) => ({
      manufacturer,
      items: [...(byManufacturer.get(manufacturer) ?? [])]
        .sort((a, b) => a.product.localeCompare(b.product))
        .map((p) => ({
          product: p.product,
          display: paintProductSelectLabel(p),
        })),
    }));
}

/** Trailing `(SW)` / `(PPG)` manufacturer suffix from a select display value. */
const TRAILING_MFR_DISPLAY = /\s*\(([^)]+)\)\s*$/;

export function extractProductName(display: string): string {
  const trimmed = display.trim();
  return trimmed.replace(TRAILING_MFR_DISPLAY, "").trim();
}

export function getProductDisplay(products: PaintProduct[], productName: string): string {
  const match = products.find((p) => p.product === productName);
  if (!match) return productName;
  return paintProductSelectLabel(match);
}

export function extractManufacturerFromDisplay(display: string): string {
  const trimmed = display.trim();
  return trimmed.match(TRAILING_MFR_DISPLAY)?.[1]?.trim() ?? "";
}

/** Map an imported / typed product string onto the catalog when possible. */
export function matchCatalogPaintProduct(
  products: PaintProduct[],
  rawProduct: string,
  rawManufacturer = "",
): { product: string; manufacturer: string } {
  const productName = extractProductName(rawProduct);
  const manufacturer = extractManufacturerFromDisplay(rawProduct) || rawManufacturer.trim();
  if (!productName) return { product: "", manufacturer };
  const lower = productName.toLowerCase();
  const mfrLower = manufacturer.toLowerCase();
  const exact = products.find(
    (p) =>
      p.product.toLowerCase() === lower &&
      (!mfrLower || p.manufacturer.toLowerCase() === mfrLower),
  );
  if (exact) return exact;
  const byName = products.find((p) => p.product.toLowerCase() === lower);
  if (byName) {
    return { product: byName.product, manufacturer: manufacturer || byName.manufacturer };
  }
  return { product: productName, manufacturer };
}

export function manufacturerForProduct(products: PaintProduct[], productName: string): string {
  return products.find((p) => p.product === productName)?.manufacturer ?? "";
}

const QUERY_VENDOR_PREFIX: Record<string, string[]> = {
  sw: ["SherwinWilliams", "SW"],
  bm: ["BenjaminMoore", "BM"],
  de: ["DE"],
  ppg: ["PPG"],
  behr: ["BEHR"],
  vista: ["Vista", "VISTA"],
};

/** Split "SW7004", "SW 7004", "DEW380" etc. into vendor keys + search term. */
export function parseColorLookupQuery(raw: string): {
  vendorKeys: string[] | null;
  term: string;
  full: string;
} {
  const trimmed = raw.trim();
  const full = trimmed.toLowerCase();
  if (!trimmed) return { vendorKeys: null, term: "", full: "" };

  const m = trimmed.match(/^(SW|BM|DE|PPG|BEHR|Vista)\s*[-.]?\s*(.*)$/i);
  if (m) {
    const vendorKeys = QUERY_VENDOR_PREFIX[m[1]!.toLowerCase()] ?? null;
    const rest = (m[2] ?? "").trim();
    return {
      vendorKeys,
      term: (rest || trimmed).toLowerCase(),
      full,
    };
  }
  return { vendorKeys: null, term: full, full };
}

function colorEntryMatches(entry: PaintColorEntry, term: string, full: string): boolean {
  const num = (entry.number || "").trim().toLowerCase();
  const name = (entry.name || "").trim().toLowerCase();
  if (!num) return false;
  if (full === num || full === name) return true;
  if (term && (num.includes(term) || name.includes(term))) return true;
  if (full && (num.includes(full) || name.includes(full))) return true;
  return false;
}

function collectColorMatches(
  colors: PaintColorsDb,
  manufacturers: string[],
  term: string,
  full: string,
): PaintColorMatch[] {
  const matches: PaintColorMatch[] = [];
  const seen = new Set<string>();
  for (const mfr of manufacturers) {
    for (const c of colors[mfr] ?? []) {
      if (!colorEntryMatches(c, term, full)) continue;
      const display = formatColorDisplay(mfr, c);
      const key = `${mfr}::${display}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        display,
        vendor: mfr,
        hex: normalizePaintHex(c.hex),
      });
    }
  }
  return matches;
}

export function normalizePaintHex(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const hex = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : "";
}

/** Resolve published approximation hex from catalog when color text matches an entry. */
export function resolvePaintColorHex(colors: PaintColorsDb | null, colorText: string): string {
  if (!colors) return "";
  const matches = searchPaintColors(colors, colorText);
  if (matches.length === 1) return matches[0]!.hex;
  const exact = matches.find((m) => m.display.toLowerCase() === colorText.trim().toLowerCase());
  return exact?.hex ?? "";
}

export function formatColorDisplay(mfrKey: string, entry: PaintColorEntry): string {
  const num = (entry.number || "").trim();
  const name = (entry.name || "").trim();
  const prefix = PREFIX_MAP[mfrKey] ?? "";
  return prefix ? `${prefix} ${name} ${num}`.trim() : `${name} ${num}`.trim();
}

export function searchPaintColors(
  colors: PaintColorsDb,
  query: string,
  _productDisplay?: string,
): PaintColorMatch[] {
  const { vendorKeys, term, full } = parseColorLookupQuery(query);
  if (!full) return [];

  let manufacturers =
    vendorKeys?.length ? vendorKeys.filter((k) => k in colors) : Object.keys(colors);

  if (!manufacturers.length) manufacturers = Object.keys(colors);

  return collectColorMatches(colors, manufacturers, term, full);
}

/** Skip lookup when color already looks formatted (matches desktop). */
export function shouldSkipColorLookup(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const prefixes = ["SW ", "BM ", "DE ", "PPG ", "BEHR ", "Vista "];
  if (prefixes.some((p) => trimmed.startsWith(p))) return true;
  if (trimmed.includes("(") && trimmed.endsWith(")")) return true;
  return false;
}

export function abbreviateVendorKey(vendor: string): string {
  return PREFIX_MAP[vendor] ?? vendor.slice(0, 2).toUpperCase();
}

