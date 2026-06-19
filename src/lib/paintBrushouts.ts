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

export async function sendToBrushoutsTracker(
  webappUrl: string | undefined,
  jobNumber: string,
  jobName: string,
  paintVendor: string,
  items: PaintItem[],
): Promise<void> {
  const paintItems = collectBrushoutColors(items);
  if (!paintItems.length) throw new Error("No paint items found. Add paint items before sending to BrushOuts.");
  if (!webappUrl?.trim()) {
    throw new Error("BrushOuts Tracker URL not configured. Add it in Settings → Google Apps Script URLs.");
  }

  const formData = {
    job_number: `${jobNumber} ${jobName}`.trim(),
    paint_vendor: paintVendor || "PPG",
    paint_items: paintItems,
  };

  const res = await fetch("/api/brushouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webappUrl.trim().replace(/\?.*$/, ""),
      payload: formData,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
  if (!res.ok) throw new Error(body.error ?? `BrushOuts request failed (${res.status})`);
}
