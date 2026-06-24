import { createNextRevisionDraft } from "./submittalHistory";
import { submittalDraftIsLocked } from "./submittalPackageActions";
import type {
  FrpSubmittalData,
  PaintSubmittalData,
  SubmittalHistoryEntry,
  WallcoveringSubmittalData,
} from "../types/tradeDocuments";

export type GuardedSubmittalDraft = PaintSubmittalData | WallcoveringSubmittalData | FrpSubmittalData;

/**
 * When a package is issued, prompt before allowing edits and bump to the next revision (draft).
 * Returns null if the user cancels.
 */
export function applySubmittalEdit<T extends GuardedSubmittalDraft>(
  draft: T,
  history: SubmittalHistoryEntry[],
  updater: (nextDraft: T) => T,
): T | null {
  if (!submittalDraftIsLocked(draft)) return updater(draft);
  if (
    !window.confirm(
      `Submittal #${String(draft.submittal_number).padStart(3, "0")} Rev ${draft.revision_number} is issued.\n\nCreate revision ${draft.revision_number + 1} to edit?`,
    )
  ) {
    return null;
  }
  const unlocked = createNextRevisionDraft(draft, history) as T;
  return updater(unlocked);
}
