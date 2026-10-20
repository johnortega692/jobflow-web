import { supabase } from "./supabase";
import { effectivePaintPrimer, findCatalogPaintProduct, type PaintProduct } from "./paintCatalog";
import { brushoutColorLine } from "./paintBrushouts";
import { formatSubmittalHistoryLabel, historyEntryKey } from "./submittalHistory";
import { type PaintItem, type PaintSubmittalData, type SubmittalHistoryEntry } from "../types/tradeDocuments";

export type ApprovedBrushoutRow = {
  id: string;
  project_id: string;
  job_number: string;
  paint_vendor: string;
  label: string;
  floor: string;
  manufacturer: string;
  color: string;
  product: string;
  sheen: string;
  display_line: string;
  approved: boolean;
  approved_by_name: string;
  approved_at: string | null;
  sort_order: number;
  /** Catalog row for this finish. Null when the name did not match. */
  catalog_item_id: string | null;
  /** Resolved primer. Null when self-priming or unmatched. */
  primer_catalog_id: string | null;
  primer_name: string | null;
  /** True for 'none' or no catalog pair. Null when the row was not matched to a paint item. */
  self_priming: boolean | null;
};

export type ApprovedBrushoutDraft = Omit<
  ApprovedBrushoutRow,
  "id" | "project_id" | "job_number" | "approved_by_name" | "approved_at"
> & { id?: string };

/** Import dedupe: label + product + location, case-insensitive and trimmed. */
export function brushoutDraftKey(row: {
  label: string;
  floor: string;
  product?: string;
  color?: string;
}): string {
  const label = row.label.trim().toLowerCase();
  const product = (row.product ?? "").trim().toLowerCase();
  const floor = row.floor.trim().toLowerCase();
  if (!label && !product && !floor) return "";
  return `${label}|${product}|${floor}`;
}

/** A primer-only line has no PT code and no color. Finishes are everything else. */
export function isStandalonePrimerBrushout(row: { label: string; color: string }): boolean {
  return !row.label.trim() && !row.color.trim();
}

