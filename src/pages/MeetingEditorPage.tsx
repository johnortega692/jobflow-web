import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  MEETING_GROUP_TITLES,
  copyMeetingForNextWeek,
  emptyAttendee,
  emptyJobLine,
  emptyTopicItem,
  meetingContentOf,
  meetingDateLine,
  meetingFileStem,
  sortAttendees,
  sortMeetingLines,
  type MeetingAttendee,
  type MeetingJobLine,
  type MeetingTopic,
  type MeetingTopicItem,
  type MeetingSort,
  type PaintMeetingContent,
} from "../lib/paintMeeting";
import { downloadMeetingDocx, downloadMeetingPdf } from "../lib/paintMeetingExport";
import { openEmailCompose } from "../lib/paintVendorEmail";
import { loadPaintUserSettings, type ComposeEmailMethod } from "../lib/paintUserSettings";
import { useAuth } from "../contexts/AuthContext";
import { createPaintMeeting, deletePaintMeeting, getPaintMeeting, savePaintMeeting, unlockPaintMeeting } from "../lib/paintMeetingStorage";
import { gcCompanyName } from "../lib/gcCompanyName";
import { formatJobStart } from "../lib/jobStartDisplay";
import { listDoneProjectIds } from "../lib/projectDone";
import { supabase } from "../lib/supabase";
import { UnsavedChangesDialog } from "../components/UnsavedChangesDialog";
import "./MeetingsPage.css";

const AGENDA_SUGGEST_ID = "agenda-suggest";

const MOVE_TO_ACTIVE_TITLES = new Set([
  "Next Starting Projects",
  "Upcoming Projects",
  "Incoming Projects",
]);

const GROUP_ADD_LABELS: Record<(typeof MEETING_GROUP_TITLES)[number], string> = {
  "Active Projects": "Add to Active",
  "Next Starting Projects": "Add to Next starting",
  "Upcoming Projects": "Add to Upcoming",
  "Recent Completed Projects": "Add to Completed",
  "Incoming Projects": "Add to Incoming",
};

type AgendaProject = {
  id: string;
  jobNumber: string;
  jobName: string;
  company: string;
  startDate: string;
};

function projectStartDate(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const jobInfo = (data as { job_info?: unknown }).job_info;
  if (!jobInfo || typeof jobInfo !== "object" || Array.isArray(jobInfo)) return "";
  const start = (jobInfo as { start_date?: unknown }).start_date;
  return typeof start === "string" ? start.trim() : "";
}

/** Discussion text from a job's start date. */
function activeStartNote(startDate: string): string {
  const display = formatJobStart(startDate);
  if (!display.title) return "";
  const marker = display.marker ? ` (${display.marker.text})` : "";
  return `Start ${display.dateLabel}${marker}`;
}

function moveActionToDiscussion(notes: string, action: string): string {
  const update = action.trim();
  if (!update) return notes;
  const discussion = notes.trim();
  return discussion ? `${discussion}\n${update}` : update;
}

const PROJECT_SECTION_IDS: Record<string, string> = {
  "Next Starting Projects": "meeting-next-starting",
  "Upcoming Projects": "meeting-upcoming",
  "Recent Completed Projects": "meeting-completed",
  "Incoming Projects": "meeting-incoming",
};

function attendeeRecipients(content: PaintMeetingContent): { name: string; email: string }[] {
  const seen = new Set<string>();
  const rows: { name: string; email: string }[] = [];
  for (const person of content.attendees) {
    const email = person.email.trim();
    if (!email.includes("@")) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name: person.name.trim() || email, email });
  }
  return rows;
}

function meetingEmailSubject(content: PaintMeetingContent): string {
  const title = content.title.trim() || "Meeting agenda";
  const when = meetingDateLine(content);
  return when ? `${title} — ${when}` : title;
}

function meetingEmailBody(content: PaintMeetingContent, fileName: string): string {
  const when = meetingDateLine(content);
  const lines = ["Hello,", "", "The paint meeting agenda is attached as a PDF.", ""];
  if (when) lines.push(`Meeting: ${when}`);
  if (content.purpose.trim()) lines.push(`Purpose: ${content.purpose.trim()}`);
  if (content.nextMeeting.trim()) lines.push(`Next meeting: ${content.nextMeeting.trim()}`);
  lines.push("", `Attachment: ${fileName}`, "", "Thank you,");
  return lines.join("\n");
}

