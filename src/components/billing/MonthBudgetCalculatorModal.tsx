import { useEffect, useMemo, useState } from "react";
import {
  blendedCostRate,
  defaultCalculatorLaborRates,
  deriveMonthCalculatorTotals,
  formatInputValue,
  formatMoney0,
  formatPct0,
  hoursPercentComplete,
  loadCalculatorLaborRates,
  loadMonthMaterial,
  monthPocBillable,
  newCalculatorLaborRateId,
  parseMoney,
  pocBillableAmount,
  saveCalculatorLaborRates,
  saveMonthMaterial,
  type CalculatorLaborRate,
} from "../../lib/manpowerCalculator";
import { formatHoursCompact, formatManWeeksCompact } from "../../lib/manpowerHours";

type Props = {
  projectId: string;
  monthKey: string;
  monthLabel: string;
  plannedHours: number;
  /** Cumulative planned hours through this month (inclusive). */
  cumulativeHours: number;
  /** Prior cumulative hours (before this month). */
  prevCumulativeHours: number;
  totalPlannedHours: number;
  contractValue: number;
  /** Budget Maker material total — reference only; user enters this month. */
  materialBudget: number;
  /** Sum of material entered in other months (excludes this month). */
  materialEnteredOtherMonths: number;
  onClose: () => void;
};

