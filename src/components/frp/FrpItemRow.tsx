import type { FrpCatalog } from "../../lib/frpCatalog";
import {
  frpColorsForProduct,
  frpManufacturers,
  frpPanelSizes,
  frpProductsForManufacturer,
  frpTrimSizes,
} from "../../lib/frpCatalog";
import type { FrpItem } from "../../types/tradeDocuments";

type Props = {
  item: FrpItem;
  index: number;
  total: number;
  catalog: FrpCatalog;
  onChange: (patch: Partial<FrpItem>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

export function FrpItemRow({
  item,
  index,
  total,
  catalog,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props) {
  const manufacturers = frpManufacturers(catalog);
  const products = item.manufacturer ? frpProductsForManufacturer(catalog, item.manufacturer) : [];
  const colors =
    item.manufacturer && item.product
      ? frpColorsForProduct(catalog, item.manufacturer, item.product)
      : [];
  const panelSizes = [""].concat(frpPanelSizes(catalog));
  const trimSizes = [""].concat(frpTrimSizes(catalog));

  function onManufacturerChange(manufacturer: string) {
    onChange({ manufacturer, product: "", color: "" });
  }

  function onProductChange(product: string) {
    onChange({ product, color: "" });
  }

  return (
    <div className="frp-item-block">
      <div className="frp-item-row1" data-index={index}>
        <span className="frp-row-num" aria-hidden="true">
          {index + 1}.
        </span>
        <label className="frp-check">
          <span className="paint-col-head">Order</span>
          <input
            type="checkbox"
            checked={item.order}
            onChange={(e) => onChange({ order: e.target.checked })}
            aria-label={`Order row ${index + 1}`}
          />
        </label>
        <label className="frp-col">
          <span className="paint-col-head">Manufacturer</span>
          <select
            value={item.manufacturer}
            onChange={(e) => onManufacturerChange(e.target.value)}
          >
            <option value="">—</option>
            {manufacturers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="frp-col frp-col--wide">
          <span className="paint-col-head">Product</span>
          <select
            value={item.product}
            onChange={(e) => onProductChange(e.target.value)}
            disabled={!item.manufacturer}
          >
            <option value="">—</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="frp-col frp-col--wide">
          <span className="paint-col-head">Color</span>
          <select
            value={item.color}
            onChange={(e) => onChange({ color: e.target.value })}
            disabled={!item.product}
          >
            <option value="">—</option>
            {colors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="frp-item-row2">
        <label className="frp-col frp-col--narrow">
          <span className="paint-col-head">Label</span>
          <input value={item.label} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
        <label className="frp-col frp-col--narrow">
          <span className="paint-col-head">Quantity</span>
          <input
            value={item.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
          />
        </label>
        <label className="frp-col">
          <span className="paint-col-head">Notes</span>
          <input value={item.notes} onChange={(e) => onChange({ notes: e.target.value })} />
        </label>
        <label className="frp-col frp-col--narrow">
          <span className="paint-col-head">Panel</span>
          <select value={item.panel_size} onChange={(e) => onChange({ panel_size: e.target.value })}>
            {panelSizes.map((s) => (
              <option key={s || "blank"} value={s}>
                {s || "—"}
              </option>
            ))}
          </select>
        </label>
        <label className="frp-col frp-col--narrow">
          <span className="paint-col-head">Length</span>
          <select value={item.trim_size} onChange={(e) => onChange({ trim_size: e.target.value })}>
            {trimSizes.map((s) => (
              <option key={s || "blank"} value={s}>
                {s || "—"}
              </option>
            ))}
          </select>
        </label>
        <div className="frp-row-actions">
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
