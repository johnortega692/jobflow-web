import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { addProjectNote, localIsoDate, shiftIsoDate, type ProjectNoteType } from "../../lib/projectNotes";
import { JobSearchCombo, type JobSearchProject } from "./JobSearchCombo";

type DatePick = "tomorrow" | "plus3" | "nextWeek" | "custom";

export type QuickNoteProject = JobSearchProject;

type Props = {
  projects: readonly QuickNoteProject[];
  onClose: () => void;
};

export function QuickNoteModal({ projects, onClose }: Props) {
  const [projectId, setProjectId] = useState("");
  const [body, setBody] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [flag, setFlag] = useState(false);
  const [datePick, setDatePick] = useState<DatePick | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const customDateRef = useRef<HTMLInputElement>(null);
  const jobInputId = useId();
  const today = localIsoDate();
  const scheduled = followUp || flag;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  useEffect(() => {
    if (datePick === "custom") customDateRef.current?.focus();
  }, [datePick]);

  function resolvedDate(): string | null {
    if (!scheduled || !datePick) return null;
    if (datePick === "tomorrow") return shiftIsoDate(today, 1);
    if (datePick === "plus3") return shiftIsoDate(today, 3);
    if (datePick === "nextWeek") return shiftIsoDate(today, 7);
    return customDate.trim() || null;
  }

  function chooseDate(pick: DatePick) {
    setDatePick((current) => (current === pick ? null : pick));
  }

  function toggleFollowUp() {
    setFollowUp((current) => {
      if (current) setFlag(false);
      return !current;
    });
  }

  function toggleFlag() {
    setFlag((current) => {
      const next = !current;
      if (next) setFollowUp(true);
      return next;
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !projectId || !body.trim()) return;
    const type: ProjectNoteType = flag ? "flag" : followUp ? "follow_up" : "note";
    setSaving(true);
    setError(null);
    try {
      await addProjectNote(projectId, {
        body,
        type,
        followUpDate: type === "note" ? null : resolvedDate(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note.");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={() => !saving && onClose()}>
      <form
        className="modal card stack quick-note-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-note-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void onSubmit(event)}
      >
        <h3 id="quick-note-title">Quick note</h3>
        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="quick-note-job">
          <label htmlFor={jobInputId}>Job</label>
          <JobSearchCombo
            id={jobInputId}
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            onPicked={() => noteRef.current?.focus()}
            disabled={saving}
            autoFocus
          />
        </div>
        <label>
          Note
          <textarea
            ref={noteRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void onSubmit(event);
            }}
            rows={4}
            placeholder="Type the note…"
            disabled={saving}
          />
        </label>
        <div className="quick-note-toggles" role="group" aria-label="Follow-up and flag">
          <button
            type="button"
            className={`filter-chip${followUp ? " filter-chip--active" : ""}`}
            aria-pressed={followUp}
            disabled={saving}
            onClick={toggleFollowUp}
          >
            Follow-up
          </button>
          <button
            type="button"
            className={`filter-chip quick-note-flag${flag ? " quick-note-flag--on" : ""}`}
            aria-pressed={flag}
            disabled={saving}
            title="Marks the job as having a problem"
            onClick={toggleFlag}
          >
            ⚑ Flag
          </button>
        </div>
        {scheduled ? (
          <div className="quick-note-dates" role="group" aria-label="Follow-up date">
            <button
              type="button"
              className={`filter-chip${datePick === "tomorrow" ? " filter-chip--active" : ""}`}
              aria-pressed={datePick === "tomorrow"}
              disabled={saving}
              onClick={() => chooseDate("tomorrow")}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className={`filter-chip${datePick === "plus3" ? " filter-chip--active" : ""}`}
              aria-pressed={datePick === "plus3"}
              disabled={saving}
              onClick={() => chooseDate("plus3")}
            >
              +3 days
            </button>
            <button
              type="button"
              className={`filter-chip${datePick === "nextWeek" ? " filter-chip--active" : ""}`}
              aria-pressed={datePick === "nextWeek"}
              disabled={saving}
              onClick={() => chooseDate("nextWeek")}
            >
              Next week
            </button>
            <button
              type="button"
              className={`filter-chip${datePick === "custom" ? " filter-chip--active" : ""}`}
              aria-pressed={datePick === "custom"}
              disabled={saving}
              onClick={() => chooseDate("custom")}
            >
              Custom
            </button>
            {datePick === "custom" ? (
              <input
                ref={customDateRef}
                className="quick-note-custom-date"
                type="date"
                value={customDate}
                aria-label="Custom follow-up date"
                disabled={saving}
                onChange={(event) => setCustomDate(event.target.value)}
              />
            ) : null}
          </div>
        ) : null}
        <div className="row-gap wrap">
          <button type="submit" className="btn btn-primary" disabled={saving || !projectId || !body.trim()}>
            {saving ? "Saving…" : "Save note"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
