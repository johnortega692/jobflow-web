import {
  addSubmittalToHistory,
  createNextRevisionDraft,
  isIssuedStatus,
  type SubmittalScope,
} from "./submittalHistory";
import type {
  FrpSubmittalData,
  PaintSubmittalData,
  SubmittalHistoryEntry,
  WallcoveringSubmittalData,
} from "../types/tradeDocuments";

type SubmittalDraft = PaintSubmittalData | WallcoveringSubmittalData | FrpSubmittalData;

export function submittalDraftIsLocked(draft: SubmittalDraft): boolean {
  return isIssuedStatus(draft.issue_status);
}

export function issueSubmittalDraft(
  draft: PaintSubmittalData,
  history: SubmittalHistoryEntry[],
  scope: "paint",
): { draft: PaintSubmittalData; history: SubmittalHistoryEntry[] };
export function issueSubmittalDraft(
  draft: WallcoveringSubmittalData,
  history: SubmittalHistoryEntry[],
  scope: "wallcovering",
): { draft: WallcoveringSubmittalData; history: SubmittalHistoryEntry[] };
export function issueSubmittalDraft(
  draft: FrpSubmittalData,
  history: SubmittalHistoryEntry[],
  scope: "frp",
): { draft: FrpSubmittalData; history: SubmittalHistoryEntry[] };
export function issueSubmittalDraft(
  draft: SubmittalDraft,
  history: SubmittalHistoryEntry[],
  scope: SubmittalScope,
): { draft: SubmittalDraft; history: SubmittalHistoryEntry[] } {
  const issued = { ...draft, issue_status: "issued" as const };
  const submittalType = "submittal_type" in issued ? issued.submittal_type : undefined;
  const nextHistory = addSubmittalToHistory(
    history,
    issued.submittal_number,
    issued.revision_number,
    issued.items,
    submittalType,
    scope,
    {
      revisionNote: issued.revision_note,
      issueStatus: "issued",
      locked: true,
      packageType: issued.package_type,
    },
  );
  return { draft: issued, history: nextHistory };
}

export function startNextRevision(draft: PaintSubmittalData, history: SubmittalHistoryEntry[]): PaintSubmittalData;
export function startNextRevision(
  draft: WallcoveringSubmittalData,
  history: SubmittalHistoryEntry[],
): WallcoveringSubmittalData;
export function startNextRevision(draft: FrpSubmittalData, history: SubmittalHistoryEntry[]): FrpSubmittalData;
export function startNextRevision(draft: SubmittalDraft, history: SubmittalHistoryEntry[]): SubmittalDraft {
  if (!submittalDraftIsLocked(draft)) return draft;
  if (
    !window.confirm(
      `Create revision ${draft.revision_number + 1} of submittal #${String(draft.submittal_number).padStart(3, "0")}? The current revision will be locked from editing.`,
    )
  ) {
    return draft;
  }
  return createNextRevisionDraft(draft, history);
}

export function historyEntryForDraft(
  draft: SubmittalDraft,
  history: SubmittalHistoryEntry[],
): SubmittalHistoryEntry | undefined {
  return history.find(
    (h) => h.submittal_number === draft.submittal_number && h.revision_number === draft.revision_number,
  );
}
