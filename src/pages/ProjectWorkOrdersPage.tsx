import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
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
import { deleteWorkOrder } from "../lib/workOrderStorage";
import { formatDateTime } from "../lib/strings";
import type { Json, ProjectForm } from "../types/database";
import { parseWorkOrderData, type WorkOrderRow } from "../types/workOrder";

type Ctx = { project: ProjectForm; projectId: string };

function todayDisplay(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
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

export function ProjectWorkOrdersPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [contractFilter, setContractFilter] = useState<ContractListFilterValue>("all");

  const showContractColumn = hasTransmittalContractSwitch(project);

  async function load() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("work_orders")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (err) setError(err.message);
    else setOrders((data ?? []) as WorkOrderRow[]);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  const rows = useMemo(() => orders.map(buildRowView), [orders]);

  const filteredRows = useMemo(() => {
    if (contractFilter === "all") return rows;
    return rows.filter((row) => row.parsed.contract === contractFilter);
  }, [contractFilter, rows]);

  const summary = useMemo(() => {
    let totalAmount = 0;
    let pendingFsi = 0;
    for (const row of filteredRows) {
      totalAmount += Number(row.total_amount);
      if (!row.parsed.fsi_checked) pendingFsi += 1;
    }
    return { totalAmount, pendingFsi, count: filteredRows.length };
  }, [filteredRows]);

  useEffect(() => {
    setContractFilter("all");
  }, [projectId]);

  async function createWorkOrder() {
    const nextNum = nextEwoNumber(orders.map((o) => o.ewo_number));
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

  async function onDelete(order: WorkOrderRow) {
    if (
      !window.confirm(
        `Delete EWO #${order.ewo_number}? This removes the work order and any uploaded PDF/image.`,
      )
    ) {
      return;
    }
    setDeletingId(order.id);
    setError(null);
    try {
      await deleteWorkOrder(order.id, order.data);
      await logProjectActivityEvent({
        projectId,
        action: "work_order_deleted",
        summary: `EWO #${order.ewo_number} deleted`,
      });
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete work order.");
    } finally {
      setDeletingId(null);
    }
  }

  async function onToggleFsi(order: WorkOrderRow, value: boolean) {
    setTogglingId(order.id);
    setError(null);
    const parsed = parseWorkOrderData(order.data);
    const updated = { ...parsed, fsi_checked: value };
    const { error: err } = await supabase
      .from("work_orders")
      .update({ data: updated as unknown as Json })
      .eq("id", order.id);
    setTogglingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    await logProjectActivityEvent({
      projectId,
      action: "work_order_updated",
      summary: `EWO #${order.ewo_number} — Added FSI ${value ? "checked" : "unchecked"}`,
    });
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, data: updated as unknown as Json } : o)),
    );
  }

  return (
    <section className="card stack">
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
      ) : orders.length === 0 ? (
        <p className="muted">No work orders yet. Create an EWO to enter labor, material, and totals.</p>
      ) : filteredRows.length === 0 ? (
        <p className="muted">
          No work orders for{" "}
          {contractFilter === "all" ? "this job" : TRANSMITTAL_CONTRACT_LABELS[contractFilter]}.
        </p>
      ) : (
        <>
          <div className="budget-metrics-bar work-orders-summary">
            <div className="budget-metric">
              <span className="muted small">Total EWOs</span>
              <strong>{summary.count}</strong>
            </div>
            <div className="budget-metric ok">
              <span className="muted small">Total amount</span>
              <strong>{formatMoney(summary.totalAmount)}</strong>
            </div>
            <div className="budget-metric">
              <span className="muted small">Not added FSI</span>
              <strong>{summary.pendingFsi}</strong>
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
                  <th>Added FSI</th>
                  <th>Delivered</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((o) => (
                  <tr key={o.id}>
                    <td>{o.ewo_number}</td>
                    {showContractColumn && (
                      <td className="muted small">
                        {TRANSMITTAL_CONTRACT_LABELS[o.parsed.contract]}
                      </td>
                    )}
                    <td>{o.ewo_date || "—"}</td>
                    <td className="num">
                      {o.parsed.hours > 0 ? o.parsed.hours.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}
                    </td>
                    <td className="num">{formatMoney(Number(o.total_amount))}</td>
                    <td className="num">{formatMoney(o.budget.material_minus_10)}</td>
                    <td className="num">{formatMoney(o.budget.indirects)}</td>
                    <td className="num">{formatMoney(o.budget.raw_labor)}</td>
                    <td className="num">{formatMoney(o.budget.budget_total)}</td>
                    <td className="work-orders-flag">
                      <input
                        type="checkbox"
                        aria-label={`Added FSI for EWO ${o.ewo_number}`}
                        checked={o.parsed.fsi_checked}
                        disabled={togglingId === o.id}
                        onChange={(e) => void onToggleFsi(o, e.target.checked)}
                      />
                    </td>
                    <td>{o.delivered ? "Yes" : "—"}</td>
                    <td className="muted">{formatDateTime(o.updated_at)}</td>
                    <td>
                      <div className="row-gap">
                        <Link className="btn btn-small" to={`/projects/${projectId}/work-orders/${o.id}`}>
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-small btn-danger-soft"
                          disabled={deletingId === o.id}
                          onClick={() => void onDelete(o)}
                        >
                          {deletingId === o.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
