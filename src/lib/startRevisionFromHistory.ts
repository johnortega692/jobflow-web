import {
  defaultPackageForScope,
  formatToday,
  normalizePackageCategory,
  paintSubjectForPackage,
  wcSubjectForPackage,
  emptyPaintItem,
  emptyWallcoveringItem,
  type PaintItem,
  type PaintSubmittalData,
  type SubmittalHistoryEntry,
  type SubmittalIssueStatus,
  type TradeSubmittalType,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments";
import {
  mapHistoryItemsForRevisedLoad,
  nextRevisionNumber,
  packageHasOpenDraftRevision,
  type SubmittalScope,
} from "./submittalHistory";

type CurrentDraftRef = {
  submittal_number: number;
  revision_number: number;
  issue_status: SubmittalIssueStatus;
};

export type RevisionDraftFromHistoryResult =
  | { ok: true; draft: PaintSubmittalData | WallcoveringSubmittalData }
  | { ok: false; error: string };

export function buildRevisionDraftFromHistory(
  scope: Exclude<SubmittalScope, "frp">,
  entry: SubmittalHistoryEntry,
  submittalType: TradeSubmittalType,
  revisionNote: string,
  history: SubmittalHistoryEntry[],
  currentDraft?: CurrentDraftRef,
): RevisionDraftFromHistoryResult {
  const submittal_number = entry.submittal_number;
  if (currentDraft && packageHasOpenDraftRevision(submittal_number, currentDraft)) {
    return {
      ok: false,
      error: `Submittal #${String(submittal_number).padStart(3, "0")} already has a draft revision open. Issue it before starting another.`,
    };
  }

  const draftForRev =
    currentDraft?.submittal_number === submittal_number ? currentDraft : undefined;
  const revision_number = nextRevisionNumber(history, submittal_number, draftForRev);
  const package_type = normalizePackageCategory(
    entry.package_type,
    defaultPackageForScope(scope),
    scope,
  );
  const note = revisionNote.trim() || undefined;

  if (scope === "paint") {
    const items = mapHistoryItemsForRevisedLoad(
      (entry.items as PaintItem[]).map((i) => ({ ...emptyPaintItem(), ...i })),
      submittalType,
    );
    return {
      ok: true,
      draft: {
        submittal_number,
        revision_number,
        issue_status: "draft",
        package_type,
        submittal_type: submittalType,
        subject: paintSubjectForPackage(package_type, submittalType),
        spec_section: entry.spec_section?.trim() || "09 91 23 - Interior Painting",
        spec_section_secondary: entry.spec_section_secondary?.trim() || undefined,
        spec_section_secondary_label: entry.spec_section_secondary_label?.trim() || undefined,
        date: formatToday(),
        items: items.length ? items : [emptyPaintItem()],
        revision_note: note,
      },
    };
  }

  const items = mapHistoryItemsForRevisedLoad(
    (entry.items as WallcoveringItem[]).map((i) => ({ ...emptyWallcoveringItem(), ...i })),
    submittalType,
  );
  return {
    ok: true,
    draft: {
      submittal_number,
      revision_number,
      issue_status: "draft",
      package_type,
      submittal_type: submittalType,
      subject: wcSubjectForPackage(package_type, submittalType),
      spec_section: entry.spec_section?.trim() || "09 72 00 - Wall Coverings",
      date: formatToday(),
      items: items.length ? items : [emptyWallcoveringItem()],
      revision_note: note,
    },
  };
}
