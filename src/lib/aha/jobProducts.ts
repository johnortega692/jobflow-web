import type { ProjectTradeData } from "../../types/tradeDocuments";
import type { AhaProduct } from "./types";

const APPROVED = new Set(["approved", "approved_as_noted"]);

function productKey(manufacturer: string, product: string): string {
  return `${manufacturer.trim().toLowerCase()}|${product.trim().toLowerCase()}`;
}

function addRow(
  rows: { product: string; manufacturer: string }[],
  seen: Set<string>,
  manufacturer: string,
  product: string,
) {
  const next = { manufacturer: manufacturer.trim(), product: product.trim() };
  if (!next.manufacturer && !next.product) return;
  const key = productKey(next.manufacturer, next.product);
  if (seen.has(key)) return;
  seen.add(key);
  rows.push(next);
}

/** Paint schedule products, plus items from approved paint, wallcovering, and FRP packages. */
export function productsFromJob(trade: ProjectTradeData): { product: string; manufacturer: string }[] {
  const rows: { product: string; manufacturer: string }[] = [];
  const seen = new Set<string>();

  for (const item of trade.paint_submittal?.items ?? []) addRow(rows, seen, item.manufacturer, item.product);

  const approvedPackages = [
    trade.paint_submittal,
    trade.wallcovering_submittal,
    trade.frp_submittal,
  ].filter((pack) => pack && APPROVED.has(pack.issue_status));
  for (const pack of approvedPackages) {
    for (const item of pack?.items ?? []) addRow(rows, seen, item.manufacturer, item.product);
  }

  const history = [
    ...(trade.paint_submittal_history ?? []),
    ...(trade.wallcovering_submittal_history ?? []),
    ...(trade.frp_submittal_history ?? []),
  ];
  for (const entry of history) {
    if (!APPROVED.has(entry.issue_status ?? "")) continue;
    for (const item of entry.items ?? []) {
      if (!item || typeof item !== "object") continue;
      const manufacturer = "manufacturer" in item && typeof item.manufacturer === "string" ? item.manufacturer : "";
      const product = "product" in item && typeof item.product === "string" ? item.product : "";
      addRow(rows, seen, manufacturer, product);
    }
  }

  return rows;
}

export function mergePulledProducts(
  current: AhaProduct[],
  incoming: { product: string; manufacturer: string }[],
): AhaProduct[] {
  const seen = new Set(current.map((row) => productKey(row.manufacturer, row.product)));
  const added = incoming
    .filter((row) => {
      const key = productKey(row.manufacturer, row.product);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      id: crypto.randomUUID(),
      product: row.product,
      manufacturer: row.manufacturer,
      sds_on_file: false,
    }));
  return [...current, ...added];
}
