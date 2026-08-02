import {
  manpowerEndDateHint,
  manpowerWeekStarts,
} from "../../lib/manpowerCalendar";
import {
  blendedCostRate,
  deriveMonthCalculatorTotals,
  formatMoney0,
  formatPct0,
  hoursPercentComplete,
  loadCalculatorLaborRates,
  loadMonthMaterial,
  monthPocBillable,
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
import type { ProjectBillingData } from "../../types/projectBilling";
import { ManpowerHeaderCalculatorIcon } from "./ManpowerHeaderPillIcons";

type Props = {
  billing: ProjectBillingData;
  projectId: string;
  projectStartIso: string;
  projectEndIso: string;
  /** Contract sell value (Budget Maker grand total) for % complete billable. */
  contractValue: number;
  /** Budget Maker material total — reference for splitting into months. */
  materialBudget: number;
  calculatorRevision: number;
  onOpenMonth: (month: DerivedMonthHours) => void;
};

export function ManpowerMonthlyBudgetCard({
  billing,
  projectId,
  projectStartIso,
  projectEndIso,
  contractValue,
  materialBudget,
  calculatorRevision,
  onOpenMonth,
}: Props) {
  const { weekStarts: weeks, contractEndWeekIndex } = manpowerWeekStarts(
    projectStartIso,
    projectEndIso,
    billing.manpowerCells,
    billing.manpowerWeekCount,
  );
  const endDateHint = manpowerEndDateHint(projectStartIso, projectEndIso);
  const months = deriveMonthlyHours(billing, weeks);
  const thisMonth = currentMonthKey();
  const laborRates = loadCalculatorLaborRates(projectId);
  void calculatorRevision;

  const totalHours = months.reduce((sum, m) => sum + m.hours, 0);
  const costRate = blendedCostRate(laborRates);

  const monthRows = (() => {
    let running = 0;
    return months.map((m) => {
      const prev = running;
      running += m.hours;
      const materialCost = loadMonthMaterial(projectId, m.key).materialCost;
      const pocBillable = monthPocBillable(contractValue, prev, running, totalHours);
      const totals = deriveMonthCalculatorTotals(m.hours, laborRates, materialCost, pocBillable);
      return {
        month: m,
        cumulativeHours: running,
        percentComplete: hoursPercentComplete(running, totalHours),
        laborCost: m.hours * costRate,
        materialCost,
        totals,
      };
    });
  })();

  const totalLaborCost = monthRows.reduce((sum, r) => sum + r.laborCost, 0);
  const totalMaterialEntered = monthRows.reduce((sum, r) => sum + r.materialCost, 0);
  const materialRemaining = materialBudget > 0 ? materialBudget - totalMaterialEntered : 0;
  const totalCost = monthRows.reduce((sum, r) => sum + r.totals.cost, 0);
  const totalBillable = contractValue > 0 && totalHours > 0 ? contractValue : 0;

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
        </span>
      </div>

      {endDateHint ? (
        <p className="banner banner-warn billing-manpower-end-hint">{endDateHint}</p>
      ) : (
        <p className="muted small billing-manpower-caption">
          current month: {currentMonthLabel()}
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
          </tbody>
        </table>
      </div>
    </section>
  );
}
