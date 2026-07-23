import {
  addSubmittalToHistory,
  createNextRevisionDraft,
  isLockedPackageStatus,
  packageHasOpenDraftRevision,
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
  return isLockedPackageStatus(draft.issue_status);
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
      date: issued.date,
      specSection: issued.spec_section,
      ...(scope === "paint" && "spec_section_secondary" in issued
        ? {
            specSectionSecondary: issued.spec_section_secondary,
            specSectionSecondaryLabel: issued.spec_section_secondary_label,
          }
        : {}),
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
  if (draft.issue_status === "draft") {
    window.alert("Already editing a draft revision.");
    return draft;
  }
  if (!submittalDraftIsLocked(draft)) {
    return draft;
  }
  if (packageHasOpenDraftRevision(draft.submittal_number, draft)) {
    window.alert(
      `Submittal #${String(draft.submittal_number).padStart(3, "0")} already has a draft revision. Issue it before creating another.`,
    );
    return draft;
  }
  const nextRevision = draft.revision_number + 1;
  if (
    !window.confirm(
      `Create revision ${nextRevision} of submittal #${String(draft.submittal_number).padStart(3, "0")}? The current revision will stay locked.`,
    )
  ) {
    return draft;
  }
  const next = createNextRevisionDraft(draft, history);
  if (next === draft) {
    window.alert(
      `Submittal #${String(draft.submittal_number).padStart(3, "0")} already has a draft revision. Issue it before creating another.`,
    );
  }
  return next;
}

export function historyEntryForDraft(
  draft: SubmittalDraft,
  history: SubmittalHistoryEntry[],
): SubmittalHistoryEntry | undefined {
  return history.find(
    (h) => h.submittal_number === draft.submittal_number && h.revision_number === draft.revision_number,
  );
}
