import type { PaintItem } from "../types/tradeDocuments";

/** Excel-style column labels: A…Z, AA, AB… */
export function paintRowAutoLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function applyPaintAutoLabels(items: PaintItem[]): PaintItem[] {
  return items.map((item, index) => ({ ...item, label: paintRowAutoLabel(index) }));
}

/** True when labels are empty or already match A, B, C… order (safe to keep auto-label on). */
export function paintItemsSuggestAutoLabel(items: PaintItem[]): boolean {
  if (!items.length) return true;
  return items.every((item, index) => {
    const label = item.label.trim();
    return !label || label === paintRowAutoLabel(index);
  });
}

export function paintItemsReadiness(items: PaintItem[]) {
  const contentItems = items.filter((i) => i.label.trim() || i.color.trim() || i.product.trim());
  const rows = contentItems.length ? contentItems : items;
  let missingColor = 0;
  let missingSheen = 0;
  for (const item of rows) {
    if (!item.color.trim()) missingColor += 1;
    if (!item.sheen.trim()) missingSheen += 1;
  }
  return {
    count: rows.length,
    missingColor,
    missingSheen,
    complete: missingColor === 0 && missingSheen === 0 && rows.length > 0,
    summaryLine:
      rows.length === 0
        ? "0 items"
        : missingColor === 0 && missingSheen === 0
          ? `${rows.length} item${rows.length === 1 ? "" : "s"} · complete`
          : [
              `${rows.length} item${rows.length === 1 ? "" : "s"}`,
              missingColor ? `${missingColor} missing color` : null,
              missingSheen ? `${missingSheen} missing sheen` : null,
            ]
              .filter(Boolean)
              .join(" · "),
    confirmMessage: [
      missingColor ? `${missingColor} item${missingColor === 1 ? "" : "s"} missing color.` : null,
      missingSheen ? `${missingSheen} item${missingSheen === 1 ? "" : "s"} missing sheen.` : null,
      "Continue?",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
