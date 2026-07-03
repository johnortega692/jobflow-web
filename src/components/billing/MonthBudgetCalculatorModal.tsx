import { useEffect, useMemo, useState } from "react";
import {
  billableRatioFromRates,
  blendedBillRate,
  blendedCostRate,
  defaultCalculatorLaborRates,
  deriveMonthCalculatorTotals,
  formatInputValue,
  formatMoney0,
  formatPct0,
  loadCalculatorLaborRates,
  loadMonthMaterial,
  newCalculatorLaborRateId,
  parseMoney,
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
  onClose: () => void;
};

export function MonthBudgetCalculatorModal({
  projectId,
  monthKey,
  monthLabel,
  plannedHours,
  onClose,
}: Props) {
  const [rates, setRates] = useState<CalculatorLaborRate[]>(() => loadCalculatorLaborRates(projectId));
  const [materialCostDraft, setMaterialCostDraft] = useState("");
  const [materialBillableDraft, setMaterialBillableDraft] = useState("");
  const [billableTouched, setBillableTouched] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);

  useEffect(() => {
    const saved = loadMonthMaterial(projectId, monthKey);
    setMaterialCostDraft(formatInputValue(saved.materialCost));
    setMaterialBillableDraft(formatInputValue(saved.materialBillable));
    setBillableTouched(saved.materialCost > 0 || saved.materialBillable > 0);
  }, [monthKey, projectId]);

  useEffect(() => {
    setRates(loadCalculatorLaborRates(projectId));
  }, [projectId]);

  const materialCost = useMemo(() => parseMoney(materialCostDraft), [materialCostDraft]);
  const materialBillable = useMemo(() => parseMoney(materialBillableDraft), [materialBillableDraft]);
  const billableRatio = billableRatioFromRates(rates);
  const totals = deriveMonthCalculatorTotals(plannedHours, rates, {
    materialCost,
    materialBillable,
  });
  const marginPct = totals.billable > 0 ? (totals.margin / totals.billable) * 100 : 0;

  function persistMaterial(nextCost: number, nextBillable: number) {
    saveMonthMaterial(projectId, monthKey, {
      materialCost: nextCost,
      materialBillable: nextBillable,
    });
  }

  function updateMaterialCost(raw: string) {
    setMaterialCostDraft(raw);
    const nextCost = parseMoney(raw);
    let nextBillable = materialBillable;
    if (!billableTouched) {
      nextBillable = nextCost * billableRatio;
      setMaterialBillableDraft(formatInputValue(nextBillable));
    }
    persistMaterial(nextCost, nextBillable);
  }

  function updateMaterialBillable(raw: string) {
    setBillableTouched(true);
    setMaterialBillableDraft(raw);
    persistMaterial(materialCost, parseMoney(raw));
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

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack billing-week-editor-modal"
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
          Calculator only — amounts stay in this browser, not saved to the project.
        </p>

        <div className="billing-week-editor-grid">
          <div className="billing-week-editor-readout">
            <span className="muted small">Planned hours</span>
            <strong>{formatHoursCompact(plannedHours)}</strong>
            <span className="muted small">{formatManWeeksCompact(plannedHours)} man-weeks</span>
          </div>
          <div className="billing-week-editor-readout">
            <span className="muted small">Blended cost/hr</span>
            <strong>{formatMoney0(blendedCostRate(rates))}</strong>
          </div>
          <div className="billing-week-editor-readout">
            <span className="muted small">Blended bill/hr</span>
            <strong>{formatMoney0(blendedBillRate(rates))}</strong>
          </div>
          <div className="billing-week-editor-readout">
            <span className="muted small">Labor cost</span>
            <strong>{formatMoney0(totals.laborCost)}</strong>
          </div>
          <div className="billing-week-editor-readout">
            <span className="muted small">Labor billable</span>
            <strong>{formatMoney0(totals.laborBillable)}</strong>
          </div>
          <label>
            Material cost
            <input
              type="number"
              min={0}
              step={100}
              className="billing-num-input"
              value={materialCostDraft}
              placeholder="0"
              onChange={(e) => updateMaterialCost(e.target.value)}
            />
          </label>
          <label>
            Material billable
            <input
              type="number"
              min={0}
              step={100}
              className="billing-num-input"
              value={materialBillableDraft}
              placeholder="0"
              onChange={(e) => updateMaterialBillable(e.target.value)}
            />
          </label>
        </div>

        <div className="billing-week-editor-totals billing-month-calculator-totals">
          <div>
            <span className="muted small">Month total cost</span>
            <strong>{formatMoney0(totals.cost)}</strong>
          </div>
          <div>
            <span className="muted small">Month total billable</span>
            <strong>{formatMoney0(totals.billable)}</strong>
          </div>
          <div>
            <span className="muted small">Margin</span>
            <strong>
              {formatMoney0(totals.margin)}
              {totals.billable > 0 ? ` · ${formatPct0(marginPct)}` : ""}
            </strong>
          </div>
        </div>

        <div className="stack billing-month-calculator-rates">
          <button
            type="button"
            className="btn btn-ghost btn-sm billing-month-calculator-rates-toggle"
            onClick={() => setRatesOpen((open) => !open)}
            aria-expanded={ratesOpen}
          >
            {ratesOpen ? "Hide labor rates" : "Edit labor rates (calculator)"}
          </button>
          {ratesOpen ? (
            <div className="table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th className="num">Cost/hr</th>
                    <th className="num">Bill/hr</th>
                    <th className="num">Crew mix</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <input
                          value={r.className}
                          placeholder="Class name"
                          onChange={(e) => patchRate(r.id, { className: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={r.costRate === 0 ? "" : r.costRate}
                          placeholder="0"
                          onChange={(e) => patchRate(r.id, { costRate: num(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={r.billRate === 0 ? "" : r.billRate}
                          placeholder="0"
                          onChange={(e) => patchRate(r.id, { billRate: num(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={r.crewMix === 0 ? "" : r.crewMix}
                          placeholder="0"
                          onChange={(e) => patchRate(r.id, { crewMix: num(e.target.value) })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
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
              <div className="row-gap wrap">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setRates((rows) => {
                      const next = [
                        ...rows,
                        { id: newCalculatorLaborRateId(), className: "", costRate: 0, billRate: 0, crewMix: 1 },
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
