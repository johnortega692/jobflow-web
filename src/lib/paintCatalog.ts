/** Paint product / sheen / color catalogs. Products and sheens come from Field Tools. */

import { PAINT_PRIMER_OVERRIDE_NONE } from "../types/tradeDocuments.js";
import { loadRawUserSettings, patchOrgSettings } from "./budgetLibrary.js";
import { supabase } from "./supabase.js";

export type PaintProduct = {
  product: string;
  manufacturer: string;
  sheens?: string[];
  /** Field Tools catalog row. Vendor copies of one product share this id. */
  id?: string;
  is_primer?: boolean;
  paired_primer_id?: string | null;
  /** VOC in g/L when the catalog product has one. */
  voc?: string;
};

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
  id?: unknown;
  product?: unknown;
  category?: unknown;
  vendor_names?: unknown;
  sheens?: unknown;
  is_primer?: unknown;
  paired_primer_id?: unknown;
  voc?: unknown;
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
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const paired =
      typeof row.paired_primer_id === "string" && row.paired_primer_id.trim()
        ? row.paired_primer_id.trim()
        : null;
    const isPrimer = row.is_primer === true;
    const voc = typeof row.voc === "string" ? row.voc.trim() : "";
    const vendorList = vendors.length ? vendors : category ? [category] : [""];
    for (const vendor of vendorList) {
      const manufacturer = manufacturerFromFieldToolsVendor(vendor);
      const key = `${product.toLowerCase()}::${manufacturer.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        product,
        manufacturer,
        sheens,
        ...(id ? { id } : {}),
        is_primer: isPrimer,
        paired_primer_id: paired,
        ...(voc ? { voc } : {}),
      });
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

export async function loadPaintProducts(
  userId?: string | null,
  options?: { includeHidden?: boolean },
): Promise<PaintProduct[]> {
  const catalog = await loadFieldToolsPaintCatalog();
  if (!userId || options?.includeHidden) return catalog.products;
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
    colorsLoadPromise = Promise.all([
      fetchJson<PaintColorsDb>("/json/paint_colors.json"),
      fetchJson<PaintColorsDb>("/json/pantone_ral_colors.json"),
    ]).then(([paint, standards]) => {
      const data = { ...paint, ...standards };
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

/** Pull color codes out of a phrase, including when a name sits in front of the number. */
function extractColorCodes(raw: string): { codes: string[]; name: string } {
  const standardCode =
    /\bPMS\s*\d{1,4}\s*C\b|\bRAL\s*\d{3,4}(?:-[A-Z0-9]{1,4})?\b|\bH\d{3}L\d{2}C\d{2}\b/gi;
  const vendorCode =
    /\b(SW|BM|DE|PPG|BEHR|VISTA)\s*[-.]?\s*([A-Z0-9]*\d[A-Z0-9]*(?:-\d+)?)\b/gi;
  const otherCode =
    /\b\d{2,4}[A-Z]-\d{1,3}\b|\b\d{3,5}-\d{1,3}\b|\b[A-Z]{1,3}-\d{1,4}\b|\b[A-Z]{2,4}\d{2,5}\b|\b\d{3,5}\b/gi;
  const codes: string[] = [];
  let rest = raw.replace(standardCode, (match) => {
    codes.push(match.replace(/\s+/g, " ").trim());
    return " ";
  });
  rest = rest.replace(vendorCode, (_match, prefix: string, body: string) => {
    codes.push(`${prefix}${body}`.replace(/\s+/g, ""));
    return " ";
  });
  rest = rest.replace(otherCode, (match) => {
    codes.push(match);
    return " ";
  });
  const name = rest
    .replace(/&/g, " ")
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 3)
    .join(" ");
  return { codes: [...new Set(codes.map((code) => code.trim()).filter(Boolean))], name };
}

function nameCovers(name: string, phrase: string): boolean {
  if (!phrase) return false;
  if (name.includes(phrase)) return true;
  const words = phrase.split(/\s+/).filter((word) => word.length >= 3);
  return words.length >= 2 && words.every((word) => name.includes(word));
}

function compactColorCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function colorEntryMatches(entry: PaintColorEntry, term: string, full: string): boolean {
  const num = (entry.number || "").trim().toLowerCase();
  const name = (entry.name || "").trim().toLowerCase();
  const numCompact = compactColorCode(num);
  const termCompact = compactColorCode(term);
  const fullCompact = compactColorCode(full);
  if (!num) return false;
  if (full === num || full === name || (fullCompact.length >= 3 && numCompact === fullCompact)) return true;
  if (term && (num.includes(term) || (termCompact.length >= 3 && numCompact.includes(termCompact)) || nameCovers(name, term))) {
    return true;
  }
  if (full && (num.includes(full) || (fullCompact.length >= 3 && numCompact.includes(fullCompact)) || nameCovers(name, full))) {
    return true;
  }
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

function searchParsedQuery(colors: PaintColorsDb, query: string): PaintColorMatch[] {
  const { vendorKeys, term, full } = parseColorLookupQuery(query);
  if (!full) return [];
  let manufacturers = vendorKeys?.length ? vendorKeys.filter((k) => k in colors) : Object.keys(colors);
  if (!manufacturers.length) manufacturers = Object.keys(colors);
  return collectColorMatches(colors, manufacturers, term, full);
}

function displayCoversName(match: PaintColorMatch, name: string): boolean {
  return nameCovers(match.display.toLowerCase(), name);
}

export function searchPaintColors(
  colors: PaintColorsDb,
  query: string,
  _productDisplay?: string,
): PaintColorMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { codes, name } = extractColorCodes(trimmed);
  if (codes.length) {
    const seen = new Set<string>();
    const byCode: PaintColorMatch[] = [];
    for (const code of codes) {
      for (const match of searchParsedQuery(colors, code)) {
        const key = `${match.vendor}::${match.display}`;
        if (seen.has(key)) continue;
        seen.add(key);
        byCode.push(match);
      }
    }
    if (byCode.length) {
      if (!name) return byCode;
      const narrowed = byCode.filter((match) => displayCoversName(match, name));
      return narrowed.length ? narrowed : byCode;
    }
    if (name) return searchParsedQuery(colors, name);
  }

  return searchParsedQuery(colors, trimmed);
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

/** Pantone and RAL are color systems. They do not replace the paint manufacturer. */
export function isStandardColorSystem(vendor: string): boolean {
  return vendor === "Pantone" || vendor === "RAL";
}

export function abbreviateVendorKey(vendor: string): string {
  if (isStandardColorSystem(vendor)) return vendor;
  return PREFIX_MAP[vendor] ?? vendor.slice(0, 2).toUpperCase();
}

export type PaintPrimerOption = { id: string; name: string };

/** Finish row fields the primer select needs. The paired primer is never stored here. */
export type PaintPrimerItemRef = {
  product: string;
  manufacturer: string;
  primer_override_id?: string | null;
  color?: string;
  sheen?: string;
  floor?: string;
  previous_color?: string;
};

export type PaintPrimerTag = "paired" | "override" | "missing";

export type PaintPrimerView = {
  /** Primer products don't take a primer of their own. */
  show: boolean;
  selectValue: string;
  firstLabel: string;
  primers: PaintPrimerOption[];
  tag: PaintPrimerTag | null;
  /** Counts toward the header when this finish has no primer and is not self-priming. */
  missing: boolean;
};

export function paintPrimers(products: PaintProduct[]): PaintPrimerOption[] {
  const byId = new Map<string, string>();
  for (const product of products) {
    const id = product.id?.trim();
    if (!product.is_primer || !id || byId.has(id)) continue;
    byId.set(id, product.product.trim());
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function findCatalogPaintProduct(
  products: PaintProduct[],
  productName: string,
  manufacturer = "",
): PaintProduct | undefined {
  const name = productName.trim().toLowerCase();
  if (!name) return undefined;
  const matches = products.filter((product) => product.product.trim().toLowerCase() === name);
  if (!matches.length) return undefined;
  const mfr = manufacturer.trim().toLowerCase();
  if (mfr) {
    const exact = matches.find((product) => product.manufacturer.trim().toLowerCase() === mfr);
    if (exact) return exact;
  }
  return matches[0];
}

export function paintItemIsCatalogPrimer(products: PaintProduct[], item: { product: string; manufacturer: string }): boolean {
  return Boolean(findCatalogPaintProduct(products, item.product, item.manufacturer)?.is_primer);
}

export function omitCatalogPrimerItems<T extends { product: string; manufacturer: string }>(
  items: T[],
  products: PaintProduct[],
): T[] {
  if (!products.length) return items;
  return items.filter((item) => !paintItemIsCatalogPrimer(products, item));
}

function finishHasContent(item: PaintPrimerItemRef): boolean {
  return Boolean(
    item.product.trim() ||
      item.color?.trim() ||
      item.sheen?.trim() ||
      item.floor?.trim() ||
      item.previous_color?.trim(),
  );
}

export type EffectivePaintPrimer = {
  isPrimerProduct: boolean;
  /** Set when this row stores an override (a primer id or explicit self-priming). */
  overridden: boolean;
  primerId: string | null;
  primerName: string;
  selfPriming: boolean;
  missing: boolean;
};

/**
 * Effective primer is the override, else the catalog pair, else none. The pair is not stored on the item.
 * Same rule as public.resolve_job_paint_primer. Brush-out rows store that result;
 * this stays in the app so the Paint tab does not call the SQL function.
 */
export function effectivePaintPrimer(item: PaintPrimerItemRef, products: PaintProduct[]): EffectivePaintPrimer {
  const raw = (item.primer_override_id ?? "").trim();
  const explicitNone = raw === PAINT_PRIMER_OVERRIDE_NONE;
  if (!products.length) {
    return {
      isPrimerProduct: false,
      overridden: explicitNone,
      primerId: null,
      primerName: "",
      selfPriming: explicitNone,
      missing: false,
    };
  }
  const catalog = findCatalogPaintProduct(products, item.product, item.manufacturer);
  const primers = paintPrimers(products);
  const primerIds = new Set(primers.map((primer) => primer.id));
  if (catalog?.is_primer) {
    return {
      isPrimerProduct: true,
      overridden: false,
      primerId: null,
      primerName: "",
      selfPriming: false,
      missing: false,
    };
  }
  const pairedId =
    catalog?.paired_primer_id && primerIds.has(catalog.paired_primer_id) ? catalog.paired_primer_id : null;
  const overrideId = raw && !explicitNone && primerIds.has(raw) ? raw : null;
  const catalogSelfPriming = Boolean(catalog) && !catalog?.paired_primer_id;
  if (explicitNone) {
    return {
      isPrimerProduct: false,
      overridden: true,
      primerId: null,
      primerName: "",
      selfPriming: true,
      missing: false,
    };
  }
  if (overrideId) {
    return {
      isPrimerProduct: false,
      overridden: true,
      primerId: overrideId,
      primerName: primers.find((primer) => primer.id === overrideId)?.name ?? "",
      selfPriming: false,
      missing: false,
    };
  }
  if (pairedId) {
    return {
      isPrimerProduct: false,
      overridden: false,
      primerId: pairedId,
      primerName: primers.find((primer) => primer.id === pairedId)?.name ?? "",
      selfPriming: false,
      missing: false,
    };
  }
  const missing = !catalogSelfPriming && finishHasContent(item);
  return {
    isPrimerProduct: false,
    overridden: false,
    primerId: null,
    primerName: "",
    selfPriming: catalogSelfPriming,
    missing,
  };
}

/** Effective primer is the override, else the catalog pair, else none. */
export function paintItemPrimerView(item: PaintPrimerItemRef, products: PaintProduct[]): PaintPrimerView {
  const primers = paintPrimers(products);
  const effect = effectivePaintPrimer(item, products);
  if (effect.isPrimerProduct) {
    return { show: false, selectValue: "", firstLabel: "", primers, tag: null, missing: false };
  }
  const catalog = products.length
    ? findCatalogPaintProduct(products, item.product, item.manufacturer)
    : undefined;
  const pairedId =
    catalog?.paired_primer_id && primers.some((primer) => primer.id === catalog.paired_primer_id)
      ? catalog.paired_primer_id
      : null;
  const pairedName = pairedId ? (primers.find((primer) => primer.id === pairedId)?.name ?? "") : "";
  const tag: PaintPrimerTag | null = effect.overridden ? "override" : effect.primerId ? "paired" : effect.missing ? "missing" : null;
  const selectValue = effect.overridden
    ? effect.selfPriming
      ? PAINT_PRIMER_OVERRIDE_NONE
      : (effect.primerId ?? "")
    : "";
  return {
    show: true,
    selectValue,
    firstLabel: pairedName ? `${pairedName} (paired)` : "No paired primer",
    primers,
    tag,
    missing: effect.missing,
  };
}

/** Drop an override the new finish can't keep: unknown primer, same as the new pair, or the product is itself a primer. */
export function primerOverrideAfterProductChange(
  product: string,
  manufacturer: string,
  current: string | null | undefined,
  products: PaintProduct[],
): string | null {
  const raw = (current ?? "").trim();
  if (!raw) return null;
  const catalog = findCatalogPaintProduct(products, product, manufacturer);
  if (catalog?.is_primer) return null;
  if (raw === PAINT_PRIMER_OVERRIDE_NONE) return PAINT_PRIMER_OVERRIDE_NONE;
  if (!paintPrimers(products).some((primer) => primer.id === raw)) return null;
  if (catalog?.paired_primer_id && raw === catalog.paired_primer_id) return null;
  return raw;
}

