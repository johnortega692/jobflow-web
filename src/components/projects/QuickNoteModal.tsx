import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { addProjectNote } from "../../lib/projectNotes";
import { JobSearchCombo, type JobSearchProject } from "./JobSearchCombo";

export type QuickNoteProject = JobSearchProject;

type Props = {
  projects: readonly QuickNoteProject[];
  onClose: () => void;
};

export function QuickNoteModal({ projects, onClose }: Props) {
  const [projectId, setProjectId] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const jobInputId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || !projectId || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await addProjectNote(projectId, { body, type: "note" });
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
