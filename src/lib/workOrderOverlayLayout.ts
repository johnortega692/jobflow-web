import type { WorkOrderOverlay } from "../types/workOrder";
import type { WorkOrderDisplayPrefs } from "../types/workOrderScan";
import { DEFAULT_DISPLAY_PREFS } from "../types/workOrderScan";

export const DEFAULT_OVERLAY_SPACING = 100;
export const MIN_OVERLAY_SPACING = 10;
export const MAX_OVERLAY_SPACING = 200;

export type WorkOrderTextSpacing = {
  material: number;
  labor: number;
};

export type OverlayTextSegment = { text: string };

export function defaultTextSpacing(): WorkOrderTextSpacing {
  return { material: DEFAULT_OVERLAY_SPACING, labor: DEFAULT_OVERLAY_SPACING };
}

export function normalizeTextSpacing(raw: unknown): WorkOrderTextSpacing {
  const base = defaultTextSpacing();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const clamp = (v: unknown, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(MIN_OVERLAY_SPACING, Math.min(MAX_OVERLAY_SPACING, Math.round(n)));
  };
  return {
    material: clamp(o.material ?? o.material_spacing, base.material),
    labor: clamp(o.labor ?? o.labor_spacing, base.labor),
  };
}

export function spacingForOverlay(o: WorkOrderOverlay, spacing: WorkOrderTextSpacing): number {
  if (o.section === "material") return spacing.material;
  if (o.section === "labor") return spacing.labor;
  return 0;
}

/** Horizontal text segments for material/labor rows — matches desktop spacing layout. */
export function overlaySegments(
  o: WorkOrderOverlay,
  prefs: WorkOrderDisplayPrefs = DEFAULT_DISPLAY_PREFS,
): OverlayTextSegment[] {
  if (o.section === "total") {
    return o.amount ? [{ text: o.amount }] : [];
  }
  if (o.section === "material") {
    const segs: OverlayTextSegment[] = [];
    if (prefs.show_material_names && o.label) segs.push({ text: o.label });
    if (prefs.show_material_quantity && o.quantity) segs.push({ text: o.quantity });
    if (o.price) segs.push({ text: o.price });
    if (o.amount) segs.push({ text: o.amount });
    return segs;
  }
  if (o.section === "labor") {
    const segs: OverlayTextSegment[] = [];
    if (prefs.show_labor_names && o.label) segs.push({ text: o.label });
    const isSupervision = o.label.toLowerCase().includes("supervision");
    const showHours = o.hours && (isSupervision ? prefs.show_supervision_hours : prefs.show_hours);
    if (showHours) segs.push({ text: o.hours! });
    if (o.price) segs.push({ text: o.price });
    if (o.amount) segs.push({ text: o.amount });
    return segs;
  }
  const fallback = o.label || o.amount;
  return fallback ? [{ text: fallback }] : [];
}

export function overlayDisplayText(
  o: WorkOrderOverlay,
  prefs: WorkOrderDisplayPrefs = DEFAULT_DISPLAY_PREFS,
): string {
  return overlaySegments(o, prefs)
    .map((s) => s.text)
    .join("  ");
}

/** Measure overlay text width in model coordinates (matches canvas + PDF layout). */
export function browserTextWidth(text: string, fontSize: number): number {
  if (typeof document === "undefined") return text.length * fontSize * 0.55;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * fontSize * 0.55;
  ctx.font = `600 ${fontSize}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}

export type SegmentLayout = { segments: OverlayTextSegment[]; offsets: number[]; width: number };

/** Place each segment after prior text + gap — matches inline-flex canvas layout. */
export function layoutOverlaySegments(
  segments: OverlayTextSegment[],
  gap: number,
  fontSize: number,
  measureWidth: (text: string, fontSize: number) => number = browserTextWidth,
): SegmentLayout {
  const visible = segments.filter((s) => s.text.trim());
  const offsets: number[] = [];
  let x = 0;
  for (let i = 0; i < visible.length; i++) {
    offsets.push(x);
    x += measureWidth(visible[i].text, fontSize);
    if (i < visible.length - 1) x += gap;
  }
  return { segments: visible, offsets, width: x };
}
