import { formatMoney0, type LaborRate, type ProjectBillingData } from "../../types/projectBilling";

type Props = {
  open: boolean;
  billing: ProjectBillingData;
  saving: boolean;
  blendedCost: number;
  blendedBill: number;
  onClose: () => void;
  onPatchRate: (id: string, patch: Partial<LaborRate>) => void;
  onAddRate: () => void;
  onRemoveRate: (id: string) => void;
  onResetToCompany: () => void;
  onSave: () => Promise<void>;
};

function MoneyInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      min={0}
      inputMode="decimal"
      className="billing-num-input"
      value={value === 0 ? "" : value}
      placeholder="0"
      disabled={disabled}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) && n >= 0 ? n : 0);
      }}
    />
  );
}

export function LaborRatesModal({
  open,
  billing,
  saving,
  blendedCost,
  blendedBill,
  onClose,
  onPatchRate,
  onAddRate,
  onRemoveRate,
  onResetToCompany,
  onSave,
}: Props) {
  if (!open) return null;

  const hasRates = billing.laborRates.length > 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack billing-labor-rates-modal"
        role="dialog"
        aria-labelledby="billing-labor-rates-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap gap">
          <h2 id="billing-labor-rates-title" className="billing-card-title">
            Labor rates
          </h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="muted small billing-manpower-caption">
          Project labor classes and blended rates used for weekly budget cost and billable calculations.
        </p>

        <div className="table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Class</th>
                <th className="num">Cost/hr</th>
                <th className="num">Bill/hr</th>
                <th className="num">Crew mix</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!hasRates ? (
                <tr>
                  <td colSpan={5} className="muted billing-empty">
                    No labor classes yet.
                  </td>
                </tr>
              ) : (
                billing.laborRates.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        value={r.className}
                        placeholder="Class name"
                        disabled={saving}
                        onChange={(e) => onPatchRate(r.id, { className: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <MoneyInput
                        value={r.costRate}
                        disabled={saving}
                        onChange={(n) => onPatchRate(r.id, { costRate: n })}
                      />
                    </td>
                    <td className="num">
                      <MoneyInput
                        value={r.billRate}
                        disabled={saving}
                        onChange={(n) => onPatchRate(r.id, { billRate: n })}
                      />
                    </td>
                    <td className="num">
                      <MoneyInput
                        value={r.crewMix}
                        disabled={saving}
                        onChange={(n) => onPatchRate(r.id, { crewMix: n })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => onRemoveRate(r.id)}
                        disabled={saving}
                        aria-label="Remove class"
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
                <td>Blended (crew-mix weighted)</td>
                <td className="num">{formatMoney0(blendedCost)}</td>
                <td className="num">{formatMoney0(blendedBill)}</td>
                <td className="num" colSpan={2}>
                  —
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="row-gap wrap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onResetToCompany} disabled={saving}>
            Reset to company defaults
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onAddRate} disabled={saving}>
            Add class
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void onSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save rates"}
          </button>
        </div>

        {!hasRates ? (
          <p className="muted small">
            No classes loaded —{" "}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onResetToCompany} disabled={saving}>
              load company defaults
            </button>{" "}
            or add a class.
          </p>
        ) : null}
      </div>
    </div>
  );
}
