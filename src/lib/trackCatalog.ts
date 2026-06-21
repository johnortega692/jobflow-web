/** Stretched-fabric track product catalog (from desktop json/track_data.json). */

export type TrackMatCodeData = {
  products: string[];
  category: string;
};

export type TrackCatalog = Record<string, TrackMatCodeData>;

const USAGE_STORAGE_KEY = "jobflow_track_usage";

let catalogCache: TrackCatalog | null = null;
let defaultUsageCache: Record<string, number> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json() as Promise<T>;
}

export async function loadTrackCatalog(): Promise<TrackCatalog> {
  if (catalogCache) return catalogCache;
  catalogCache = await fetchJson<TrackCatalog>("/json/track_data.json");
  return catalogCache;
}

export async function loadDefaultTrackUsage(): Promise<Record<string, number>> {
  if (defaultUsageCache) return defaultUsageCache;
  defaultUsageCache = await fetchJson<Record<string, number>>("/json/track_usage.json");
  return defaultUsageCache;
}

export function clearTrackCatalogCache(): void {
  catalogCache = null;
  defaultUsageCache = null;
}

function readLocalUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLocalUsage(usage: Record<string, number>): void {
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
  } catch {
    /* ignore quota errors */
  }
}

export async function loadTrackUsage(): Promise<Record<string, number>> {
  const [defaults, local] = await Promise.all([loadDefaultTrackUsage(), Promise.resolve(readLocalUsage())]);
  return { ...defaults, ...local };
}

export function trackUsageCount(usage: Record<string, number>, product: string): number {
  const clean = stripProductPrefix(product);
  return usage[clean] ?? usage[product] ?? 0;
}

export function incrementTrackUsage(product: string): void {
  const clean = stripProductPrefix(product);
  const usage = readLocalUsage();
  usage[clean] = (usage[clean] ?? 0) + 1;
  writeLocalUsage(usage);
}

export function stripProductPrefix(display: string): string {
  if (display.startsWith("★ ")) return display.slice(2);
  if (display.startsWith("• ")) return display.slice(2);
  return display;
}

export function formatProductWithUsage(product: string, count: number): string {
  if (count >= 5) return `★ ${product}`;
  if (count >= 3) return `• ${product}`;
  return product;
}

export type TrackProductOption = {
  product: string;
  display: string;
  matCode: string;
};

export function trackProductsForType(
  catalog: TrackCatalog,
  type: string,
  usage: Record<string, number>,
): TrackProductOption[] {
  const typeLower = type.trim().toLowerCase();
  if (!typeLower) return [];

  const options: TrackProductOption[] = [];
  for (const matCode of Object.keys(catalog).sort()) {
    const entry = catalog[matCode]!;
    if ((entry.category ?? "").toLowerCase() !== typeLower) continue;
    for (const product of entry.products) {
      const count = trackUsageCount(usage, product);
      options.push({
        product,
        display: formatProductWithUsage(product, count),
        matCode,
      });
    }
  }

  options.sort((a, b) => {
    const countDiff = trackUsageCount(usage, b.product) - trackUsageCount(usage, a.product);
    if (countDiff !== 0) return countDiff;
    return a.product.localeCompare(b.product);
  });

  return options;
}

export function findMatCodeForProduct(catalog: TrackCatalog, product: string): string {
  const clean = stripProductPrefix(product);
  for (const [matCode, entry] of Object.entries(catalog)) {
    if (entry.products.includes(clean)) return matCode;
  }
  return "";
}

export function matCodeDisplay(matCode: string, catalog: TrackCatalog): string {
  if (!matCode) return "";
  const category = catalog[matCode]?.category ?? "unknown";
  return `${matCode} (${category.toUpperCase()})`;
}