/** One finish per paint item. Standalone primer lines (empty label and color) are not imported. */
export function brushoutImportDisplayLine(item: PaintItem): string | null {
  if (isStandalonePrimerBrushout(item)) return null;
  const colorLine = brushoutColorLine(item);
  if (colorLine) return colorLine;
  const parts = [item.label.trim(), item.product.trim(), item.floor.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export type BrushoutImportLineStatus = "new" | "on_list" | "revised";

/** Same label + product + location: already on the list, or a color change on that line. */
export function brushoutImportLineDetail(
  item: PaintItem,
  existing: ApprovedBrushoutDraft[],
): { status: BrushoutImportLineStatus; previousColor: string } {
  if (!brushoutImportDisplayLine(item)) return { status: "new", previousColor: "" };
  const key = brushoutDraftKey(item);
  const match = key ? existing.find((row) => brushoutDraftKey(row) === key) : undefined;
  if (!match) return { status: "new", previousColor: "" };
  const color = item.color.trim().toLowerCase();
  if (match.color.trim().toLowerCase() === color) return { status: "on_list", previousColor: match.color.trim() };
  return { status: "revised", previousColor: match.color.trim() };
}

export function brushoutImportLineStatus(
  item: PaintItem,
  existing: ApprovedBrushoutDraft[],
): BrushoutImportLineStatus {
  return brushoutImportLineDetail(item, existing).status;
}

export function defaultApprovedBrushoutImportSelection(
  items: PaintItem[],
  existing: ApprovedBrushoutDraft[],
): Set<number> {
  const selected = new Set<number>();
  items.forEach((item, index) => {
    if (!brushoutImportDisplayLine(item)) return;
    const status = brushoutImportLineStatus(item, existing);
    if (status === "new") selected.add(index);
  });
  return selected;
}

export type BrushoutImportSource = {
  id: string;
  label: string;
  items: PaintItem[];
};

function paintItemsForBrushoutImport(items: PaintItem[]): PaintItem[] {
  return items.filter((item) => brushoutImportDisplayLine(item));
}

/** Current paint tab plus each saved history package — pick one when importing. */
export function buildBrushoutImportSources(
  paintSubmittal: PaintSubmittalData,
  history: SubmittalHistoryEntry[] | undefined,
): BrushoutImportSource[] {
  const sources: BrushoutImportSource[] = [];
  const currentItems = paintItemsForBrushoutImport(paintSubmittal.items);
  if (currentItems.length) {
    sources.push({
      id: "current",
      label: `Current paint tab — #${paintSubmittal.submittal_number} Rev ${paintSubmittal.revision_number ?? 0} (${currentItems.length} line${currentItems.length === 1 ? "" : "s"})`,
      items: currentItems,
    });
  }

  const sortedHistory = [...(history ?? [])].sort((a, b) => {
    const numDiff = (b.submittal_number ?? 0) - (a.submittal_number ?? 0);
    if (numDiff !== 0) return numDiff;
    return (b.revision_number ?? 0) - (a.revision_number ?? 0);
  });

  for (const entry of sortedHistory) {
    const items = paintItemsForBrushoutImport(entry.items as PaintItem[]);
    if (!items.length) continue;
    const key = historyEntryKey(entry.submittal_number, entry.revision_number ?? 0);
    sources.push({
      id: key,
      label: formatSubmittalHistoryLabel(entry),
      items,
    });
  }

  return sources;
}

export function pickDefaultBrushoutImportSourceId(
  sources: BrushoutImportSource[],
  existing: ApprovedBrushoutDraft[],
): string {
  if (!sources.length) return "";
  let bestId = sources[0]!.id;
  let bestNew = -1;
  for (const source of sources) {
    const newCount = source.items.filter((item) => brushoutImportLineStatus(item, existing) === "new").length;
    if (newCount > bestNew) {
      bestNew = newCount;
      bestId = source.id;
    }
  }
  return bestId;
}

/** Add or update selected paint lines without replacing rows already on the list. */
export type BrushoutPrimerFields = {
  catalog_item_id: string | null;
  primer_catalog_id: string | null;
  primer_name: string | null;
  self_priming: boolean | null;
};

/**
 * Primer stored on a brush-out row.
 * Same rule as effectivePaintPrimer and public.resolve_job_paint_primer:
 * override, else the catalog pair, else none. 'none' or no pair is self-priming.
 * No catalog loaded → leave the columns null rather than guessing.
 */
export function brushoutPrimerFields(item: PaintItem, products: PaintProduct[]): BrushoutPrimerFields {
  if (!products.length) {
    return { catalog_item_id: null, primer_catalog_id: null, primer_name: null, self_priming: null };
  }
  const catalog = findCatalogPaintProduct(products, item.product, item.manufacturer);
  const effect = effectivePaintPrimer(item, products);
  if (effect.isPrimerProduct) {
    return {
      catalog_item_id: catalog?.id ?? null,
      primer_catalog_id: null,
      primer_name: null,
      self_priming: false,
    };
  }
  if (!effect.primerId) {
    return {
      catalog_item_id: catalog?.id ?? null,
      primer_catalog_id: null,
      primer_name: null,
      self_priming: true,
    };
  }
  return {
    catalog_item_id: catalog?.id ?? null,
    primer_catalog_id: effect.primerId,
    primer_name: effect.primerName.trim() || null,
    self_priming: false,
  };
}

/** Read-only primer line under a finish. Uses the row's stored primer fields. */
export function brushoutPrimerCaption(
  row: Pick<
    ApprovedBrushoutDraft,
    "label" | "color" | "product" | "manufacturer" | "primer_name" | "primer_catalog_id" | "self_priming" | "catalog_item_id"
  >,
  products: PaintProduct[],
): string | null {
  if (isStandalonePrimerBrushout(row)) return null;
  if (row.self_priming) return "None (self-priming)";
  const name = row.primer_name?.trim();
  if (!name) return null;
  if (!products.length) return `Primer: ${name}`;
  const finish = row.catalog_item_id
    ? products.find((product) => product.id === row.catalog_item_id)
    : findCatalogPaintProduct(products, row.product, row.manufacturer);
  const paired = Boolean(finish?.paired_primer_id && finish.paired_primer_id === row.primer_catalog_id);
  return `Primer: ${name} (${paired ? "paired" : "override"})`;
}

/**
 * Match approved brush-outs to a paint line on project + label + product (case-insensitive).
 * Floor is not part of the key. When the product name changed, pass the previous product
 * so the stored row is still found; the caller then writes the new product so the next save matches.
 */
export function brushoutRowsMatchingPaintLine(
  rows: ApprovedBrushoutRow[],
  label: string,
  product: string,
  floor = "",
): ApprovedBrushoutRow[] {
  const key = brushoutDraftKey({ label, product, floor });
  if (!key) return [];
  return rows.filter((row) => row.approved && brushoutDraftKey(row) === key);
}

function paintLinePlace(item: PaintItem): string {
  return `${item.label.trim().toLowerCase()}|${item.floor.trim().toLowerCase()}`;
}

/** When a paint line's primer override or product changes, refresh matching approved brush-out primer columns. */
export async function syncApprovedBrushoutPrimers(args: {
  projectId: string;
  previous: PaintItem[];
  next: PaintItem[];
  products: PaintProduct[];
}): Promise<void> {
  if (!args.products.length) return;
  const updates: { ids: string[]; fields: BrushoutPrimerFields; product?: string; label?: string }[] = [];
  const rows = await listProjectBrushouts(args.projectId);
  for (const item of args.next) {
    const place = paintLinePlace(item);
    const atPlace = args.previous.filter((prev) => paintLinePlace(prev) === place);
    const sameProduct = atPlace.filter(
      (candidate) => candidate.product.trim().toLowerCase() === item.product.trim().toLowerCase(),
    );
    const prev =
      sameProduct.length === 1
        ? sameProduct[0]
        : atPlace.length === 1
          ? atPlace[0]
          : atPlace.find((candidate) => candidate.color.trim().toLowerCase() === item.color.trim().toLowerCase());
    if (!prev) continue;
    const productChanged = prev.product.trim().toLowerCase() !== item.product.trim().toLowerCase();
    const primerChanged = (prev.primer_override_id ?? "").trim() !== (item.primer_override_id ?? "").trim();
    if (!productChanged && !primerChanged) continue;
    const matches = brushoutRowsMatchingPaintLine(rows, prev.label, prev.product, prev.floor);
    if (!matches.length) continue;
    updates.push({
      ids: matches.map((row) => row.id),
      fields: brushoutPrimerFields(item, args.products),
      product: productChanged ? item.product.trim() : undefined,
      label: prev.label.trim().toLowerCase() !== item.label.trim().toLowerCase() ? item.label.trim() : undefined,
    });
  }
  const now = new Date().toISOString();
  for (const update of updates) {
    const { error } = await supabase
      .from("project_approved_brushouts")
      .update({
        ...update.fields,
        ...(update.product ? { product: update.product } : {}),
        ...(update.label ? { label: update.label } : {}),
        updated_at: now,
      } as never)
      .in("id", update.ids);
    if (error) throw new Error(error.message);
  }
}

/**
 * Stamp primer columns from the current paint submittal.
 * Match is label + product + location on this project, case-insensitive.
 */
export function stampBrushoutPrimerFields(
  rows: ApprovedBrushoutDraft[],
  items: PaintItem[],
  products: PaintProduct[],
): ApprovedBrushoutDraft[] {
  if (!products.length) return rows;
  return rows.map((row) => {
    const key = brushoutDraftKey(row);
    const item = key ? items.find((candidate) => brushoutDraftKey(candidate) === key) : undefined;
    if (!item) return row;
    return { ...row, ...brushoutPrimerFields(item, products) };
  });
}

export type BrushoutImportMerge = {
  rows: ApprovedBrushoutDraft[];
  added: number;
  updated: number;
};

/** One row per paint item. The same label + product + location updates primer fields and is not added again. */
export function mergePaintItemsIntoBrushoutRows(
  existing: ApprovedBrushoutDraft[],
  selectedItems: PaintItem[],
  paintVendor: string,
  products: PaintProduct[] = [],
): BrushoutImportMerge {
  const next = [...existing];
  const indexByKey = new Map<string, number>();
  next.forEach((row, index) => {
    const key = brushoutDraftKey(row);
    if (key) indexByKey.set(key, index);
  });

  let added = 0;
  let updated = 0;
  for (const item of selectedItems) {
    if (!brushoutImportDisplayLine(item)) continue;
    const draft = paintItemToBrushoutDraft(item, next.length, paintVendor, products);
    const key = brushoutDraftKey(draft);
    const index = key ? (indexByKey.get(key) ?? -1) : -1;
    if (index >= 0) {
      const prev = next[index]!;
      const sameColor =
        prev.color.trim().toLowerCase() === draft.color.trim().toLowerCase() &&
        prev.display_line.trim() === draft.display_line.trim();
      const primerPatch = products.length ? brushoutPrimerFields(item, products) : {};
      next[index] = {
        ...prev,
        color: draft.color,
        sheen: draft.sheen,
        manufacturer: draft.manufacturer,
        display_line: draft.display_line,
        approved: sameColor ? prev.approved : false,
        sort_order: prev.sort_order,
        ...primerPatch,
      };
      updated += 1;
      continue;
    }
    next.push({ ...draft, sort_order: next.length, approved: false });
    if (key) indexByKey.set(key, next.length - 1);
    added += 1;
  }

  return { rows: next, added, updated };
}

export function paintItemToBrushoutDraft(
  item: PaintItem,
  sortOrder: number,
  paintVendor: string,
  products: PaintProduct[] = [],
): ApprovedBrushoutDraft {
  const display_line = brushoutImportDisplayLine(item) ?? "";
  return {
    id: undefined,
    paint_vendor: paintVendor,
    label: item.label.trim(),
    floor: item.floor.trim(),
    manufacturer: item.manufacturer.trim(),
    color: item.color.trim(),
    product: item.product.trim(),
    sheen: item.sheen.trim(),
    display_line,
    approved: false,
    sort_order: sortOrder,
    ...brushoutPrimerFields(item, products),
  };
}

export async function listProjectBrushouts(projectId: string): Promise<ApprovedBrushoutRow[]> {
  const { data, error } = await supabase
    .from("project_approved_brushouts")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order")
    .order("display_line");
  if (error) throw new Error(error.message);
  return (data ?? []) as ApprovedBrushoutRow[];
}

/** Project IDs that have at least one approved brush-out Field Tools can load. */
export async function listProjectIdsWithApprovedBrushouts(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("project_approved_brushouts")
    .select("project_id")
    .eq("approved", true);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => String((row as { project_id: string }).project_id)));
}

