import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useOutletContext } from "react-router-dom";
import { SegmentedControl } from "../components/SegmentedControl";
import {
  addProjectNote,
  calendarDaysBetween,
  formatNoteStamp,
  listProjectNotes,
  localIsoDate,
  shiftIsoDate,
  snoozeProjectNote,
  toggleProjectNoteDone,
  type ProjectNote,
  type ProjectNoteSnooze,
  type ProjectNoteType,
} from "../lib/projectNotes";
import type { ProjectForm } from "../types/database";
import "./NotesPage.css";

type Ctx = { project: ProjectForm; projectId: string };

type NoteFilter = "open" | "done" | "follow_ups" | "flagged";
type DatePick = "tomorrow" | "plus3" | "nextWeek" | "custom";

const TYPE_OPTIONS: { value: ProjectNoteType; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "follow_up", label: "Follow-up" },
  { value: "flag", label: "Flag" },
];

const TYPE_LABEL: Record<ProjectNoteType, string> = {
  note: "Note",
  follow_up: "Follow-up",
  flag: "Flag",
};

const FILTERS: { id: NoteFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
  { id: "follow_ups", label: "Follow-ups" },
  { id: "flagged", label: "Flagged" },
];

function matchesFilter(note: ProjectNote, filter: NoteFilter): boolean {
  if (filter === "open") return note.status === "open";
  if (filter === "done") return note.status === "done";
  if (filter === "follow_ups") return note.type === "follow_up";
  return note.type === "flag";
}

function sortNotes(rows: ProjectNote[], filter: NoteFilter): ProjectNote[] {
  const copy = [...rows];
  if (filter === "done") {
    copy.sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));
    return copy;
  }
  copy.sort((a, b) => {
    const status = Number(a.status === "done") - Number(b.status === "done");
    if (status !== 0) return status;
    const aDate = a.follow_up_date ?? "9999-12-31";
    const bDate = b.follow_up_date ?? "9999-12-31";
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return b.created_at.localeCompare(a.created_at);
  });
  return copy;
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

