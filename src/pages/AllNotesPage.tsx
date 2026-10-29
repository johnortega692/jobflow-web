import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { SegmentedControl } from "../components/SegmentedControl";
import { listDoneProjectIds } from "../lib/projectDone";
import {
  addProjectNote,
  calendarDaysBetween,
  endOfCalendarWeek,
  listAllProjectNotes,
  localIsoDate,
  shiftIsoDate,
  snoozeProjectNote,
  toggleProjectNoteDone,
  type ProjectNote,
  type ProjectNoteSnooze,
  type ProjectNoteType,
  type ProjectNoteWithJob,
} from "../lib/projectNotes";
import { supabase } from "../lib/supabase";
import "./NotesPage.css";
import "./AllNotesPage.css";

type NoteFilter = "open" | "overdue" | "today" | "week" | "follow_ups" | "flagged" | "done";
type NoteSort = "date" | "project" | "newest";
type DatePick = "tomorrow" | "plus3" | "nextWeek" | "custom";

type NoteProject = {
  id: string;
  jobNumber: string;
  jobName: string;
};

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
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "follow_ups", label: "Follow-ups" },
  { id: "flagged", label: "Flagged" },
  { id: "done", label: "Done" },
];

function jobLabel(jobNumber: string, jobName: string): string {
  const name = jobName.trim() || "Untitled job";
  const number = jobNumber.trim();
  return number ? `${number} · ${name}` : name;
}

function noteLabel(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function matchesFilter(note: ProjectNoteWithJob, filter: NoteFilter, today: string, weekEnd: string): boolean {
  if (filter === "open") return note.status === "open";
  if (filter === "done") return note.status === "done";
  if (filter === "follow_ups") return note.type === "follow_up";
  if (filter === "flagged") return note.type === "flag";
  if (note.status !== "open" || note.type === "note" || !note.follow_up_date) return false;
  if (filter === "overdue") return note.follow_up_date < today;
  if (filter === "today") return note.follow_up_date === today;
  return note.follow_up_date > today && note.follow_up_date <= weekEnd;
}

function compareNotes(a: ProjectNoteWithJob, b: ProjectNoteWithJob, sort: NoteSort): number {
  if (sort === "newest") return b.created_at.localeCompare(a.created_at);
  if (sort === "project") {
    const byJob = a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: "base" });
    if (byJob !== 0) return byJob;
    const byName = a.jobName.localeCompare(b.jobName, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
  }
  const aDate = a.follow_up_date ?? "9999-12-31";
  const bDate = b.follow_up_date ?? "9999-12-31";
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  const byJob = a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: "base" });
  if (byJob !== 0) return byJob;
  return a.body.localeCompare(b.body, undefined, { sensitivity: "base" });
}

