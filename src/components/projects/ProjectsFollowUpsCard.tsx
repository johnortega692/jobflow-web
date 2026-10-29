import { useEffect, useId, useMemo, useRef, useState, type SetStateAction } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  calendarDaysBetween,
  endOfCalendarWeek,
  listOpenProjectFollowUps,
  localIsoDate,
  shiftIsoDate,
  snoozeProjectNote,
  toggleProjectNoteDone,
  updateProjectNote,
  type OpenProjectFollowUp,
  type ProjectNoteSnooze,
} from "../../lib/projectNotes";
import "./ProjectsFollowUpsCard.css";

type FilterId = "all" | "overdue" | "today" | "week" | "flagged";
type Bucket = "overdue" | "today" | "week" | "later" | "undated" | "flagged";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "flagged", label: "Flagged" },
];

const GROUPS: { id: Bucket; label: string }[] = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "later", label: "Later" },
  { id: "undated", label: "No date" },
  { id: "flagged", label: "Flagged" },
];

type Props = {
  items: OpenProjectFollowUp[];
  activeProjectIds: ReadonlySet<string>;
  onChange: (items: SetStateAction<OpenProjectFollowUp[]>) => void;
};

function bucketFor(row: OpenProjectFollowUp, today: string, weekEnd: string): Bucket {
  if (!row.followUpDate) return row.type === "flag" ? "flagged" : "undated";
  if (row.followUpDate < today) return "overdue";
  if (row.followUpDate === today) return "today";
  if (row.followUpDate <= weekEnd) return "week";
  return "later";
}

function matchesFilter(row: OpenProjectFollowUp, filter: FilterId, today: string, weekEnd: string): boolean {
  if (filter === "all") return true;
  if (filter === "flagged") return row.type === "flag";
  return bucketFor(row, today, weekEnd) === filter;
}

function compareRows(a: OpenProjectFollowUp, b: OpenProjectFollowUp): number {
  const aDate = a.followUpDate ?? "9999-12-31";
  const bDate = b.followUpDate ?? "9999-12-31";
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  const byJob = a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: "base" });
  if (byJob !== 0) return byJob;
  return a.body.localeCompare(b.body, undefined, { sensitivity: "base" });
}

function jobLabel(row: OpenProjectFollowUp): string {
  const name = row.jobName.trim() || "Untitled job";
  const number = row.jobNumber.trim();
  return number ? `${number} · ${name}` : name;
}

