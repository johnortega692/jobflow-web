/** Paint product / sheen / color catalogs (from desktop json/). */

export type PaintProduct = { product: string; manufacturer: string };
export type PaintColorEntry = { number: string; name: string };
export type PaintColorsDb = Record<string, PaintColorEntry[]>;

const MFR_TO_COLOR_KEYS: Record<string, string[]> = {
  SW: ["SW", "SherwinWilliams"],
  BM: ["BM", "BenjaminMoore"],
  PPG: ["PPG"],
  DE: ["DE"],
  BEHR: ["BEHR"],
  VISTA: ["VISTA", "Vista"],
};

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

let productsCache: PaintProduct[] | null = null;
let sheensCache: string[] | null = null;
let colorsCache: PaintColorsDb | null = null;
let colorsLoadPromise: Promise<PaintColorsDb> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json() as Promise<T>;
}

export async function loadPaintProducts(): Promise<PaintProduct[]> {
  if (productsCache) return productsCache;
  productsCache = await fetchJson<PaintProduct[]>("/json/paint_products.json");
  return productsCache;
}

export async function loadPaintSheens(): Promise<string[]> {
  if (sheensCache) return sheensCache;
  sheensCache = await fetchJson<string[]>("/json/paint_sheens.json");
  return sheensCache;
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

function colorKeysForManufacturer(mfr: string, colors: PaintColorsDb): string[] {
  const keys = MFR_TO_COLOR_KEYS[mfr.toUpperCase()] ?? [mfr];
  return keys.filter((k) => k in colors);
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
  productDisplay: string,
): { display: string; vendor: string }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const productMfr = extractManufacturerFromDisplay(productDisplay);
  let manufacturers = productMfr ? colorKeysForManufacturer(productMfr, colors) : [];
  if (!manufacturers.length) manufacturers = Object.keys(colors);

  const matches: { display: string; vendor: string }[] = [];
  for (const mfr of manufacturers) {
    for (const c of colors[mfr] ?? []) {
      const num = (c.number || "").trim();
      const name = (c.name || "").trim();
      if (!num) continue;
      if (q === num.toLowerCase() || q === name.toLowerCase() || num.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
        matches.push({ display: formatColorDisplay(mfr, c), vendor: mfr });
      }
    }
  }
  return matches;
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

