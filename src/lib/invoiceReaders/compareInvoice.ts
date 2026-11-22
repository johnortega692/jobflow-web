import type { InvoiceLine } from "./types.ts";

export type InvoiceCatalogItem = {
  id: string;
  section: "sundry" | "paint_product";
  category: string;
  name: string;
  productId: string;
  akas: string[];
  unitCost: number | null;
  sheenCosts: Record<string, number>;
  sheens: string[];
  vendorNames: string[];
};

export type InvoicePriceDraft = {
  unitCost: string;
  sheenCosts: Record<string, string>;
};

export type InvoiceMatchKind = "match" | "suggested" | "missing" | "fee";

export type InvoiceCompareRow = {
  line: InvoiceLine;
  kind: InvoiceMatchKind;
  item: InvoiceCatalogItem | null;
  suggestion: InvoiceCatalogItem | null;
  catalogPrice: number | null;
  sheenKey: string | null;
  samePrice: boolean;
};

const NAME_STOP = new Set(["THE", "AND", "FOR", "WITH", "INCH", "EACH", "GALLON", "QUART", "PINT", "GAL", "PLAST", "PLASTIC", "SIDED", "SW"]);

function fold(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "");
}

function normId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokens(value: string): string[] {
  const cleaned = value
    .toUpperCase()
    .replace(/\b(SEMI[-\s]?GLOSS|S\/G|EGGSHELL|SATIN|PRIMER|GLOSS|FLAT|MATTE|VELVET|SG|EG|FL|GL|PR|SAT)\b/g, " ");
  const out: string[] = [];
  for (const token of cleaned.split(/[^A-Z0-9]+/)) {
    if (token.length < 2 || NAME_STOP.has(token)) continue;
    const gallons = token.match(/^(\d+)G(?:AL(?:LON)?)?$/);
    out.push(gallons ? `${gallons[1]}GAL` : token);
  }
  return out;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const right = new Set(b);
  let shared = 0;
  for (const token of new Set(a)) if (right.has(token)) shared += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : (shared / union) * 100;
}

function vendorKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inInvoiceCatalog(item: InvoiceCatalogItem, vendorName: string): boolean {
  return vendorHit(item, vendorName);
}

function vendorHit(item: InvoiceCatalogItem, vendorName: string): boolean {
  const want = vendorKey(vendorName);
  if (!want) return false;
  return item.vendorNames.some((name) => vendorKey(name) === want);
}

export function invoiceSheenKey(item: InvoiceCatalogItem, draft: InvoicePriceDraft | undefined, label: string | null): string | null {
  const keys = [...item.sheens, ...Object.keys(item.sheenCosts), ...Object.keys(draft?.sheenCosts ?? {})];
  if (label) {
    const want = fold(label);
    const hit = keys.find((key) => fold(key) === want);
    if (hit) return hit;
  }
  const own = item.sheens.map((name) => name.trim()).filter(Boolean);
  if (!label && own.length === 1) return own[0]!;
  return null;
}

/** Gallons in a paint unit such as 5GL or GALLON. Quart and each stay unset. */
export function paintGallons(size: string): number | null {
  const text = size.toUpperCase().replace(/[\s-]+/g, "");
  const counted = text.match(/^(\d+)(?:GL|GAL|GALLONS?)$/);
  if (counted) {
    const gallons = Number(counted[1]);
    return gallons > 0 ? gallons : null;
  }
  if (/^(?:GL|GAL|GALLONS?)$/.test(text)) return 1;
  return null;
}

/** Catalog prices are per gallon. Multi-gallon invoice units divide down to that. */
export function invoiceComparePrice(line: InvoiceLine, perGallon: boolean): number {
  if (!perGallon || line.section !== "paint_product") return line.netPrice;
  const gallons = paintGallons(line.size);
  if (!gallons || gallons <= 1) return line.netPrice;
  return Math.round((line.netPrice / gallons) * 100) / 100;
}

