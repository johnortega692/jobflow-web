import type { PaintItem } from "../types/tradeDocuments";

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