export function MonthBudgetCalculatorModal({
  projectId,
  monthKey,
  monthLabel,
  plannedHours,
  cumulativeHours,
  prevCumulativeHours,
  totalPlannedHours,
  contractValue,
  materialBudget,
  materialEnteredOtherMonths,
  onClose,
}: Props) {
  const [rates, setRates] = useState<CalculatorLaborRate[]>(() => loadCalculatorLaborRates(projectId));
  const [materialCostDraft, setMaterialCostDraft] = useState("");

  useEffect(() => {
    const saved = loadMonthMaterial(projectId, monthKey);
    setMaterialCostDraft(formatInputValue(saved.materialCost));
  }, [monthKey, projectId]);

  useEffect(() => {
    setRates(loadCalculatorLaborRates(projectId));
  }, [projectId]);

  const materialCost = useMemo(() => parseMoney(materialCostDraft), [materialCostDraft]);
  const percentComplete = hoursPercentComplete(cumulativeHours, totalPlannedHours);
  const monthBillable = monthPocBillable(
    contractValue,
    prevCumulativeHours,
    cumulativeHours,
    totalPlannedHours,
  );
  const earnedToDate = pocBillableAmount(contractValue, percentComplete);
  const totals = deriveMonthCalculatorTotals(plannedHours, rates, materialCost, monthBillable);
  const marginPct = totals.billable > 0 ? (totals.margin / totals.billable) * 100 : 0;
  const materialEnteredAll = materialEnteredOtherMonths + materialCost;
  const materialLeft = materialBudget > 0 ? materialBudget - materialEnteredAll : 0;

  function updateMaterialCost(raw: string) {
    setMaterialCostDraft(raw);
    saveMonthMaterial(projectId, monthKey, { materialCost: parseMoney(raw) });
  }

  function patchRate(id: string, patch: Partial<CalculatorLaborRate>) {
    setRates((rows) => {
      const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
      saveCalculatorLaborRates(projectId, next);
      return next;
    });
  }

  function num(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  const marginLabel =
    totals.billable > 0
      ? `${formatMoney0(totals.margin)} · ${formatPct0(marginPct)}`
      : formatMoney0(totals.margin);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack billing-month-calculator-modal"
        role="dialog"
        aria-labelledby="billing-month-calculator-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap gap">
          <h2 id="billing-month-calculator-title" className="billing-card-title">
            {monthLabel} — cost calculator
          </h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="muted small billing-manpower-caption">
          Labor uses Cost/hr. Billable = contract × % complete. Enter this month’s material to split the
          budget total.
        </p>

        <div className="billing-calc-stat-strip">
          <div className="billing-calc-stat-tile">
            <span className="billing-calc-stat-label">Planned</span>
            <strong className="billing-calc-stat-value">{formatHoursCompact(plannedHours)}</strong>
            <span className="billing-calc-stat-sub muted">
              {formatManWeeksCompact(plannedHours)} man-weeks
            </span>
          </div>
          <div className="billing-calc-stat-tile">
            <span className="billing-calc-stat-label">Cost/hr</span>
            <strong className="billing-calc-stat-value">{formatMoney0(blendedCostRate(rates))}</strong>
          </div>
          <div className="billing-calc-stat-tile">
            <span className="billing-calc-stat-label">% complete</span>
            <strong className="billing-calc-stat-value">
              {totalPlannedHours > 0 ? formatPct0(percentComplete) : "—"}
            </strong>
            <span className="billing-calc-stat-sub muted">
              earned {formatMoney0(earnedToDate)}
            </span>
          </div>
          <div className="billing-calc-stat-tile">
            <span className="billing-calc-stat-label">Material budget</span>
            <strong className="billing-calc-stat-value">{formatMoney0(materialBudget)}</strong>
            <span className="billing-calc-stat-sub muted">
              {materialBudget > 0
                ? `entered ${formatMoney0(materialEnteredAll)} · left ${formatMoney0(materialLeft)}`
                : "from Budget Maker"}
            </span>
          </div>
        </div>

        <div className="billing-calc-ledger" role="table" aria-label="Cost and billable">
          <div className="billing-calc-ledger-row billing-calc-ledger-row--head" role="row">
            <span className="billing-calc-ledger-label" role="columnheader" />
            <span className="billing-calc-ledger-cell" role="columnheader">
              Cost
            </span>
            <span className="billing-calc-ledger-cell" role="columnheader">
              Billable
            </span>
          </div>
          <div className="billing-calc-ledger-row" role="row">
            <span className="billing-calc-ledger-label" role="rowheader">
              Labor
            </span>
            <span className="billing-calc-ledger-cell billing-calc-ledger-value" role="cell">
              {formatMoney0(totals.laborCost)}
            </span>
            <span className="billing-calc-ledger-cell billing-calc-ledger-value muted" role="cell">
              —
            </span>
          </div>
          <div className="billing-calc-ledger-row billing-calc-ledger-row--material" role="row">
            <span className="billing-calc-ledger-label" role="rowheader">
              Material
            </span>
            <span className="billing-calc-ledger-cell" role="cell">
              <input
                type="number"
                min={0}
                step={100}
                className="billing-calc-ledger-input"
                value={materialCostDraft}
                placeholder="0"
                aria-label="Material cost for this month"
                onChange={(e) => updateMaterialCost(e.target.value)}
              />
            </span>
            <span className="billing-calc-ledger-cell billing-calc-ledger-value muted" role="cell">
              —
            </span>
          </div>
          <div className="billing-calc-ledger-row billing-calc-ledger-row--total" role="row">
            <span className="billing-calc-ledger-label" role="rowheader">
              Month total
            </span>
            <span className="billing-calc-ledger-cell billing-calc-ledger-value" role="cell">
              {formatMoney0(totals.cost)}
            </span>
            <span className="billing-calc-ledger-cell billing-calc-ledger-value" role="cell">
              {formatMoney0(totals.billable)}
            </span>
          </div>
        </div>

        <div className="billing-calc-margin-bar" role="status">
          <span className="billing-calc-margin-label">Margin</span>
          <strong className="billing-calc-margin-value">{marginLabel}</strong>
        </div>

        <details className="billing-calc-rates">
          <summary className="billing-calc-rates-summary">
            <span className="billing-calc-rates-chevron" aria-hidden="true" />
            Labor rates ({rates.length} {rates.length === 1 ? "class" : "classes"})
          </summary>
          <div className="billing-calc-rates-body stack">
            <div className="billing-calc-rates-table-wrap">
              <table className="billing-calc-rates-table">
                <thead>
                  <tr>
                    <th className="billing-calc-rates-class-col">Class</th>
                    <th className="num">Cost/hr</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id}>
                      <td className="billing-calc-rates-class-col">
                        <input
                          className="billing-calc-rates-class-input"
                          value={r.className}
                          placeholder="Class name"
                          onChange={(e) => patchRate(r.id, { className: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          className="billing-calc-rates-num-input"
                          value={r.costRate === 0 ? "" : r.costRate}
                          placeholder="0"
                          onChange={(e) => patchRate(r.id, { costRate: num(e.target.value) })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small billing-calc-rates-remove"
                          onClick={() => {
                            setRates((rows) => {
                              const next = rows.filter((x) => x.id !== r.id);
                              saveCalculatorLaborRates(projectId, next);
                              return next;
                            });
                          }}
                          aria-label="Remove class"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-gap wrap">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setRates((rows) => {
                    const next = [
                      ...rows,
                      { id: newCalculatorLaborRateId(), className: "", costRate: 0 },
                    ];
                    saveCalculatorLaborRates(projectId, next);
                    return next;
                  });
                }}
              >
                Add class
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const next = defaultCalculatorLaborRates();
                  saveCalculatorLaborRates(projectId, next);
                  setRates(next);
                }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