export function NotesPage() {
  const { projectId } = useOutletContext<Ctx>();
  const customDateId = useId();
  const waitingId = useId();
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ProjectNoteType>("note");
  const [body, setBody] = useState("");
  const [waitingOn, setWaitingOn] = useState("");
  const [datePick, setDatePick] = useState<DatePick | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [filter, setFilter] = useState<NoteFilter>("open");
  const [saving, setSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef<Set<string>>(new Set());
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const customDateRef = useRef<HTMLInputElement>(null);
  const today = localIsoDate();
  const showSchedule = type === "follow_up" || type === "flag";

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

  useEffect(() => {
    if (datePick === "custom") customDateRef.current?.focus();
  }, [datePick]);

  const counts = useMemo(
    () => ({
      open: notes.filter((note) => matchesFilter(note, "open")).length,
      done: notes.filter((note) => matchesFilter(note, "done")).length,
      follow_ups: notes.filter((note) => matchesFilter(note, "follow_ups")).length,
      flagged: notes.filter((note) => matchesFilter(note, "flagged")).length,
    }),
    [notes],
  );

  const visible = useMemo(
    () => sortNotes(notes.filter((note) => matchesFilter(note, filter)), filter),
    [notes, filter],
  );

  function resolvedDate(): string | null {
    if (!showSchedule || !datePick) return null;
    if (datePick === "tomorrow") return shiftIsoDate(today, 1);
    if (datePick === "plus3") return shiftIsoDate(today, 3);
    if (datePick === "nextWeek") return shiftIsoDate(today, 7);
    return customDate;
  }

  function chooseDate(pick: DatePick) {
    setDatePick((current) => (current === pick ? null : pick));
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (saving || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await addProjectNote(projectId, {
        body,
        type,
        followUpDate: resolvedDate(),
        waitingOn,
      });
      setNotes((rows) => [created, ...rows]);
      setBody("");
      setWaitingOn("");
      setDatePick(null);
      setCustomDate("");
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

  const emptyMessage =
    notes.length === 0 ? "No notes yet. Add one above." : "Nothing in this view.";

  return (
    <section className="card stack project-notes">
      <form className="stack" onSubmit={(event) => void onAdd(event)}>
        <div className="project-notes-add">
          <SegmentedControl
            aria-label="Note type"
            options={TYPE_OPTIONS}
            value={type}
            onChange={setType}
          />
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
        </div>
        {showSchedule ? (
          <div className="project-notes-meta">
            <div className="project-notes-dates" role="group" aria-label="Follow-up date">
              <button
                type="button"
                className={`filter-chip${datePick === "tomorrow" ? " filter-chip--active" : ""}`}
                aria-pressed={datePick === "tomorrow"}
                onClick={() => chooseDate("tomorrow")}
              >
                Tomorrow
              </button>
              <button
                type="button"
                className={`filter-chip${datePick === "plus3" ? " filter-chip--active" : ""}`}
                aria-pressed={datePick === "plus3"}
                onClick={() => chooseDate("plus3")}
              >
                +3 days
              </button>
              <button
                type="button"
                className={`filter-chip${datePick === "nextWeek" ? " filter-chip--active" : ""}`}
                aria-pressed={datePick === "nextWeek"}
                onClick={() => chooseDate("nextWeek")}
              >
                Next week
              </button>
              <button
                type="button"
                className={`filter-chip${datePick === "custom" ? " filter-chip--active" : ""}`}
                aria-pressed={datePick === "custom"}
                onClick={() => chooseDate("custom")}
              >
                Custom
              </button>
              {datePick === "custom" ? (
                <input
                  ref={customDateRef}
                  id={customDateId}
                  className="project-notes-custom-date"
                  type="date"
                  value={customDate}
                  aria-label="Custom follow-up date"
                  onChange={(event) => setCustomDate(event.target.value)}
                />
              ) : null}
            </div>
            <label className="project-notes-waiting" htmlFor={waitingId}>
              <span>Waiting on</span>
              <input
                id={waitingId}
                type="text"
                value={waitingOn}
                placeholder="Optional"
                onChange={(event) => setWaitingOn(event.target.value)}
              />
            </label>
          </div>
        ) : null}
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
      ) : (
        <div className="table-wrap project-notes-wrap">
          <table className="project-notes-table">
            <caption className="sr-only">Project notes</caption>
            <thead>
              <tr>
                <th className="project-notes-check" scope="col">
                  <span className="sr-only">Done</span>
                </th>
                <th scope="col">Type</th>
                <th scope="col">Note</th>
                <th scope="col">Waiting on</th>
                <th scope="col">Follow-up</th>
                <th scope="col">Snooze</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr className="project-notes-empty">
                  <td colSpan={6}>{emptyMessage}</td>
                </tr>
              ) : (
                visible.map((note) => {
                  const pill = followUpPill(note.follow_up_date, today);
                  const busy = busyIds.has(note.id);
                  const done = note.status === "done";
                  return (
                    <tr key={note.id} className={done ? "project-notes-row--done" : undefined}>
                      <td data-col="check">
                        <input
                          type="checkbox"
                          checked={done}
                          disabled={busy}
                          aria-label={
                            done
                              ? `Mark “${noteLabel(note.body)}” open`
                              : `Mark “${noteLabel(note.body)}” done`
                          }
                          onChange={() => void withRow(note.id, () => toggleProjectNoteDone(note.id, note.status))}
                        />
                      </td>
                      <td data-col="type">
                        <span className={`project-notes-pill project-notes-pill--${note.type}`}>
                          {TYPE_LABEL[note.type]}
                        </span>
                      </td>
                      <td data-col="note">
                        <div className="project-notes-body">{note.body}</div>
                        <div className="project-notes-stamp">{formatNoteStamp(note.created_at)}</div>
                      </td>
                      <td className="project-notes-waiting-cell" data-col="waiting">
                        {note.waiting_on?.trim() ? note.waiting_on : "—"}
                      </td>
                      <td data-col="date">
                        {pill ? (
                          <span className={`project-notes-pill project-notes-pill--${pill.tone}`}>{pill.text}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-col="snooze">
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
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SnoozeButton({
  label,
  open,
  disabled,
  onToggle,
  onClose,
  onSnooze,
}: {
  label: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSnooze: (amount: ProjectNoteSnooze) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocus = useRef(false);
  const menuId = useId();
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      setBox(null);
      if (restoreFocus.current) {
        restoreFocus.current = false;
        buttonRef.current?.focus();
      }
      return;
    }
    const button = buttonRef.current;
    if (!button) return;
    const menuWidth = 140;
    const menuHeight = 88;
    function place() {
      const trigger = buttonRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < menuHeight + 8 ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4;
      const left = Math.max(menuWidth + 8, Math.min(rect.right, window.innerWidth - 8));
      setBox({ top, left });
    }
    place();
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onCloseRef.current();
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      restoreFocus.current = true;
      onCloseRef.current();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let inner = 0;
    const frame = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        menuRef.current?.querySelector("button")?.focus();
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(inner);
    };
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll("button") ?? []);
    const index = items.findIndex((item) => item === document.activeElement);
    const next = event.key === "ArrowDown" ? items[index + 1] ?? items[0] : items[index - 1] ?? items[items.length - 1];
    next?.focus();
  }

  return (
    <div className="project-notes-snooze">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-small"
        aria-label={`Snooze “${label}”`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={onToggle}
      >
        Snooze
      </button>
      {open && box
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="project-notes-snooze-menu"
              role="menu"
              aria-label={`Snooze “${label}”`}
              style={{ top: box.top, left: box.left, transform: "translateX(-100%)" }}
              onKeyDown={onMenuKeyDown}
            >
              <button
                type="button"
                className="btn btn-small btn-ghost"
                role="menuitem"
                onClick={() => {
                  restoreFocus.current = true;
                  onSnooze("day");
                }}
              >
                +1 day
              </button>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                role="menuitem"
                onClick={() => {
                  restoreFocus.current = true;
                  onSnooze("week");
                }}
              >
                +1 week
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
