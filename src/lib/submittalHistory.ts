import type {
  FrpItem,
  PaintItem,
  SubmittalHistoryEntry,
  SubmittalPackageCategory,
  TradeSubmittalType,
  WallcoveringItem,
} from "../types/tradeDocuments";
import {
  defaultPackageForScope,
  formatToday,
  normalizePackageCategory,
  normalizeRevisionNumber,
  normalizeSubmittalIssueStatus,
  type SubmittalIssueStatus,
} from "../types/tradeDocuments";
import { formatSubmittalDisplayDate } from "./dateInputUtils";

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

/** Statuses where package content is locked until a new revision is created. */
export const LOCKED_PACKAGE_STATUSES: SubmittalIssueStatus[] = [
  "issued",
  "approved",
  "approved_as_noted",
  "revise_resubmit",
  "closed",
];

export function isLockedPackageStatus(status: SubmittalIssueStatus | undefined): boolean {
  return Boolean(status && LOCKED_PACKAGE_STATUSES.includes(status));
}

/** @deprecated Use isLockedPackageStatus — kept for history entry normalization. */
export function isIssuedStatus(status: SubmittalIssueStatus | undefined): boolean {
  return isLockedPackageStatus(status);
}

/** Latest issued/locked revision in history for a submittal package number. */
export function latestIssuedHistoryEntryForPackage(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
): SubmittalHistoryEntry | undefined {
  let best: SubmittalHistoryEntry | undefined;
  for (const entry of history) {
    if (entry.submittal_number !== submittalNumber) continue;
    const normalized = normalizeHistoryEntry(entry);
    if (!isLockedPackageStatus(normalized.issue_status)) continue;
    if (
      !best ||
      normalizeRevisionNumber(entry.revision_number) > normalizeRevisionNumber(best.revision_number)
    ) {
      best = entry;
    }
  }
  return best;
}

/** Latest revision saved in history for a submittal package number (any status). */
export function latestHistoryEntryForPackage(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
): SubmittalHistoryEntry | undefined {
  let best: SubmittalHistoryEntry | undefined;
  for (const entry of history) {
    if (entry.submittal_number !== submittalNumber) continue;
    if (
      !best ||
      normalizeRevisionNumber(entry.revision_number) > normalizeRevisionNumber(best.revision_number)
    ) {
      best = entry;
    }
  }
  return best;
}

/** One row per submittal package — latest revision only. */
export function latestHistoryEntryPerPackage(history: SubmittalHistoryEntry[]): SubmittalHistoryEntry[] {
  const byNum = new Map<number, SubmittalHistoryEntry>();
  for (const entry of history) {
    const num = entry.submittal_number ?? 0;
    const existing = byNum.get(num);
    if (
      !existing ||
      normalizeRevisionNumber(entry.revision_number) > normalizeRevisionNumber(existing.revision_number)
    ) {
      byNum.set(num, entry);
    }
  }
  return [...byNum.values()].sort((a, b) => {
    const numDiff = (b.submittal_number ?? 0) - (a.submittal_number ?? 0);
    if (numDiff !== 0) return numDiff;
    return normalizeRevisionNumber(b.revision_number) - normalizeRevisionNumber(a.revision_number);
  });
}

/** Best history row for PDF append: issued first, else latest revision. */
export function resolveHistoryEntryForSheet(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
): SubmittalHistoryEntry | undefined {
  return (
    latestIssuedHistoryEntryForPackage(history, submittalNumber) ??
    latestHistoryEntryForPackage(history, submittalNumber)
  );
}

type DraftRevisionCheck = {
  submittal_number: number;
  revision_number: number;
  issue_status: SubmittalIssueStatus;
};

/** True when this package already has an unissued draft revision (Rev > 0, status draft). */
export function packageHasOpenDraftRevision(
  submittalNumber: number,
  currentDraft: DraftRevisionCheck,
): boolean {
  if (currentDraft.submittal_number !== submittalNumber) return false;
  return (
    currentDraft.issue_status === "draft" &&
    normalizeRevisionNumber(currentDraft.revision_number) > 0
  );
}

export function normalizeHistoryEntry(raw: SubmittalHistoryEntry): SubmittalHistoryEntry {
  const revision_number = normalizeRevisionNumber(raw.revision_number);
  const issue_status = normalizeSubmittalIssueStatus(raw.issue_status ?? (raw.locked ? "issued" : "draft"));
  return {
    ...raw,
    revision_number,
    issue_status,
    locked: raw.locked ?? isLockedPackageStatus(issue_status),
    revision_note: raw.revision_note?.trim() || undefined,
    date: raw.date?.trim() ? formatSubmittalDisplayDate(raw.date) : raw.date,
  };
}

export function formatSubmittalHistoryLabel(entry: SubmittalHistoryEntry): string {
  const normalized = normalizeHistoryEntry(entry);
  const num = formatSubmittalNumLabel(normalized.submittal_number);
  const rev = normalized.revision_number ?? 0;
  const dateStr = normalized.date ? formatSubmittalDisplayDate(normalized.date) : "Unknown date";
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
    date?: string;
  },
): SubmittalHistoryEntry[] {
  const filtered = items.filter((i) => {
    const row = i as PaintItem & WallcoveringItem & FrpItem;
    return row.color?.trim() || row.product?.trim() || row.label?.trim() || row.manufacturer?.trim();
  });
  const issueStatus = normalizeSubmittalIssueStatus(options?.issueStatus ?? "issued");
  const locked = options?.locked ?? isLockedPackageStatus(issueStatus);
  const defaultPackage = defaultPackageForScope(scope);
  const entry: SubmittalHistoryEntry = normalizeHistoryEntry({
    submittal_number: submittalNumber,
    revision_number: revisionNumber,
    date: formatSubmittalDisplayDate(options?.date?.trim() || formatToday()),
    items:
      scope === "paint"
        ? (filtered as PaintItem[]).map((i) => ({ ...i }))
        : scope === "wallcovering"
          ? (filtered as WallcoveringItem[]).map((i) => ({ ...i }))
          : (filtered as FrpItem[]).map((i) => ({ ...i })),
    scope,
    submittal_type: submittalType,
    package_type: normalizePackageCategory(options?.packageType, defaultPackage, scope),
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
export function nextRevisionNumber(
  history: SubmittalHistoryEntry[],
  submittalNumber: number,
  currentDraft?: DraftRevisionCheck,
): number {
  const revs = history
    .filter((h) => h.submittal_number === submittalNumber)
    .map((h) => normalizeRevisionNumber(h.revision_number));
  let maxRev = revs.length ? Math.max(...revs) : -1;
  if (
    currentDraft &&
    currentDraft.submittal_number === submittalNumber &&
    currentDraft.issue_status === "draft"
  ) {
    maxRev = Math.max(maxRev, normalizeRevisionNumber(currentDraft.revision_number));
  }
  return maxRev + 1;
}

export function createNextRevisionDraft<
  T extends DraftRevisionCheck & {
    date: string;
    items: unknown[];
    revision_note?: string;
  },
>(draft: T, history: SubmittalHistoryEntry[]): T {
  if (draft.issue_status === "draft") {
    return draft;
  }
  if (packageHasOpenDraftRevision(draft.submittal_number, draft)) {
    return draft;
  }
  if (!isLockedPackageStatus(draft.issue_status)) {
    return draft;
  }
  const revision_number = normalizeRevisionNumber(draft.revision_number) + 1;
  const maxAllowed = nextRevisionNumber(history, draft.submittal_number, draft);
  if (revision_number > maxAllowed) {
    return draft;
  }
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