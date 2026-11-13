import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  copyMeetingForNextWeek,
  emptyAttendee,
  emptyJobLine,
  meetingContentOf,
  sortAttendees,
  sortMeetingLines,
  type MeetingAttendee,
  type MeetingJobLine,
  type MeetingSort,
  type PaintMeetingContent,
} from "../lib/paintMeeting";
import { downloadMeetingDocx, downloadMeetingPdf } from "../lib/paintMeetingExport";
import { createPaintMeeting, deletePaintMeeting, getPaintMeeting, savePaintMeeting } from "../lib/paintMeetingStorage";
import "./MeetingsPage.css";

export function MeetingEditorPage() {
  const { meetingId = "" } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState<PaintMeetingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPaintMeeting(meetingId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("Meeting was not found.");
          setContent(null);
          return;
        }
        setContent(meetingContentOf(row));
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

  function patch(partial: Partial<PaintMeetingContent>) {
    setSaved(false);
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

  async function onSave() {
    if (!content || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const savedRow = await savePaintMeeting(meetingId, content);
      setContent(meetingContentOf(savedRow));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the meeting.");
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
    if (!content || open) {
      setCollapsed(new Set());
      return;
    }
    setCollapsed(new Set(["attendees", ...content.groups.map((group) => group.id), ...content.topics.map((topic) => topic.id)]));
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

  return (
    <section className="stack paint-meetings">
      <div className="row-between wrap gap">
        <div>
          <Link className="muted small" to="/meetings">
            All meetings
          </Link>
          <h1>Meeting</h1>
        </div>
        <div className="paint-meetings-actions">
          <button type="button" className="btn" onClick={() => setAllSections(collapsed.size > 0)}>
            {collapsed.size > 0 ? "Expand sections" : "Collapse sections"}
          </button>
          <button type="button" className="btn" onClick={() => void onCopyNextWeek()} disabled={copying || saving}>
            {copying ? "Copying…" : "Copy for next week"}
          </button>
          <button type="button" className="btn" onClick={() => void onExport("pdf")} disabled={exporting !== null}>
            {exporting === "pdf" ? "Preparing PDF…" : "Download PDF"}
          </button>
          <button type="button" className="btn" onClick={() => void onExport("docx")} disabled={exporting !== null}>
            {exporting === "docx" ? "Preparing Word…" : "Download Word"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card stack">
        <label>
          Title
          <input value={content.title} onChange={(event) => patch({ title: event.target.value })} />
        </label>
        <div className="paint-meeting-meta">
          <label>
            Meeting date
            <input type="date" value={content.meetingDate} onChange={(event) => patch({ meetingDate: event.target.value })} />
          </label>
          <label>
            Time
            <input value={content.meetingTime} onChange={(event) => patch({ meetingTime: event.target.value })} />
          </label>
          <label>
            Purpose
            <input value={content.purpose} onChange={(event) => patch({ purpose: event.target.value })} />
          </label>
          <label>
            Next meeting
            <input
              value={content.nextMeeting}
              placeholder="Thursday 11/19 @ 1:00 PM PST"
              onChange={(event) => patch({ nextMeeting: event.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="card stack">
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
          </div> : null}
        </div>
        {sectionOpen("attendees") ? <div className="paint-meeting-attendees">
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

      {content.groups.map((group) => {
        const open = sectionOpen(group.id);
        const jobCount = group.lines.filter((line) => line.company.trim() || line.job.trim() || line.notes.trim()).length;
        return (
        <div key={group.id} className="card stack">
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
                  value={group.sort === "company" || group.sort === "job" ? group.sort : "entered"}
                  onChange={(event) => {
                    const sort = event.target.value as MeetingSort;
                    patch({
                      groups: content.groups.map((item) =>
                        item.id === group.id ? { ...item, sort, lines: sortMeetingLines(item.lines, sort) } : item,
                      ),
                    });
                  }}
                >
                  <option value="entered">As entered</option>
                  <option value="company">Company</option>
                  <option value="job">Job number</option>
                </select>
              </label>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  patch({
                    groups: content.groups.map((item) =>
                      item.id === group.id ? { ...item, lines: [...item.lines, emptyJobLine()] } : item,
                    ),
                  })
                }
              >
                Add job
              </button>
            </div> : null}
          </div>
          {open ? group.lines.map((line) => (
            <div key={line.id} className="paint-meeting-job">
              <div className="paint-meeting-job-head">
                <input aria-label="Company" placeholder="GC" value={line.company} onChange={(event) => patchLine(group.id, line.id, { company: event.target.value })} />
                <input aria-label="Job" placeholder="Job number and name" value={line.job} onChange={(event) => patchLine(group.id, line.id, { job: event.target.value })} />
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    patch({
                      groups: content.groups.map((item) =>
                        item.id === group.id ? { ...item, lines: item.lines.filter((row) => row.id !== line.id) } : item,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
              <textarea
                aria-label="Job notes"
                rows={3}
                placeholder="Updates for this job"
                value={line.notes}
                onChange={(event) => patchLine(group.id, line.id, { notes: event.target.value })}
              />
            </div>
          )) : null}
        </div>
        );
      })}

      {content.topics.map((topic) => {
        const open = sectionOpen(topic.id);
        return (
        <div key={topic.id} className="card stack">
          <button
            type="button"
            className="paint-meeting-toggle"
            aria-expanded={open}
            onClick={() => toggleSection(topic.id)}
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            <h2>{topic.title}</h2>
            {open ? null : <span className="muted small">{topic.body.trim() ? "Has notes" : "Empty"}</span>}
          </button>
          {open ? <textarea
            aria-label={topic.title}
            rows={5}
            placeholder="Notes"
            value={topic.body}
            onChange={(event) =>
              patch({ topics: content.topics.map((item) => (item.id === topic.id ? { ...item, body: event.target.value } : item)) })
            }
            /> : null}
        </div>
        );
      })}

      <div>
        <button type="button" className="btn" onClick={() => void onDelete()}>
          Delete meeting
        </button>
      </div>
    </section>
  );
}
