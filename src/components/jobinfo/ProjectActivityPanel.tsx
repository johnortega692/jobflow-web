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
  limit?: number;
};

function ActivityFeed({ rows, compact }: { rows: ProjectActivityRow[]; compact?: boolean }) {
  if (!rows.length) {
    return <p className="muted small">No edits logged yet for this project.</p>;
  }

  if (compact) {
    return (
      <ul className="job-activity-list job-activity-list--compact">
        {rows.map((row) => {
          const source = activityActionLabel(row.action);
          const summary = row.summary.trim();
          const action = summary && summary !== source ? summary : "Updated";
          return (
            <li key={row.id} className="job-activity-item job-activity-item--compact">
              <span className="job-activity-compact-main">
                {source} · {action}
              </span>
              <span className="job-activity-compact-time muted small">{formatDateTime(row.created_at)}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
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
  );
}

export function ProjectActivityPanel({ project, refreshKey = 0, limit }: Props) {
  const [rows, setRows] = useState<ProjectActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewAllOpen, setViewAllOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const fetchLimit = limit ? Math.max(limit, 12) : 12;
    const result = await loadProjectActivity(project.id, fetchLimit);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setRows([]);
      return;
    }
    setRows(result.rows);
  }, [project.id, limit]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const visibleRows = limit ? rows.slice(0, limit) : rows;
  const hasMore = limit ? rows.length > limit : false;

  return (
    <>
      <section className="card stack job-activity-panel">
        <div className="job-activity-header">
          <h3 className="job-dashboard-section-title">Recent activity</h3>
          {hasMore && (
            <button type="button" className="link-btn small" onClick={() => setViewAllOpen(true)}>
              View all
            </button>
          )}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {loading ? (
          <p className="muted small">Loading activity…</p>
        ) : (
          <ActivityFeed rows={visibleRows} compact={Boolean(limit)} />
        )}
      </section>

      {viewAllOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setViewAllOpen(false)}>
          <div
            className="modal card stack job-activity-modal"
            role="dialog"
            aria-labelledby="job-activity-all-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row-between wrap gap">
              <h2 id="job-activity-all-title" className="job-dashboard-section-title">
                Project activity
              </h2>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setViewAllOpen(false)}>
                Close
              </button>
            </div>
            {loading ? (
              <p className="muted small">Loading activity…</p>
            ) : (
              <ActivityFeed rows={rows} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
