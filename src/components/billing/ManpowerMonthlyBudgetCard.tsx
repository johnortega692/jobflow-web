import {
  manpowerEndDateHint,
  manpowerWeekStarts,
} from "../../lib/manpowerCalendar";
import {
  deriveMonthCalculatorTotals,
  formatMoney0,
  loadCalculatorLaborRates,
  loadMonthMaterial,
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

type Props = {
  billing: ProjectBillingData;
  projectId: string;
  projectStartIso: string;
  projectEndIso: string;
  calculatorRevision: number;
  onOpenMonth: (month: DerivedMonthHours) => void;
};

export function ManpowerMonthlyBudgetCard({
  billing,
  projectId,
  projectStartIso,
  projectEndIso,
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

  const monthTotals = months.map((m) => {
    void calculatorRevision;
    const material = loadMonthMaterial(projectId, m.key);
    return deriveMonthCalculatorTotals(m.hours, laborRates, material);
  });

  const totalHours = months.reduce((sum, m) => sum + m.hours, 0);
  const totalCost = monthTotals.reduce((sum, t) => sum + t.cost, 0);
  const totalBillable = monthTotals.reduce((sum, t) => sum + t.billable, 0);

  function monthHeaderClass(m: DerivedMonthHours): string {
    return [
      "billing-manpower-month-col",
      "num",
      "billing-manpower-month-col--clickable",
      m.key === thisMonth ? "billing-manpower-month-col--current" : "",
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
            <> · Calc billable {formatMoney0(totalBillable)} · cost {formatMoney0(totalCost)}</>
          ) : null}
        </span>
      </div>

      {endDateHint ? (
        <p className="banner banner-warn billing-manpower-end-hint">{endDateHint}</p>
      ) : (
        <p className="muted small billing-manpower-end-hint">
          Click a month to open the cost calculator · current month highlighted ({currentMonthLabel()})
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
                    className="billing-manpower-month-button"
                    onClick={() => onOpenMonth(m)}
                    title={`Calculate cost & billable for ${m.label}`}
                    aria-label={`Open cost calculator for ${m.label}`}
                  >
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
                <td
                  key={m.key}
                  className={`billing-manpower-month-col num billing-manpower-planned-cell${
                    m.key === thisMonth ? " billing-manpower-month-col--current" : ""
                  }`}
                >
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
                <td
                  key={m.key}
                  className={`billing-manpower-month-col num${m.key === thisMonth ? " billing-manpower-month-col--current" : ""}`}
                >
                  {formatManWeeksCompact(m.hours)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatManWeeksCompact(totalHours)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Cost (calc)
              </td>
              {monthTotals.map((t, i) => (
                <td
                  key={months[i].key}
                  className={`billing-manpower-month-col num${
                    months[i].key === thisMonth ? " billing-manpower-month-col--current" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="billing-budget-value-button"
                    onClick={() => onOpenMonth(months[i])}
                    title={`Edit calculator for ${months[i].label}`}
                  >
                    {formatMoney0(t.cost)}
                  </button>
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalCost)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Billable (calc)
              </td>
              {monthTotals.map((t, i) => (
                <td
                  key={months[i].key}
                  className={`billing-manpower-month-col num${
                    months[i].key === thisMonth ? " billing-manpower-month-col--current" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="billing-budget-value-button"
                    onClick={() => onOpenMonth(months[i])}
                    title={`Edit calculator for ${months[i].label}`}
                  >
                    {formatMoney0(t.billable)}
                  </button>
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalBillable)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Cumulative hrs
              </td>
              {(() => {
                let running = 0;
                return months.map((m) => {
                  running += m.hours;
                  return (
                    <td
                      key={m.key}
                      className={`billing-manpower-month-col num${m.key === thisMonth ? " billing-manpower-month-col--current" : ""}`}
                    >
                      {formatHoursCompact(running)}
                    </td>
                  );
                });
              })()}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatHoursCompact(totalHours)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted small billing-manpower-caption">
        Cost and billable rows are calculator estimates (browser only) · project stores hours only
      </p>
    </section>
  );
}
