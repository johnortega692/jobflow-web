import {
  formatJobDateLabel,
  manpowerEndDateHint,
  manpowerWeekStarts,
  weekColumnLabel,
} from "../../lib/manpowerCalendar";
import { deriveWeekBudget } from "../../lib/weeklyBudget";
import { formatMoney0, type ProjectBillingData } from "../../types/projectBilling";

type Props = {
  billing: ProjectBillingData;
  projectStartIso: string;
  projectEndIso: string;
  saving: boolean;
  onOpenWeekBudget: (weekStartIso: string) => void;
};

function formatHours(hours: number): string {
  if (hours <= 0) return "—";
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function ManpowerBudgetCard({
  billing,
  projectStartIso,
  projectEndIso,
  saving,
  onOpenWeekBudget,
}: Props) {
  const { weekStarts: weeks, contractEndWeekIndex } = manpowerWeekStarts(
    projectStartIso,
    projectEndIso,
    billing.manpowerCells,
    billing.manpowerWeekCount,
  );
  const endDateHint = manpowerEndDateHint(projectStartIso, projectEndIso);
  const endDateLabel = formatJobDateLabel(projectEndIso);
  const totalPlannedHours = weeks.reduce((sum, w) => sum + deriveWeekBudget(billing, w).hours, 0);
  const totalCost = weeks.reduce((sum, w) => sum + deriveWeekBudget(billing, w).cost, 0);
  const totalBillable = weeks.reduce((sum, w) => sum + deriveWeekBudget(billing, w).billable, 0);

  function weekValues(weekStartIso: string) {
    return deriveWeekBudget(billing, weekStartIso);
  }

  function renderValueButton(weekStartIso: string, value: string, label: string) {
    return (
      <button
        type="button"
        className="billing-budget-value-button"
        onClick={() => onOpenWeekBudget(weekStartIso)}
        title={`Edit ${label.toLowerCase()} for ${weekColumnLabel(weekStartIso)}`}
        aria-label={`Edit ${label.toLowerCase()} for week of ${weekColumnLabel(weekStartIso)}`}
        disabled={saving}
      >
        {value}
      </button>
    );
  }

  return (
    <section className="card stack billing-card billing-manpower-card billing-budget-card">
      <div className="row-between wrap gap">
        <h3 className="billing-card-title">Weekly budget</h3>
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
          Same week columns as manpower plan · contract through {endDateLabel}
        </p>
      ) : (
        <p className="muted small billing-manpower-end-hint">
          Same week columns as manpower plan · click a week to edit material budget
        </p>
      )}

      <div className="billing-manpower-scroll" tabIndex={0} aria-label="Weekly budget — scroll horizontally">
        <table className="billing-manpower-table">
          <thead>
            <tr>
              <th className="billing-manpower-sticky billing-manpower-phase-col">Row</th>
              {weeks.map((w, weekIdx) => (
                <th
                  key={w}
                  className={`billing-manpower-week-col num${
                    contractEndWeekIndex !== null && weekIdx > contractEndWeekIndex
                      ? " billing-manpower-week-col--beyond-contract"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    className="billing-manpower-week-header-button"
                    onClick={() => onOpenWeekBudget(w)}
                    title={`Edit weekly budget for ${weekColumnLabel(w)}`}
                    aria-label={`Edit weekly budget for week of ${weekColumnLabel(w)}`}
                    disabled={saving}
                  >
                    {weekColumnLabel(w)}
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
              {weeks.map((w) => {
                const hrs = weekValues(w).hours;
                return (
                  <td key={w} className="billing-manpower-week-col num billing-manpower-planned-cell">
                    {renderValueButton(w, formatHours(hrs), "Planned hours")}
                  </td>
                );
              })}
              <td className="billing-manpower-sticky billing-manpower-total-col num">{formatHours(totalPlannedHours)}</td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">Cost</td>
              {weeks.map((w) => {
                const { cost } = weekValues(w);
                return (
                  <td key={w} className="billing-manpower-week-col num">
                    {renderValueButton(w, formatMoney0(cost), "Cost")}
                  </td>
                );
              })}
              <td className="billing-manpower-sticky billing-manpower-total-col num">
                {formatMoney0(totalCost)}
              </td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">Billable</td>
              {weeks.map((w) => {
                const { billable } = weekValues(w);
                return (
                  <td key={w} className="billing-manpower-week-col num">
                    {renderValueButton(w, formatMoney0(billable), "Billable")}
                  </td>
                );
              })}
              <td className="billing-manpower-sticky billing-manpower-total-col num">
                {formatMoney0(totalBillable)}
              </td>
            </tr>
            <tr>
              <td className="billing-manpower-sticky billing-manpower-phase-col billing-manpower-row-label">
                Cumulative billable
              </td>
              {(() => {
                let running = 0;
                return weeks.map((w) => {
                  running += weekValues(w).billable;
                  return (
                    <td key={w} className="billing-manpower-week-col num">
                      {renderValueButton(w, formatMoney0(running), "Cumulative billable")}
                    </td>
                  );
                });
              })()}
              <td className="billing-manpower-sticky billing-manpower-total-col num">
                {formatMoney0(totalBillable)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted small billing-manpower-caption">
        Billable = hours × bill rate + material · summary cards use cumulative monthly totals through the current month
      </p>
    </section>
  );
}
