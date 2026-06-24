import type { PaintItem } from "../types/tradeDocuments";

export type BrushoutsPushMode = "merge" | "replace";

export type BrushoutLineStatus = "new" | "on_sheet" | "revised" | "pending";

export type BrushoutsPushPayload = {
  job_number: string;
  paint_vendor: string;
  paint_items: string[];
  mode: BrushoutsPushMode;
};

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

export function brushoutLineStatus(
  item: PaintItem,
  pushed: Record<string, string> | undefined,
): BrushoutLineStatus {
  const key = brushoutMergeKey(item);
  const line = brushoutColorLine(item);
  if (!key || !line) return "pending";
  const prev = pushed?.[key];
  if (!prev) return "new";
  if (prev === line) return "on_sheet";
  return "revised";
}

export const BRUSHOUT_LINE_STATUS_LABEL: Record<BrushoutLineStatus, string> = {
  new: "New",
  on_sheet: "On sheet",
  revised: "Revised",
  pending: "No color",
};

export function collectBrushoutColors(items: PaintItem[]): string[] {
  return items.map(brushoutColorLine).filter((c): c is string => Boolean(c));
}

export function applyBrushoutPushedSnapshot(
  pushed: Record<string, string> | undefined,
  items: PaintItem[],
): Record<string, string> {
  const next = { ...(pushed ?? {}) };
  for (const item of items) {
    const key = brushoutMergeKey(item);
    const line = brushoutColorLine(item);
    if (key && line) next[key] = line;
  }
  return next;
}

export function defaultBrushoutSelection(
  items: PaintItem[],
  pushed: Record<string, string> | undefined,
): Set<number> {
  const selected = new Set<number>();
  items.forEach((item, index) => {
    const status = brushoutLineStatus(item, pushed);
    if (status === "new" || status === "revised") selected.add(index);
  });
  return selected;
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

async function postBrushoutsPayload(
  webappUrl: string,
  formData: BrushoutsPushPayload,
): Promise<{ message?: string; colors_on_sheet?: number }> {
  const res = await fetch("/api/brushouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webappUrl.trim().replace(/\?.*$/, ""),
      payload: formData,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    body?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `BrushOuts request failed (${res.status})`);

  if (body.body) {
    try {
      return JSON.parse(body.body) as { message?: string; colors_on_sheet?: number };
    } catch {
      return {};
    }
  }
  return {};
}

export async function sendToBrushoutsTracker(
  webappUrl: string | undefined,
  jobNumber: string,
  jobName: string,
  paintVendor: string,
  items: PaintItem[],
  options?: {
    mode?: BrushoutsPushMode;
    /** When set, only these row indices are sent (must have colors). */
    selectedIndices?: number[];
  },
): Promise<{ message: string; count: number }> {
  const indices =
    options?.selectedIndices ??
    items.map((item, i) => (brushoutColorLine(item) ? i : -1)).filter((i) => i >= 0);

  const paintItems = indices
    .map((i) => brushoutColorLine(items[i]!))
    .filter((c): c is string => Boolean(c));

  if (!paintItems.length) {
    throw new Error("No paint items selected. Choose lines with colors before sending to BrushOuts.");
  }
  if (!webappUrl?.trim()) {
    throw new Error("BrushOuts Tracker URL not configured. Add it in Settings → Google Apps Script URLs.");
  }

  const formData: BrushoutsPushPayload = {
    job_number: `${jobNumber} ${jobName}`.trim(),
    paint_vendor: paintVendor || "PPG",
    paint_items: paintItems,
    mode: options?.mode ?? "merge",
  };

  const parsed = await postBrushoutsPayload(webappUrl, formData);
  const count = paintItems.length;
  const message =
    parsed.message ??
    `Brush outs pushed (${count} line${count === 1 ? "" : "s"}${parsed.colors_on_sheet ? `, ${parsed.colors_on_sheet} on sheet` : ""}).`;
  return { message, count };
}
