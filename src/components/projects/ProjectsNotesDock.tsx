import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listAllProjectNotes,
  localIsoDate,
  subscribeProjectNotesChanged,
  type OpenProjectFollowUp,
  type ProjectNoteWithJob,
} from "../../lib/projectNotes";
import {
  clampDockWidth,
  loadNotesDockState,
  modeForWidth,
  NOTES_DOCK_MIN_WIDTH,
  NOTES_DOCK_RESIZE_MAX,
  saveNotesDockState,
  subscribeNotesDockToggle,
  widthForMode,
  type NotesDockState,
} from "../../lib/notesDockState";
import { compareRows, datePill, jobLabel, noteLabel, SnoozeControl, useFollowUpActions } from "./ProjectsFollowUpsCard";
import { QuickNoteModal, type QuickNoteProject } from "./QuickNoteModal";
import "./ProjectsNotesDock.css";

const NARROW_QUERY = "(max-width: 899px)";
const LATEST_LIMIT = 30;

type Tab = "followups" | "flags" | "latest";
type FilterId = "all" | "overdue" | "today" | "flagged";
type Bucket = "overdue" | "today" | "later" | "flagged";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "flagged", label: "Flagged" },
];

const GROUPS: { id: Bucket; label: string }[] = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "later", label: "Later" },
  { id: "flagged", label: "Flagged" },
];

type Props = {
  items: OpenProjectFollowUp[];
  activeProjectIds: ReadonlySet<string>;
  onChange: (items: SetStateAction<OpenProjectFollowUp[]>) => void;
  loading: boolean;
  loadError: string | null;
  projects: readonly QuickNoteProject[];
  onHoverJob: (jobNumber: string | null) => void;
  onOverlayChange: (overlay: boolean) => void;
};

function bucketFor(row: OpenProjectFollowUp, today: string): Bucket {
  if (!row.followUpDate) return row.type === "flag" ? "flagged" : "later";
  if (row.followUpDate < today) return "overdue";
  if (row.followUpDate === today) return "today";
  return "later";
}

function matchesFilter(row: OpenProjectFollowUp, filter: FilterId, today: string): boolean {
  if (filter === "all") return true;
  if (filter === "flagged") return row.type === "flag";
  return bucketFor(row, today) === filter;
}

