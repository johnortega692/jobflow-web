/** FRP manufacturer / product / color catalog (from desktop json/frp_data.json). */

export type FrpManufacturerData = {
  products: string[];
  colors: string[];
  product_colors?: Record<string, string[]>;
  trim_products?: string[];
  trim_defaults?: string[];
};

export type FrpCatalog = Record<string, FrpManufacturerData | string[]>;

let catalogCache: FrpCatalog | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json() as Promise<T>;
}

export async function loadFrpCatalog(): Promise<FrpCatalog> {
  if (catalogCache) return catalogCache;
  catalogCache = await fetchJson<FrpCatalog>("/json/frp_data.json");
  return catalogCache;
}

export function clearFrpCatalogCache(): void {
  catalogCache = null;
}

export function frpManufacturers(catalog: FrpCatalog): string[] {
  return Object.keys(catalog)
    .filter((k) => !k.startsWith("_"))
    .sort();
}

export function frpPanelSizes(catalog: FrpCatalog): string[] {
  const raw = catalog._panel_sizes;
  return Array.isArray(raw) ? [...raw] : [];
}

export function frpTrimSizes(catalog: FrpCatalog): string[] {
  const raw = catalog._trim_sizes;
  return Array.isArray(raw) ? [...raw] : [];
}

export function frpProductsForManufacturer(catalog: FrpCatalog, manufacturer: string): string[] {
  const data = catalog[manufacturer];
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return [...(data.products ?? [])].sort();
}

export function frpColorsForProduct(
  catalog: FrpCatalog,
  manufacturer: string,
  product: string,
): string[] {
  const data = catalog[manufacturer];
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const productColors = data.product_colors?.[product];
  if (productColors?.length) return [...productColors].sort();
  return [...(data.colors ?? [])].sort();
}

export function frpTrimProducts(catalog: FrpCatalog, manufacturer: string): string[] {
  const data = catalog[manufacturer];
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return [...(data.trim_products ?? [])];
}

export function frpManufacturersWithTrims(catalog: FrpCatalog): string[] {
  return frpManufacturers(catalog).filter((m) => frpTrimProducts(catalog, m).length > 0);
}

export function frpIsTrimProduct(catalog: FrpCatalog, manufacturer: string, product: string): boolean {
  return frpTrimProducts(catalog, manufacturer).includes(product);
}
