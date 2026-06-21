import type { WorkOrderOverlay } from "../types/workOrder";
import type { WorkOrderFontSettings } from "../types/workOrderSettings";
import { fontSizeForOverlay } from "./workOrderFonts";
import { formatMoney, parseMoney } from "./workOrderCalc";
export { overlayDisplayText } from "./workOrderOverlayLayout";
import {
  defaultTotalPositions,
  positionForTotalLabel,
  type WorkOrderTotalPositions,
} from "./workOrderTotalPositions";

export const DEFAULT_TOTAL_POSITIONS: Record<string, { x: number; y: number }> = {
  "Material Total 1": { x: 400, y: 325 },
  "Material Total 2": { x: 400, y: 700 },
  "Labor Total": { x: 400, y: 670 },
  "Labor Total 2": { x: 400, y: 740 },
  "Grand Total": { x: 400, y: 730 },
};

export function newOverlayId(): string {
  return crypto.randomUUID();
}

export function sumOverlaySection(overlays: WorkOrderOverlay[], section: "material" | "labor"): number {
  return overlays
    .filter((o) => o.section === section)
    .reduce((sum, o) => sum + parseMoney(o.amount), 0);
}

/** Update Material/Labor/Grand total overlay amounts from line overlays. */
export function refreshTotalOverlayAmounts(overlays: WorkOrderOverlay[]): WorkOrderOverlay[] {
  const materialSum = sumOverlaySection(overlays, "material");
  const laborSum = sumOverlaySection(overlays, "labor");
  const grand = Math.ceil(materialSum + laborSum);

  return overlays.map((o) => {
    if (o.section !== "total") return o;
    const key = o.label;
    if (key === "Material Total 1" || key === "Material Total 2") {
      return { ...o, amount: formatMoney(materialSum) };
    }
    if (key === "Labor Total" || key === "Labor Total 2") {
      return { ...o, amount: formatMoney(laborSum) };
    }
    if (key === "Grand Total") {
      return { ...o, amount: formatMoney(grand) };
    }
    return o;
  });
}

export function createDefaultTotalOverlays(
  fonts: WorkOrderFontSettings,
  positions: WorkOrderTotalPositions = defaultTotalPositions(),
): WorkOrderOverlay[] {
  const keys = [
    "Material Total 1",
    "Material Total 2",
    "Labor Total",
    "Labor Total 2",
    "Grand Total",
  ] as const;
  return keys.map((label) => {
    const pos = positionForTotalLabel(label, positions);
    return {
      id: newOverlayId(),
      section: "total" as const,
      label,
      price: label,
      amount: formatMoney(0),
      hours: null,
      quantity: null,
      color: fonts.overlay_color,
      x: pos.x,
      y: pos.y,
      font_size: fontSizeForOverlay("total", label, fonts),
    };
  });
}

export function initializeTotalOverlays(
  overlays: WorkOrderOverlay[],
  fonts: WorkOrderFontSettings,
  positions: WorkOrderTotalPositions = defaultTotalPositions(),
): WorkOrderOverlay[] {
  const withoutTotals = overlays.filter((o) => o.section !== "total");
  return refreshTotalOverlayAmounts([...withoutTotals, ...createDefaultTotalOverlays(fonts, positions)]);
}

/** Ensure all five total fields exist on the document using saved/default positions. */
export function ensureTotalOverlaysOnCanvas(
  overlays: WorkOrderOverlay[],
  fonts: WorkOrderFontSettings,
  positions: WorkOrderTotalPositions = defaultTotalPositions(),
): WorkOrderOverlay[] {
  const hasTotals = overlays.some((o) => o.section === "total");
  if (!hasTotals) {
    return initializeTotalOverlays(overlays, fonts, positions);
  }
  return refreshTotalOverlayAmounts(overlays);
}

export function createMaterialOverlay(input: {
  name: string;
  unitPrice: number;
  quantity: number;
  fonts: WorkOrderFontSettings;
  yOffset: number;
}): WorkOrderOverlay {
  const total = input.unitPrice * (input.quantity > 0 ? input.quantity : 1);
  const qtyStr =
    input.quantity === Math.floor(input.quantity) ? String(input.quantity) : String(input.quantity);
  return {
    id: newOverlayId(),
    section: "material",
    label: input.name,
    price: formatMoney(input.unitPrice),
    amount: formatMoney(total),
    hours: null,
    quantity: qtyStr,
    color: input.fonts.overlay_color,
    x: 50,
    y: 50 + input.yOffset,
    font_size: fontSizeForOverlay("material", input.name, input.fonts),
  };
}

export function createLaborOverlay(input: {
  name: string;
  hours: number;
  rate: number;
  fonts: WorkOrderFontSettings;
  yOffset: number;
}): WorkOrderOverlay {
  const total = input.hours * input.rate;
  const hoursStr = input.hours === Math.floor(input.hours) ? `${input.hours}hrs` : `${input.hours}hrs`;
  return {
    id: newOverlayId(),
    section: "labor",
    label: input.name,
    price: formatMoney(input.rate),
    amount: formatMoney(total),
    hours: hoursStr,
    quantity: null,
    color: input.fonts.overlay_color,
    x: 50,
    y: 50 + input.yOffset,
    font_size: fontSizeForOverlay("labor", input.name, input.fonts),
  };
}

export function moveOverlay(
  overlays: WorkOrderOverlay[],
  id: string,
  x: number,
  y: number,
): WorkOrderOverlay[] {
  return overlays.map((o) => (o.id === id ? { ...o, x, y } : o));
}

export function removeOverlay(overlays: WorkOrderOverlay[], id: string): WorkOrderOverlay[] {
  return refreshTotalOverlayAmounts(overlays.filter((o) => o.id !== id));
}

export function addOverlays(
  overlays: WorkOrderOverlay[],
  added: WorkOrderOverlay[],
): WorkOrderOverlay[] {
  return refreshTotalOverlayAmounts([...overlays, ...added]);
}
