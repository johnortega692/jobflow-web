/** Paint product / sheen / color catalogs (from desktop json/ + user_settings overrides). */

import { loadRawUserSettings } from "./budgetLibrary";

export type PaintProduct = { product: string; manufacturer: string };

export const PAINT_PRODUCTS_KEY = "paint_products";
export const PAINT_SHEENS_KEY = "paint_sheens";

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

let defaultProductsCache: PaintProduct[] | null = null;
let defaultSheensCache: string[] | null = null;
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

export function clearPaintCatalogCache(): void {
  defaultProductsCache = null;
  defaultSheensCache = null;
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

export async function loadPaintProducts(userId?: string | null): Promise<PaintProduct[]> {
  if (userId) {
    const raw = await loadRawUserSettings(userId);
    const custom = normalizePaintProducts(raw[PAINT_PRODUCTS_KEY]);
    if (custom !== null) return custom;
  }
  return loadDefaultPaintProducts();
}

export async function loadPaintSheens(userId?: string | null): Promise<string[]> {
  if (userId) {
    const raw = await loadRawUserSettings(userId);
    const custom = normalizePaintSheens(raw[PAINT_SHEENS_KEY]);
    if (custom !== null) return custom;
  }
  return loadDefaultPaintSheens();
}

export type PaintCatalogSettingsDraft = {
  products: PaintProduct[];
  sheens: string[];
  usingCustomProducts: boolean;
  usingCustomSheens: boolean;
};

/** Load editable catalog lists for Settings (custom overrides or built-in defaults). */
export async function loadPaintCatalogSettingsDraft(userId: string): Promise<PaintCatalogSettingsDraft> {
  const raw = await loadRawUserSettings(userId);
  const [defaultProducts, defaultSheens] = await Promise.all([
    loadDefaultPaintProducts(),
    loadDefaultPaintSheens(),
  ]);
  const customProducts = normalizePaintProducts(raw[PAINT_PRODUCTS_KEY]);
  const customSheens = normalizePaintSheens(raw[PAINT_SHEENS_KEY]);
  return {
    products: customProducts ?? defaultProducts.map((p) => ({ ...p })),
    sheens: customSheens ?? [...defaultSheens],
    usingCustomProducts: customProducts !== null,
    usingCustomSheens: customSheens !== null,
  };
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
    const display = mfr ? `${p.product} (${mfr})` : p.product;
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

/** Compact display names for the paint items sheen column (UI only; stored/PDF keep full values). */
const SHEEN_COMPACT_LABELS: Record<string, string> = {
  "Semi-Gloss": "S-G",
  Eggshell: "Egg",
};

/** Map a stored sheen value to a compact select label (compounds joined with " · "). */
export function compactSheenLabel(sheen: string): string {
  const trimmed = sheen.trim();
  if (!trimmed) return "";
  const parts = trimmed
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return formatSheenLabel(trimmed);
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
          display: p.manufacturer ? `${p.product} (${p.manufacturer})` : p.product,
        })),
    }));
}

export function extractProductName(display: string): string {
  if (display.includes("(") && display.endsWith(")")) {
    return display.split("(")[0]!.trim();
  }
  return display.trim();
}

export function getProductDisplay(products: PaintProduct[], productName: string): string {
  const match = products.find((p) => p.product === productName);
  if (!match) return productName;
  return match.manufacturer ? `${match.product} (${match.manufacturer})` : match.product;
}

export function extractManufacturerFromDisplay(display: string): string {
  if (!display || !display.includes("(") || !display.includes(")")) return "";
  return display.split("(").pop()!.replace(")", "").trim();
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

