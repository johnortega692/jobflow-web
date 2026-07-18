import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FieldToolsOrderViewModal } from "../components/fieldTools/FieldToolsOrderViewModal";
import { projectTradeJobIdentities, type TransmittalContract } from "../lib/jobInfo";
import {
  formatPoOrderMeta,
  listPoDispatchesForJobs,
  type FieldToolsPoDispatchRow,
  updatePoDispatchTracking,
} from "../lib/fieldToolsPoTracker";
import { getProjectFieldAppVisibility } from "../lib/projectFieldAppVisibility";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

type ViewTarget = { orderId: string; poNumber: string; dispatchId: string };

function formatDateNeeded(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ProjectPoPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const [rows, setRows] = useState<FieldToolsPoDispatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewOrder, setViewOrder] = useState<ViewTarget | null>(null);
  const [contractFilter, setContractFilter] = useState<TransmittalContract | "all">("all");
  const [hiddenFromFieldApps, setHiddenFromFieldApps] = useState(false);
  const [visibilityLoaded, setVisibilityLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setVisibilityLoaded(false);
    void (async () => {
      try {
        const hidden = await getProjectFieldAppVisibility(projectId);
        if (!cancelled) setHiddenFromFieldApps(hidden);
      } catch {
        if (!cancelled) setHiddenFromFieldApps(false);
      } finally {
        if (!cancelled) setVisibilityLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const jobLookups = useMemo(
    () =>
      projectTradeJobIdentities(project).map((identity) => ({
        jobNumber: identity.jobNumber,
        contractLabel: identity.contractLabel,
      })),
    [project],
  );

  const hasMultipleContracts = jobLookups.length > 1;

  const load = useCallback(async () => {
    if (!jobLookups.length || hiddenFromFieldApps) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRows(await listPoDispatchesForJobs(jobLookups));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load PO orders.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [jobLookups, hiddenFromFieldApps]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (contractFilter === "all") return rows;
    const identity = projectTradeJobIdentities(project).find((item) => item.contract === contractFilter);
    if (!identity) return rows;
    return rows.filter((row) => row.contractLabel === identity.contractLabel);
  }, [contractFilter, project, rows]);

  const stats = useMemo(() => {
    const total = filteredRows.length;
    const received = filteredRows.filter((r) => r.receivedField).length;
    const completed = filteredRows.filter((r) => r.completed).length;
    return { total, received, completed };
  }, [filteredRows]);

  async function toggleRow(
    row: FieldToolsPoDispatchRow,
    field: "receivedField" | "completed",
    next: boolean,
  ) {
    setBusyId(row.dispatchId);
    setError(null);
    const prev = rows;
    setRows((current) =>
      current.map((r) => (r.dispatchId === row.dispatchId ? { ...r, [field]: next } : r)),
    );
    try {
      await updatePoDispatchTracking(
        row.dispatchId,
        {
          receivedField: field === "receivedField" ? next : undefined,
          completed: field === "completed" ? next : undefined,
        },
        row.source,
      );
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  const viewRow = viewOrder ? rows.find((r) => r.dispatchId === viewOrder.dispatchId) : null;

  if (visibilityLoaded && hiddenFromFieldApps) {
    return (
      <div className="stack po-tracker-page">
        <div className="banner banner-warn">
          Order history is hidden while this project is hidden from Field Tools. Uncheck{" "}
          <strong>Hide from Field Tools ordering, order history, and Manpower Cal</strong> in Job
          setup to show PO tracking again.
        </div>
      </div>
    );
  }

  return (
    <div className="stack po-tracker-page">
      <div className="po-tracker-intro">
        <p className="muted small">
          PO numbers issued from <strong>Field Tools</strong> and <strong>Material orders</strong>{" "}
          for this job (shared sequence, e.g. 1058-002). Check <strong>Received Field</strong> when
          the foreman sends a packing slip photo, and <strong>Completed</strong> after the PO is
          entered in FSI.
        </p>
        {jobLookups.length > 0 && (
          <p className="muted small">
            Tracking POs for{" "}
            {jobLookups.map((lookup, index) => (
              <span key={lookup.jobNumber}>
                <strong>{lookup.contractLabel}</strong> {lookup.jobNumber}
                {index < jobLookups.length - 1 ? " · " : ""}
              </span>
            ))}
            {stats.total > 0 && (
              <>
                {" "}
                · {stats.received}/{stats.total} received · {stats.completed}/{stats.total} completed
              </>
            )}
          </p>
        )}
      </div>

      {hasMultipleContracts && (
        <div className="row-gap wrap po-tracker-filters">
          <span className="muted small">Show</span>
          <button
            type="button"
            className={`btn btn-sm${contractFilter === "all" ? " btn-secondary" : " btn-ghost"}`}
            onClick={() => setContractFilter("all")}
          >
            All contracts
          </button>
          {projectTradeJobIdentities(project).map((identity) => (
            <button
              key={identity.contract}
              type="button"
              className={`btn btn-sm${contractFilter === identity.contract ? " btn-secondary" : " btn-ghost"}`}
              onClick={() => setContractFilter(identity.contract)}
            >
              {identity.contractLabel}
            </button>
          ))}
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {!jobLookups.length ? (
        <p className="banner banner-warn">Add a job number on the project dashboard to track POs.</p>
      ) : loading ? (
        <p className="muted">Loading PO orders…</p>
      ) : filteredRows.length === 0 ? (
        <p className="muted">
          No PO orders yet
          {contractFilter === "all" ? " for this job" : " for this contract"}. Field Tools material
          orders and JobFlow Material Order PDFs will appear here.
        </p>
      ) : (
        <div className="po-tracker-table-wrap">
          <table className="po-tracker-table">
            <thead>
              <tr>
                <th>PO#</th>
                {hasMultipleContracts && <th>Contract</th>}
                <th>Submitted</th>
                <th>Order</th>
                <th>Vendor</th>
                <th>By</th>
                <th>Needed</th>
                <th className="po-tracker-check-col">Received Field</th>
                <th className="po-tracker-check-col">Completed</th>
                <th className="po-tracker-action-col"> </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.dispatchId} className={row.completed ? "po-tracker-row--done" : undefined}>
                  <td>
                    <strong>{row.poNumber}</strong>
                  </td>
                  {hasMultipleContracts && <td>{row.contractLabel}</td>}
                  <td>{formatSubmittedAt(row.submittedAt)}</td>
                  <td>
                    <div>{formatPoOrderMeta(row)}</div>
                    <div className="muted small">
                      {row.jobNumber}
                      {row.jobName ? ` · ${row.jobName}` : ""}
                    </div>
                    {row.emailStatus !== "sent" && (
                      <div className="muted small">Email: {row.emailStatus}</div>
                    )}
                  </td>
                  <td>{row.vendorLabel || "—"}</td>
                  <td>{row.submittedBy || "—"}</td>
                  <td>{row.dateNeeded ? formatDateNeeded(row.dateNeeded) : "—"}</td>
                  <td className="po-tracker-check-col">
                    <label className="po-tracker-check">
                      <input
                        type="checkbox"
                        checked={row.receivedField}
                        disabled={busyId === row.dispatchId}
                        onChange={(e) => void toggleRow(row, "receivedField", e.target.checked)}
                      />
                      <span className="sr-only">Received Field for {row.poNumber}</span>
                    </label>
                  </td>
                  <td className="po-tracker-check-col">
                    <label className="po-tracker-check">
                      <input
                        type="checkbox"
                        checked={row.completed}
                        disabled={busyId === row.dispatchId}
                        onChange={(e) => void toggleRow(row, "completed", e.target.checked)}
                      />
                      <span className="sr-only">Completed for {row.poNumber}</span>
                    </label>
                  </td>
                  <td className="po-tracker-action-col">
                    {row.source === "field_tools" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setViewOrder({
                            orderId: row.orderId,
                            poNumber: row.poNumber,
                            dispatchId: row.dispatchId,
                          })
                        }
                      >
                        View
                      </button>
                    ) : (
                      <span className="muted small">PDF</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row-between wrap">
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {viewOrder && viewRow && (
        <FieldToolsOrderViewModal
          orderId={viewOrder.orderId}
          poNumber={viewOrder.poNumber}
          receivedField={viewRow.receivedField}
          completed={viewRow.completed}
          trackingBusy={busyId === viewRow.dispatchId}
          onToggleReceived={(next) => void toggleRow(viewRow, "receivedField", next)}
          onToggleCompleted={(next) => void toggleRow(viewRow, "completed", next)}
          onClose={() => setViewOrder(null)}
        />
      )}
    </div>
  );
}
