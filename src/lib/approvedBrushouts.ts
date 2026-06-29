import { supabase } from "./supabase";
import { brushoutColorLine, brushoutMergeKey, normalizeFloorForBrushout } from "./paintBrushouts";
import { formatSubmittalHistoryLabel, historyEntryKey } from "./submittalHistory";
import type { PaintItem, PaintSubmittalData, SubmittalHistoryEntry } from "../types/tradeDocuments";

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
};

export type ApprovedBrushoutDraft = Omit<
  ApprovedBrushoutRow,
  "id" | "project_id" | "job_number" | "approved_by_name" | "approved_at"
> & { id?: string };

export function brushoutDraftKey(row: { label: string; floor: string; color?: string }): string {
  const label = row.label.trim().toLowerCase();
  const floor = normalizeFloorForBrushout(row.floor).toLowerCase();
  if (label && floor) return `${label}|${floor}`;
  if (label) return label;
  return (row.color?.trim() ?? "").toLowerCase();
}

export type BrushoutImportLineStatus = "new" | "on_list" | "revised";

export function brushoutImportLineStatus(
  item: PaintItem,
  existing: ApprovedBrushoutDraft[],
): BrushoutImportLineStatus {
  const key = brushoutMergeKey(item);
  const line = brushoutColorLine(item);
  if (!key || !line) return "new";

  const match = existing.find((row) => brushoutDraftKey(row) === key);
  if (!match) return "new";
  if (match.display_line.trim() === line.trim() || match.color.trim() === item.color.trim()) return "on_list";
  return "revised";
}

export function defaultApprovedBrushoutImportSelection(
  items: PaintItem[],
  existing: ApprovedBrushoutDraft[],
): Set<number> {
  const selected = new Set<number>();
  items.forEach((item, index) => {
    if (!brushoutColorLine(item)) return;
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

function paintItemsWithColor(items: PaintItem[]): PaintItem[] {
  return items.filter((item) => Boolean(item.color?.trim()));
}

/** Current paint tab plus each saved history package — pick one when importing. */
export function buildBrushoutImportSources(
  paintSubmittal: PaintSubmittalData,
  history: SubmittalHistoryEntry[] | undefined,
): BrushoutImportSource[] {
  const sources: BrushoutImportSource[] = [];
  const currentItems = paintItemsWithColor(paintSubmittal.items);
  if (currentItems.length) {
    sources.push({
      id: "current",
      label: `Current paint tab — #${paintSubmittal.submittal_number} Rev ${paintSubmittal.revision_number ?? 0} (${currentItems.length} color${currentItems.length === 1 ? "" : "s"})`,
      items: currentItems,
    });
  }

  const sortedHistory = [...(history ?? [])].sort((a, b) => {
    const numDiff = (b.submittal_number ?? 0) - (a.submittal_number ?? 0);
    if (numDiff !== 0) return numDiff;
    return (b.revision_number ?? 0) - (a.revision_number ?? 0);
  });

  for (const entry of sortedHistory) {
    const items = paintItemsWithColor(entry.items as PaintItem[]);
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
export function mergePaintItemsIntoBrushoutRows(
  existing: ApprovedBrushoutDraft[],
  selectedItems: PaintItem[],
  paintVendor: string,
): ApprovedBrushoutDraft[] {
  const next = [...existing];
  const indexByKey = new Map<string, number>();
  next.forEach((row, index) => {
    const key = brushoutDraftKey(row);
    if (key) indexByKey.set(key, index);
  });

  for (const item of selectedItems) {
    const draft = paintItemToBrushoutDraft(item, next.length, paintVendor);
    const key = brushoutDraftKey(draft);
    if (key && indexByKey.has(key)) {
      const index = indexByKey.get(key)!;
      const prev = next[index]!;
      const sameColor =
        prev.color.trim() === draft.color.trim() &&
        prev.display_line.trim() === draft.display_line.trim();
      next[index] = {
        ...prev,
        ...draft,
        id: prev.id,
        approved: sameColor ? prev.approved : false,
        sort_order: prev.sort_order,
      };
      continue;
    }
    next.push({ ...draft, sort_order: next.length, approved: false });
    if (key) indexByKey.set(key, next.length - 1);
  }

  return next;
}

export function paintItemToBrushoutDraft(
  item: PaintItem,
  sortOrder: number,
  paintVendor: string,
): ApprovedBrushoutDraft {
  const display_line = brushoutColorLine(item) ?? "";
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
