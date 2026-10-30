import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  allocateEwoNumber,
  loadExtraWorkTags,
  openExtraWorkTagPdf,
  saveExtraWorkTagPrice,
  type OfficeExtraWorkTag,
} from "../lib/extraWorkTags";
import { ContractListFilter, type ContractListFilterValue } from "../components/jobinfo/ContractListFilter";
import {
  hasTransmittalContractSwitch,
  TRANSMITTAL_CONTRACT_LABELS,
} from "../lib/jobInfo";
import { logProjectActivityEvent } from "../lib/projectActivity";
import { supabase } from "../lib/supabase";
import {
  computeBudgetFromCosts,
  formatMoney,
  nextEwoNumber,
} from "../lib/workOrderCalc";
import type { ProjectForm } from "../types/database";
import { parseWorkOrderData, type WorkOrderRow } from "../types/workOrder";

type Ctx = { project: ProjectForm; projectId: string };

function todayDisplay(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

/** List timestamp without seconds (e.g. 6/25/2026, 5:50 PM). */
function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type RowView = WorkOrderRow & {
  parsed: ReturnType<typeof parseWorkOrderData>;
  budget: ReturnType<typeof computeBudgetFromCosts>;
};

function buildRowView(order: WorkOrderRow): RowView {
  const parsed = parseWorkOrderData(order.data);
  const budget = computeBudgetFromCosts(
    Number(order.material_cost),
    parsed.raw_cost,
    parsed.indirects,
  );
  return { ...order, parsed, budget };
}

function moneyDraft(value: number | null): string {
  return value == null ? "" : value.toFixed(2);
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999.99) return null;
  return Math.round(amount * 100) / 100;
}

function tagDateDisplay(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso || "—";
  return `${month}/${day}/${year}`;
}

function tagIsPriced(tag: OfficeExtraWorkTag): boolean {
  return tag.status === "signed" && tag.laborAmount != null && tag.materialAmount != null;
}

