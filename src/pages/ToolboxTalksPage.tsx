import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatDateTime } from "../lib/strings";
import { loadToolboxTalks, type ToolboxTalk } from "../lib/toolboxTalks";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

function signedInLabel(count: number): string {
  return count === 1 ? "1 signed in" : `${count} signed in`;
}

export function ToolboxTalksPage() {
  const { projectId } = useOutletContext<Ctx>();
  const [talks, setTalks] = useState<ToolboxTalk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadToolboxTalks(projectId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      setError(result.error);
      setTalks(result.talks);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="card stack">
      <p className="muted small">Submitted from Field Tools for this job.</p>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted small">Loading toolbox talks…</p>
      ) : talks.length === 0 ? (
        <p className="muted">No toolbox talks have been submitted for this job yet.</p>
      ) : (
        <div className="stack">
          {talks.map((talk) => (
            <article key={talk.id} className="job-activity-item">
              <div className="job-activity-item-main">
                <span className="job-activity-action">{talk.title}</span>
              </div>
              <div className="job-activity-meta muted small">
                {talk.submittedByName} · {formatDateTime(talk.completedAt)} · {signedInLabel(talk.attendeeCount)}
              </div>
              {talk.notes ? <div className="job-activity-summary">{talk.notes}</div> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
