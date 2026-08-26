import { useEffect, useMemo, useRef, useState } from "react";
import {
  manpowerEndDateHint,
  manpowerWeekStarts,
} from "../../lib/manpowerCalendar";
import {
  blendedCostRate,
  deriveMonthCalculatorTotals,
  formatInputValue,
  formatMoney0,
  formatPct0,
  hoursPercentComplete,
  monthPocBillable,
  parseMoney,
} from "../../lib/manpowerCalculator";
import {
  currentMonthKey,
  currentMonthLabel,
  deriveMonthlyHours,
  formatHoursCompact,
  formatManWeeksCompact,
  monthBeyondContract,
  type DerivedMonthHours,
} from "../../lib/manpowerHours";
import type { TransmittalContract } from "../../lib/jobInfo";
import {
  getMonthBilledAmount,
  getMonthMaterialCost,
  withMonthBilledAmount,
  type ProjectBillingData,
} from "../../types/projectBilling";
import { ManpowerHeaderCalculatorIcon } from "./ManpowerHeaderPillIcons";

type Props = {
  billing: ProjectBillingData;
  projectStartIso: string;
  projectEndIso: string;
  /** Contract sell value (Budget Maker grand total) for % complete billable. */
  contractValue: number;
  /** Budget Maker material total — reference for splitting into months. */
  materialBudget: number;
  /** When set, month hours / billable use only this contract's Labor Projection rows. */
  phaseIds?: ReadonlySet<string>;
  /** Active contract key for per-contract billed amounts. */
  contract: TransmittalContract;
  /** Label for the active contract (e.g. Paint) shown in the caption. */
  contractLabel?: string;
  calculatorRevision: number;
  onOpenMonth: (month: DerivedMonthHours) => void;
  onPersistQuiet: (next: ProjectBillingData) => Promise<boolean>;
};

