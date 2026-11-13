import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { copyMeetingForNextWeek, formatMeetingDate, meetingContentOf, meetingDateLine, type PaintMeetingRecord } from "../lib/paintMeeting";
import { createPaintMeeting, listPaintMeetings } from "../lib/paintMeetingStorage";
import "./MeetingsPage.css";

export function MeetingsPage() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<PaintMeetingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listPaintMeetings()
      .then((rows) => {
        if (!cancelled) setMeetings(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load meetings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function startMeeting(source?: PaintMeetingRecord) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPaintMeeting(source ? copyMeetingForNextWeek(meetingContentOf(source)) : undefined);
      void navigate(`/meetings/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a meeting.");
      setBusy(false);
    }
  }

  return (
    <section className="stack paint-meetings">
      <div className="row-between wrap gap">
        <div>
          <h1>Meeting</h1>
          <p className="muted">Weekly paint agenda and minutes. Save the record, then download a PDF or Word file.</p>
        </div>
        <div className="paint-meetings-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startMeeting()}>
            New meeting
          </button>
        </div>
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading meetings…</p>
      ) : meetings.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No meetings yet. Start one to fill in attendees, project updates, and the standing topics.
          </p>
        </div>
      ) : (
        <ul className="paint-meetings-list">
          {meetings.map((meeting) => (
            <li key={meeting.id} className="card paint-meetings-row">
              <Link className="paint-meetings-card" to={`/meetings/${meeting.id}`}>
                <strong>{meeting.title || "Meeting Agenda"}</strong>
                <span className="muted">{meetingDateLine(meeting) || formatMeetingDate(meeting.meetingDate) || "Date not set"}</span>
                <span>{meeting.purpose}</span>
              </Link>
              <button type="button" className="btn" disabled={busy} onClick={() => void startMeeting(meeting)}>
                Copy for next week
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