function ExtraWorkPdfActions({ path, filename }: { path: string; filename: string }) {
  const [busy, setBusy] = useState<"" | "view" | "download">("");
  const [error, setError] = useState<string | null>(null);

  async function open(download: boolean) {
    setBusy(download ? "download" : "view");
    setError(null);
    try {
      await openExtraWorkTagPdf(path, filename, download);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the PDF.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
      <button type="button" className="btn btn-secondary btn-small" disabled={busy !== ""} onClick={() => void open(false)}>
        {busy === "view" ? "Opening…" : "View PDF"}
      </button>
      <button type="button" className="btn btn-secondary btn-small" disabled={busy !== ""} onClick={() => void open(true)}>
        {busy === "download" ? "Downloading…" : "Download PDF"}
      </button>
      {error ? <span className="muted small">{error}</span> : null}
    </div>
  );
}

function StatusMark({ on, label }: { on: boolean; label: string }) {
  if (on) {
    return (
      <span className="work-orders-status-ok" aria-label={label}>
        ✓
      </span>
    );
  }
  return (
    <span className="work-orders-status-empty" aria-label={`Not ${label.toLowerCase()}`}>
      —
    </span>
  );
}

export function ProjectWorkOrdersPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [tags, setTags] = useState<OfficeExtraWorkTag[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, { labor: string; material: string }>>({});
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractFilter, setContractFilter] = useState<ContractListFilterValue>("all");

  const showContractColumn = hasTransmittalContractSwitch(project);

  async function load() {
    setLoading(true);
    const ordersPromise = supabase
      .from("work_orders")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    const tagsPromise = isAdmin ? loadExtraWorkTags(projectId) : Promise.resolve({ tags: [] as OfficeExtraWorkTag[], error: null });
    const [{ data, error: err }, tagResult] = await Promise.all([ordersPromise, tagsPromise]);
    if (err) setError(err.message);
    else setOrders((data ?? []) as WorkOrderRow[]);
    if (tagResult.error) setError(tagResult.error);
    else setTags(tagResult.tags);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [projectId, isAdmin]);

  useEffect(() => {
    const next: Record<string, { labor: string; material: string }> = {};
    for (const tag of tags) {
      if (tag.status !== "signed") continue;
      next[tag.id] = {
        labor: moneyDraft(tag.laborAmount),
        material: moneyDraft(tag.materialAmount),
      };
    }
    setPriceDrafts(next);
  }, [tags]);

  const rows = useMemo(() => orders.map(buildRowView), [orders]);

  const filteredRows = useMemo(() => {
    if (contractFilter === "all") return rows;
    return rows.filter((row) => row.parsed.contract === contractFilter);
  }, [contractFilter, rows]);

  const pricedTags = useMemo(() => tags.filter(tagIsPriced), [tags]);
  const visiblePricedTags = contractFilter === "all" ? pricedTags : [];

  const summary = useMemo(() => {
    let totalAmount = 0;
    let pendingFsi = 0;
    for (const row of filteredRows) {
      totalAmount += Number(row.total_amount);
      if (!row.parsed.fsi_checked) pendingFsi += 1;
    }
    for (const tag of visiblePricedTags) {
      totalAmount += (tag.laborAmount ?? 0) + (tag.materialAmount ?? 0);
    }
    return { totalAmount, pendingFsi, count: filteredRows.length + visiblePricedTags.length };
  }, [filteredRows, visiblePricedTags]);
  const showOrderTable = filteredRows.length > 0 || visiblePricedTags.length > 0;

  useEffect(() => {
    setContractFilter("all");
  }, [projectId]);

  function openOrder(id: string) {
    navigate(`/projects/${projectId}/work-orders/${id}`);
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openOrder(id);
    }
  }

  async function savePrice(tag: OfficeExtraWorkTag) {
    const draft = priceDrafts[tag.id] ?? {
      labor: moneyDraft(tag.laborAmount),
      material: moneyDraft(tag.materialAmount),
    };
    const labor = parsePrice(draft.labor);
    const material = parsePrice(draft.material);
    if (labor == null || material == null) {
      setError("Enter a labor amount and a material amount.");
      return;
    }
    setSavingPriceId(tag.id);
    setError(null);
    const message = await saveExtraWorkTagPrice(tag.id, labor, material);
    setSavingPriceId(null);
    if (message) {
      setError(message);
      return;
    }
    setTags((current) =>
      current.map((row) => (row.id === tag.id ? { ...row, laborAmount: labor, materialAmount: material } : row)),
    );
  }

  async function createWorkOrder() {
    const nextNum = await allocateEwoNumber(projectId, orders.map((o) => o.ewo_number), nextEwoNumber);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("work_orders")
      .insert({
        project_id: projectId,
        ewo_number: nextNum,
        ewo_date: todayDisplay(),
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
      action: "work_order_created",
      summary: `EWO #${nextNum} created`,
    });
    navigate(`/projects/${projectId}/work-orders/${data.id}`);
  }

  return (
    <section className="card stack work-orders-page">
      <div className="row-between wrap">
        <div>
          <h2>Work Orders (EWO)</h2>
          <p className="muted small">
            Track extra work orders for this job. Budget columns match desktop Work Order Manager Jobs List.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void createWorkOrder()}>
          New EWO
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <ContractListFilter project={project} value={contractFilter} onChange={setContractFilter} />

      {loading ? (
        <p className="muted">Loading work orders…</p>
      ) : !showOrderTable && orders.length === 0 ? (
        <p className="muted">No work orders yet. Create an EWO to enter labor, material, and totals.</p>
      ) : !showOrderTable ? (
        <p className="muted">
          No work orders for{" "}
          {contractFilter === "all" ? "this job" : TRANSMITTAL_CONTRACT_LABELS[contractFilter]}.
        </p>
      ) : (
        <>
          <div className="billing-calc-stat-strip work-orders-summary">
            <div className="billing-calc-stat-tile">
              <span className="billing-calc-stat-label">Total EWOs</span>
              <strong className="billing-calc-stat-value">{summary.count}</strong>
            </div>
            <div className="billing-calc-stat-tile">
              <span className="billing-calc-stat-label">Total amount</span>
              <strong className="billing-calc-stat-value work-orders-stat-ok">
                {formatMoney(summary.totalAmount)}
              </strong>
            </div>
            <div className="billing-calc-stat-tile">
              <span className="billing-calc-stat-label">Not added FSI</span>
              <strong
                className={`billing-calc-stat-value${summary.pendingFsi > 0 ? " work-orders-stat-warn" : ""}`}
              >
                {summary.pendingFsi}
              </strong>
            </div>
          </div>

          <div className="table-wrap work-orders-table-wrap">
            <table className="data-table work-orders-table">
              <thead>
                <tr>
                  <th>EWO #</th>
                  {showContractColumn && <th>Contract</th>}
                  <th>Date</th>
                  <th className="num">Hrs</th>
                  <th className="num">Total</th>
                  <th className="num">Mat</th>
                  <th className="num">Indirects</th>
                  <th className="num">Raw Lab</th>
                  <th className="num">Budget</th>
                  <th className="work-orders-status-col">FSI</th>
                  <th className="work-orders-status-col">Delivered</th>
                  <th>Updated</th>
                  <th className="work-orders-chevron-col" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((o) => (
                  <tr
                    key={o.id}
                    className="work-orders-row"
                    tabIndex={0}
                    role="link"
                    aria-label={`Open EWO ${o.ewo_number}`}
                    onClick={() => openOrder(o.id)}
                    onKeyDown={(e) => onRowKeyDown(e, o.id)}
                  >
                    <td>{o.ewo_number}</td>
                    {showContractColumn && (
                      <td className="muted small">
                        {TRANSMITTAL_CONTRACT_LABELS[o.parsed.contract]}
                      </td>
                    )}
                    <td>{o.ewo_date || "—"}</td>
                    <td className="num">
                      {o.parsed.hours > 0
                        ? o.parsed.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })
                        : "—"}
                    </td>
                    <td className="num">{formatMoney(Number(o.total_amount))}</td>
                    <td className="num">{formatMoney(o.budget.material_minus_10)}</td>
                    <td className="num">{formatMoney(o.budget.indirects)}</td>
                    <td className="num">{formatMoney(o.budget.raw_labor)}</td>
                    <td className="num">{formatMoney(o.budget.budget_total)}</td>
                    <td className="work-orders-status-col">
                      <StatusMark on={o.parsed.fsi_checked} label="Added FSI" />
                    </td>
                    <td className="work-orders-status-col">
                      <StatusMark on={o.delivered} label="Delivered" />
                    </td>
                    <td className="work-orders-updated">{formatUpdatedAt(o.updated_at)}</td>
                    <td className="work-orders-chevron-col" aria-hidden="true">
                      <span className="work-orders-chevron">›</span>
                    </td>
                  </tr>
                ))}
                {visiblePricedTags.map((tag) => (
                  <tr key={tag.id}>
                    <td>
                      {tag.tagNumber || "—"} <span className="muted small">Tag</span>
                    </td>
                    {showContractColumn && <td />}
                    <td>{tagDateDisplay(tag.tagDate)}</td>
                    <td className="num">
                      {tag.hoursTotal > 0
                        ? tag.hoursTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })
                        : "—"}
                    </td>
                    <td className="num">{formatMoney((tag.laborAmount ?? 0) + (tag.materialAmount ?? 0))}</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                    <td className="work-orders-status-col">—</td>
                    <td className="work-orders-status-col">—</td>
                    <td className="work-orders-updated">{formatUpdatedAt(tag.updatedAt)}</td>
                    <td className="work-orders-chevron-col" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isAdmin && (
        <div className="stack">
          <div>
            <h3>Field tags</h3>
            <p className="muted small">
              Tags saved from Field Tools. They share this job&apos;s EWO numbers. Enter labor and materials after a tag is signed.
            </p>
          </div>
          {tags.length === 0 ? (
            <p className="muted">No field tags yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tag #</th>
                    <th>Date</th>
                    <th>Area</th>
                    <th>Description</th>
                    <th>Hours</th>
                    <th>Materials</th>
                    <th className="num">Labor $</th>
                    <th className="num">Material $</th>
                    <th className="num">Total</th>
                    <th>By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((tag) => {
                    const draft = priceDrafts[tag.id] ?? {
                      labor: moneyDraft(tag.laborAmount),
                      material: moneyDraft(tag.materialAmount),
                    };
                    const labor = parsePrice(draft.labor);
                    const material = parsePrice(draft.material);
                    const canSave = tag.status === "signed"
                      && (draft.labor.trim() !== moneyDraft(tag.laborAmount)
                        || draft.material.trim() !== moneyDraft(tag.materialAmount));
                    return (
                    <Fragment key={tag.id}>
                    <tr>
                      <td>{tag.tagNumber || "—"}</td>
                      <td>{tag.tagDate || "—"}</td>
                      <td>{tag.area || "—"}</td>
                      <td>{tag.description || "—"}</td>
                      <td>{tag.hoursLabel || "—"}</td>
                      <td>{tag.materialsLabel || "—"}</td>
                      <td className="num">
                        {tag.status === "signed" ? (
                          <input
                            aria-label={`Labor price for tag ${tag.tagNumber}`}
                            inputMode="decimal"
                            value={draft.labor}
                            onChange={(e) =>
                              setPriceDrafts((current) => ({
                                ...current,
                                [tag.id]: { ...(current[tag.id] ?? draft), labor: e.target.value },
                              }))
                            }
                            style={{ width: "7rem" }}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">
                        {tag.status === "signed" ? (
                          <input
                            aria-label={`Material price for tag ${tag.tagNumber}`}
                            inputMode="decimal"
                            value={draft.material}
                            onChange={(e) =>
                              setPriceDrafts((current) => ({
                                ...current,
                                [tag.id]: { ...(current[tag.id] ?? draft), material: e.target.value },
                              }))
                            }
                            style={{ width: "7rem" }}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">
                        {tag.status === "signed" ? (
                          <div className="stack" style={{ alignItems: "flex-end", gap: 6 }}>
                            <span>{labor != null && material != null ? formatMoney(labor + material) : "—"}</span>
                            {canSave ? (
                              <button
                                type="button"
                                className="btn btn-primary btn-small"
                                disabled={savingPriceId === tag.id}
                                onClick={() => void savePrice(tag)}
                              >
                                {savingPriceId === tag.id ? "Saving…" : "Save"}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{tag.submittedByName}</td>
                      <td>
                        {tag.status === "waiting"
                          ? "Waiting for signature"
                          : tag.status === "signed"
                            ? "Signed"
                            : tag.status === "refused"
                              ? "Refused"
                              : "Draft"}
                      </td>
                    </tr>
                    {tag.photos.length > 0 || tag.signaturePng || tag.refusedNote || tag.pdfPath || tag.status === "signed" ? (
                      <tr>
                        <td colSpan={11}>
                          <div className="stack">
                            {tag.pdfPath ? (
                              <ExtraWorkPdfActions path={tag.pdfPath} filename={tag.pdfFilename || `Extra work tag ${tag.tagNumber}.pdf`} />
                            ) : tag.status === "signed" ? (
                              <p className="muted small">The PDF is saved when the signed tag is emailed.</p>
                            ) : null}
                            {tag.signerName ? (
                              <p className="small">
                                {tag.status === "refused" ? "Refused by" : "Signed by"} {tag.signerName}
                                {tag.signerCompany ? `, ${tag.signerCompany}` : ""}
                                {tag.refusedNote ? ` — ${tag.refusedNote}` : ""}
                              </p>
                            ) : null}
                            {tag.signaturePng ? (
                              <img src={tag.signaturePng} alt="Signature" style={{ maxWidth: 280, background: "#fff" }} />
                            ) : null}
                            {tag.photos.length > 0 ? (
                              <div className="row wrap" style={{ gap: 8 }}>
                                {tag.photos.map((photo, index) => (
                                  <img
                                    key={index}
                                    src={photo.startsWith("data:") ? photo : `data:image/jpeg;base64,${photo}`}
                                    alt=""
                                    style={{ width: 120, height: 90, objectFit: "cover" }}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