function draftPrice(item: InvoiceCatalogItem, draft: InvoicePriceDraft | undefined, sheenKey: string | null): number | null {
  if (item.section === "sundry") {
    const raw = draft?.unitCost ?? "";
    if (raw.trim()) {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    }
    return item.unitCost;
  }
  if (!sheenKey) return null;
  const raw = draft?.sheenCosts[sheenKey];
  if (raw != null && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  const saved = item.sheenCosts[sheenKey];
  return saved == null || !Number.isFinite(saved) ? null : saved;
}

function rank(line: InvoiceLine, item: InvoiceCatalogItem, vendorName: string): number {
  if (item.section !== line.section) return 0;
  const lineIds = [normId(line.productId), normId(line.salesNumber)].filter((id) => id.length >= 3);
  const itemId = normId(item.productId);
  if (itemId && lineIds.includes(itemId)) return 100;
  const described = new Set(tokens(`${line.description} ${line.productId}`));
  if (itemId.length >= 3 && described.has(itemId.toUpperCase())) return 92;
  const lineFold = fold(line.description);
  let score = 0;
  for (const name of [item.name, ...(item.akas ?? [])]) {
    if (lineFold && fold(name) === lineFold) return 100;
    score = Math.max(score, jaccard(tokens(line.description), tokens(name)));
  }
  if (score > 0 && vendorHit(item, vendorName)) score = Math.min(99, score + 12);
  return Math.min(score, 99);
}

export function compareInvoiceLines(
  lines: InvoiceLine[],
  items: InvoiceCatalogItem[],
  drafts: Record<string, InvoicePriceDraft>,
  vendorName: string,
  forcedIds: Record<string, string> = {},
  invoiceNo = "",
  perGallon = false,
): InvoiceCompareRow[] {
  return lines.map((line, index) => {
    if (line.catalogItem === false) {
      return { line, kind: "fee" as const, item: null, suggestion: null, catalogPrice: null, sheenKey: null, samePrice: false };
    }
    const key = invoiceLineKey(line, index, invoiceNo);
    const catalog = items.filter((item) => inInvoiceCatalog(item, vendorName));
    const forced = catalog.find((item) => item.id === forcedIds[key] && item.section === line.section) ?? null;
    const ranked = catalog
      .map((item) => ({ item, score: rank(line, item, vendorName) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0] ?? null;
    const second = ranked[1]?.score ?? 0;
    let item: InvoiceCatalogItem | null = forced;
    let suggestion: InvoiceCatalogItem | null = null;
    if (!item && best) {
      const gap = best.score - second;
      if (best.score >= 85 || (best.score >= 62 && gap >= 15)) item = best.item;
      else if (best.score >= 48 && gap >= 8) suggestion = best.item;
    }
    const sheenKey = item && line.section === "paint_product" ? invoiceSheenKey(item, drafts[item.id], line.sheen) : null;
    const catalogPrice = item ? draftPrice(item, drafts[item.id], sheenKey) : null;
    const comparePrice = invoiceComparePrice(line, perGallon);
    const samePrice = item != null && catalogPrice != null && Math.round(catalogPrice * 100) === Math.round(comparePrice * 100);
    const kind: InvoiceMatchKind = item ? "match" : suggestion ? "suggested" : "missing";
    return { line, kind, item, suggestion, catalogPrice, sheenKey, samePrice };
  });
}

export function invoiceLinkChoices(
  items: InvoiceCatalogItem[],
  vendorName: string,
  section: InvoiceLine["section"],
  query: string,
): InvoiceCatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return items
    .filter((item) => item.section === section && inInvoiceCatalog(item, vendorName))
    .filter((item) => `${item.name} ${(item.akas ?? []).join(" ")} ${item.productId} ${item.category}`.toLowerCase().includes(needle))
    .slice(0, 8);
}

export function invoiceLineKey(line: InvoiceLine, index: number, invoiceNo = ""): string {
  return `${invoiceNo}:${index}:${line.salesNumber}:${line.productId}`;
}
