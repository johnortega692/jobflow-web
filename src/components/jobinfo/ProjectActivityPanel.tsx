import { useCallback, useEffect, useState } from "react";
import {
  activityActionLabel,
  loadProjectActivity,
  type ProjectActivityRow,
} from "../../lib/projectActivity";
import { formatDateTime } from "../../lib/strings";
import type { ProjectForm } from "../../types/database";

type Props = {
  project: ProjectForm;
  refreshKey?: string | number;
};

function resolveLastEditor(
  project: ProjectForm,
  rows: ProjectActivityRow[],
): { name: string; at: string | null } {
  if (rows[0]) {
    return { name: rows[0].user_name.trim() || "Unknown user", at: rows[0].created_at };
  }
  if (project.updated_at) {
    return { name: "Unknown user", at: project.updated_at };
  }
  return { name: "", at: null };
}

export function ProjectActivityPanel({ project, refreshKey = 0 }: Props) {
  const [rows, setRows] = useState<ProjectActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadProjectActivity(project.id, 12);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setRows([]);
      return;
    }
    setRows(result.rows);
  }, [project.id]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const last = resolveLastEditor(project, rows);

  return (
    <section className="card stack job-activity-panel">
      <div className="job-activity-header">
        <h3 className="job-dashboard-section-title">Project activity</h3>
        {last.at && (
          <p className="muted small job-activity-last">
            Last updated by <strong>{last.name}</strong> · {formatDateTime(last.at)}
          </p>
        )}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {loading ? (
        <p className="muted small">Loading activity…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No edits logged yet for this project.</p>
      ) : (
        <ul className="job-activity-list">
          {rows.map((row) => (
            <li key={row.id} className="job-activity-item">
              <div className="job-activity-item-main">
                <span className="job-activity-action">{activityActionLabel(row.action)}</span>
                {row.summary && row.summary !== activityActionLabel(row.action) && (
                  <span className="job-activity-summary">{row.summary}</span>
                )}
              </div>
              <div className="job-activity-meta muted small">
                {row.user_name.trim() || "Unknown user"} · {formatDateTime(row.created_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
