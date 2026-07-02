import { useEffect, useMemo, useState } from "react";
import { weekColumnLabel, weekTotalHours } from "../../lib/manpowerCalendar";
import {
  blendedBillRate,
  blendedCostRate,
  formatMoney0,
  weeklyBudgetEntry,
  withWeeklyBudgetEntry,
  type ProjectBillingData,
} from "../../types/projectBilling";

type Props = {
  weekStartIso: string | null;
  billing: ProjectBillingData;
  saving: boolean;
  onClose: () => void;
  onBillingChange: (next: ProjectBillingData) => void;
  onPersistQuiet: (next: ProjectBillingData) => Promise<boolean>;
};

function parseMoney(raw: string): number {
  const n = Number(raw.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatInputValue(value: number): string {
  return value > 0 ? String(Number(value.toFixed(2))) : "";
}

export function WeekBudgetEditorModal({
  weekStartIso,
  billing,
  saving,
  onClose,
  onBillingChange,
  onPersistQuiet,
}: Props) {
  const entry = weekStartIso ? weeklyBudgetEntry(billing.weeklyBudgetEntries, weekStartIso) : null;
  const plannedHours = weekStartIso ? weekTotalHours(billing.manpowerCells, weekStartIso) : 0;
  const costRate = blendedCostRate(billing.laborRates);
  const billRate = blendedBillRate(billing.laborRates);
  const laborCost = plannedHours * costRate;
  const laborBillable = plannedHours * billRate;
  const billableRatio = costRate > 0 ? billRate / costRate : 1;
  const hasExistingEntry = (entry?.materialCost ?? 0) > 0 || (entry?.materialBillable ?? 0) > 0;

  const [materialCostDraft, setMaterialCostDraft] = useState("");
  const [materialBillableDraft, setMaterialBillableDraft] = useState("");
  const [billableTouched, setBillableTouched] = useState(false);

  useEffect(() => {
    setMaterialCostDraft(formatInputValue(entry?.materialCost ?? 0));
    setMaterialBillableDraft(formatInputValue(entry?.materialBillable ?? 0));
    setBillableTouched(hasExistingEntry);
  }, [entry?.materialBillable, entry?.materialCost, hasExistingEntry, weekStartIso]);

  const materialCost = useMemo(() => parseMoney(materialCostDraft), [materialCostDraft]);
  const materialBillable = useMemo(() => parseMoney(materialBillableDraft), [materialBillableDraft]);
  const totalCost = laborCost + materialCost;
  const totalBillable = laborBillable + materialBillable;

  if (!weekStartIso) return null;

  async function save() {
    const nextEntries = withWeeklyBudgetEntry(billing.weeklyBudgetEntries, weekStartIso!, {
      materialCost,
      materialBillable,
    });
    const next = { ...billing, weeklyBudgetEntries: nextEntries };
    onBillingChange(next);
    const ok = await onPersistQuiet(next);
    if (ok) onClose();
  }

  function updateMaterialCost(raw: string) {
    setMaterialCostDraft(raw);
    if (!billableTouched && !hasExistingEntry) {
      const nextCost = parseMoney(raw);
      setMaterialBillableDraft(formatInputValue(nextCost * billableRatio));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack billing-week-editor-modal"
        role="dialog"
        aria-labelledby="billing-week-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap gap">
          <h2 id="billing-week-editor-title" className="billing-card-title">
            Week of {weekColumnLabel(weekStartIso)}
          </h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="billing-week-editor-grid">
          <div className="billing-week-editor-readout">
            <span className="muted small">Planned hours</span>
            <strong>{plannedHours > 0 ? plannedHours.toLocaleString() : "—"}</strong>
          </div>
          <div className="billing-week-editor-readout">
            <span className="muted small">Labor cost</span>
            <strong>{formatMoney0(laborCost)}</strong>
          </div>
          <div className="billing-week-editor-readout">
            <span className="muted small">Labor billable</span>
            <strong>{formatMoney0(laborBillable)}</strong>
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
              onChange={(e) => {
                setBillableTouched(true);
                setMaterialBillableDraft(e.target.value);
              }}
            />
          </label>
        </div>

        <div className="billing-week-editor-totals">
          <div>
            <span className="muted small">Week total cost</span>
            <strong>{formatMoney0(totalCost)}</strong>
          </div>
          <div>
            <span className="muted small">Week total billable</span>
            <strong>{formatMoney0(totalBillable)}</strong>
          </div>
        </div>

        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save week"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
