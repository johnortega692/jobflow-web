import type { PaintItem, PaintRevisionChange } from "../types/tradeDocuments";

export function normalizeFloorForBrushout(floor: string): string {
  return floor.replace(/Floor/gi, "FL").trim();
}

/** One color cell: "Label - FL - Color" (matches desktop Copy / Add BrushOuts). */
export function brushoutColorLine(item: PaintItem): string | null {
  const color = item.color.trim();
  if (!color) return null;
  const label = item.label.trim();
  const floor = normalizeFloorForBrushout(item.floor);
  return [label, floor, color].filter(Boolean).join(" - ");
}

/** Stable key for merge — label + floor (color can change on revision). */
export function brushoutMergeKey(item: PaintItem): string | null {
  const line = brushoutColorLine(item);
  if (!line) return null;
  const parts = line.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return `${parts[0]}|${parts[1]}`.toLowerCase();
  if (parts.length === 2) return parts[0]!.toLowerCase();
  return line.toLowerCase();
}

export function collectBrushoutColors(items: PaintItem[]): string[] {
  return items.map(brushoutColorLine).filter((c): c is string => Boolean(c));
}

export type BrushoutOrderLineStatus = "new" | "switched" | "unchanged";

function brushoutOrderMatchKey(item: PaintItem): string {
  const label = item.label.trim().toLowerCase();
  const floor = normalizeFloorForBrushout(item.floor).toLowerCase();
  if (label && floor) return `${label}|${floor}`;
  if (label) return label;
  return `color:${item.color.trim().toLowerCase()}`;
}

/** Compare a revision line to the last issued package: new label, color switch, or already ordered. */
export function brushoutOrderLineStatus(
  item: PaintItem,
  previouslyOrdered: PaintItem[],
): BrushoutOrderLineStatus {
  if (!item.color.trim()) return "new";
  if (!previouslyOrdered.length) return "new";
  const key = brushoutOrderMatchKey(item);
  const matches = previouslyOrdered.filter((prev) => brushoutOrderMatchKey(prev) === key);
  if (!matches.length) return "new";
  const color = item.color.trim().toLowerCase();
  if (matches.some((prev) => prev.color.trim().toLowerCase() === color)) return "unchanged";
  return "switched";
}

/** First order: all colors. Revision: new + switched colors. */
export function defaultBrushoutOrderSelection(
  items: PaintItem[],
  previouslyOrdered: PaintItem[] = [],
): Set<number> {
  const selected = new Set<number>();
  const hasPrevious = previouslyOrdered.some((item) => item.color.trim());
  items.forEach((item, index) => {
    if (!item.color.trim()) return;
    if (!hasPrevious) {
      selected.add(index);
      return;
    }
    const status = brushoutOrderLineStatus(item, previouslyOrdered);
    if (status === "new" || status === "switched") selected.add(index);
  });
  return selected;
}

/** GC-facing labels for a revision paint list vs the previous issued package. */
export function paintRevisionChangeLabel(
  item: PaintItem,
  previousItems: PaintItem[],
): PaintRevisionChange | null {
  if (!previousItems.some((row) => row.color.trim() || row.label.trim())) return null;
  if (
    item.revision_change === "NEW" ||
    item.revision_change === "REVISED" ||
    item.revision_change === "No Change" ||
    item.revision_change === "Removed"
  ) {
    return item.revision_change;
  }
  const status = brushoutOrderLineStatus(item, previousItems);
  if (status === "new") return "NEW";
  if (status === "switched") return "REVISED";
  return "No Change";
}

export function buildBrushoutsClipboardRow(
  jobNumber: string,
  jobName: string,
  paintVendor: string,
  items: PaintItem[],
): string {
  const colors = collectBrushoutColors(items);
  const jobAndName = `${jobNumber} ${jobName}`.trim();
  const row = [jobAndName, "", paintVendor || "PPG", ...colors];
  return row.join("\t");
}

export async function copyBrushoutsRow(
  jobNumber: string,
  jobName: string,
  paintVendor: string,
  items: PaintItem[],
): Promise<number> {
  const colors = collectBrushoutColors(items);
  if (!colors.length) throw new Error("No paint colors found. Add items with colors first.");
  const text = buildBrushoutsClipboardRow(jobNumber, jobName, paintVendor, items);
  await navigator.clipboard.writeText(text);
  return colors.length;
}
