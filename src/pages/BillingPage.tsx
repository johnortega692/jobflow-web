import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { LaborRatesModal } from "../components/billing/LaborRatesModal";
import { ManpowerMonthlyBudgetCard } from "../components/billing/ManpowerMonthlyBudgetCard";
import { ManpowerBudgetCard } from "../components/billing/ManpowerBudgetCard";
import { ManpowerPlanCard } from "../components/billing/ManpowerPlanCard";
import { WeekBudgetEditorModal } from "../components/billing/WeekBudgetEditorModal";
import { useAuth } from "../contexts/AuthContext";
import { loadCompanyLaborRates } from "../lib/companyLaborRates";
import { saveProjectBilling, saveProjectBillingQuiet } from "../lib/projectBillingStorage";
import { supabase } from "../lib/supabase";
import {
  earnedVsPlanBillable,
  currentMonthLabel,
  planBillablePctOfContract,
  planBillablePctOfPlan,
  planToDateFromCalendar,
  totalPlanFromCalendar,
} from "../lib/weeklyBudget";
import {
  blendedBillRate,
  blendedCostRate,
  defaultProjectBilling,
  formatMoney0,
  formatPct0,
  lineItemsTotal,
  newBillingLineItemId,
  newLaborRateId,
  parseProjectBilling,
  projectedMarginDollars,
  projectedMarginPct,
  projectedTotalCost,
  revisedContract,
  type BillingLineItem,
  type LaborRate,
  type ProjectBillingData,
} from "../types/projectBilling";
import type { ProjectForm } from "../types/database";
import { normalizeProject } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

function MoneyInput({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      inputMode="decimal"
      className="billing-num-input"
      value={value === 0 ? "" : value}
      placeholder={placeholder ?? "0"}
      disabled={disabled}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) && n >= 0 ? n : 0);
      }}
    />
  );
}

function SummaryCard({
  label,
  value,
  subtitle,
  subtitleMuted,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  subtitleMuted?: boolean;
  tone?: "amber" | "blue" | "green" | "red";
}) {
  return (
    <div className={`billing-summary-card${tone ? ` billing-summary-card--${tone}` : ""}`}>
      <span className="billing-summary-label">{label}</span>
      <span className="billing-summary-value">{value}</span>
      {subtitle && (
        <span className={`billing-summary-sub${subtitleMuted ? " billing-summary-sub--muted" : ""}`}>
          {subtitle}
        </span>
      )}
    </div>
  );
}

