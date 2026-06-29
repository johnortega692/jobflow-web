import { useCallback, useEffect, useState } from "react";
import {
  deleteCompletedProject,
  listCompletedProjectsForAdmin,
  type CompletedProjectRow,
} from "../../lib/projectDelete";
import { formatDateTime } from "../../lib/strings";

export function CompletedProjectsSettingsSection() {
  const [rows, setRows] = useState<CompletedProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { rows: next, error: err } = await listCompletedProjectsForAdmin();
    setLoading(false);
    if (err) setError(err);
    else setRows(next);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function projectLabel(row: CompletedProjectRow): string {
    return `${row.job_number} ${row.job_name}`.trim();
  }

  function startConfirm(row: CompletedProjectRow) {
    setConfirmId(row.id);
    setConfirmText("");
    setMessage(null);
    setError(null);
  }

  function cancelConfirm() {
    setConfirmId(null);
    setConfirmText("");
  }

  async function onDelete(row: CompletedProjectRow) {
    const expected = row.job_number.trim();
    if (confirmText.trim() !== expected) {
      setError(`Type the job number "${expected}" to confirm deletion.`);
      return;
    }
    setBusyId(row.id);
    setError(null);
    setMessage(null);
    const err = await deleteCompletedProject(row.id);
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    setConfirmId(null);
    setConfirmText("");
    setMessage(`Deleted ${projectLabel(row)} and all related JobFlow data.`);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  }

  return (
    <section className="stack">
      <div className="settings-section-head">
        <div>
          <h2>Completed projects</h2>
          <p className="muted" style={{ margin: "4px 0 0", maxWidth: 560 }}>
            Permanently remove projects that were marked <strong>Done</strong> in Manpower → Admin. This deletes
            RFIs, submittals, work orders, activity history, and uploaded files for that job from JobFlow.
          </p>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}

      {loading ? (
        <p className="muted">Loading completed projects…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          No completed projects ready for deletion. Mark a project done in Manpower → Admin first.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job #</th>
                <th>Name</th>
                <th>Marked done</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.job_number}</td>
                  <td>{row.job_name || "—"}</td>
                  <td className="muted">{row.marked_done_at ? formatDateTime(row.marked_done_at) : "—"}</td>
                  <td>
                    {confirmId === row.id ? (
                      <div className="stack" style={{ minWidth: 220 }}>
                        <label className="small">
                          Type <strong>{row.job_number}</strong> to confirm
                          <input
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            autoFocus
                            disabled={busyId === row.id}
                          />
                        </label>
                        <div className="row-gap">
                          <button
                            type="button"
                            className="btn btn-danger-soft btn-sm"
                            disabled={busyId === row.id}
                            onClick={() => void onDelete(row)}
                          >
                            {busyId === row.id ? "Deleting…" : "Delete permanently"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === row.id}
                            onClick={cancelConfirm}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger-soft btn-sm"
                        onClick={() => startConfirm(row)}
                      >
                        Delete…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
