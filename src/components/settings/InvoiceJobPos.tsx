import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { LastMinReceiptsModal } from "../fieldTools/LastMinReceiptsModal";
import { reloadProject } from "../../lib/fieldTrackerProject";
import {
  listFieldOrderTotals,
  listPoDispatchesForJobs,
  parseLastMinAmount,
  saveFieldOrderInvoice,
  saveLastMinAmount,
  updatePoDispatchTracking,
  type FieldOrderMoney,
  type FieldToolsPoDispatchRow,
} from "../../lib/fieldToolsPoTracker";
import { formatMaterialDollars } from "../../lib/materialOrderSpend";
import { projectTradeJobIdentities } from "../../lib/jobInfo";
import { supabase } from "../../lib/supabase";

type JobChoice = {
  id: string;
  jobNumber: string;
  jobName: string;
};

function formatPoDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function PoTotalField({
  poNumber,
  saved,
  placed,
  canEdit,
  onSave,
}: {
  poNumber: string;
  saved: string;
  placed: string | null;
  canEdit: boolean;
  onSave: (amount: number) => Promise<string>;
}) {
  const [amount, setAmount] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = amount.trim() !== saved;

  async function save() {
    const value = parseLastMinAmount(amount);
    if (value == null) {
      setError("Enter the order total, like 119.63.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await onSave(value);
      setAmount(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the order total.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="read-invoice-po-total">
      <span>Order total</span>
      {canEdit ? (
        <>
          <input
            className="input"
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            aria-label={`Order total for ${poNumber}`}
            disabled={busy}
            onChange={(event) => {
              setAmount(event.target.value);
              setError(null);
            }}
          />
          <button type="button" className="btn btn-small" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      ) : (
        <strong>{saved ? `$${saved}` : "—"}</strong>
      )}
      {placed ? <span className="read-invoice-po-placed">Placed {placed}</span> : null}
      {error ? <span className="read-invoice-po-total-error">{error}</span> : null}
    </div>
  );
}

export function InvoiceJobPos({
  projectId,
  onJobChange,
  catalogNote,
  children,
}: {
  projectId?: string;
  onJobChange?: (jobNumber: string, poNumbers: string[]) => void;
  catalogNote?: string;
  children?: ReactNode;
}) {
  const [jobs, setJobs] = useState<JobChoice[]>([]);
  const [selectedId, setSelectedId] = useState(projectId ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FieldToolsPoDispatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [receipt, setReceipt] = useState<{ orderId: string; poNumber: string } | null>(null);
  const [tab, setTab] = useState<"catalog" | "pos">("catalog");
  const [moneyByOrder, setMoneyByOrder] = useState<Map<string, FieldOrderMoney>>(() => new Map());
  const [openPoId, setOpenPoId] = useState<string | null>(null);
  const { isAdmin } = useAuth();

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("projects")
      .select("id, job_number, job_name")
      .order("job_number")
      .then(({ data, error: loadError }) => {
        if (cancelled || loadError || !data) return;
        setJobs(
          data.map((row) => ({
            id: String(row.id),
            jobNumber: String(row.job_number ?? "").trim(),
            jobName: String(row.job_name ?? "").trim(),
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projectId) setSelectedId(projectId);
  }, [projectId]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return jobs.slice(0, 8);
    return jobs
      .filter((job) => `${job.jobNumber} ${job.jobName}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [jobs, query]);

  useEffect(() => {
    if (!selectedId) {
      setRows([]);
      setMoneyByOrder(new Map());
      setOpenPoId(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setOpenPoId(null);
    setShowAll(false);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const project = await reloadProject(selectedId);
        const lookups = project
          ? projectTradeJobIdentities(project).map((identity) => ({
              jobNumber: identity.jobNumber,
              contractLabel: identity.contractLabel,
            }))
          : selected
            ? [{ jobNumber: selected.jobNumber, contractLabel: "Paint" }]
            : [];
        const next = lookups.length ? await listPoDispatchesForJobs(lookups) : [];
        const jobNumbers = [...new Set([...lookups.map((lookup) => lookup.jobNumber), ...next.map((row) => row.jobNumber)])].filter(Boolean);
        const totals = (
          await Promise.all(jobNumbers.map((jobNumber) => listFieldOrderTotals(jobNumber).catch(() => [] as FieldOrderMoney[])))
        ).flat();
        if (!cancelled) {
          setRows(next);
          setMoneyByOrder(new Map(totals.map((money) => [money.orderId, money])));
        }
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Could not load POs.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selected]);

  const todoRows = rows.filter((row) => !row.receivedField && !row.completed);
  const shown = showAll ? rows : todoRows;
  const poKey = shown.map((row) => row.poNumber).join("|");

  useEffect(() => {
    onJobChange?.(selected?.jobNumber ?? "", poKey ? poKey.split("|") : []);
  }, [onJobChange, poKey, selected?.jobNumber]);

  async function toggle(row: FieldToolsPoDispatchRow, field: "receivedField" | "completed", next: boolean) {
    setBusyId(row.dispatchId);
    setError(null);
    const prev = rows;
    setRows((current) => current.map((item) => (item.dispatchId === row.dispatchId ? { ...item, [field]: next } : item)));
    try {
      await updatePoDispatchTracking(
        row.dispatchId,
        { receivedField: field === "receivedField" ? next : undefined, completed: field === "completed" ? next : undefined },
        row.source,
      );
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "Could not update that PO.");
    } finally {
      setBusyId(null);
    }
  }

  const jobLabel = selected ? [selected.jobNumber, selected.jobName].filter(Boolean).join(" · ") : "";

  return (
    <section className="read-invoice-job" aria-label="Job, catalog, and purchase orders">
      <div className="read-invoice-job-search">
      <div className="read-invoice-job-bar">
        <label>
          Job
          <input
            value={open ? query : jobLabel}
            placeholder="Search a job for this invoice"
            aria-label="Job for this invoice"
            onFocus={() => {
              setQuery("");
              setOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 150);
            }}
          />
        </label>
      </div>
      {open ? (
        <ul className="read-invoice-job-list">
          {matches.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSelectedId(job.id);
                  setQuery("");
                  setOpen(false);
                  setTab("pos");
                }}
              >
                <strong>{job.jobNumber || "No number"}</strong>
                <span>{job.jobName}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="muted small">No jobs match.</li> : null}
        </ul>
      ) : null}
      </div>
      <div className="read-invoice-tabs" role="tablist" aria-label="Invoice workspace">
        <button
          type="button"
          role="tab"
          id="read-invoice-tab-catalog"
          aria-controls="read-invoice-panel-catalog"
          aria-selected={tab === "catalog"}
          className={tab === "catalog" ? "is-on" : undefined}
          onClick={() => setTab("catalog")}
        >
          <span>Pricing & Catalog</span>
          {catalogNote ? <span className="read-invoice-tabs-count">{catalogNote}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          id="read-invoice-tab-pos"
          aria-controls="read-invoice-panel-pos"
          aria-selected={tab === "pos"}
          className={tab === "pos" ? "is-on" : undefined}
          onClick={() => setTab("pos")}
        >
          <span>Job POs</span>
          {selected && shown.length > 0 ? <span className="read-invoice-tabs-badge">{shown.length}</span> : null}
        </button>
      </div>
      {tab === "catalog" ? (
        <div id="read-invoice-panel-catalog" role="tabpanel" aria-labelledby="read-invoice-tab-catalog">
          {children}
        </div>
      ) : (
        <div className="read-invoice-tab-body" id="read-invoice-panel-pos" role="tabpanel" aria-labelledby="read-invoice-tab-pos">
          {selected ? (
            <div className="read-invoice-po-filter" role="group" aria-label="Which POs to show">
              <button type="button" className={showAll ? undefined : "is-on"} aria-pressed={!showAll} onClick={() => setShowAll(false)}>
                To Do
              </button>
              <button type="button" className={showAll ? "is-on" : undefined} aria-pressed={showAll} onClick={() => setShowAll(true)}>
                Show All
              </button>
            </div>
          ) : null}
          {selected && shown.length > 0 ? <p className="read-invoice-po-hint muted small">Select a PO to see what was ordered.</p> : null}
          {error ? <p className="material-prices-error">{error}</p> : null}
          {!selected ? (
            <p className="read-invoice-tab-empty muted small">Search a job above. Received and Completed update that job’s POs.</p>
          ) : null}
          {loading && selectedId ? <p className="muted small">Loading POs…</p> : null}
          {!loading && selectedId && shown.length === 0 ? (
            <p className="muted small">
              {showAll ? "No POs on this job." : "No POs left to do on this job."}
            </p>
          ) : null}
          {shown.length > 0 ? (
            <div className="read-invoice-po-scroll">
              <ul className="read-invoice-po-list">
                {shown.map((row) => {
                  const orderedOn = formatPoDate(row.submittedAt);
                  const money = moneyByOrder.get(row.orderId);
                  const fieldTotal =
                    row.orderType === "field_request" || row.orderType === "pm_order"
                      ? {
                          saved: money ? (money.invoice ?? money.placed).toFixed(2) : "",
                          placed:
                            money && money.invoice != null && money.invoice !== money.placed
                              ? formatMaterialDollars(money.placed)
                              : null,
                        }
                      : null;
                  const lastMinTotal =
                    row.orderType === "last_min"
                      ? {
                          saved: row.lastMinAmount,
                          placed:
                            row.lastMinPlaced && row.lastMinAmount && row.lastMinPlaced !== row.lastMinAmount
                              ? `$${row.lastMinPlaced}`
                              : null,
                        }
                      : null;
                  const total = fieldTotal ?? lastMinTotal;
                  const totalText = total?.saved
                    ? Number.isFinite(Number(total.saved))
                      ? formatMaterialDollars(Number(total.saved))
                      : `$${total.saved}`
                    : "";
                  const expanded = openPoId === row.dispatchId;
                  return (
                  <li key={row.dispatchId} className={expanded ? "is-open" : undefined}>
                    <button
                      type="button"
                      className="read-invoice-po-toggle"
                      aria-expanded={expanded}
                      onClick={() => setOpenPoId(expanded ? null : row.dispatchId)}
                    >
                      <span className="read-invoice-po-chevron" aria-hidden />
                      <span className="read-invoice-po-summary">
                        <span className="read-invoice-po-title">
                          <strong>{row.poNumber}</strong>
                          {row.orderType === "last_min" ? <span className="read-invoice-po-kind">Last-Min</span> : null}
                        </span>
                        <small>{row.vendorLabel || "—"}</small>
                      </span>
                      <span className="read-invoice-po-summary-side">
                        {orderedOn ? <span className="read-invoice-po-date">{orderedOn}</span> : null}
                        {totalText ? <span className="read-invoice-po-summary-total">{totalText}</span> : null}
                      </span>
                    </button>
                    {expanded ? (
                    <div className="read-invoice-po-body">
                    <div className="read-invoice-po-items">
                      {row.orderedItems.length > 0 ? (
                        row.orderedItems.map((item, index) => <p key={`${row.dispatchId}-${index}`}>{item}</p>)
                      ) : (
                        <p className="muted">{row.orderType === "last_min" ? "Last-Min receipt" : "No items listed"}</p>
                      )}
                    </div>
                    {total ? (
                      <PoTotalField
                        key={`${row.orderId}-${total.saved}`}
                        poNumber={row.poNumber}
                        saved={total.saved}
                        placed={total.placed}
                        canEdit={isAdmin}
                        onSave={async (amount) => {
                          if (row.orderType === "last_min") {
                            const next = await saveLastMinAmount(row.orderId, amount);
                            setRows((current) =>
                              current.map((item) => (item.orderId === row.orderId ? { ...item, lastMinAmount: next } : item)),
                            );
                            return next;
                          }
                          const next = await saveFieldOrderInvoice(row.orderId, amount);
                          const invoice = Number(next);
                          setMoneyByOrder((current) => {
                            const copy = new Map(current);
                            const prev = copy.get(row.orderId);
                            const invoiceAmount = Number.isFinite(invoice) ? invoice : amount;
                            copy.set(
                              row.orderId,
                              prev
                                ? { ...prev, invoice: invoiceAmount }
                                : { orderId: row.orderId, placed: invoiceAmount, invoice: invoiceAmount, unpriced: 0 },
                            );
                            return copy;
                          });
                          return next;
                        }}
                      />
                    ) : null}
                    <div className="read-invoice-po-actions">
                      <label className="read-invoice-po-check">
                        <input
                          type="checkbox"
                          checked={row.receivedField}
                          disabled={busyId === row.dispatchId}
                          aria-label={`Received ${row.poNumber}`}
                          onChange={(event) => void toggle(row, "receivedField", event.target.checked)}
                        />
                        Received
                      </label>
                      <label className="read-invoice-po-check">
                        <input
                          type="checkbox"
                          checked={row.completed}
                          disabled={busyId === row.dispatchId}
                          aria-label={`Completed ${row.poNumber}`}
                          onChange={(event) => void toggle(row, "completed", event.target.checked)}
                        />
                        Completed
                      </label>
                      {row.hasReceipt || row.orderType === "last_min" ? (
                        <button type="button" className="btn btn-small" onClick={() => setReceipt({ orderId: row.orderId, poNumber: row.poNumber })}>
                          Receipt
                        </button>
                      ) : null}
                    </div>
                    </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
      {receipt ? (
        <LastMinReceiptsModal
          orderId={receipt.orderId}
          poNumber={receipt.poNumber}
          onClose={() => setReceipt(null)}
          onReceiptCount={(count) =>
            setRows((current) =>
              current.map((row) => (row.orderId === receipt.orderId ? { ...row, hasReceipt: count > 0 } : row)),
            )
          }
        />
      ) : null}
    </section>
  );
}
