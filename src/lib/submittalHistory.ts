import type {
  PaintItem,
  SubmittalHistoryEntry,
  TradeSubmittalType,
  WallcoveringItem,
} from "../types/tradeDocuments";

export type SubmittalScope = "paint" | "wallcovering";

const TYPE_LABELS: Record<string, string> = {
  new: "New",
  revised: "Revised",
  substitution: "Substitution",
  original: "Original",
};

export function formatSubmittalHistoryLabel(entry: SubmittalHistoryEntry): string {
  const num = entry.submittal_number ?? "?";
  const dateStr = entry.date?.split(" ")[0] ?? entry.date ?? "Unknown date";
  const count = entry.items?.length ?? 0;
  const type = entry.submittal_type ? TYPE_LABELS[entry.submittal_type] ?? entry.submittal_type : "";
  const typePart = type ? ` · ${type}` : "";
  const scopePart = entry.scope === "wallcovering" ? " · WC" : "";
  return `Submittal #${num} - ${dateStr} (${count} items)${typePart}${scopePart}`;
}

export function addSubmittalToHistory(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
  items: PaintItem[] | WallcoveringItem[],
  submittalType: TradeSubmittalType,
  scope: SubmittalScope,
): SubmittalHistoryEntry[] {
  const filtered = items.filter((i) => {
    const row = i as PaintItem & WallcoveringItem;
    return row.color?.trim() || row.product?.trim() || row.label?.trim() || row.manufacturer?.trim();
  });
  const entry: SubmittalHistoryEntry = {
    submittal_number: submittalNumber,
    date: new Date().toISOString().replace("T", " ").slice(0, 19),
    items:
      scope === "paint"
        ? (filtered as PaintItem[]).map((i) => ({ ...i }))
        : (filtered as WallcoveringItem[]).map((i) => ({ ...i })),
    scope,
    submittal_type: submittalType,
  };
  return [...history.filter((h) => h.submittal_number !== submittalNumber), entry].sort(
    (a, b) => (b.submittal_number ?? 0) - (a.submittal_number ?? 0),
  );
}

export function removeSubmittalFromHistory(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
): SubmittalHistoryEntry[] {
  return history.filter((h) => h.submittal_number !== submittalNumber);
}

export function nextSubmittalNumber(history: SubmittalHistoryEntry[]): number {
  const nums = history.map((h) => h.submittal_number).filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

/** Load history items for revised/substitution workflow (desktop parity). */
export function mapHistoryItemsForRevisedLoad<T extends PaintItem | WallcoveringItem>(
  items: T[],
  submittalType: TradeSubmittalType,
): T[] {
  const isSubstitution = submittalType === "substitution";
  return items.map((item) => {
    const loadedColor = item.color ?? "";
    const prev = (item as PaintItem).previous_color ?? "";
    if (isSubstitution) {
      return {
        ...item,
        color: "",
        previous_color: prev.trim() || loadedColor,
      } as T;
    }
    return { ...item, previous_color: prev };
  });
}

export function filterHistoryByScope(
  history: SubmittalHistoryEntry[],
  scope: SubmittalScope,
): SubmittalHistoryEntry[] {
  return history.filter((h) => (h.scope ?? "paint") === scope);
}