export async function saveProjectBrushouts(
  projectId: string,
  jobNumber: string,
  rows: ApprovedBrushoutDraft[],
  approverName: string,
): Promise<void> {
  const now = new Date().toISOString();
  const job = jobNumber.trim();

  const { error: delErr } = await supabase
    .from("project_approved_brushouts")
    .delete()
    .eq("project_id", projectId);
  if (delErr) throw new Error(delErr.message);

  const approvedRows = rows.filter((r) => r.approved);
  if (!approvedRows.length) return;

  const payload = approvedRows.map((row, index) => ({
    project_id: projectId,
    job_number: job,
    paint_vendor: row.paint_vendor.trim(),
    label: row.label.trim(),
    floor: row.floor.trim(),
    manufacturer: row.manufacturer.trim(),
    color: row.color.trim(),
    product: row.product.trim(),
    sheen: row.sheen.trim(),
    display_line: row.display_line.trim() || row.color.trim(),
    catalog_item_id: row.catalog_item_id,
    primer_catalog_id: row.primer_catalog_id,
    primer_name: row.primer_name,
    self_priming: row.self_priming,
    approved: row.approved,
    approved_by_name: row.approved ? approverName.trim() : "",
    approved_at: row.approved ? now : null,
    sort_order: row.sort_order ?? index,
    updated_at: now,
  }));

  const { error: insErr } = await supabase
    .from("project_approved_brushouts" as "projects")
    .insert(payload as never);
  if (insErr) throw new Error(insErr.message);
}
