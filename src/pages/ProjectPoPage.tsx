import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FieldToolsOrderViewModal } from "../components/fieldTools/FieldToolsOrderViewModal";
import { LastMinReceiptsModal } from "../components/fieldTools/LastMinReceiptsModal";
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

/** Known paint vendors. Longer keys are matched first so "Sherwin Williams" wins over shorter prefixes. */
const VENDOR_SHORT_CODES: Record<string, string> = {
  "sherwin williams": "S-W",
  "sherwin william": "S-W",
  "dunn edwards": "D-E",
  "dunn edward": "D-E",
  "benjamin moore": "B-M",
  ppg: "PPG",
  vista: "Vista",
};

function formatMdYy(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

function formatCompactTime(d: Date): string {
  const hours24 = d.getHours();
  const suffix = hours24 >= 12 ? "p" : "a";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(d.getMinutes()).padStart(2, "0")}${suffix}`;
}

function formatSubmittedParts(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { date: formatMdYy(d), time: formatCompactTime(d) };
}

function formatNeededDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return formatMdYy(d);
}

function vendorShortCode(label: string): string | null {
  const normalized = label
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return null;
  const keys = Object.keys(VENDOR_SHORT_CODES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized === key || normalized.startsWith(key)) return VENDOR_SHORT_CODES[key];
  }
  return null;
}

function shortPersonName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const initial = parts[0]?.[0]?.toUpperCase() ?? "";
  return `${initial}. ${parts[parts.length - 1]}`;
}

function orderDispatchLabel(row: FieldToolsPoDispatchRow): string {
  const parts = formatPoOrderMeta(row).split(" · ");
  return parts.length > 1 ? parts.slice(1).join(" · ") : "";
}

function orderTypeChip(type: string): { label: string; tone: string } {
  switch (type) {
    case "pm_order":
      return { label: "PM", tone: "pm" };
    case "last_min":
      return { label: "Last-min", tone: "last-min" };
    case "haul_off":
      return { label: "Haul", tone: "haul" };
    case "job_scope_kit":
      return { label: "Kit", tone: "kit" };
    case "material_order":
      return { label: "Order", tone: "order" };
    default:
      return { label: "Field", tone: "field" };
  }
}

function PoReceivedFieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M5 17h-2v-4m-1 -8h11v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5" />
      <path d="M3 9l4 0" />
    </svg>
  );
}

function PoCompletedIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -10" />
      <path d="M7 20h10" />
      <path d="M9 16v4" />
      <path d="M15 16v4" />
      <path d="M9 12v-4" />
      <path d="M12 12v-1" />
      <path d="M15 12v-2" />
      <path d="M12 12v-1" />
    </svg>
  );
}

function PoViewIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
      <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
    </svg>
  );
}

function PoReceiptIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16l-3 -2l-2 2l-2 -2l-2 2l-2 -2l-3 2" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </svg>
  );
}

export function ProjectPoPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const [rows, setRows] = useState<FieldToolsPoDispatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewOrder, setViewOrder] = useState<ViewTarget | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<{ orderId: string; poNumber: string } | null>(null);
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
          <strong>Hide from Field Tools ordering, Field View, digest emails, order history, and Manpower Cal</strong> in Job
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
          for this job (shared sequence, e.g. 1058-002).
        </p>
        <ul className="po-tracker-legend">
          <li>
            <span className="po-tracker-legend-icon" aria-hidden="true">
              <PoReceivedFieldIcon size={15} />
            </span>
            <span>
              Check <strong>Received Field</strong> when the foreman sends a packing slip photo
            </span>
          </li>
          <li>
            <span className="po-tracker-legend-icon" aria-hidden="true">
              <PoCompletedIcon size={15} />
            </span>
            <span>
              and <strong>Completed</strong> after the PO is entered in FSI.
            </span>
          </li>
        </ul>
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
          <table className={`po-tracker-table${hasMultipleContracts ? " po-tracker-table--contracts" : ""}`}>
            <colgroup>
              <col className="po-tracker-col-po" />
              {hasMultipleContracts && <col className="po-tracker-col-contract" />}
              <col className="po-tracker-col-submitted" />
              <col className="po-tracker-col-order" />
              <col className="po-tracker-col-vendor" />
              <col className="po-tracker-col-by" />
              <col className="po-tracker-col-needed" />
              <col className="po-tracker-col-check" />
              <col className="po-tracker-col-check" />
              <col className="po-tracker-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>PO#</th>
                {hasMultipleContracts && <th>Contract</th>}
                <th>Submitted</th>
                <th>Order</th>
                <th>Vendor</th>
                <th>By</th>
                <th>Needed</th>
                <th className="po-tracker-check-col" title="Received Field">
                  <span className="po-tracker-th-icon">
                    <PoReceivedFieldIcon size={15} />
                  </span>
                  <span className="sr-only">Received Field</span>
                </th>
                <th className="po-tracker-check-col" title="Completed">
                  <span className="po-tracker-th-icon">
                    <PoCompletedIcon size={15} />
                  </span>
                  <span className="sr-only">Completed</span>
                </th>
                <th className="po-tracker-action-col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const submitted = formatSubmittedParts(row.submittedAt);
                const chip = orderTypeChip(row.orderType);
                const dispatchLabel = orderDispatchLabel(row);
                const emailNote = row.emailStatus !== "sent" ? `Email: ${row.emailStatus}` : "";
                const vendorFull = row.vendorLabel.trim();
                const vendorCode = vendorFull ? vendorShortCode(vendorFull) : null;
                const byFull = row.submittedBy.trim();
                const byShort = byFull ? shortPersonName(byFull) : "";
                return (
                  <tr key={row.dispatchId} className={row.completed ? "po-tracker-row--done" : undefined}>
                    <td title={row.poNumber}>
                      <strong>{row.poNumber}</strong>
                    </td>
                    {hasMultipleContracts && <td title={row.contractLabel}>{row.contractLabel}</td>}
                    <td title={submitted ? `${submitted.date} ${submitted.time}` : row.submittedAt}>
                      {submitted ? (
                        <span className="po-tracker-line">
                          {submitted.date} <span className="po-tracker-sub">{submitted.time}</span>
                        </span>
                      ) : (
                        row.submittedAt
                      )}
                    </td>
                    <td title={[formatPoOrderMeta(row), emailNote].filter(Boolean).join(" · ")}>
                      <span className="po-tracker-line po-tracker-order-line">
                        <span className={`po-tracker-type po-tracker-type--${chip.tone}`}>{chip.label}</span>
                        <span className="po-tracker-order-text">
                          {dispatchLabel ? ` · ${dispatchLabel}` : ""}
                          {emailNote ? ` · ${emailNote}` : ""}
                        </span>
                      </span>
                    </td>
                    <td title={vendorFull || undefined}>{vendorCode || vendorFull || "—"}</td>
                    <td title={byFull || undefined}>{byShort || "—"}</td>
                    <td>{formatNeededDate(row.dateNeeded)}</td>
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
                      <div className="po-tracker-actions">
                        {row.orderType === "last_min" && (
                          <button
                            type="button"
                            className="btn btn-ghost po-tracker-icon-btn"
                            aria-label={`View receipt for PO ${row.poNumber}`}
                            title="Receipt"
                            onClick={() =>
                              setReceiptOrder({ orderId: row.orderId, poNumber: row.poNumber })
                            }
                          >
                            <PoReceiptIcon />
                          </button>
                        )}
                        {row.source === "field_tools" ? (
                          <button
                            type="button"
                            className="btn btn-ghost po-tracker-icon-btn"
                            aria-label={`View PO ${row.poNumber}`}
                            title="View"
                            onClick={() =>
                              setViewOrder({
                                orderId: row.orderId,
                                poNumber: row.poNumber,
                                dispatchId: row.dispatchId,
                              })
                            }
                          >
                            <PoViewIcon />
                          </button>
                        ) : (
                          <span className="muted small">PDF</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row-between wrap">
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {receiptOrder && (
        <LastMinReceiptsModal
          orderId={receiptOrder.orderId}
          poNumber={receiptOrder.poNumber}
          onClose={() => setReceiptOrder(null)}
        />
      )}

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
