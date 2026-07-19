import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
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
  const navigate = useNavigate();
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  function openOrder(id: string) {
    navigate(`/projects/${projectId}/work-orders/${id}`);
  }

  function onRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openOrder(id);
    }
  }

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
      ) : orders.length === 0 ? (
        <p className="muted">No work orders yet. Create an EWO to enter labor, material, and totals.</p>
      ) : filteredRows.length === 0 ? (
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
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
