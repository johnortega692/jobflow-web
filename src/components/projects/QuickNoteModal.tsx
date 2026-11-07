import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { addProjectNote } from "../../lib/projectNotes";
import { jobLabel } from "./ProjectsFollowUpsCard";

export type QuickNoteProject = { id: string; jobNumber: string; jobName: string };

type Props = {
  projects: readonly QuickNoteProject[];
  onClose: () => void;
};

const MAX_MATCHES = 50;

function matchesQuery(project: QuickNoteProject, query: string): boolean {
  const haystack = `${project.jobNumber} ${project.jobName}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export function QuickNoteModal({ projects, onClose }: Props) {
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const trimmed = query.trim();
    const selected = projects.find((project) => project.id === projectId);
    if (!trimmed || (selected && jobLabel(selected) === query)) return projects.slice(0, MAX_MATCHES);
    return projects.filter((project) => matchesQuery(project, trimmed)).slice(0, MAX_MATCHES);
  }, [projects, projectId, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listOpen]);

  function choose(project: QuickNoteProject) {
    setProjectId(project.id);
    setQuery(jobLabel(project));
    setListOpen(false);
    noteRef.current?.focus();
  }

  function onJobKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!listOpen) setListOpen(true);
      else setActiveIndex((index) => Math.min(matches.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = listOpen ? matches[activeIndex] : undefined;
      if (pick) choose(pick);
      else if (projectId) noteRef.current?.focus();
    } else if (event.key === "Escape" && listOpen) {
      event.stopPropagation();
      setListOpen(false);
    }
  }

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
          <label htmlFor={`${listId}-input`}>Job</label>
          <input
            id={`${listId}-input`}
            type="text"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={listOpen && matches[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
            autoComplete="off"
            autoFocus
            placeholder="Search job # or name…"
            value={query}
            disabled={saving}
            onFocus={() => setListOpen(true)}
            onBlur={() => setListOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value);
              setProjectId("");
              setActiveIndex(0);
              setListOpen(true);
            }}
            onKeyDown={onJobKeyDown}
          />
          {listOpen ? (
            <ul ref={listRef} id={listId} role="listbox" aria-label="Jobs" className="quick-note-job-list">
              {matches.length === 0 ? (
                <li className="quick-note-job-empty">No jobs match.</li>
              ) : (
                matches.map((project, index) => (
                  <li
                    key={project.id}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    data-index={index}
                    aria-selected={project.id === projectId}
                    className={`quick-note-job-option${index === activeIndex ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(project)}
                  >
                    <span className="quick-note-job-number">{project.jobNumber || "—"}</span>
                    <span className="quick-note-job-name">{project.jobName || "Untitled job"}</span>
                  </li>
                ))
              )}
            </ul>
          ) : null}
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