function projectSectionId(title: string): string | undefined {
  return PROJECT_SECTION_IDS[title];
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Keep the text after @ (the time). Fall back to the meeting time field. */
function nextMeetingTime(nextMeeting: string, meetingTime: string): string {
  const match = /@\s*([\s\S]*)$/.exec(nextMeeting.trim());
  return (match?.[1] ?? meetingTime).trim();
}

/** Calendar choice writes "Thursday 11/19 @ 1:00 PM PST" and leaves the time in place. */
function formatNextMeeting(iso: string, nextMeeting: string, meetingTime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return nextMeeting;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const label = `${WEEKDAY_NAMES[date.getDay()]} ${Number(match[2])}/${Number(match[3])}`;
  const time = nextMeetingTime(nextMeeting, meetingTime);
  return time ? `${label} @ ${time}` : label;
}

/** The picker needs a year. The stored line only has M/D, so use the meeting year and roll forward if that date already passed. */
function nextMeetingIso(nextMeeting: string, meetingDate: string): string {
  const match = /(\d{1,2})\/(\d{1,2})/.exec(nextMeeting);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const meeting = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingDate.trim());
  let year = meeting ? Number(meeting[1]) : new Date().getFullYear();
  if (meeting) {
    const meetingMonth = Number(meeting[2]);
    const meetingDay = Number(meeting[3]);
    if (month < meetingMonth || (month === meetingMonth && day < meetingDay)) year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function agendaJobKey(job: string): string {
  const number = splitJobLabel(job).number || job;
  return number.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitJobLabel(job: string): { number: string; name: string } {
  const trimmed = job.trim();
  const match = /^(\d+[A-Za-z0-9-]*)\s*[—–-]?\s*(.*)$/.exec(trimmed);
  if (!match) return { number: "", name: trimmed };
  return { number: match[1], name: (match[2] ?? "").trim() };
}

function projectRowStatus(line: MeetingJobLine): { tone: "blue" | "amber" | "grey"; label: string; updated: string } {
  const carried = /^\[From (\d{1,2}\/\d{1,2})\]/.exec(line.notes.trim());
  if (line.action.trim()) return { tone: "blue", label: "Has updates", updated: carried?.[1] ?? "" };
  if (carried) return { tone: "amber", label: "Carried over", updated: carried[1] };
  if (line.notes.trim()) return { tone: "amber", label: "Has notes", updated: "" };
  return { tone: "grey", label: "No notes", updated: "" };
}

export function MeetingEditorPage() {
  const { meetingId = "" } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [content, setContent] = useState<PaintMeetingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSkipped, setEmailSkipped] = useState<Set<string>>(() => new Set());
  const [openingEmail, setOpeningEmail] = useState(false);
  const [composeMethod, setComposeMethod] = useState<ComposeEmailMethod>("gmail");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [rosterOpen, setRosterOpen] = useState(false);
  const [openJobs, setOpenJobs] = useState<Set<string>>(() => new Set());
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [agendaProjects, setAgendaProjects] = useState<AgendaProject[]>([]);
  const [agendaReady, setAgendaReady] = useState(false);
  const [agendaError, setAgendaError] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [addTarget, setAddTarget] = useState<Record<string, string>>({});
  const [headerEditing, setHeaderEditing] = useState(false);
  const [locked, setLocked] = useState(false);
  const [locking, setLocking] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [purposeDraft, setPurposeDraft] = useState("");
  const downloadRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const nextMeetingPickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRosterOpen(false);
    setOpenJobs(new Set());
    setHeaderEditing(false);
    setLocked(false);
    setMoreOpen(false);
    setDirty(false);
    setLeaveTo(null);
    void getPaintMeeting(meetingId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("Meeting was not found.");
          setContent(null);
          return;
        }
        const next = meetingContentOf(row);
        setContent(next);
        setLocked(row.locked);
        setCollapsed(
          new Set([
            AGENDA_SUGGEST_ID,
            ...next.groups.map((group) => group.id),
            ...next.topics.map((topic) => topic.id),
          ]),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the meeting.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    let cancelled = false;
    setAgendaReady(false);
    setAgendaError(null);
    void Promise.all([
      supabase.from("projects").select("id, job_number, job_name, contractor, data"),
      listDoneProjectIds(),
    ]).then(([projectsRes, doneRes]) => {
      if (cancelled) return;
      if (projectsRes.error) {
        setAgendaError(projectsRes.error.message);
        setAgendaReady(true);
        return;
      }
      const done = new Set(doneRes.ids);
      const rows = (projectsRes.data ?? [])
        .filter((project) => !done.has(project.id))
        .map((project) => ({
          id: project.id,
          jobNumber: (project.job_number ?? "").trim(),
          jobName: (project.job_name ?? "").trim(),
          company: gcCompanyName(project.contractor ?? ""),
          startDate: projectStartDate(project.data),
        }))
        .filter((project) => project.jobNumber || project.jobName)
        .sort((a, b) => a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: "base" }));
      setAgendaProjects(rows);
      setAgendaReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    if (!downloadOpen) return;
    function onPointer(event: MouseEvent) {
      if (downloadRef.current?.contains(event.target as Node)) return;
      setDownloadOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDownloadOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [downloadOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    function onPointer(event: MouseEvent) {
      if (moreRef.current?.contains(event.target as Node)) return;
      setMoreOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const headerDirty = headerEditing && content != null && (titleDraft !== content.title || purposeDraft !== content.purpose);
  const unsaved = dirty || headerDirty;

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  useEffect(() => {
    if (!unsaved) return;
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [unsaved]);

  useEffect(() => {
    if (!emailOpen || !user?.id) return;
    let cancelled = false;
    void loadPaintUserSettings(user.id)
      .then((settings) => {
        if (!cancelled) setComposeMethod(settings.compose_email_method);
      })
      .catch(() => {
        if (!cancelled) setComposeMethod("gmail");
      });
    return () => {
      cancelled = true;
    };
  }, [emailOpen, user?.id]);

  function patch(partial: Partial<PaintMeetingContent>) {
    if (locked) return;
    setSaved(false);
    setDirty(true);
    setContent((current) => (current ? { ...current, ...partial } : current));
  }

  function patchAttendee(id: string, partial: Partial<MeetingAttendee>) {
    if (!content) return;
    patch({ attendees: content.attendees.map((row) => (row.id === id ? { ...row, ...partial } : row)) });
  }

  function patchLine(groupId: string, lineId: string, partial: Partial<MeetingJobLine>) {
    if (!content) return;
    patch({
      groups: content.groups.map((group) =>
        group.id === groupId
          ? { ...group, lines: group.lines.map((line) => (line.id === lineId ? { ...line, ...partial } : line)) }
          : group,
      ),
    });
  }

  async function onSave(): Promise<boolean> {
    if (!content || saving || locked) return false;
    const next = headerEditing ? { ...content, title: titleDraft, purpose: purposeDraft } : content;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const savedRow = await savePaintMeeting(meetingId, next);
      setContent(meetingContentOf(savedRow));
      setLocked(savedRow.locked);
      setHeaderEditing(false);
      setDirty(false);
      setSaved(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the meeting.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onExport(kind: "pdf" | "docx") {
    if (!content || exporting) return;
    setExporting(kind);
    setError(null);
    try {
      if (kind === "pdf") await downloadMeetingPdf(content);
      else await downloadMeetingDocx(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the meeting.");
    } finally {
      setExporting(null);
    }
  }

  async function openMeetingEmail() {
    if (!content || openingEmail) return;
    setOpeningEmail(true);
    const recipients = attendeeRecipients(content).filter((person) => !emailSkipped.has(person.email.toLowerCase()));
    const result = openEmailCompose(
      recipients.map((person) => person.email),
      [],
      meetingEmailSubject(content),
      meetingEmailBody(content, `${meetingFileStem(content)}.pdf`),
      composeMethod,
    );
    try {
      await downloadMeetingPdf(content);
      setEmailOpen(false);
      if (result.warning) setError(result.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the PDF.");
    } finally {
      setOpeningEmail(false);
    }
  }

  async function onLock() {
    if (!content || locking || locked) return;
    if (!window.confirm("Lock this meeting? Edits stop until an admin unlocks it. Copy for next week still works.")) return;
    setLocking(true);
    setError(null);
    try {
      const next = headerEditing ? { ...content, title: titleDraft, purpose: purposeDraft } : content;
      const savedRow = await savePaintMeeting(meetingId, next, { lock: true });
      setContent(meetingContentOf(savedRow));
      setLocked(true);
      setHeaderEditing(false);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not lock the meeting.");
    } finally {
      setLocking(false);
    }
  }

  async function onUnlock() {
    if (!isAdmin || !locked || locking) return;
    if (!window.confirm("Unlock this meeting so it can be edited again?")) return;
    setLocking(true);
    setError(null);
    try {
      const savedRow = await unlockPaintMeeting(meetingId);
      setLocked(savedRow.locked);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock the meeting.");
    } finally {
      setLocking(false);
    }
  }

  async function onCopyNextWeek() {
    if (!content || copying) return;
    setCopying(true);
    setError(null);
    try {
      const created = await createPaintMeeting(copyMeetingForNextWeek(content));
      void navigate(`/meetings/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy the agenda.");
      setCopying(false);
    }
  }

  async function onDelete() {
    if (!window.confirm("Delete this meeting?")) return;
    setError(null);
    try {
      await deletePaintMeeting(meetingId);
      void navigate("/meetings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the meeting.");
    }
  }

  function sectionOpen(id: string): boolean {
    return !collapsed.has(id);
  }

  function toggleSection(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAllSections(open: boolean) {
    if (!content) return;
    const lineIds = content.groups.flatMap((group) => group.lines.map((line) => line.id));
    if (open) {
      setCollapsed(new Set());
      setOpenJobs(new Set(lineIds));
      return;
    }
    setCollapsed(new Set(["attendees", AGENDA_SUGGEST_ID, ...content.groups.map((group) => group.id), ...content.topics.map((topic) => topic.id)]));
    setOpenJobs(new Set());
  }

  function toggleJob(lineId: string) {
    setOpenJobs((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  if (loading) return <p className="muted">Loading meeting…</p>;
  if (!content) {
    return (
      <section className="stack">
        {error ? <div className="banner banner-error">{error}</div> : null}
        <Link to="/meetings">Back to meetings</Link>
      </section>
    );
  }

  const attendeeCount = content.attendees.filter((person) => person.name.trim() || person.email.trim()).length;
  const sectionIds = ["attendees", AGENDA_SUGGEST_ID, ...content.groups.map((group) => group.id), ...content.topics.map((topic) => topic.id)];
  const agendaKeys = new Set(
    content.groups.flatMap((group) => group.lines.map((line) => agendaJobKey(line.job))).filter(Boolean),
  );
  const query = projectQuery.trim().toLowerCase();
  const missingProjects = agendaProjects.filter((project) => {
    const key = agendaJobKey(project.jobNumber);
    return !(key && agendaKeys.has(key));
  });
  const availableProjects = missingProjects.filter((project) => {
    if (!query) return true;
    return `${project.jobNumber} ${project.jobName} ${project.company}`.toLowerCase().includes(query);
  });

  function addAgendaProject(project: AgendaProject, groupTitle: string) {
    if (!content) return;
    const group = content.groups.find((item) => item.title === groupTitle);
    if (!group) return;
    const line: MeetingJobLine = {
      ...emptyJobLine(),
      company: project.company,
      job: [project.jobNumber, project.jobName].filter(Boolean).join(" "),
      notes: activeStartNote(project.startDate),
    };
    setOpenJobs((prev) => new Set(prev).add(line.id));
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(group.id);
      return next;
    });
    patch({
      groups: content.groups.map((item) =>
        item.id === group.id ? { ...item, lines: sortMeetingLines([...item.lines, line], item.sort) } : item,
      ),
    });
  }

  function moveLineToActive(groupId: string, line: MeetingJobLine) {
    if (!content) return;
    const active = content.groups.find((item) => item.title === "Active Projects");
    if (!active || active.id === groupId) return;
    const key = agendaJobKey(line.job);
    const project = agendaProjects.find((item) => agendaJobKey(item.jobNumber) === key);
    const startNote = project ? activeStartNote(project.startDate) : "";
    const moved = line.notes.trim() || !startNote ? line : { ...line, notes: startNote };
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(active.id);
      return next;
    });
    patch({
      groups: content.groups.map((item) => {
        if (item.id === groupId) return { ...item, lines: item.lines.filter((row) => row.id !== line.id) };
        if (item.id === active.id) return { ...item, lines: sortMeetingLines([...item.lines, moved], item.sort) };
        return item;
      }),
    });
  }
  function openJump(hash: string) {
    if (!content) return;
    const ids: string[] = [];
    if (hash === "meeting-attendees") ids.push("attendees");
    const groupTitle: Record<string, string> = {
      "meeting-projects": "Active Projects",
      "meeting-next-starting": "Next Starting Projects",
      "meeting-upcoming": "Upcoming Projects",
      "meeting-completed": "Recent Completed Projects",
      "meeting-incoming": "Incoming Projects",
    };
    const match = content.groups.find((group) => group.title === groupTitle[hash]);
    if (match) ids.push(match.id);
    if (hash === "meeting-other") {
      ids.push(...content.topics.filter((topic) => topic.title !== "Safety Issues").map((topic) => topic.id));
    }
    if (hash === "meeting-safety") {
      ids.push(...content.topics.filter((topic) => topic.title === "Safety Issues").map((topic) => topic.id));
    }
    const keep = new Set(ids);
    setCollapsed(
      new Set(
        ["attendees", AGENDA_SUGGEST_ID, ...content.groups.map((group) => group.id), ...content.topics.map((topic) => topic.id)].filter(
          (id) => !keep.has(id),
        ),
      ),
    );
    setOpenJobs(new Set());
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const allSectionsClosed = sectionIds.every((id) => collapsed.has(id)) && openJobs.size === 0;
  const safetyTopics = content.topics.filter((topic) => topic.title === "Safety Issues");
  const otherTopics = content.topics.filter((topic) => topic.title !== "Safety Issues");

  return (
    <section className={locked ? "stack paint-meetings paint-meeting--locked" : "stack paint-meetings"}>
      <div className="row-between wrap gap">
        <div>
          <Link className="muted small" to="/meetings">
            All meetings
          </Link>
          <h1>Meeting</h1>
        </div>
        <div className="paint-meetings-actions">
          <div className="paint-meeting-download" ref={downloadRef}>
            <button
              type="button"
              className="btn"
              aria-haspopup="menu"
              aria-expanded={downloadOpen}
              disabled={exporting !== null}
              onClick={() => setDownloadOpen((open) => !open)}
            >
              {exporting === "pdf" ? "Preparing PDF…" : exporting === "docx" ? "Preparing Word…" : "Download"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {downloadOpen ? (
              <div className="paint-meeting-download-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setDownloadOpen(false); void onExport("pdf"); }}>
                  PDF
                </button>
                <button type="button" role="menuitem" onClick={() => { setDownloadOpen(false); void onExport("docx"); }}>
                  Word
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDownloadOpen(false);
                    setEmailSkipped(new Set());
                    setEmailOpen(true);
                  }}
                >
                  Email PDF
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving || locked}>
            {locked ? "Locked" : saving ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
          {locked && isAdmin ? (
            <button type="button" className="btn" onClick={() => void onUnlock()} disabled={locking}>
              {locking ? "Unlocking…" : "Unlock"}
            </button>
          ) : null}
          {locked ? null : (
            <button type="button" className="btn" onClick={() => void onLock()} disabled={locking || saving}>
              {locking ? "Locking…" : "Lock"}
            </button>
          )}
          <div className="paint-meeting-download" ref={moreRef}>
            <button
              type="button"
              className="btn paint-meeting-more-btn"
              aria-label="More meeting actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              ⋯
            </button>
            {moreOpen ? (
              <div className="paint-meeting-download-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={copying || saving || locking}
                  onClick={() => {
                    setMoreOpen(false);
                    void onCopyNextWeek();
                  }}
                >
                  {copying ? "Copying…" : "Copy for next week"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="paint-meeting-menu-danger"
                  disabled={locked}
                  title={locked ? "Unlock this meeting before deleting it." : undefined}
                  onClick={() => {
                    setMoreOpen(false);
                    void onDelete();
                  }}
                >
                  Delete meeting
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="paint-meeting-jump-row">
        <nav className="paint-meeting-jump" aria-label="Meeting sections">
          <a href="#meeting-attendees" onClick={(event) => { event.preventDefault(); openJump("meeting-attendees"); }}>Attendees</a>
          <a href="#meeting-projects" onClick={(event) => { event.preventDefault(); openJump("meeting-projects"); }}>Projects</a>
          <a href="#meeting-next-starting" onClick={(event) => { event.preventDefault(); openJump("meeting-next-starting"); }}>Next Starting</a>
          <a href="#meeting-upcoming" onClick={(event) => { event.preventDefault(); openJump("meeting-upcoming"); }}>Upcoming</a>
          <a href="#meeting-completed" onClick={(event) => { event.preventDefault(); openJump("meeting-completed"); }}>Completed</a>
          <a href="#meeting-incoming" onClick={(event) => { event.preventDefault(); openJump("meeting-incoming"); }}>Incoming</a>
          <a href="#meeting-other" onClick={(event) => { event.preventDefault(); openJump("meeting-other"); }}>Other sections</a>
          <a href="#meeting-safety" onClick={(event) => { event.preventDefault(); openJump("meeting-safety"); }}>Safety</a>
        </nav>
        <button type="button" className="paint-meeting-jump-toggle" onClick={() => setAllSections(allSectionsClosed)}>
          {allSectionsClosed ? "Expand all" : "Collapse all"}
        </button>
      </div>

      {locked ? (
        <div className="banner banner-warn" role="status">
          This meeting is locked. {isAdmin ? "Unlock it to edit again." : "An admin can unlock it."} Copy for next week still works.
        </div>
      ) : null}
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card paint-meeting-head">
        <div className="paint-meeting-head-title">
          {headerEditing ? (
            <div className="paint-meeting-head-edit">
              <input aria-label="Title" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
              <input aria-label="Purpose" value={purposeDraft} onChange={(event) => setPurposeDraft(event.target.value)} />
            </div>
          ) : (
            <div>
              <div className="paint-meeting-title">{content.title.trim() || "Untitled meeting"}</div>
              {content.purpose.trim() ? <div className="paint-meeting-purpose">{content.purpose}</div> : null}
            </div>
          )}
          {headerEditing ? (
            <button
              type="button"
              className="paint-meeting-edit"
              onClick={() => {
                patch({ title: titleDraft, purpose: purposeDraft });
                setHeaderEditing(false);
              }}
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              className="paint-meeting-edit"
              onClick={() => {
                if (locked) return;
                setTitleDraft(content.title);
                setPurposeDraft(content.purpose);
                setHeaderEditing(true);
              }}
            >
              ✎ Edit
            </button>
          )}
        </div>
        <div className="paint-meeting-head-fields">
          <label>
            <span>Meeting date</span>
            <input type="date" value={content.meetingDate} onChange={(event) => patch({ meetingDate: event.target.value })} />
          </label>
          <label>
            <span>Time</span>
            <input value={content.meetingTime} onChange={(event) => patch({ meetingTime: event.target.value })} />
          </label>
          <label>
            <span>Next meeting</span>
            <div className="paint-meeting-next">
              <input
                type="text"
                value={content.nextMeeting}
                placeholder="Thursday 11/19 @ 1:00 PM PST"
                onChange={(event) => patch({ nextMeeting: event.target.value })}
              />
              <button
                type="button"
                className="paint-meeting-next-btn"
                aria-label="Choose next meeting date"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const picker = nextMeetingPickerRef.current;
                  if (!picker) return;
                  try {
                    if (typeof picker.showPicker === "function") picker.showPicker();
                    else picker.focus();
                  } catch {
                    picker.focus();
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
              </button>
              <input
                ref={nextMeetingPickerRef}
                type="date"
                className="paint-meeting-next-picker"
                tabIndex={-1}
                aria-hidden="true"
                value={nextMeetingIso(content.nextMeeting, content.meetingDate)}
                onChange={(event) => {
                  if (!event.target.value) return;
                  patch({ nextMeeting: formatNextMeeting(event.target.value, content.nextMeeting, content.meetingTime) });
                }}
              />
            </div>
          </label>
        </div>
      </div>

      <div className="card stack" id="meeting-attendees">
        <div className="row-between wrap gap">
          <button
            type="button"
            className="paint-meeting-toggle"
            aria-expanded={sectionOpen("attendees")}
            onClick={() => toggleSection("attendees")}
          >
            <span aria-hidden="true">{sectionOpen("attendees") ? "▾" : "▸"}</span>
            <h2>Attendees</h2>
            {sectionOpen("attendees") ? null : (
              <span className="muted small">{attendeeCount === 1 ? "1 person" : `${attendeeCount} people`}</span>
            )}
          </button>
          {sectionOpen("attendees") ? <div className="paint-meeting-section-actions">
            <button type="button" className="btn" onClick={() => setRosterOpen((open) => !open)}>
              {rosterOpen ? "Hide roster" : "Edit roster"}
            </button>
            {rosterOpen ? (
              <>
            <label className="paint-meeting-sort">
              Sort
              <select
                aria-label="Sort attendees"
                value={content.attendeeSort === "name" || content.attendeeSort === "company" ? content.attendeeSort : "entered"}
                onChange={(event) => {
                  const sort = event.target.value as MeetingSort;
                  patch({ attendeeSort: sort, attendees: sortAttendees(content.attendees, sort) });
                }}
              >
                <option value="entered">As entered</option>
                <option value="name">Name</option>
                <option value="company">Company</option>
              </select>
            </label>
            <button type="button" className="btn" onClick={() => patch({ attendees: [...content.attendees, emptyAttendee()] })}>
              Add person
            </button>
              </>
            ) : null}
          </div> : null}
        </div>
        {sectionOpen("attendees") ? (
          <div className="paint-meeting-chips">
            {content.attendees.filter((person) => person.name.trim() || person.email.trim()).map((person) => (
              <button
                key={person.id}
                type="button"
                className={person.present ? "paint-meeting-chip" : "paint-meeting-chip is-absent"}
                aria-pressed={person.present}
                aria-label={`${person.name.trim() || person.email.trim()}, ${person.present ? "present" : "absent"}`}
                onClick={() => patchAttendee(person.id, { present: !person.present })}
              >
                <span className={person.present ? "paint-meeting-chip-dot is-present" : "paint-meeting-chip-dot is-absent"} aria-hidden="true" />
                {person.name.trim() || person.email.trim()}
              </button>
            ))}
          </div>
        ) : null}
        {sectionOpen("attendees") && rosterOpen ? <div className="paint-meeting-attendees">
          {content.attendees.map((person) => (
            <div key={person.id} className="paint-meeting-attendee">
              <input aria-label="Name" placeholder="Name" value={person.name} onChange={(event) => patchAttendee(person.id, { name: event.target.value })} />
              <input aria-label="Company" placeholder="Company" value={person.company} onChange={(event) => patchAttendee(person.id, { company: event.target.value })} />
              <input aria-label="Position" placeholder="Position" value={person.position} onChange={(event) => patchAttendee(person.id, { position: event.target.value })} />
              <input aria-label="Phone" placeholder="Phone" value={person.phone} onChange={(event) => patchAttendee(person.id, { phone: event.target.value })} />
              <input aria-label="Email" placeholder="Email" value={person.email} onChange={(event) => patchAttendee(person.id, { email: event.target.value })} />
              <label className="paint-meeting-present">
                <input
                  type="checkbox"
                  checked={person.present}
                  onChange={(event) => patchAttendee(person.id, { present: event.target.checked })}
                />
                Present
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => patch({ attendees: content.attendees.filter((row) => row.id !== person.id) })}
              >
                Remove
              </button>
            </div>
          ))}
        </div> : null}
      </div>

      <div id="meeting-projects">
      {locked ? null : (
      <div className="card stack">
        <button
          type="button"
          className="paint-meeting-toggle"
          aria-expanded={sectionOpen(AGENDA_SUGGEST_ID)}
          onClick={() => toggleSection(AGENDA_SUGGEST_ID)}
        >
          <span aria-hidden="true">{sectionOpen(AGENDA_SUGGEST_ID) ? "▾" : "▸"}</span>
          <h2>Not on this agenda</h2>
          {sectionOpen(AGENDA_SUGGEST_ID) ? null : (
            <span className="muted small">
              {!agendaReady ? "…" : missingProjects.length === 1 ? "1 job" : `${missingProjects.length} jobs`}
            </span>
          )}
        </button>
        {sectionOpen(AGENDA_SUGGEST_ID) ? (
          <>
            <p className="muted small paint-meeting-suggest-note">
              Open JobFlow jobs that are not on this meeting. Adding one puts it on the agenda. The job stays in JobFlow either way.
            </p>
            <input
              aria-label="Find a job"
              placeholder="Find a job"
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
            />
            {availableProjects.map((project) => {
              const section = addTarget[project.id] ?? "Active Projects";
              const start = formatJobStart(project.startDate);
              const startLabel = start.title
                ? start.marker
                  ? `${start.dateLabel} · ${start.marker.text}`
                  : start.dateLabel
                : "No start";
              return (
                <div key={project.id} className="paint-meeting-suggest">
                  <span className="paint-meeting-project-number">{project.jobNumber || "—"}</span>
                  <span className="paint-meeting-project-name">{project.jobName || "Untitled job"}</span>
                  <span className="muted small">{project.company}</span>
                  <span className="muted small paint-meeting-suggest-start" title={start.title || undefined}>
                    {startLabel}
                  </span>
                  <select
                    aria-label={`Agenda section for ${project.jobNumber || project.jobName}`}
                    value={section}
                    onChange={(event) => setAddTarget((prev) => ({ ...prev, [project.id]: event.target.value }))}
                  >
                    {MEETING_GROUP_TITLES.map((title) => (
                      <option key={title} value={title}>
                        {GROUP_ADD_LABELS[title]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={() => addAgendaProject(project, section)}>
                    Add
                  </button>
                </div>
              );
            })}
            {agendaError ? <p className="muted small">{agendaError}</p> : null}
            {agendaReady && !agendaError && availableProjects.length === 0 ? (
              <p className="muted small">{query ? "No matching jobs." : "Every open job is already on this agenda."}</p>
            ) : null}
          </>
        ) : null}
      </div>
      )}
      {content.groups.map((group) => {
        const open = sectionOpen(group.id);
        const jobCount = group.lines.filter((line) => line.company.trim() || line.job.trim() || line.notes.trim() || line.action.trim()).length;
        return (
        <div key={group.id} id={projectSectionId(group.title)} className="card stack">
          <div className="row-between wrap gap">
            <button
              type="button"
              className="paint-meeting-toggle"
              aria-expanded={open}
              onClick={() => toggleSection(group.id)}
            >
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
              <h2>{group.title}</h2>
              {open ? null : <span className="muted small">{jobCount === 1 ? "1 job" : `${jobCount} jobs`}</span>}
            </button>
            {open ? <div className="paint-meeting-section-actions">
              <label className="paint-meeting-sort">
                Sort
                <select
                  aria-label={`Sort ${group.title}`}
                  value={group.sort === "company" || group.sort === "manual" ? group.sort : "job"}
                  onChange={(event) => {
                    const sort = event.target.value as MeetingSort;
                    patch({
                      groups: content.groups.map((item) =>
                        item.id === group.id ? { ...item, sort, lines: sortMeetingLines(item.lines, sort) } : item,
                      ),
                    });
                  }}
                >
                  <option value="job">Job number</option>
                  <option value="company">Company</option>
                  <option value="manual">As entered</option>
                </select>
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const line = emptyJobLine();
                  setOpenJobs((prev) => new Set(prev).add(line.id));
                  patch({
                    groups: content.groups.map((item) =>
                      item.id === group.id ? { ...item, lines: [...item.lines, line] } : item,
                    ),
                  });
                }}
              >
                Add job
              </button>
            </div> : null}
          </div>
          {open ? group.lines.map((line) => renderProjectRow(group, line)) : null}
        </div>
        );
      })}

      </div>

      <div id="meeting-other">{renderTopics(otherTopics)}</div>
      <div id="meeting-safety">{renderTopics(safetyTopics)}</div>
      {leaveTo ? (
        <UnsavedChangesDialog
          targetLabel="this meeting"
          saving={saving}
          onSave={() => {
            void onSave().then((ok) => {
              if (!ok || !leaveTo) return;
              const to = leaveTo;
              setLeaveTo(null);
              void navigate(to);
            });
          }}
          onDiscard={() => {
            const to = leaveTo;
            setDirty(false);
            setLeaveTo(null);
            if (to) void navigate(to);
          }}
          onCancel={() => setLeaveTo(null)}
        />
      ) : null}
      {emailOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setEmailOpen(false)}>
          <div
            className="modal card stack paint-meeting-email"
            role="dialog"
            aria-labelledby="meeting-email-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="meeting-email-title">Recipients</h3>
            {attendeeRecipients(content).filter((person) => !emailSkipped.has(person.email.toLowerCase())).length ? (
              <ul className="paint-meeting-email-people">
                {attendeeRecipients(content)
                  .filter((person) => !emailSkipped.has(person.email.toLowerCase()))
                  .map((person) => (
                    <li key={person.email}>
                      <span>
                        {person.name} <span className="muted">{person.email}</span>
                      </span>
                      <button
                        type="button"
                        className="paint-meeting-remove"
                        aria-label={`Remove ${person.email}`}
                        onClick={() =>
                          setEmailSkipped((prev) => {
                            const next = new Set(prev);
                            next.add(person.email.toLowerCase());
                            return next;
                          })
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="muted small">No recipients left. The draft will open with an empty To line.</p>
            )}
            <div className="row-gap wrap">
              <button type="button" className="btn btn-primary" disabled={openingEmail} onClick={() => void openMeetingEmail()}>
                {openingEmail ? "Opening…" : "Open email draft"}
              </button>
              <button type="button" className="btn" disabled={openingEmail} onClick={() => setEmailOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );

  function renderProjectRow(group: PaintMeetingContent["groups"][number], line: MeetingJobLine) {
    if (!content) return null;
    const status = line.skipNext ? { tone: "grey" as const, label: "Won't carry", updated: "" } : projectRowStatus(line);
    const jobLabel = splitJobLabel(line.job);
    const expanded = openJobs.has(line.id);
    return (
      <div key={line.id} className="paint-meeting-project">
        <button type="button" className="paint-meeting-project-row" aria-expanded={expanded} onClick={() => toggleJob(line.id)}>
          <span className={`paint-meeting-dot is-${status.tone}`} aria-hidden="true" />
          <span className="paint-meeting-project-number">{jobLabel.number || "—"}</span>
          <span className="paint-meeting-project-name">{jobLabel.name || line.company || "Untitled job"}</span>
          <span className="muted small">{status.label}</span>
          <span className="muted small">{status.updated || "—"}</span>
        </button>
        {expanded ? (
          <div className="paint-meeting-job">
            <div className="paint-meeting-job-head">
              <input aria-label="Company" placeholder="GC" value={line.company} onChange={(event) => patchLine(group.id, line.id, { company: event.target.value })} />
              <input aria-label="Job" placeholder="Job number and name" value={line.job} onChange={(event) => patchLine(group.id, line.id, { job: event.target.value })} />
              <div className="paint-meeting-line-actions">
                {MOVE_TO_ACTIVE_TITLES.has(group.title) ? (
                  <button type="button" className="btn" onClick={() => moveLineToActive(group.id, line)}>
                    Move to Active
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  title="Stays on this meeting. Copy for next week leaves it off. The job stays in JobFlow."
                  onClick={() => patchLine(group.id, line.id, { skipNext: !line.skipNext })}
                >
                  {line.skipNext ? "Keep for next week" : "Done talking"}
                </button>
                <button
                  type="button"
                  className="paint-meeting-remove"
                  aria-label="Remove from meeting"
                  title="Takes this job off the agenda. It stays in JobFlow."
                  onClick={() =>
                    patch({
                      groups: content.groups.map((item) =>
                        item.id === group.id ? { ...item, lines: item.lines.filter((row) => row.id !== line.id) } : item,
                      ),
                    })
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="paint-meeting-columns">
              <label>
                Discussion
                <textarea aria-label="Discussion" rows={4} placeholder="Discussion" value={line.notes} onChange={(event) => patchLine(group.id, line.id, { notes: event.target.value })} />
              </label>
              <label>
                <span className="paint-meeting-field-label">
                  Updates / Action Item
                  <button
                    type="button"
                    className="paint-meeting-move"
                    disabled={!line.action.trim()}
                    onClick={() => patchLine(group.id, line.id, { notes: moveActionToDiscussion(line.notes, line.action), action: "" })}
                  >
                    Move to discussion
                  </button>
                </span>
                <textarea aria-label="Updates / Action Item" rows={4} placeholder="Updates / Action Item" value={line.action} onChange={(event) => patchLine(group.id, line.id, { action: event.target.value })} />
              </label>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderTopics(topics: MeetingTopic[]) {
    return topics.map((topic) => {
        if (!content) return null;
        const open = sectionOpen(topic.id);
        const filled = topic.items.filter((item) => item.title.trim() || item.notes.trim() || item.action.trim()).length;
        function patchItem(itemId: string, partial: Partial<MeetingTopicItem>) {
          if (!content) return;
          patch({
            topics: content.topics.map((item) =>
              item.id === topic.id
                ? { ...item, items: item.items.map((row) => (row.id === itemId ? { ...row, ...partial } : row)) }
                : item,
            ),
          });
        }
        return (
        <div key={topic.id} className="card stack">
          <div className="row-between wrap gap">
            <button
              type="button"
              className="paint-meeting-toggle"
              aria-expanded={open}
              onClick={() => toggleSection(topic.id)}
            >
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
              <h2>{topic.title}</h2>
              {open ? null : <span className="muted small">{filled === 0 ? "empty" : filled === 1 ? "1 item" : `${filled} items`}</span>}
            </button>
            {open ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  patch({
                    topics: content.topics.map((item) =>
                      item.id === topic.id ? { ...item, items: [...item.items, emptyTopicItem()] } : item,
                    ),
                  })
                }
              >
                Add item
              </button>
            ) : null}
          </div>
          {open
            ? topic.items.map((item) => (
                <div key={item.id} className="paint-meeting-job">
                  <div className="paint-meeting-topic-head">
                    <input
                      aria-label="Item title"
                      placeholder="Item title"
                      value={item.title}
                      onChange={(event) => patchItem(item.id, { title: event.target.value })}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        patch({
                          topics: content.topics.map((row) =>
                            row.id === topic.id ? { ...row, items: row.items.filter((entry) => entry.id !== item.id) } : row,
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="paint-meeting-columns">
                    <label>
                      Discussion
                      <textarea
                        aria-label="Discussion"
                        rows={4}
                        placeholder="Discussion"
                        value={item.notes}
                        onChange={(event) => patchItem(item.id, { notes: event.target.value })}
                      />
                    </label>
                    <label>
                      <span className="paint-meeting-field-label">
                        Updates / Action Item
                        <button
                          type="button"
                          className="paint-meeting-move"
                          disabled={!item.action.trim()}
                          onClick={() =>
                            patchItem(item.id, {
                              notes: moveActionToDiscussion(item.notes, item.action),
                              action: "",
                            })
                          }
                        >
                          Move to discussion
                        </button>
                      </span>
                      <textarea
                        aria-label="Updates / Action Item"
                        rows={4}
                        placeholder="Updates / Action Item"
                        value={item.action}
                        onChange={(event) => patchItem(item.id, { action: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))
            : null}
        </div>
        );
      });
  }
}