export function BillingPage() {
  const { project, projectId, setProject } = useOutletContext<Ctx>();
  const { user } = useAuth();

  const [billing, setBilling] = useState<ProjectBillingData>(() => parseProjectBilling(project.data));
  const [companyRates, setCompanyRates] = useState<LaborRate[]>([]);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingWeekBudget, setEditingWeekBudget] = useState<string | null>(null);
  const [laborRatesOpen, setLaborRatesOpen] = useState(false);

  useEffect(() => {
    setBilling(parseProjectBilling(project.data));
  }, [project.data]);

  /** Pick up start/end dates saved from Job setup on another tab (layout context can be stale). */
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setProject(normalizeProject(data));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, setProject]);

  useEffect(() => {
    void loadCompanyLaborRates().then(setCompanyRates).catch(() => setCompanyRates([]));
  }, []);

  const applyBilling = useCallback(
    (next: ProjectBillingData) => {
      setBilling(next);
      setProject({ ...project, data: { ...(project.data as object), billing: next } as ProjectForm["data"] });
    },
    [project, setProject],
  );

  const persist = useCallback(
    async (next: ProjectBillingData, summary: string) => {
      setSaving(true);
      setError(null);
      const err = await saveProjectBilling(projectId, next, summary);
      setSaving(false);
      if (err) {
        setError(err);
        return false;
      }
      applyBilling(next);
      setStatus("Saved.");
      return true;
    },
    [applyBilling, projectId],
  );

  const persistQuiet = useCallback(
    async (next: ProjectBillingData) => {
      setSaving(true);
      setError(null);
      const err = await saveProjectBillingQuiet(projectId, next);
      setSaving(false);
      if (err) {
        setError(err);
        return false;
      }
      applyBilling(next);
      return true;
    },
    [applyBilling, projectId],
  );

  const revised = revisedContract(billing.contract);
  const bCostRate = blendedCostRate(billing.laborRates);
  const bBillRate = blendedBillRate(billing.laborRates);
  const projectStartIso = project.jobInfo.start_date ?? "";
  const projectEndIso = project.jobInfo.end_date ?? "";
  const planToDate = planToDateFromCalendar(billing, projectStartIso, projectEndIso);
  const totalPlan = totalPlanFromCalendar(billing, projectStartIso, projectEndIso);
  const billableToDate = planToDate.billable;
  const costToDatePlan = planToDate.cost;
  const billablePercent = planBillablePctOfContract(billableToDate, revised);
  const planBillablePercent = planBillablePctOfPlan(billableToDate, totalPlan.billable);
  const projCost = projectedTotalCost(billing);
  const marginDollars = projectedMarginDollars(billing);
  const marginPct = projectedMarginPct(billing);
  const earnedPlan = earnedVsPlanBillable(billing, projectStartIso, projectEndIso);
  const throughMonth = currentMonthLabel();

  const corCount = billing.contract.changes.length > 0 ? `+ ${billing.contract.changes.length} change${billing.contract.changes.length === 1 ? "" : "s"}` : null;
  const changesTotal = lineItemsTotal(billing.contract.changes);
  const budgetTotal = lineItemsTotal(billing.budgetLines);
  const revisedSubtitle = useMemo(() => {
    const base = formatMoney0(billing.contract.baseAmount);
    return corCount ? `base ${base} ${corCount}` : `base ${base}`;
  }, [billing.contract.baseAmount, corCount]);

  const earnedSubtitle = useMemo(() => {
    const earned = formatPct0(earnedPlan.earnedPct);
    const planBillable =
      earnedPlan.billedPct !== null ? formatPct0(earnedPlan.billedPct) : "—";
    if (earnedPlan.isUnderbilled) {
      return `Earned ${earned} vs plan billable ${planBillable} · under by ~${formatMoney0(earnedPlan.underbilledAmount)}`;
    }
    return `Earned ${earned} vs plan billable ${planBillable} · ahead of plan`;
  }, [earnedPlan]);

  /* ---------- Contract + budgets ---------- */

  function patchContract(patch: Partial<ProjectBillingData["contract"]>) {
    setBilling((b) => ({ ...b, contract: { ...b.contract, ...patch } }));
  }

  function patchChange(id: string, patch: Partial<BillingLineItem>) {
    setBilling((b) => ({
      ...b,
      contract: {
        ...b.contract,
        changes: b.contract.changes.map((line) => (line.id === id ? { ...line, ...patch } : line)),
      },
    }));
  }
  function addChange() {
    setBilling((b) => ({
      ...b,
      contract: {
        ...b.contract,
        changes: [...b.contract.changes, { id: newBillingLineItemId(), label: "", amount: 0 }],
      },
    }));
  }
  function removeChange(id: string) {
    setBilling((b) => ({
      ...b,
      contract: { ...b.contract, changes: b.contract.changes.filter((line) => line.id !== id) },
    }));
  }

  function patchBudgetLine(id: string, patch: Partial<BillingLineItem>) {
    setBilling((b) => ({
      ...b,
      budgetLines: b.budgetLines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    }));
  }
  function addBudgetLine() {
    setBilling((b) => ({
      ...b,
      budgetLines: [...b.budgetLines, { id: newBillingLineItemId(), label: "", amount: 0 }],
    }));
  }
  function removeBudgetLine(id: string) {
    setBilling((b) => ({ ...b, budgetLines: b.budgetLines.filter((line) => line.id !== id) }));
  }

  /* ---------- Labor rates ---------- */

  function patchRate(id: string, patch: Partial<LaborRate>) {
    setBilling((b) => ({
      ...b,
      laborRates: b.laborRates.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }
  function addRate() {
    setBilling((b) => ({
      ...b,
      laborRates: [...b.laborRates, { id: newLaborRateId(), className: "", costRate: 0, billRate: 0, crewMix: 1 }],
    }));
  }
  function removeRate(id: string) {
    setBilling((b) => ({ ...b, laborRates: b.laborRates.filter((r) => r.id !== id) }));
  }
  function resetRatesToCompany() {
    const seeded = (companyRates.length ? companyRates : []).map((r) => ({ ...r, id: newLaborRateId() }));
    setBilling((b) => ({ ...b, laborRates: seeded.length ? seeded : defaultProjectBilling().laborRates }));
  }

  /* ---------- Contract + budgets ---------- */

  return (
    <div className="stack billing-page">
      {(error || status) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? status}</div>
      )}

      <div className="row-between wrap gap billing-page-toolbar">
        <p className="muted small billing-page-toolbar-hint">
          Blended labor {formatMoney0(bCostRate)} cost · {formatMoney0(bBillRate)} bill
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setLaborRatesOpen(true)}
          disabled={saving}
        >
          Options
        </button>
      </div>

      {/* a. Summary cards */}
      <div className="billing-summary-row billing-summary-row--five">
        <SummaryCard label="Revised contract" value={formatMoney0(revised)} subtitle={revisedSubtitle} />
        <SummaryCard
          label="Billable to date"
          value={formatMoney0(billableToDate)}
          subtitle={
            billablePercent !== null
              ? `${formatPct0(billablePercent)} of contract · through ${throughMonth}${
                  planBillablePercent !== null ? ` · ${formatPct0(planBillablePercent)} of plan` : ""
                }`
              : `Through ${throughMonth}${
                  planBillablePercent !== null ? ` · ${formatPct0(planBillablePercent)} of plan` : ""
                }`
          }
        />
        <SummaryCard
          label="Cost to date"
          value={formatMoney0(costToDatePlan)}
          subtitle={`${planToDate.hours}h planned · Labor ${formatMoney0(planToDate.laborCost)} · Mat ${formatMoney0(planToDate.materialCost)} · through ${throughMonth}`}
        />
        <SummaryCard
          label="Projected margin"
          value={marginDollars !== null ? formatMoney0(marginDollars) : "—"}
          subtitle={
            marginPct !== null
              ? `${formatPct0(marginPct)} of contract · Proj cost ${formatMoney0(projCost)}`
              : `Proj cost ${formatMoney0(projCost)}`
          }
          tone={marginDollars !== null && marginDollars < 0 ? "red" : "green"}
        />
        <SummaryCard
          label="Earned vs plan billable"
          value={
            earnedPlan.billedPct !== null
              ? `${formatPct0(earnedPlan.earnedPct)} / ${formatPct0(earnedPlan.billedPct)}`
              : formatPct0(earnedPlan.earnedPct)
          }
          subtitle={earnedSubtitle}
          subtitleMuted={!earnedPlan.isUnderbilled}
          tone={earnedPlan.isUnderbilled ? "amber" : undefined}
        />
      </div>

      <ManpowerPlanCard
        billing={billing}
        projectStartIso={projectStartIso}
        projectEndIso={projectEndIso}
        saving={saving}
        onBillingChange={setBilling}
        onPersistQuiet={persistQuiet}
        onOpenWeekBudget={setEditingWeekBudget}
      />

      <ManpowerBudgetCard
        billing={billing}
        projectStartIso={projectStartIso}
        projectEndIso={projectEndIso}
        saving={saving}
        onOpenWeekBudget={setEditingWeekBudget}
      />

      <ManpowerMonthlyBudgetCard
        billing={billing}
        projectStartIso={projectStartIso}
        projectEndIso={projectEndIso}
      />

      <WeekBudgetEditorModal
        weekStartIso={editingWeekBudget}
        billing={billing}
        saving={saving}
        onClose={() => setEditingWeekBudget(null)}
        onBillingChange={setBilling}
        onPersistQuiet={persistQuiet}
      />

      <LaborRatesModal
        open={laborRatesOpen}
        billing={billing}
        saving={saving}
        blendedCost={bCostRate}
        blendedBill={bBillRate}
        onClose={() => setLaborRatesOpen(false)}
        onPatchRate={patchRate}
        onAddRate={addRate}
        onRemoveRate={removeRate}
        onResetToCompany={resetRatesToCompany}
        onSave={async () => {
          const ok = await persist(billing, "Billing · labor rates updated");
          if (ok) setLaborRatesOpen(false);
        }}
      />

      {/* Contract + budget */}
      <section className="card stack billing-card">
        <h3 className="billing-card-title">Contract &amp; budget</h3>

        <label className="billing-contract-base">
          Base contract amount
          <MoneyInput value={billing.contract.baseAmount} onChange={(n) => patchContract({ baseAmount: n })} />
        </label>

        <div className="stack billing-line-items-section">
          <div className="row-between wrap gap">
            <h4 className="billing-section-subtitle">Approved changes</h4>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addChange} disabled={saving}>
              Add line item
            </button>
          </div>
          <div className="table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {billing.contract.changes.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted billing-empty">
                      No approved changes yet.
                    </td>
                  </tr>
                ) : (
                  billing.contract.changes.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <input
                          value={line.label}
                          placeholder="COR #1 · scope add"
                          onChange={(e) => patchChange(line.id, { label: e.target.value })}
                        />
                      </td>
                      <td className="num">
                        <MoneyInput value={line.amount} onChange={(n) => patchChange(line.id, { amount: n })} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => removeChange(line.id)}
                          aria-label="Remove change"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="billing-blended-row">
                  <td>Revised contract</td>
                  <td className="num">{formatMoney0(revised)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {changesTotal > 0 ? (
            <p className="muted small billing-manpower-caption">
              Base {formatMoney0(billing.contract.baseAmount)} + changes {formatMoney0(changesTotal)}
            </p>
          ) : null}
        </div>

        <div className="stack billing-line-items-section">
          <div className="row-between wrap gap">
            <h4 className="billing-section-subtitle">Budget</h4>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addBudgetLine} disabled={saving}>
              Add line item
            </button>
          </div>
          <div className="table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {billing.budgetLines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted billing-empty">
                      No budget line items yet.
                    </td>
                  </tr>
                ) : (
                  billing.budgetLines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <input
                          value={line.label}
                          placeholder="Labor · material · other"
                          onChange={(e) => patchBudgetLine(line.id, { label: e.target.value })}
                        />
                      </td>
                      <td className="num">
                        <MoneyInput value={line.amount} onChange={(n) => patchBudgetLine(line.id, { amount: n })} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => removeBudgetLine(line.id)}
                          aria-label="Remove budget line"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="billing-blended-row">
                  <td>Total budget</td>
                  <td className="num">{formatMoney0(budgetTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <label className="billing-contract-note">
          Contract note
          <input
            value={billing.contract.note}
            onChange={(e) => patchContract({ note: e.target.value })}
            placeholder="Optional note"
          />
        </label>

        <div className="row-gap">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void persist(billing, "Billing · contract & budget updated")}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save contract & budget"}
          </button>
        </div>
        {!user && <p className="muted small">Sign in to save changes.</p>}
      </section>
    </div>
  );
}
