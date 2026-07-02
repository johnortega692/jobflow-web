import {
  formatJobDateLabel,
  manpowerEndDateHint,
  manpowerWeekStarts,
} from "../../lib/manpowerCalendar";
import { deriveMonthlyBudgets, monthBeyondContract, currentMonthKey, currentMonthLabel } from "../../lib/weeklyBudget";
import { formatMoney0, type ProjectBillingData } from "../../types/projectBilling";

type Props = {
  billing: ProjectBillingData;
  projectStartIso: string;
  projectEndIso: string;
};

function formatHours(hours: number): string {
  if (hours <= 0) return "—";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function ManpowerMonthlyBudgetCard({ billing, projectStartIso, projectEndIso }: Props) {
  const { weekStarts: weeks, contractEndWeekIndex } = manpowerWeekStarts(
    projectStartIso,
    projectEndIso,
    billing.manpowerCells,
    billing.manpowerWeekCount,
  );
  const endDateHint = manpowerEndDateHint(projectStartIso, projectEndIso);
  const endDateLabel = formatJobDateLabel(projectEndIso);
  const months = deriveMonthlyBudgets(billing, weeks);
  const thisMonth = currentMonthKey();

  const totalHours = months.reduce((sum, m) => sum + m.hours, 0);
  const totalCost = months.reduce((sum, m) => sum + m.cost, 0);
  const totalBillable = months.reduce((sum, m) => sum + m.billable, 0);

  return (
    <section className="card stack billing-card billing-manpower-card billing-budget-card billing-monthly-budget-card">
      <div className="row-between wrap gap">
        <h3 className="billing-card-title">Monthly budget</h3>
        <span className="muted small">
          Billable {formatMoney0(totalBillable)} · Cost {formatMoney0(totalCost)}
          {totalBillable > 0 || totalCost > 0 ? (
            <> · Margin {formatMoney0(totalBillable - totalCost)}</>
          ) : null}
        </span>
      </div>

      {endDateHint ? (
        <p className="banner banner-warn billing-manpower-end-hint">{endDateHint}</p>
      ) : endDateLabel && contractEndWeekIndex !== null ? (
        <p className="muted small billing-manpower-end-hint">
          Weekly plan rolled up by calendar month · summary cards cumulative through {currentMonthLabel()}
        </p>
      ) : (
        <p className="muted small billing-manpower-end-hint">
          Weekly plan rolled up by calendar month · summary cards cumulative through {currentMonthLabel()}
        </p>
      )}

      <div className="billing-manpower-scroll" tabIndex={0} aria-label="Monthly budget — scroll horizontally">
        <table className="billing-manpower-table">
          <thead>
            <tr>
              <th className="billing-manpower-sticky billing-manpower-phase-col">Row</th>
              {months.map((m) => (
                <th
                  key={m.key}
                  className={`billing-manpower-month-col num${
                    m.key === thisMonth ? " billing-manpower-month-col--current" : ""
                  }${
                    monthBeyondContract(m.weekStartIsos, weeks, contractEndWeekIndex)
                      ? " billing-manpower-week-col--beyond-contract"
                      : ""
                  }`}
                >
                  {m.label}
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
                  {formatHours(m.hours)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatHours(totalHours)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">Cost</td>
              {months.map((m) => (
                <td
                  key={m.key}
                  className={`billing-manpower-month-col num${m.key === thisMonth ? " billing-manpower-month-col--current" : ""}`}
                >
                  {formatMoney0(m.cost)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalCost)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">Billable</td>
              {months.map((m) => (
                <td
                  key={m.key}
                  className={`billing-manpower-month-col num${m.key === thisMonth ? " billing-manpower-month-col--current" : ""}`}
                >
                  {formatMoney0(m.billable)}
                </td>
              ))}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalBillable)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Cumulative billable
              </td>
              {(() => {
                let running = 0;
                return months.map((m) => {
                  running += m.billable;
                  return (
                    <td
                  key={m.key}
                  className={`billing-manpower-month-col num${m.key === thisMonth ? " billing-manpower-month-col--current" : ""}`}
                >
                      {formatMoney0(running)}
                    </td>
                  );
                });
              })()}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatMoney0(totalBillable)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted small billing-manpower-caption">
        Cumulative billable through the highlighted month drives the summary cards · edit weeks in Weekly budget
      </p>
    </section>
  );
}