export function ManpowerMonthlyBudgetCard({
  billing,
  projectStartIso,
  projectEndIso,
  contractValue,
  materialBudget,
  phaseIds,
  contract,
  contractLabel,
  calculatorRevision,
  onOpenMonth,
  onPersistQuiet,
}: Props) {
  const { weekStarts: weeks, contractEndWeekIndex } = manpowerWeekStarts(
    projectStartIso,
    projectEndIso,
    billing.manpowerCells,
    billing.manpowerWeekCount,
  );
  const endDateHint = manpowerEndDateHint(projectStartIso, projectEndIso);
  const months = deriveMonthlyHours(billing, weeks, phaseIds);
  const thisMonth = currentMonthKey();
  const laborRates = billing.calculatorLaborRates;
  void calculatorRevision;

  const billingRef = useRef(billing);
  billingRef.current = billing;

  const [billedDrafts, setBilledDrafts] = useState<Record<string, string>>({});
  const [savingBilled, setSavingBilled] = useState(false);

  useEffect(() => {
    setBilledDrafts({});
  }, [contract]);

  const totalHours = months.reduce((sum, m) => sum + m.hours, 0);
  const costRate = blendedCostRate(laborRates);

  const monthRows = useMemo(() => {
    let running = 0;
    return months.map((m) => {
      const prev = running;
      running += m.hours;
      const materialCost = getMonthMaterialCost(billing, m.key);
      const pocBillable = monthPocBillable(contractValue, prev, running, totalHours);
      const totals = deriveMonthCalculatorTotals(m.hours, laborRates, materialCost, pocBillable);
      const billedAmount = getMonthBilledAmount(billing, contract, m.key);
      return {
        month: m,
        cumulativeHours: running,
        percentComplete: hoursPercentComplete(running, totalHours),
        laborCost: m.hours * costRate,
        materialCost,
        billedAmount,
        totals,
      };
    });
  }, [billing, contract, contractValue, costRate, laborRates, months, totalHours]);

  const totalLaborCost = monthRows.reduce((sum, r) => sum + r.laborCost, 0);
  const totalMaterialEntered = monthRows.reduce((sum, r) => sum + r.materialCost, 0);
  const materialRemaining = materialBudget > 0 ? materialBudget - totalMaterialEntered : 0;
  const totalCost = monthRows.reduce((sum, r) => sum + r.totals.cost, 0);
  const totalBillable = contractValue > 0 && totalHours > 0 ? contractValue : 0;
  const totalBilled = monthRows.reduce((sum, r) => sum + r.billedAmount, 0);

  function billedInputValue(monthKey: string, stored: number): string {
    if (Object.prototype.hasOwnProperty.call(billedDrafts, monthKey)) {
      return billedDrafts[monthKey] ?? "";
    }
    return formatInputValue(stored);
  }

  async function commitBilled(monthKey: string, raw: string) {
    const amount = parseMoney(raw);
    const current = getMonthBilledAmount(billingRef.current, contract, monthKey);
    setBilledDrafts((prev) => {
      const next = { ...prev };
      delete next[monthKey];
      return next;
    });
    if (amount === current) return;
    setSavingBilled(true);
    await onPersistQuiet(withMonthBilledAmount(billingRef.current, contract, monthKey, amount));
    setSavingBilled(false);
  }

  function monthHeaderClass(m: DerivedMonthHours): string {
    return [
      "billing-manpower-month-col",
      "num",
      "billing-manpower-month-col--clickable",
      monthBeyondContract(m.weekStartIsos, weeks, contractEndWeekIndex)
        ? "billing-manpower-week-col--beyond-contract"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return (
    <section className="card stack billing-card billing-manpower-card billing-budget-card billing-monthly-budget-card">
      <div className="row-between wrap gap">
        <h3 className="billing-card-title">Monthly hours</h3>
        <span className="muted small">
          {formatHoursCompact(totalHours)} hrs · {formatManWeeksCompact(totalHours)} man-wks
          {totalBillable > 0 || totalCost > 0 ? (
            <> · Billable {formatMoney0(totalBillable)} · cost {formatMoney0(totalCost)}</>
          ) : null}
          {totalBilled > 0 ? <> · Billed {formatMoney0(totalBilled)}</> : null}
          {savingBilled ? <> · saving…</> : null}
        </span>
      </div>

      {endDateHint ? (
        <p className="banner banner-warn billing-manpower-end-hint">{endDateHint}</p>
      ) : (
        <p className="muted small billing-manpower-caption">
          current month: {currentMonthLabel()}
          {contractLabel ? <> · {contractLabel}</> : null}
          {contractValue > 0 ? (
            <> · Billable = contract × % complete ({formatMoney0(contractValue)})</>
          ) : (
            <> · Set Budget Maker grand total to show billable</>
          )}
          {materialBudget > 0 ? (
            <>
              {" "}
              · Material budget {formatMoney0(materialBudget)}
              {totalMaterialEntered > 0 ? (
                <>
                  {" "}
                  · entered {formatMoney0(totalMaterialEntered)}
                  {materialRemaining !== 0 ? (
                    <> · left {formatMoney0(materialRemaining)}</>
                  ) : (
                    <> · fully allocated</>
                  )}
                </>
              ) : (
                <> — enter by month</>
              )}
            </>
          ) : null}
        </p>
      )}

      <div className="billing-manpower-scroll" tabIndex={0} aria-label="Monthly hours — scroll horizontally">
        <table className="billing-manpower-table">
          <thead>
            <tr>
              <th className="billing-manpower-sticky billing-manpower-phase-col">Row</th>
              {months.map((m) => (
                <th key={m.key} className={monthHeaderClass(m)}>
                  <button
                    type="button"
                    className={`billing-manpower-header-pill${m.key === thisMonth ? " billing-manpower-header-pill--current" : ""}`}
                    onClick={() => onOpenMonth(m)}
                    title={`Calculate cost & billable for ${m.label}`}
                    aria-label={`Open cost calculator for ${m.label}`}
                  >
                    <ManpowerHeaderCalculatorIcon />
                    {m.label}
                  </button>
                </th>
              ))}
              <th className="billing-manpower-sticky billing-manpower-total-col num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Planned (hrs)
              </td>
              {months.map((m) => (
                <td key={m.key} className="billing-manpower-month-col num billing-manpower-planned-cell">
                  {formatHoursCompact(m.hours)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatHoursCompact(totalHours)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Man-weeks
              </td>
              {months.map((m) => (
                <td key={m.key} className="billing-manpower-month-col num">
                  {formatManWeeksCompact(m.hours)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatManWeeksCompact(totalHours)}</td>
            </tr>
            <tr className="billing-monthly-cost-band">
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Labor (calc)
              </td>
              {monthRows.map((r) => (
                <td key={r.month.key} className="billing-manpower-month-col num">
                  <button
                    type="button"
                    className="billing-budget-value-button"
                    onClick={() => onOpenMonth(r.month)}
                    title={`Edit labor rate for ${r.month.label}`}
                  >
                    {formatMoney0(r.laborCost)}
                  </button>
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalLaborCost)}</td>
            </tr>
            <tr className="billing-monthly-cost-band">
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Material
              </td>
              {monthRows.map((r) => (
                <td key={r.month.key} className="billing-manpower-month-col num">
                  <button
                    type="button"
                    className="billing-budget-value-button"
                    onClick={() => onOpenMonth(r.month)}
                    title={`Enter material cost for ${r.month.label}`}
                  >
                    {formatMoney0(r.materialCost)}
                  </button>
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">
                {formatMoney0(totalMaterialEntered)}
                {materialBudget > 0 ? (
                  <span className="muted" style={{ display: "block", fontSize: "0.75em", fontWeight: 400 }}>
                    of {formatMoney0(materialBudget)}
                  </span>
                ) : null}
              </td>
            </tr>
            <tr className="billing-monthly-cost-band billing-monthly-cost-band--total">
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Cost (calc)
              </td>
              {monthRows.map((r) => (
                <td key={r.month.key} className="billing-manpower-month-col num">
                  {formatMoney0(r.totals.cost)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalCost)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Billable
              </td>
              {monthRows.map((r) => (
                <td key={r.month.key} className="billing-manpower-month-col num">
                  <button
                    type="button"
                    className="billing-budget-value-button"
                    onClick={() => onOpenMonth(r.month)}
                    title={`Billable for ${r.month.label} (contract × % complete)`}
                  >
                    {formatMoney0(r.totals.billable)}
                  </button>
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalBillable)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Cumulative hrs
              </td>
              {monthRows.map((r) => (
                <td key={r.month.key} className="billing-manpower-month-col num">
                  {formatHoursCompact(r.cumulativeHours)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatHoursCompact(totalHours)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                % complete
              </td>
              {monthRows.map((r) => (
                <td key={r.month.key} className="billing-manpower-month-col num">
                  {totalHours > 0 ? formatPct0(r.percentComplete) : "—"}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">
                {totalHours > 0 ? formatPct0(100) : "—"}
              </td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Billed
              </td>
              {monthRows.map((r) => (
                <td key={r.month.key} className="billing-manpower-month-col num">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="billing-billed-input"
                    value={billedInputValue(r.month.key, r.billedAmount)}
                    placeholder="—"
                    aria-label={`Billed to GC for ${r.month.label}`}
                    title={`Amount billed to GC for ${r.month.label}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBilledDrafts((prev) => ({ ...prev, [r.month.key]: v }));
                    }}
                    onBlur={(e) => {
                      void commitBilled(r.month.key, e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalBilled)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