function noteLabel(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function datePill(iso: string | null, today: string): { text: string; tone: "overdue" | "today" | "future" } | null {
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
  return err instanceof Error ? err.message : "Could not update the follow-up.";
}

export function followUpsColumnPill(
  rows: readonly OpenProjectFollowUp[] | undefined,
): { text: string; overdue: boolean } | null {
  if (!rows?.length) return null;
  const today = localIsoDate();
  let due = 0;
  let flags = 0;
  let overdue = false;
  for (const row of rows) {
    if (row.type === "flag") flags += 1;
    else due += 1;
    if (row.followUpDate && row.followUpDate < today) overdue = true;
  }
  const parts: string[] = [];
  if (due) parts.push(`${due} due`);
  if (flags) parts.push(`${flags} flag${flags === 1 ? "" : "s"}`);
  if (!parts.length) return null;
  return { text: parts.join(" · "), overdue };
}

export function FollowUpsColumnPill({ rows }: { rows: readonly OpenProjectFollowUp[] | undefined }) {
  const pill = followUpsColumnPill(rows);
  if (!pill) return null;
  return (
    <span className={pill.overdue ? "projects-followups-pill projects-followups-pill--overdue" : "projects-followups-pill"}>
      {pill.text}
    </span>
  );
}

export function ProjectsFollowUpsCard({ items, activeProjectIds, onChange }: Props) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterId>("all");
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef<Set<string>>(new Set());
  const today = localIsoDate();
  const weekEnd = endOfCalendarWeek(today);

  const visible = useMemo(
    () => items.filter((row) => activeProjectIds.has(row.projectId)),
    [items, activeProjectIds],
  );

  const counts = useMemo(() => {
    const next: Record<FilterId, number> = { all: visible.length, overdue: 0, today: 0, week: 0, flagged: 0 };
    for (const row of visible) {
      if (row.type === "flag") next.flagged += 1;
      const bucket = bucketFor(row, today, weekEnd);
      if (bucket === "overdue" || bucket === "today" || bucket === "week") next[bucket] += 1;
    }
    return next;
  }, [visible, today, weekEnd]);

  const groups = useMemo(() => {
    const filtered = visible.filter((row) => matchesFilter(row, filter, today, weekEnd));
    return GROUPS.map((group) => ({
      ...group,
      rows: filtered.filter((row) => bucketFor(row, today, weekEnd) === group.id).sort(compareRows),
    })).filter((group) => group.rows.length > 0);
  }, [visible, filter, today, weekEnd]);

  if (!visible.length) return null;

  function markBusy(id: string, busy: boolean) {
    if (busy) busyRef.current.add(id);
    else busyRef.current.delete(id);
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function onToggle(row: OpenProjectFollowUp) {
    if (busyRef.current.has(row.id)) return;
    markBusy(row.id, true);
    setError(null);
    try {
      await toggleProjectNoteDone(row.id, "open");
      onChange((current) => current.filter((item) => item.id !== row.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      markBusy(row.id, false);
    }
  }

  async function onSnooze(row: OpenProjectFollowUp, amount: ProjectNoteSnooze) {
    if (busyRef.current.has(row.id)) return;
    markBusy(row.id, true);
    setError(null);
    try {
      const next = await snoozeProjectNote(row.id, amount);
      onChange((current) =>
        current.map((item) => (item.id === row.id ? { ...item, followUpDate: next.follow_up_date } : item)),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      markBusy(row.id, false);
    }
  }

  async function onPushOverdue() {
    const overdue = visible.filter((row) => bucketFor(row, today, weekEnd) === "overdue");
    if (!overdue.length || pushing) return;
    setPushing(true);
    setError(null);
    const tomorrow = shiftIsoDate(today, 1);
    const ids = new Set(overdue.map((row) => row.id));
    try {
      await Promise.all(overdue.map((row) => updateProjectNote(row.id, { followUpDate: tomorrow })));
      onChange((current) => current.map((row) => (ids.has(row.id) ? { ...row, followUpDate: tomorrow } : row)));
    } catch (err) {
      setError(errorMessage(err));
      try {
        onChange(await listOpenProjectFollowUps());
      } catch {
        // Keep the rows we have; the banner already explains the failure.
      }
    } finally {
      setPushing(false);
    }
  }

  return (
    <section className="card stack projects-followups" aria-label="Follow-ups">
      <div className="projects-followups-head">
        <div className="projects-followups-heading">
          <h2>Follow-ups</h2>
          <Link to="/notes" className="projects-followups-all">
            View all notes →
          </Link>
        </div>
        <button
          type="button"
          className="btn btn-small"
          disabled={pushing || counts.overdue === 0}
          onClick={() => void onPushOverdue()}
        >
          {pushing ? "Pushing…" : "Push all overdue to tomorrow"}
        </button>
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="filter-chips" role="group" aria-label="Filter follow-ups">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`filter-chip${filter === item.id ? " filter-chip--active" : ""}`}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span className="projects-followups-count">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {groups.map((group) => (
        <section key={group.id} className="projects-followups-group" aria-label={group.label}>
          <h3 className={`projects-followups-group-label${group.id === "overdue" ? " projects-followups-group-label--overdue" : ""}`}>
            {group.label}
          </h3>
          <ul className="projects-followups-list">
            {group.rows.map((row) => {
              const pill = datePill(row.followUpDate, today);
              const busy = busyIds.has(row.id);
              const label = noteLabel(row.body);
              return (
                <li key={row.id}>
                  <div
                    className="projects-followups-row"
                    onClick={(event) => {
                      const target = event.target;
                      if (target instanceof Element && target.closest("button, input, a")) return;
                      navigate(`/projects/${row.projectId}/notes`);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={busy}
                      aria-label={`Mark “${label}” done`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => void onToggle(row)}
                    />
                    <Link
                      className="projects-followups-note"
                      to={`/projects/${row.projectId}/notes`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.body}
                    </Link>
                    <span className="projects-followups-job">{jobLabel(row)}</span>
                    {pill ? (
                      <span className={`projects-followups-date projects-followups-date--${pill.tone}`}>{pill.text}</span>
                    ) : (
                      <span className="projects-followups-date projects-followups-date--none">—</span>
                    )}
                    <SnoozeControl label={label} disabled={busy} onSnooze={(amount) => void onSnooze(row, amount)} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}

function SnoozeControl({
  label,
  disabled,
  onSnooze,
}: {
  label: string;
  disabled: boolean;
  onSnooze: (amount: ProjectNoteSnooze) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector("button")?.focus();
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className="projects-followups-snooze"
      ref={rootRef}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="btn btn-small"
        aria-label={`Snooze “${label}”`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        Snooze
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} className="projects-followups-snooze-menu" role="menu" aria-label={`Snooze “${label}”`}>
          <button
            type="button"
            className="btn btn-small btn-ghost"
            role="menuitem"
            onClick={() => {
              setOpen(false);
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
              setOpen(false);
              onSnooze("week");
            }}
          >
            +1 week
          </button>
        </div>
      ) : null}
    </div>
  );
}