function followUpPill(
  note: ProjectNoteWithJob,
  today: string,
): { text: string; tone: "overdue" | "today" | "future" | "none" } | null {
  const iso = note.follow_up_date;
  if (!iso) {
    if (note.type === "flag") return { text: "No date", tone: "none" };
    return null;
  }
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

async function loadActiveProjects(): Promise<NoteProject[]> {
  const [{ data, error }, done] = await Promise.all([
    supabase.from("projects").select("id, job_number, job_name").order("job_number", { ascending: true }),
    listDoneProjectIds(),
  ]);
  if (error) throw new Error(error.message);
  if (done.error) throw new Error(done.error);
  const doneIds = new Set(done.ids);
  return (data ?? [])
    .filter((row) => !doneIds.has(row.id))
    .map((row) => ({
      id: row.id,
      jobNumber: (row.job_number ?? "").trim(),
      jobName: (row.job_name ?? "").trim(),
    }));
}

export function AllNotesPage() {
  const navigate = useNavigate();
  const customDateId = useId();
  const waitingId = useId();
  const [notes, setNotes] = useState<ProjectNoteWithJob[]>([]);
  const [projects, setProjects] = useState<NoteProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [type, setType] = useState<ProjectNoteType>("note");
  const [body, setBody] = useState("");
  const [waitingOn, setWaitingOn] = useState("");
  const [datePick, setDatePick] = useState<DatePick | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [filter, setFilter] = useState<NoteFilter>("open");
  const [projectFilter, setProjectFilter] = useState("");
  const [sort, setSort] = useState<NoteSort>("date");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef<Set<string>>(new Set());
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const customDateRef = useRef<HTMLInputElement>(null);
  const today = localIsoDate();
  const weekEnd = endOfCalendarWeek(today);
  const showSchedule = type === "follow_up" || type === "flag";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([listAllProjectNotes(), loadActiveProjects()])
      .then(([rows, jobs]) => {
        if (cancelled) return;
        setNotes(rows);
        setProjects(jobs);
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
  }, []);

  useEffect(() => {
    if (datePick === "custom") customDateRef.current?.focus();
  }, [datePick]);

  const scoped = useMemo(() => {
    const query = search.trim().toLowerCase();
    return notes.filter((note) => {
      if (projectFilter && note.project_id !== projectFilter) return false;
      if (!query) return true;
      const haystack = [note.body, note.jobNumber, note.jobName, note.waiting_on ?? ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [notes, projectFilter, search]);

  const counts = useMemo(() => {
    const next = {} as Record<NoteFilter, number>;
    for (const item of FILTERS) next[item.id] = scoped.filter((note) => matchesFilter(note, item.id, today, weekEnd)).length;
    return next;
  }, [scoped, today, weekEnd]);

  const visible = useMemo(
    () => scoped.filter((note) => matchesFilter(note, filter, today, weekEnd)).sort((a, b) => compareNotes(a, b, sort)),
    [scoped, filter, today, weekEnd, sort],
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
    if (saving || !projectId || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await addProjectNote(projectId, {
        body,
        type,
        followUpDate: resolvedDate(),
        waitingOn,
      });
      const project = projects.find((job) => job.id === projectId);
      const row: ProjectNoteWithJob = {
        ...created,
        jobNumber: project?.jobNumber ?? "",
        jobName: project?.jobName ?? "",
      };
      setNotes((rows) => [row, ...rows.filter((note) => note.id !== row.id)]);
      setBody("");
      setWaitingOn("");
      setDatePick(null);
      setCustomDate("");
      if (!matchesFilter(row, filter, today, weekEnd)) setFilter("open");
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
      setNotes((rows) => rows.map((row) => (row.id === id ? { ...row, ...next } : row)));
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

  const emptyMessage = notes.length === 0 ? "No notes yet. Add one above." : "No notes match this view.";

  return (
    <div className="page all-notes stack">
      <div className="page-header">
        <div>
          <h1>Notes</h1>
          <p className="all-notes-sub">Follow-ups, flags, and notes on active jobs.</p>
        </div>
      </div>

      <form className="card stack" onSubmit={(event) => void onAdd(event)}>
        <div className="all-notes-add">
          <select
            className="all-notes-project"
            aria-label="Project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {jobLabel(project.jobNumber, project.jobName)}
              </option>
            ))}
          </select>
          <SegmentedControl aria-label="Note type" options={TYPE_OPTIONS} value={type} onChange={setType} />
          <input
            className="all-notes-body-input"
            type="text"
            value={body}
            aria-label="Note"
            placeholder="Add a note"
            onChange={(event) => setBody(event.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={saving || !projectId || !body.trim()}>
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

      <section className="card stack">
        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="all-notes-toolbar">
          <input
            className="all-notes-search"
            type="search"
            value={search}
            aria-label="Search notes"
            placeholder="Search notes, jobs, or waiting on"
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Filter by project"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {jobLabel(project.jobNumber, project.jobName)}
              </option>
            ))}
          </select>
          <select aria-label="Sort notes" value={sort} onChange={(event) => setSort(event.target.value as NoteSort)}>
            <option value="date">Follow-up date</option>
            <option value="project">Project</option>
            <option value="newest">Newest</option>
          </select>
        </div>

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
          <div className="table-wrap all-notes-wrap">
            <table className="all-notes-table">
              <caption className="sr-only">Notes across projects</caption>
              <thead>
                <tr>
                  <th className="all-notes-check" scope="col">
                    <span className="sr-only">Done</span>
                  </th>
                  <th scope="col">Project</th>
                  <th scope="col">Type</th>
                  <th scope="col">Note</th>
                  <th scope="col">Waiting on</th>
                  <th scope="col">Follow-up</th>
                  <th scope="col">Snooze</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr className="all-notes-empty">
                    <td colSpan={7}>{emptyMessage}</td>
                  </tr>
                ) : (
                  visible.map((note) => {
                    const pill = followUpPill(note, today);
                    const busy = busyIds.has(note.id);
                    const done = note.status === "done";
                    const label = noteLabel(note.body);
                    return (
                      <tr
                        key={note.id}
                        className={done ? "all-notes-row project-notes-row--done" : "all-notes-row"}
                        onClick={(event) => {
                          const target = event.target;
                          if (target instanceof Element && target.closest("button, input, a")) return;
                          navigate(`/projects/${note.project_id}/notes`);
                        }}
                      >
                        <td data-col="check">
                          <input
                            type="checkbox"
                            checked={done}
                            disabled={busy}
                            aria-label={done ? `Mark “${label}” open` : `Mark “${label}” done`}
                            onChange={() => void withRow(note.id, () => toggleProjectNoteDone(note.id, note.status))}
                          />
                        </td>
                        <td data-col="project">
                          <Link to={`/projects/${note.project_id}/notes`}>{jobLabel(note.jobNumber, note.jobName)}</Link>
                        </td>
                        <td data-col="type">
                          <span className={`project-notes-pill project-notes-pill--${note.type}`}>{TYPE_LABEL[note.type]}</span>
                        </td>
                        <td className="project-notes-body" data-col="note">
                          {note.body}
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
                            label={label}
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
    </div>
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
