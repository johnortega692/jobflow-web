import type {
  FrpItem,
  PaintItem,
  SubmittalHistoryEntry,
  SubmittalIssueStatus,
  SubmittalPackageCategory,
  TradeSubmittalType,
  WallcoveringItem,
} from "../types/tradeDocuments";
import {
  formatToday,
  normalizePackageCategory,
  normalizeRevisionNumber,
  normalizeSubmittalIssueStatus,
} from "../types/tradeDocuments";

export type SubmittalScope = "paint" | "wallcovering" | "frp";

const TYPE_LABELS: Record<string, string> = {
  new: "New",
  revised: "Revised",
  substitution: "Substitution",
  original: "Original",
};

export function historyEntryKey(submittalNumber: number, revisionNumber: number): string {
  return `${submittalNumber}:${revisionNumber}`;
}

export function isIssuedStatus(status: SubmittalIssueStatus | undefined): boolean {
  return Boolean(status && status !== "draft");
}

export function normalizeHistoryEntry(raw: SubmittalHistoryEntry): SubmittalHistoryEntry {
  const revision_number = normalizeRevisionNumber(raw.revision_number);
  const issue_status = normalizeSubmittalIssueStatus(raw.issue_status ?? (raw.locked ? "issued" : "draft"));
  return {
    ...raw,
    revision_number,
    issue_status,
    locked: raw.locked ?? isIssuedStatus(issue_status),
    revision_note: raw.revision_note?.trim() || undefined,
  };
}

export function formatSubmittalHistoryLabel(entry: SubmittalHistoryEntry): string {
  const normalized = normalizeHistoryEntry(entry);
  const num = formatSubmittalNumLabel(normalized.submittal_number);
  const rev = normalized.revision_number ?? 0;
  const dateStr = normalized.date?.split(" ")[0] ?? normalized.date ?? "Unknown date";
  const count = normalized.items?.length ?? 0;
  const type = normalized.submittal_type ? TYPE_LABELS[normalized.submittal_type] ?? normalized.submittal_type : "";
  const typePart = type ? ` · ${type}` : "";
  const scopePart =
    normalized.scope === "wallcovering" ? " · WC" : normalized.scope === "frp" ? " · FRP" : "";
  const pkgPart = normalized.package_type ? ` · ${normalized.package_type}` : "";
  const statusPart = normalized.issue_status && normalized.issue_status !== "issued"
    ? ` · ${normalized.issue_status.replace(/_/g, " ")}`
    : "";
  const notePart = normalized.revision_note ? " · note" : "";
  return `${num} Rev ${rev} — ${dateStr} (${count} items)${pkgPart}${typePart}${scopePart}${statusPart}${notePart}`;
}

function formatSubmittalNumLabel(n: number): string {
  return `Submittal #${String(n).padStart(3, "0")}`;
}

export function findHistoryEntry(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
  revisionNumber: number,
): SubmittalHistoryEntry | undefined {
  return history.find(
    (h) => h.submittal_number === submittalNumber && normalizeRevisionNumber(h.revision_number) === revisionNumber,
  );
}

export function lockSubmittalPackage(history: SubmittalHistoryEntry[], submittalNumber: number): SubmittalHistoryEntry[] {
  return history.map((h) =>
    h.submittal_number === submittalNumber ? { ...normalizeHistoryEntry(h), locked: true } : h,
  );
}

