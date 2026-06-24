import {
  createNextRevisionDraft,
  isLockedPackageStatus,
  packageHasOpenDraftRevision,
} from "./submittalHistory";
import type {
  FrpSubmittalData,
  PaintSubmittalData,
  SubmittalHistoryEntry,
  WallcoveringSubmittalData,
} from "../types/tradeDocuments";

export type GuardedSubmittalDraft = PaintSubmittalData | WallcoveringSubmittalData | FrpSubmittalData;

function formatPackageLabel(submittalNumber: number, revisionNumber: number): string {
  return `#${String(submittalNumber).padStart(3, "0")} Rev ${revisionNumber}`;
}

/**
 * When a package is locked (issued/approved/etc.), prompt once before allowing content edits
 * and bump to the next revision (draft). Returns null if the user cancels.
 */
export function applySubmittalEdit<T extends GuardedSubmittalDraft>(
  draft: T,
  history: SubmittalHistoryEntry[],
  updater: (nextDraft: T) => T,
): T | null {
  if (draft.issue_status === "draft") {
    return updater(draft);
  }

  if (!isLockedPackageStatus(draft.issue_status)) {
    return updater(draft);
  }

  if (packageHasOpenDraftRevision(draft.submittal_number, draft)) {
    window.alert(
      `Submittal ${formatPackageLabel(draft.submittal_number, draft.revision_number)} is still in draft. Issue it before creating another revision.`,
    );
    return null;
  }

  const nextRevision = draft.revision_number + 1;
  if (
    !window.confirm(
      `Submittal ${formatPackageLabel(draft.submittal_number, draft.revision_number)} is ${draft.issue_status.replace(/_/g, " ")}.\n\nCreate revision ${nextRevision} to edit?`,
    )
  ) {
    return null;
  }

  const unlocked = createNextRevisionDraft(draft, history) as T;
  if (unlocked === draft || unlocked.issue_status !== "draft") {
    window.alert(
      `Submittal #${String(draft.submittal_number).padStart(3, "0")} already has a draft revision open. Issue it before creating another.`,
    );
    return null;
  }

  return updater(unlocked);
}
