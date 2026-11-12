import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { SegmentedControl } from "../SegmentedControl";
import { SnoozeButton } from "../../pages/NotesPage";
import {
  addProjectNote,
  calendarDaysBetween,
  formatNoteStamp,
  listProjectNotes,
  localIsoDate,
  snoozeProjectNote,
  toggleProjectNoteDone,
  type ProjectNote,
  type ProjectNoteType,
} from "../../lib/projectNotes";
import "../../pages/NotesPage.css";

const PREVIEW_LIMIT = 8;

const TYPE_OPTIONS: { value: Extract<ProjectNoteType, "note" | "follow_up">; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "follow_up", label: "Follow-up" },
];

const TYPE_LABEL: Record<ProjectNoteType, string> = {
  note: "Note",
  follow_up: "Follow-up",
  flag: "Flagged",
};

type NoteFilter = "open" | "done" | "follow_ups";

const FILTERS: { id: NoteFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
  { id: "follow_ups", label: "Follow-ups" },
];

type Props = {
  projectId: string;
  onOpenCount?: (count: number) => void;
};

function matchesFilter(note: ProjectNote, filter: NoteFilter): boolean {
  if (filter === "open") return note.status !== "done";
  if (filter === "done") return note.status === "done";
  return note.type !== "note";
}

function noteLabel(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function followUpPill(iso: string | null, today: string): { text: string; tone: "overdue" | "today" | "future" } | null {
  if (!iso) return null;
  if (iso < today) {
    const late = calendarDaysBetween(iso, today);
    return { text: `${late}d late`, tone: "overdue" };
  }
  if (iso === today) return { text: "Today", tone: "today" };
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year!, (month ?? 1) - 1, day);
  const sameYear = year === Number(today.slice(0, 4));
  return {
    text: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    }),
    tone: "future",
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function DashboardProjectNotes({ projectId, onOpenCount }: Props) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<Extract<ProjectNoteType, "note" | "follow_up">>("note");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<NoteFilter>("open");
  const [saving, setSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef<Set<string>>(new Set());
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const today = localIsoDate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listProjectNotes(projectId)
      .then((rows) => {
        if (!cancelled) setNotes(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const openCount = notes.filter((note) => note.status !== "done").length;
  useEffect(() => {
    onOpenCount?.(openCount);
  }, [onOpenCount, openCount]);

  const counts = useMemo(
    () => ({
      open: notes.filter((note) => matchesFilter(note, "open")).length,
      done: notes.filter((note) => matchesFilter(note, "done")).length,
      follow_ups: notes.filter((note) => matchesFilter(note, "follow_ups")).length,
    }),
    [notes],
  );

  const filtered = notes.filter((note) => matchesFilter(note, filter));
  const shown = filtered.slice(0, PREVIEW_LIMIT);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (saving || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await addProjectNote(projectId, { body, type });
      setNotes((rows) => [created, ...rows]);
      setBody("");
      if (!matchesFilter(created, filter)) setFilter("open");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function withRow(id: string, task: () => Promise<ProjectNote>) {
    if (busyRef.current.has(id)) return;
    busyRef.current.add(id);
    setBusyIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const next = await task();
      setNotes((rows) => rows.map((row) => (row.id === id ? next : row)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busyRef.current.delete(id);
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="dashboard-notes stack">
      <form className="dashboard-notes-add" onSubmit={(event) => void onAdd(event)}>
        <SegmentedControl aria-label="Note type" options={TYPE_OPTIONS} value={type} onChange={setType} />
        <input
          className="project-notes-body-input"
          type="text"
          value={body}
          aria-label="Note"
          placeholder="Add a note"
          onChange={(event) => setBody(event.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={saving || !body.trim()}>
          {saving ? "Adding…" : "Add"}
        </button>
      </form>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="filter-chips" role="group" aria-label="Filter notes">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`filter-chip${filter === item.id ? " filter-chip--active" : ""}`}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span className="project-notes-count">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="muted dashboard-notes-empty">No notes yet. Add the first one above.</p>
      ) : shown.length === 0 ? (
        <p className="muted dashboard-notes-empty">Nothing in this view.</p>
      ) : (
        <ul className="dashboard-notes-list">
          {shown.map((note) => {
            const pill = followUpPill(note.follow_up_date, today);
            const busy = busyIds.has(note.id);
            const done = note.status === "done";
            const canSnooze = !done && note.type !== "note";
            return (
              <li key={note.id} className={`dashboard-notes-row${done ? " dashboard-notes-row--done" : ""}`}>
                <input
                  type="checkbox"
                  checked={done}
                  disabled={busy}
                  aria-label={done ? `Mark “${noteLabel(note.body)}” open` : `Mark “${noteLabel(note.body)}” done`}
                  onChange={() => void withRow(note.id, () => toggleProjectNoteDone(note.id, note.status))}
                />
                <span className={`project-notes-pill project-notes-pill--${note.type}`}>{TYPE_LABEL[note.type]}</span>
                <div className="dashboard-notes-copy">
                  <div className="project-notes-body">{note.body}</div>
                  <div className="project-notes-stamp">{formatNoteStamp(note.created_at)}</div>
                </div>
                {pill ? (
                  <span className={`project-notes-pill project-notes-pill--${pill.tone}`}>{pill.text}</span>
                ) : null}
                {canSnooze ? (
                  <SnoozeButton
                    label={noteLabel(note.body)}
                    open={snoozeFor === note.id}
                    disabled={busy}
                    onToggle={() => setSnoozeFor((current) => (current === note.id ? null : note.id))}
                    onClose={() => setSnoozeFor((current) => (current === note.id ? null : current))}
                    onSnooze={(amount) => {
                      setSnoozeFor(null);
                      void withRow(note.id, () => snoozeProjectNote(note.id, amount));
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {notes.length > PREVIEW_LIMIT ? (
        <Link className="dashboard-notes-all" to={`/projects/${projectId}/notes`}>
          View all notes
        </Link>
      ) : null}
    </div>
  );
}
