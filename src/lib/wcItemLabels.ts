import type { WallcoveringItem } from "../types/tradeDocuments";

const WC_TRACK_MFR = "APS";
const WC_TRACK_PRODUCT = "Track and Infill";

function isTrackRow(item: WallcoveringItem): boolean {
  return (
    item.product.trim() === WC_TRACK_PRODUCT &&
    item.manufacturer.trim().toUpperCase() === WC_TRACK_MFR
  );
}

/** Auto-label sequence for content rows: W-1, W-2… */
export function wcRowAutoLabel(index: number): string {
  return `W-${index + 1}`;
}

/** Apply W-1… labels to non-track rows; track rows keep an empty label. */
export function applyWcAutoLabels(items: WallcoveringItem[]): WallcoveringItem[] {
  let n = 0;
  return items.map((item) => {
    if (isTrackRow(item)) return { ...item, label: "" };
    return { ...item, label: wcRowAutoLabel(n++) };
  });
}

/** True when content-row labels are empty or already match W-1, W-2… */
export function wcItemsSuggestAutoLabel(items: WallcoveringItem[]): boolean {
  const content = items.filter((i) => !isTrackRow(i));
  if (!content.length) return true;
  return content.every((item, index) => {
    const label = item.label.trim();
    return !label || label === wcRowAutoLabel(index);
  });
}

const UNIT_WORD_MAP: Record<string, string> = {
  ly: "LY",
  "lin yd": "LY",
  "linear yard": "LY",
  "linear yards": "LY",
  yard: "LY",
  yards: "LY",
  yd: "LY",
  yds: "LY",
  sy: "SY",
  "sq yd": "SY",
  "sq yds": "SY",
  "square yard": "SY",
  "square yards": "SY",
  rl: "RL",
  roll: "RL",
  rolls: "RL",
  ea: "EA",
  each: "EA",
  lf: "LF",
  "lin ft": "LF",
  "linear foot": "LF",
  "linear feet": "LF",
  ft: "LF",
  foot: "LF",
  feet: "LF",
};

/** Extract numeric qty + unit from free-text qty (e.g. "10yards" → 10 / LY). */
export function parseWcQtyField(
  qtyRaw: string,
  existingUnit?: string,
  defaultUnit = "LY",
): { qty: string; unit: string } {
  const trimmed = qtyRaw.trim();
  const fallbackUnit = existingUnit?.trim() || defaultUnit;
  if (!trimmed) return { qty: "", unit: fallbackUnit };

  const spaced = trimmed.match(/^(\d+(?:\.\d+)?)\s+(.+)$/i);
  if (spaced) {
    const unitKey = spaced[2]!.trim().toLowerCase().replace(/\./g, "");
    return {
      qty: spaced[1]!,
      unit: UNIT_WORD_MAP[unitKey] ?? fallbackUnit,
    };
  }

  const glued = trimmed.match(/^(\d+(?:\.\d+)?)([a-zA-Z].*)$/);
  if (glued) {
    const unitKey = glued[2]!.trim().toLowerCase().replace(/\./g, "");
    return {
      qty: glued[1]!,
      unit: UNIT_WORD_MAP[unitKey] ?? fallbackUnit,
    };
  }

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return { qty: trimmed, unit: fallbackUnit };
  }

  // Non-numeric leftover — clear qty, keep unit
  return { qty: "", unit: fallbackUnit };
}

export function wcContentItems(items: WallcoveringItem[]): WallcoveringItem[] {
  return items.filter((i) => !isTrackRow(i));
}

/** True when any content row has a floor value (forces Show floor on). */
export function wcItemsHaveFloor(items: WallcoveringItem[]): boolean {
  return items.some((i) => !isTrackRow(i) && i.floor.trim().length > 0);
}

export function wcItemsReadiness(items: WallcoveringItem[]) {
  const rows = wcContentItems(items);
  let missingColor = 0;
  let missingQty = 0;
  let missingManufacturer = 0;
  for (const item of rows) {
    if (!item.color.trim()) missingColor += 1;
    if (!item.qty.trim()) missingQty += 1;
    if (!item.manufacturer.trim()) missingManufacturer += 1;
  }
  const gaps = missingColor + missingQty + missingManufacturer;
  return {
    count: rows.length,
    missingColor,
    missingQty,
    missingManufacturer,
    complete: gaps === 0 && rows.length > 0,
    summaryLine:
      rows.length === 0
        ? "0 items"
        : gaps === 0
          ? `${rows.length} item${rows.length === 1 ? "" : "s"} · complete`
          : [
              `${rows.length} item${rows.length === 1 ? "" : "s"}`,
              missingColor ? `${missingColor} missing color` : null,
              missingQty ? `${missingQty} missing qty` : null,
              missingManufacturer ? `${missingManufacturer} missing manufacturer` : null,
            ]
              .filter(Boolean)
              .join(" · "),
    confirmMessage: [
      missingColor ? `${missingColor} item${missingColor === 1 ? "" : "s"} missing color.` : null,
      missingQty ? `${missingQty} item${missingQty === 1 ? "" : "s"} missing qty.` : null,
      missingManufacturer
        ? `${missingManufacturer} item${missingManufacturer === 1 ? "" : "s"} missing manufacturer.`
        : null,
      "Continue?",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
