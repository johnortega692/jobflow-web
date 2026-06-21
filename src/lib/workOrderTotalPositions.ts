import { DEFAULT_TOTAL_POSITIONS } from "./workOrderOverlays";
import type { WorkOrderOverlay } from "../types/workOrder";

/** Gap between total label and amount — matches desktop TOTAL_LABEL_AMOUNT_GAP. */
export const TOTAL_LABEL_AMOUNT_GAP = 100;

export const TOTAL_OVERLAY_LABELS = [
  "Material Total 1",
  "Material Total 2",
  "Labor Total",
  "Labor Total 2",
  "Grand Total",
] as const;

export type TotalOverlayLabel = (typeof TOTAL_OVERLAY_LABELS)[number];
export type WorkOrderTotalPositions = Record<string, { x: number; y: number }>;

export function defaultTotalPositions(): WorkOrderTotalPositions {
  return { ...DEFAULT_TOTAL_POSITIONS };
}

export function normalizeTotalPositions(raw: unknown): WorkOrderTotalPositions {
  const merged = defaultTotalPositions();
  if (!raw || typeof raw !== "object") return merged;
  const o = raw as Record<string, unknown>;
  for (const label of TOTAL_OVERLAY_LABELS) {
    const row = o[label];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const x = Number(r.x);
    const y = Number(r.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      merged[label] = { x, y };
    }
  }
  return merged;
}

export function extractTotalPositionsFromOverlays(overlays: WorkOrderOverlay[]): WorkOrderTotalPositions {
  const positions: WorkOrderTotalPositions = {};
  for (const o of overlays) {
    if (o.section !== "total") continue;
    positions[o.label] = { x: o.x, y: o.y };
  }
  return positions;
}

/** Move existing total overlays to saved positions; leave other overlays unchanged. */
export function applySavedTotalPositions(
  overlays: WorkOrderOverlay[],
  positions: WorkOrderTotalPositions,
): WorkOrderOverlay[] {
  return overlays.map((o) => {
    if (o.section !== "total") return o;
    const pos = positions[o.label];
    if (!pos) return o;
    return { ...o, x: pos.x, y: pos.y };
  });
}

export function positionForTotalLabel(
  label: string,
  positions: WorkOrderTotalPositions,
): { x: number; y: number } {
  return positions[label] ?? DEFAULT_TOTAL_POSITIONS[label] ?? { x: 400, y: 400 };
}

/** Whether a total row appears on canvas/PDF — matches desktop is_total_row_visible. */
export function isTotalRowVisible(label: string, prefs: { show_material_total_1: boolean; show_labor_total: boolean }): boolean {
  const key = String(label ?? "");
  if (key.includes("Material Total 1")) return prefs.show_material_total_1;
  if (key.includes("Labor Total 2")) return true;
  if (key.includes("Labor Total")) return prefs.show_labor_total;
  return true;
}
