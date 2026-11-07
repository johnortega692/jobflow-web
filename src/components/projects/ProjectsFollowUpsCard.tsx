import { useEffect, useId, useRef, useState, type SetStateAction } from "react";
import {
  calendarDaysBetween,
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

export function compareRows(a: OpenProjectFollowUp, b: OpenProjectFollowUp): number {
  const aDate = a.followUpDate ?? "9999-12-31";
  const bDate = b.followUpDate ?? "9999-12-31";
  if (aDate !== bDate) return aDate.localeCompare(bDate);
  const byJob = a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: "base" });
  if (byJob !== 0) return byJob;
  return a.body.localeCompare(b.body, undefined, { sensitivity: "base" });
}

export function jobLabel(row: { jobNumber: string; jobName: string }): string {
  const name = row.jobName.trim() || "Untitled job";
  const number = row.jobNumber.trim();
  return number ? `${number} · ${name}` : name;
}

export function noteLabel(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

export function datePill(iso: string | null, today: string): { text: string; tone: "overdue" | "today" | "future" } | null {
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

/** Complete, snooze, and push-overdue handlers for the Projects follow-ups list. */
export function useFollowUpActions(onChange: (items: SetStateAction<OpenProjectFollowUp[]>) => void) {
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef<Set<string>>(new Set());

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

  async function onPushOverdue(overdue: readonly OpenProjectFollowUp[]) {
    if (!overdue.length || pushing) return;
    setPushing(true);
    setError(null);
    const tomorrow = shiftIsoDate(localIsoDate(), 1);
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

  return { error, pushing, busyIds, onToggle, onSnooze, onPushOverdue };
}

export function SnoozeControl({
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
