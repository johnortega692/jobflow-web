import { FLOOR_ORDER } from "../../lib/printCore";
import type { WallcoveringItem } from "../../types/tradeDocuments";

type Props = {
  item: WallcoveringItem;
  index: number;
  total: number;
  showPreviousColor: boolean;
  onChange: (patch: Partial<WallcoveringItem>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

export function WallcoveringItemRow({
  item,
  index,
  total,
  showPreviousColor,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props) {
  return (
    <div className="wc-item-block">
      <div
        className={`wc-item-row1${showPreviousColor ? " wc-item-row1--substitution" : ""}`}
        data-index={index}
      >
        <span className="wc-row-num" aria-hidden="true">
          {index + 1}.
        </span>
        <label className="wc-col">
          <span className="paint-col-head">Label</span>
          <input value={item.label} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
        <label className="wc-col">
          <span className="paint-col-head">Manufacturer</span>
          <input
            value={item.manufacturer}
            onChange={(e) => onChange({ manufacturer: e.target.value })}
          />
        </label>
        <label className="wc-col">
          <span className="paint-col-head">Product</span>
          <input value={item.product} onChange={(e) => onChange({ product: e.target.value })} />
        </label>
        {showPreviousColor ? (
          <label className="wc-col">
            <span className="paint-col-head">Previous</span>
            <input
              value={item.previous_color}
              onChange={(e) => onChange({ previous_color: e.target.value })}
            />
          </label>
        ) : null}
        <label className="wc-col">
          <span className="paint-col-head">Color</span>
          <input value={item.color} onChange={(e) => onChange({ color: e.target.value })} />
        </label>
      </div>

      <div className="wc-item-row2">
        <label className="wc-check">
          <span className="paint-col-head">Order</span>
          <input
            type="checkbox"
            checked={item.order}
            onChange={(e) => onChange({ order: e.target.checked })}
            aria-label={`Order row ${index + 1}`}
          />
        </label>
        <label className="wc-check">
          <span className="paint-col-head">Panel?</span>
          <input
            type="checkbox"
            checked={item.panels}
            onChange={(e) => onChange({ panels: e.target.checked })}
            aria-label={`Panel row ${index + 1}`}
          />
        </label>
        <label className="wc-check">
          <span className="paint-col-head">Submittal</span>
          <input
            type="checkbox"
            checked={item.include_in_submittal}
            onChange={(e) => onChange({ include_in_submittal: e.target.checked })}
            aria-label={`Include in submittal row ${index + 1}`}
          />
        </label>
        <label className="wc-col wc-col-floor">
          <span className="paint-col-head">Floor</span>
          <select value={item.floor} onChange={(e) => onChange({ floor: e.target.value })}>
            <option value="">—</option>
            {FLOOR_ORDER.filter(Boolean).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="wc-col wc-col-qty">
          <span className="paint-col-head">QTY</span>
          <input value={item.qty} onChange={(e) => onChange({ qty: e.target.value })} />
        </label>
        <label className="wc-col wc-col-notes">
          <span className="paint-col-head">Notes</span>
          <input value={item.notes} onChange={(e) => onChange({ notes: e.target.value })} />
        </label>
        <div className="wc-row-actions" aria-label={`Row ${index + 1} actions`}>
          <button
            type="button"
            className="btn btn-icon btn-small"
            disabled={index === 0}
            onClick={onMoveUp}
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-icon btn-small"
            disabled={index >= total - 1}
            onClick={onMoveDown}
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-icon btn-small btn-danger-soft"
            disabled={total <= 1}
            onClick={onRemove}
            title="Remove row"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
