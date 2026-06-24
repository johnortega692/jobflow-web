import { useMemo, useState } from "react";
import { RevisionNoteField } from "./RevisionNoteField";
import {
  filterHistoryByScope,
  formatSubmittalHistoryLabel,
  nextRevisionNumber,
  type SubmittalScope,
} from "../../lib/submittalHistory";
import { buildRevisionDraftFromHistory } from "../../lib/startRevisionFromHistory";
import {
  REVISED_SUBMITTAL_TYPES,
  type PaintSubmittalData,
  type SubmittalHistoryEntry,
  type SubmittalIssueStatus,
  type TradeSubmittalType,
  type WallcoveringSubmittalData,
} from "../../types/tradeDocuments";

type CurrentDraftRef = {
  submittal_number: number;
  revision_number: number;
  issue_status: SubmittalIssueStatus;
};

type Props = {
  scope: Exclude<SubmittalScope, "frp">;
  history: SubmittalHistoryEntry[];
  currentDraft: CurrentDraftRef;
  onClose: () => void;
  onStart: (draft: PaintSubmittalData | WallcoveringSubmittalData) => void;
};

function sortHistory(entries: SubmittalHistoryEntry[]): SubmittalHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const numDiff = (b.submittal_number ?? 0) - (a.submittal_number ?? 0);
    if (numDiff !== 0) return numDiff;
    return (b.revision_number ?? 0) - (a.revision_number ?? 0);
  });
}

function defaultHistoryIndex(sorted: SubmittalHistoryEntry[], currentDraft: CurrentDraftRef): number {
  const idx = sorted.findIndex((h) => h.submittal_number === currentDraft.submittal_number);
  return idx >= 0 ? idx : 0;
}

export function StartRevisionFromHistoryModal({
  scope,
  history,
  currentDraft,
  onClose,
  onStart,
}: Props) {
  const scopedHistory = useMemo(() => sortHistory(filterHistoryByScope(history, scope)), [history, scope]);
  const [historyIdx, setHistoryIdx] = useState(() => defaultHistoryIndex(scopedHistory, currentDraft));
  const [submittalType, setSubmittalType] = useState<TradeSubmittalType>("revised");
  const [revisionNote, setRevisionNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const baseEntry = scopedHistory[historyIdx];
  const targetSubmittalNum = baseEntry?.submittal_number ?? currentDraft.submittal_number;
  const targetRevisionNum = useMemo(
    () =>
      nextRevisionNumber(
        scopedHistory,
        targetSubmittalNum,
        currentDraft.submittal_number === targetSubmittalNum ? currentDraft : undefined,
      ),
    [scopedHistory, targetSubmittalNum, currentDraft],
  );

  const title =
    scope === "paint" ? "Start revision from history" : "Start wallcovering revision from history";

  function onStartRevision() {
    setError(null);
    const entry = scopedHistory[historyIdx];
    if (!entry) {
      setError("Select a source submittal package.");
      return;
    }
    const result = buildRevisionDraftFromHistory(
      scope,
      entry,
      submittalType,
      revisionNote,
      scopedHistory,
      currentDraft,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onStart(result.draft);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack revised-submittal-modal"
        role="dialog"
        aria-labelledby="start-revision-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="start-revision-title">{title}</h3>

        <p className="muted small">
          Loads a new <strong>draft</strong> on the submittal tab:{" "}
          <strong>
            Submittal #{String(targetSubmittalNum).padStart(3, "0")} Rev {targetRevisionNum}
          </strong>
          . Edit items there, then issue or download PDF when ready.
        </p>

        {!scopedHistory.length ? (
          <p className="muted small italic">No issued submittals in history yet. Issue a package first.</p>
        ) : (
          <>
            <section className="stack revised-section">
              <p className="paint-col-head">Source submittal package</p>
              <select
                value={historyIdx}
                onChange={(e) => setHistoryIdx(Number(e.target.value))}
                aria-label="Select source submittal package"
              >
                {scopedHistory.map((h, i) => (
                  <option key={`${h.submittal_number}-${h.revision_number ?? 0}`} value={i}>
                    {formatSubmittalHistoryLabel(h)}
                  </option>
                ))}
              </select>
            </section>

            <section className="stack revised-section">
              <p className="paint-col-head">Submittal type</p>
              {REVISED_SUBMITTAL_TYPES.map((t) => (
                <label key={t.id} className="check revised-type-option">
                  <input
                    type="radio"
                    name="start-revision-type"
                    checked={submittalType === t.id}
                    onChange={() => setSubmittalType(t.id)}
                  />
                  <span>
                    <strong>{t.label}</strong>
                    <span className="muted small"> — {t.hint}</span>
                  </span>
                </label>
              ))}
            </section>

            <RevisionNoteField
              revisionNumber={targetRevisionNum}
              value={revisionNote}
              onChange={setRevisionNote}
            />
          </>
        )}

        {error && <div className="banner banner-error">{error}</div>}

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!scopedHistory.length}
            onClick={onStartRevision}
          >
            Start revision on submittal tab
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
