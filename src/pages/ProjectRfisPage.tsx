import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { RfiStatusBadge } from "../components/rfi/RfiStatusBadge";
import { logProjectActivityEvent } from "../lib/projectActivity";
import { supabase } from "../lib/supabase";
import { RFI_STATUS_CLOSED, RFI_STATUS_OPEN, normalizeRfiStatus, rfiStatusCounts } from "../lib/rfiStatus";
import { formatDateTime } from "../lib/strings";
import type { ProjectForm, Rfi } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

function nextRfiNumber(numbers: string[]): string {
  const max = numbers.reduce((m, num) => {
    const n = parseInt(num, 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1).padStart(3, "0");
}

export function ProjectRfisPage() {
  const { projectId } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const statusSummary = rfiStatusCounts(rfis);

  async function load() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("rfis")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (err) setError(err.message);
    else setRfis(data ?? []);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function createRfi() {
    const nextNum = nextRfiNumber(rfis.map((r) => r.rfi_number ?? ""));
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("rfis")
      .insert({
        project_id: projectId,
        rfi_number: nextNum,
        subject: "New RFI",
        status: RFI_STATUS_OPEN,
        created_by: userData.user?.id ?? null,
      })
      .select()
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_created",
      summary: `RFI #${nextNum} created`,
    });
    navigate(`/projects/${projectId}/rfis/${data.id}`);
  }

  async function onDelete(rfi: Rfi) {
    if (!window.confirm(`Delete RFI #${rfi.rfi_number} — "${rfi.subject}"? This cannot be undone.`)) {
      return;
    }
    setDeletingId(rfi.id);
    setError(null);
    const { error: err } = await supabase.from("rfis").delete().eq("id", rfi.id);
    setDeletingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_deleted",
      summary: `RFI #${rfi.rfi_number} — "${rfi.subject}" deleted`,
    });
    setRfis((prev) => prev.filter((r) => r.id !== rfi.id));
  }

  async function setRfiStatus(rfi: Rfi, status: typeof RFI_STATUS_OPEN | typeof RFI_STATUS_CLOSED) {
    if (normalizeRfiStatus(rfi.status) === status) return;
    setStatusBusyId(rfi.id);
    setError(null);
    const { error: err } = await supabase.from("rfis").update({ status }).eq("id", rfi.id);
    setStatusBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "rfi_status_updated",
      summary: `RFI #${rfi.rfi_number} marked ${status}`,
    });
    setRfis((prev) => prev.map((r) => (r.id === rfi.id ? { ...r, status } : r)));
  }

  return (
    <section className="card">
      <div className="row-between" style={{ marginBottom: "1rem" }}>
        <div>
          <h2>RFIs</h2>
          {rfis.length > 0 && (
            <p className="muted small rfi-list-status-summary">
              {statusSummary.total} RFI(s) · {statusSummary.open} Open · {statusSummary.closed} Closed
            </p>
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void createRfi()}>
          New RFI
        </button>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {loading ? (
        <p className="muted">Loading RFIs…</p>
      ) : rfis.length === 0 ? (
        <p className="muted">No RFIs yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rfis.map((r) => (
                <tr key={r.id}>
                  <td>{r.rfi_number}</td>
                  <td>{r.subject}</td>
                  <td>
                    <RfiStatusBadge status={r.status} />
                  </td>
                  <td className="muted">{formatDateTime(r.updated_at)}</td>
                  <td>
                    <div className="row-gap wrap">
                      <Link className="btn btn-small" to={`/projects/${projectId}/rfis/${r.id}`}>
                        Edit
                      </Link>
                      {normalizeRfiStatus(r.status) === RFI_STATUS_OPEN ? (
                        <button
                          type="button"
                          className="btn btn-small btn-success-soft"
                          disabled={statusBusyId === r.id}
                          onClick={() => void setRfiStatus(r, RFI_STATUS_CLOSED)}
                        >
                          Mark closed
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small btn-secondary"
                          disabled={statusBusyId === r.id}
                          onClick={() => void setRfiStatus(r, RFI_STATUS_OPEN)}
                        >
                          Mark open
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-small btn-danger-soft"
                        disabled={deletingId === r.id}
                        onClick={() => void onDelete(r)}
                      >
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
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