export function addSubmittalToHistory(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
  revisionNumber: number,
  items: PaintItem[] | WallcoveringItem[] | FrpItem[],
  submittalType: TradeSubmittalType | undefined,
  scope: SubmittalScope,
  options?: {
    revisionNote?: string;
    issueStatus?: SubmittalIssueStatus;
    locked?: boolean;
    packageType?: SubmittalPackageCategory;
  },
): SubmittalHistoryEntry[] {
  const filtered = items.filter((i) => {
    const row = i as PaintItem & WallcoveringItem & FrpItem;
    return row.color?.trim() || row.product?.trim() || row.label?.trim() || row.manufacturer?.trim();
  });
  const issueStatus = normalizeSubmittalIssueStatus(options?.issueStatus ?? "issued");
  const locked = options?.locked ?? isIssuedStatus(issueStatus);
  const defaultPackage: SubmittalPackageCategory =
    scope === "frp" ? "Product Data" : "Color Samples";
  const entry: SubmittalHistoryEntry = normalizeHistoryEntry({
    submittal_number: submittalNumber,
    revision_number: revisionNumber,
    date: new Date().toISOString().replace("T", " ").slice(0, 19),
    items:
      scope === "paint"
        ? (filtered as PaintItem[]).map((i) => ({ ...i }))
        : scope === "wallcovering"
          ? (filtered as WallcoveringItem[]).map((i) => ({ ...i }))
          : (filtered as FrpItem[]).map((i) => ({ ...i })),
    scope,
    submittal_type: submittalType,
    package_type: normalizePackageCategory(options?.packageType, defaultPackage),
    revision_note: options?.revisionNote?.trim() || undefined,
    issue_status: issueStatus,
    locked,
  });

  const withoutSame = history.filter(
    (h) =>
      !(
        h.submittal_number === submittalNumber &&
        normalizeRevisionNumber(h.revision_number) === revisionNumber
      ),
  );
  const withLocks = locked ? lockSubmittalPackage(withoutSame, submittalNumber) : withoutSame;
  return [...withLocks, entry].sort(sortHistoryEntries);
}

function sortHistoryEntries(a: SubmittalHistoryEntry, b: SubmittalHistoryEntry): number {
  const numDiff = (b.submittal_number ?? 0) - (a.submittal_number ?? 0);
  if (numDiff !== 0) return numDiff;
  return normalizeRevisionNumber(b.revision_number) - normalizeRevisionNumber(a.revision_number);
}

export function removeSubmittalFromHistory(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
  revisionNumber?: number,
): SubmittalHistoryEntry[] {
  if (revisionNumber === undefined) {
    return history.filter((h) => h.submittal_number !== submittalNumber);
  }
  return history.filter(
    (h) =>
      !(
        h.submittal_number === submittalNumber &&
        normalizeRevisionNumber(h.revision_number) === revisionNumber
      ),
  );
}

/** Next submittal package number (new product-data / color package). */
export function nextSubmittalNumber(history: SubmittalHistoryEntry[]): number {
  const nums = history.map((h) => h.submittal_number).filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

/** Next revision for an existing submittal package (after Rev 0, Rev 1, …). */
export function nextRevisionNumber(history: SubmittalHistoryEntry[], submittalNumber: number): number {
  const revs = history
    .filter((h) => h.submittal_number === submittalNumber)
    .map((h) => normalizeRevisionNumber(h.revision_number));
  return revs.length ? Math.max(...revs) + 1 : 0;
}

export function createNextRevisionDraft<
  T extends {
    submittal_number: number;
    revision_number: number;
    issue_status: SubmittalIssueStatus;
    date: string;
    items: unknown[];
    revision_note?: string;
  },
>(draft: T, history: SubmittalHistoryEntry[]): T {
  const revision_number = nextRevisionNumber(history, draft.submittal_number);
  return {
    ...draft,
    revision_number,
    issue_status: "draft",
    date: formatToday(),
    revision_note: "",
    items: draft.items.map((item) => ({ ...(item as object) })) as T["items"],
  };
}

export function createNewSubmittalPackageDraft<
  T extends {
    submittal_number: number;
    revision_number: number;
    issue_status: SubmittalIssueStatus;
    date: string;
    revision_note?: string;
  },
>(base: T, history: SubmittalHistoryEntry[]): T {
  return {
    ...base,
    submittal_number: nextSubmittalNumber(history),
    revision_number: 0,
    issue_status: "draft",
    date: formatToday(),
    revision_note: "",
  };
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
  return history.map(normalizeHistoryEntry).filter((h) => (h.scope ?? "paint") === scope);
}