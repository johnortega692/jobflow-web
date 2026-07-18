import type { TrackCatalog } from "../../lib/trackCatalog";
import {
  findMatCodeForProduct,
  matCodeDisplay,
  stripProductPrefix,
  trackProductsForType,
} from "../../lib/trackCatalog";
import {
  MATERIAL_ORDER_UNITS,
  type TrackItem,
  type TrackItemType,
  type MaterialOrderUnit,
} from "../../types/tradeDocuments";

const TRACK_TYPES: TrackItemType[] = ["Track", "Infill"];

type Props = {
  item: TrackItem;
  index: number;
  total: number;
  catalog: TrackCatalog;
  usage: Record<string, number>;
  onChange: (patch: Partial<TrackItem>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

export function TrackItemRow({
  item,
  index,
  total,
  catalog,
  usage,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props) {
  const productOptions = item.type ? trackProductsForType(catalog, item.type, usage) : [];
  const unitValue = (item.unit?.trim() || "EA") as MaterialOrderUnit;

  function onTypeChange(type: TrackItemType) {
    onChange({ type, product: "", mat_code: "" });
  }

  function onProductChange(display: string) {
    const product = stripProductPrefix(display);
    const matCode = findMatCodeForProduct(catalog, product);
    onChange({ product: display, mat_code: matCode });
  }

  return (
    <div className="track-item-block">
      <div className="track-item-row" data-index={index}>
        <span className="track-row-num" aria-hidden="true">
          {index + 1}.
        </span>
        <label className="track-check">
          <span className="paint-col-head">Order</span>
          <input
            type="checkbox"
            checked={item.order}
            onChange={(e) => onChange({ order: e.target.checked })}
            aria-label={`Order row ${index + 1}`}
          />
        </label>
        <label className="track-col track-col--type">
          <span className="paint-col-head">Type</span>
          <select
            value={item.type}
            onChange={(e) => onTypeChange(e.target.value as TrackItemType)}
          >
            <option value="">—</option>
            {TRACK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="track-col track-col--product">
          <span className="paint-col-head">Product</span>
          <select
            value={item.product}
            onChange={(e) => onProductChange(e.target.value)}
            disabled={!item.type}
          >
            <option value="">—</option>
            {productOptions.map((opt) => (
              <option key={`${opt.matCode}-${opt.product}`} value={opt.display}>
                {opt.display}
              </option>
            ))}
          </select>
        </label>
        <label className="track-col track-col--code">
          <span className="paint-col-head">Mat code</span>
          <input
            value={item.mat_code ? matCodeDisplay(item.mat_code, catalog) : ""}
            readOnly
            tabIndex={-1}
            aria-readonly="true"
          />
        </label>
        <label className="track-col track-col--qty">
          <span className="paint-col-head">Qty</span>
          <input
            value={item.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            inputMode="decimal"
          />
        </label>
        <label className="track-col track-col--unit">
          <span className="paint-col-head">Unit</span>
          <select
            value={unitValue}
            onChange={(e) => onChange({ unit: e.target.value as MaterialOrderUnit })}
            aria-label={`Unit row ${index + 1}`}
          >
            {MATERIAL_ORDER_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <div className="track-row-actions">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onMoveDown}
            disabled={index >= total - 1}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onRemove}
            disabled={total <= 1}
            aria-label="Remove row"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
