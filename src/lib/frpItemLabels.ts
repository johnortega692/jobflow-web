import type { FrpItem } from "../types/tradeDocuments";

/** Auto-label sequence: F-1, F-2… */
export function frpRowAutoLabel(index: number): string {
  return `F-${index + 1}`;
}

export function applyFrpAutoLabels(items: FrpItem[]): FrpItem[] {
  return items.map((item, index) => ({ ...item, label: frpRowAutoLabel(index) }));
}

/** True when labels are empty or already match F-1, F-2… */
export function frpItemsSuggestAutoLabel(items: FrpItem[]): boolean {
  if (!items.length) return true;
  return items.every((item, index) => {
    const label = item.label.trim();
    return !label || label === frpRowAutoLabel(index);
  });
}

const UNIT_WORD_MAP: Record<string, string> = {
  ea: "EA",
  each: "EA",
  sht: "SHT",
  sheet: "SHT",
  sheets: "SHT",
  lf: "LF",
  "lin ft": "LF",
  "linear foot": "LF",
  "linear feet": "LF",
  ft: "LF",
  foot: "LF",
  feet: "LF",
};

/** Extract numeric qty + unit from free-text quantity. */
export function parseFrpQtyField(
  qtyRaw: string,
  existingUnit?: string,
  defaultUnit = "EA",
): { quantity: string; unit: string } {
  const trimmed = qtyRaw.trim();
  const fallbackUnit = existingUnit?.trim() || defaultUnit;
  if (!trimmed) return { quantity: "", unit: fallbackUnit };

  const spaced = trimmed.match(/^(\d+(?:\.\d+)?)\s+(.+)$/i);
  if (spaced) {
    const unitKey = spaced[2]!.trim().toLowerCase().replace(/\./g, "");
    return {
      quantity: spaced[1]!,
      unit: UNIT_WORD_MAP[unitKey] ?? fallbackUnit,
    };
  }

  const glued = trimmed.match(/^(\d+(?:\.\d+)?)([a-zA-Z].*)$/);
  if (glued) {
    const unitKey = glued[2]!.trim().toLowerCase().replace(/\./g, "");
    return {
      quantity: glued[1]!,
      unit: UNIT_WORD_MAP[unitKey] ?? fallbackUnit,
    };
  }

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return { quantity: trimmed, unit: fallbackUnit };
  }

  return { quantity: "", unit: fallbackUnit };
}

export function frpItemsReadiness(items: FrpItem[]) {
  const contentItems = items.filter(
    (i) => i.label.trim() || i.manufacturer.trim() || i.product.trim() || i.color.trim(),
  );
  const all = contentItems.length ? contentItems : items;
  const rows = all.filter((i) => i.include_in_submittal !== false);
  const excluded = all.length - rows.length;
  let missingManufacturer = 0;
  let missingProduct = 0;
  let missingColor = 0;
  let missingQty = 0;
  for (const item of rows) {
    if (!item.manufacturer.trim()) missingManufacturer += 1;
    if (!item.product.trim()) missingProduct += 1;
    if (!item.color.trim()) missingColor += 1;
    if (!item.quantity.trim()) missingQty += 1;
  }
  const gaps = missingManufacturer + missingProduct + missingColor + missingQty;
  return {
    count: rows.length,
    excluded,
    missingManufacturer,
    missingProduct,
    missingColor,
    missingQty,
    gaps,
    complete: gaps === 0 && rows.length > 0,
    summaryLine:
      all.length === 0
        ? "0 items"
        : gaps === 0
          ? [
              `${rows.length} item${rows.length === 1 ? "" : "s"} · complete`,
              excluded ? `${excluded} off PDF` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : [
              `${rows.length} item${rows.length === 1 ? "" : "s"}`,
              missingProduct ? `${missingProduct} missing product` : null,
              missingColor ? `${missingColor} missing color` : null,
              missingQty ? `${missingQty} missing qty` : null,
              excluded ? `${excluded} off PDF` : null,
            ]
              .filter(Boolean)
              .join(" · "),
    confirmMessage: [
      missingProduct
        ? `${missingProduct} item${missingProduct === 1 ? "" : "s"} missing product.`
        : null,
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