function firstLine(body: string): string {
  return body.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function relativeTime(iso: string): string {
  const then = new Date(iso);
  const ms = Date.now() - then.getTime();
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select") !== null;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function ProjectsNotesDock({
  items,
  activeProjectIds,
  onChange,
  loading,
  loadError,
  projects,
  onHoverJob,
  onOverlayChange,
}: Props) {
  const navigate = useNavigate();
  const narrow = useNarrow();
  const [dock, setDock] = useState<NotesDockState>(() => {
    const saved = loadNotesDockState();
    return window.matchMedia(NARROW_QUERY).matches ? { ...saved, mode: "min" } : saved;
  });
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<Tab>("followups");
  const [filter, setFilter] = useState<FilterId>("all");
  const { error: actionError, pushing, busyIds, onToggle, onSnooze, onPushOverdue } = useFollowUpActions(onChange);
  const [latest, setLatest] = useState<ProjectNoteWithJob[] | null>(null);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);
  const today = localIsoDate();
  const wide = dock.mode === "wide";

  useEffect(() => {
    onOverlayChange(narrow);
  }, [narrow, onOverlayChange]);

  useEffect(() => {
    if (narrow) setDock((current) => (current.mode === "min" ? current : { ...current, mode: "min" }));
  }, [narrow]);

  useEffect(() => {
    if (!narrow) saveNotesDockState(dock);
  }, [dock, narrow]);

  const toggleMin = useCallback(() => {
    setDock((current) => (current.mode === "min" ? { ...current, mode: current.last } : { ...current, mode: "min" }));
  }, []);

  const toggleWide = useCallback(() => {
    setDock((current) => {
      const next = current.mode === "wide" ? "std" : "wide";
      return { mode: next, last: next, width: widthForMode(next) };
    });
  }, []);

  useEffect(() => subscribeNotesDockToggle(toggleMin), [toggleMin]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "]" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      toggleMin();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleMin]);

  function setOpenWidth(width: number) {
    const max = narrow ? Math.min(NOTES_DOCK_RESIZE_MAX, window.innerWidth - 16) : NOTES_DOCK_RESIZE_MAX;
    const next = Math.min(clampDockWidth(width), Math.max(max, 0));
    const mode = modeForWidth(next);
    setDock({ mode, last: mode, width: next });
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onHandlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging || !panelRef.current) return;
    const right = panelRef.current.getBoundingClientRect().right;
    setOpenWidth(right - event.clientX);
  }

  function onHandlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setOpenWidth(dock.width + 20);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setOpenWidth(dock.width - 20);
    }
  }

  const visible = useMemo(
    () => items.filter((row) => activeProjectIds.has(row.projectId)),
    [items, activeProjectIds],
  );

  const counts = useMemo(() => {
    const next: Record<FilterId, number> = { all: visible.length, overdue: 0, today: 0, flagged: 0 };
    for (const row of visible) {
      if (row.type === "flag") next.flagged += 1;
      const bucket = bucketFor(row, today);
      if (bucket === "overdue" || bucket === "today") next[bucket] += 1;
    }
    return next;
  }, [visible, today]);

  const groups = useMemo(() => {
    const filtered = visible.filter((row) => matchesFilter(row, filter, today));
    return GROUPS.map((group) => ({
      ...group,
      rows: filtered.filter((row) => bucketFor(row, today) === group.id).sort(compareRows),
    })).filter((group) => group.rows.length > 0);
  }, [visible, filter, today]);

  const flaggedJobs = useMemo(() => {
    const byProject = new Map<string, { projectId: string; jobNumber: string; jobName: string; count: number }>();
    for (const row of visible) {
      if (row.type !== "flag") continue;
      const entry = byProject.get(row.projectId);
      if (entry) entry.count += 1;
      else byProject.set(row.projectId, { projectId: row.projectId, jobNumber: row.jobNumber, jobName: row.jobName, count: 1 });
    }
    return [...byProject.values()].sort(
      (a, b) => b.count - a.count || a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [visible]);

  const loadLatest = useCallback(async () => {
    try {
      const rows = await listAllProjectNotes();
      setLatest(rows.slice(0, LATEST_LIMIT));
      setLatestError(null);
    } catch (err) {
      setLatestError(err instanceof Error ? err.message : "Could not load notes.");
    }
  }, []);

  const latestRequested = tab === "latest" || latest !== null;
  useEffect(() => {
    if (!latestRequested) return;
    void loadLatest();
    return subscribeProjectNotesChanged(() => void loadLatest());
  }, [latestRequested, loadLatest]);

  function openFromRow(event: ReactMouseEvent, to: string) {
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, a, select")) return;
    navigate(to);
  }

  const panelWidth = dock.mode === "min" ? NOTES_DOCK_MIN_WIDTH : dock.width;
  const className = [
    "notes-dock",
    narrow ? "notes-dock--overlay" : "",
    dock.mode === "min" ? "notes-dock--min" : "",
    dragging ? "notes-dock--dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const banner = loadError ?? actionError ?? (tab === "latest" ? latestError : null);

  if (dock.mode === "min") {
    return (
      <aside ref={panelRef} className={className} style={{ width: panelWidth }} aria-label="Notes and follow-ups">
        <button
          type="button"
          className="notes-dock-strip"
          aria-label={`Show follow-ups and notes (${visible.length} open)`}
          aria-expanded={false}
          onClick={toggleMin}
        >
          <BellIcon />
          {visible.length > 0 ? <span className="notes-dock-strip-badge">{visible.length}</span> : null}
          <span className="notes-dock-strip-label">Follow-ups &amp; notes</span>
        </button>
      </aside>
    );
  }

  return (
    <aside ref={panelRef} className={className} style={{ width: panelWidth }} aria-label="Notes and follow-ups">
      <div
        className="notes-dock-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes panel"
        aria-valuemin={300}
        aria-valuemax={NOTES_DOCK_RESIZE_MAX}
        aria-valuenow={dock.width}
        tabIndex={0}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onDoubleClick={toggleWide}
        onKeyDown={onHandleKeyDown}
      />
      <div className="notes-dock-inner">
        <div className="notes-dock-head">
          <h2>Notes &amp; follow-ups</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-small"
            aria-label="Add quick note"
            title="Quick note"
            onClick={() => setQuickNoteOpen(true)}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-small"
            aria-label={wide ? "Narrow panel" : "Widen panel"}
            title={wide ? "Narrow" : "Widen"}
            onClick={toggleWide}
          >
            {wide ? <NarrowIcon /> : <WidenIcon />}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-small"
            aria-label="Collapse panel"
            title="Collapse ( ] )"
            onClick={toggleMin}
          >
            <CollapseIcon />
          </button>
        </div>

        <div className="notes-dock-tabs" role="tablist" aria-label="Notes panel">
          <DockTab id="followups" current={tab} onSelect={setTab} label="Follow-ups" count={visible.length} />
          <DockTab id="flags" current={tab} onSelect={setTab} label="Flags" count={counts.flagged} />
          <DockTab id="latest" current={tab} onSelect={setTab} label="Latest notes" />
        </div>

        <div className="notes-dock-scroll" role="tabpanel" onMouseLeave={() => onHoverJob(null)}>
          {banner ? (
            <div className="banner banner-error" role="alert">
              {banner}
            </div>
          ) : null}

          {tab === "followups" ? (
            loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <>
                <div className="notes-dock-toolbar">
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
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={pushing || counts.overdue === 0}
                    onClick={() => void onPushOverdue(visible.filter((row) => bucketFor(row, today) === "overdue"))}
                  >
                    {pushing ? "Pushing…" : "Push overdue → tomorrow"}
                  </button>
                </div>

                {groups.length === 0 ? <p className="notes-dock-empty">All clear</p> : null}

                {groups.map((group) => (
                  <section key={group.id} aria-label={group.label}>
                    <h3
                      className={`projects-followups-group-label${group.id === "overdue" ? " projects-followups-group-label--overdue" : ""}`}
                    >
                      {group.label}
                    </h3>
                    <ul className="notes-dock-list">
                      {group.rows.map((row) => {
                        const pill = datePill(row.followUpDate, today);
                        const busy = busyIds.has(row.id);
                        const label = noteLabel(row.body);
                        const title = firstLine(row.body) || label;
                        const showBody = wide && (row.body.trim() !== title || title.length > 60);
                        return (
                          <li
                            key={row.id}
                            className="notes-dock-row"
                            onMouseEnter={() => onHoverJob(row.jobNumber)}
                            onClick={(event) => openFromRow(event, `/projects/${row.projectId}/notes`)}
                          >
                            <input
                              type="checkbox"
                              checked={false}
                              disabled={busy}
                              aria-label={`Mark “${label}” done`}
                              onChange={() => void onToggle(row)}
                            />
                            <div className="notes-dock-row-main">
                              <Link className="notes-dock-row-title" to={`/projects/${row.projectId}/notes`} title={label}>
                                {title}
                              </Link>
                              <div className="notes-dock-row-job">{jobLabel(row)}</div>
                              {showBody ? <p className="notes-dock-row-body">{row.body.trim()}</p> : null}
                            </div>
                            <div className="notes-dock-row-side">
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
              </>
            )
          ) : null}

          {tab === "flags" ? (
            loading ? (
              <p className="muted">Loading…</p>
            ) : flaggedJobs.length === 0 ? (
              <p className="notes-dock-empty">All clear</p>
            ) : (
              <ul className="notes-dock-list">
                {flaggedJobs.map((job) => (
                  <li
                    key={job.projectId}
                    className="notes-dock-row"
                    onMouseEnter={() => onHoverJob(job.jobNumber)}
                    onClick={(event) => openFromRow(event, `/projects/${job.projectId}`)}
                  >
                    <div className="notes-dock-row-main">
                      <Link className="notes-dock-row-title" to={`/projects/${job.projectId}`}>
                        {jobLabel(job)}
                      </Link>
                    </div>
                    <span className="projects-followups-pill projects-followups-pill--overdue">
                      {job.count} flag{job.count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {tab === "latest" ? (
            latest === null ? (
              latestError ? null : <p className="muted">Loading…</p>
            ) : latest.length === 0 ? (
              <p className="notes-dock-empty">All clear</p>
            ) : (
              <ul className="notes-dock-list">
                {latest.map((note) => {
                  const title = firstLine(note.body) || noteLabel(note.body);
                  return (
                    <li
                      key={note.id}
                      className="notes-dock-row"
                      onMouseEnter={() => onHoverJob(note.jobNumber)}
                      onClick={(event) => openFromRow(event, `/projects/${note.project_id}/notes`)}
                    >
                      <div className="notes-dock-row-main">
                        <Link className="notes-dock-row-title" to={`/projects/${note.project_id}/notes`} title={noteLabel(note.body)}>
                          {title}
                        </Link>
                        <div className="notes-dock-row-job">
                          {[note.jobNumber || note.jobName || "Untitled job", relativeTime(note.created_at)].filter(Boolean).join(" · ")}
                        </div>
                        {wide && note.body.trim() !== title ? <p className="notes-dock-row-body">{note.body.trim()}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </div>

        <div className="notes-dock-footer">
          <Link className="notes-dock-all" to="/notes">
            All notes →
          </Link>
        </div>
      </div>
      {quickNoteOpen ? <QuickNoteModal projects={projects} onClose={() => setQuickNoteOpen(false)} /> : null}
    </aside>
  );
}

function DockTab({
  id,
  current,
  onSelect,
  label,
  count,
}: {
  id: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  label: string;
  count?: number;
}) {
  const selected = id === current;
  return (
    <button type="button" role="tab" aria-selected={selected} className="notes-dock-tab" onClick={() => onSelect(id)}>
      {label}
      {count !== undefined ? <span className="notes-dock-tab-count">{count}</span> : null}
    </button>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function WidenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  );
}

function NarrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}
