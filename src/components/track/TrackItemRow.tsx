import type { DragEvent } from "react";
import type { TrackCatalog } from "../../lib/trackCatalog";
import {
  findMatCodeForProduct,
  matCodeDisplay,
  stripProductPrefix,
  trackProductsForType,
} from "../../lib/trackCatalog";
import type { TrackItem, TrackItemType, MaterialOrderUnit } from "../../types/tradeDocuments";

const TRACK_TYPES: TrackItemType[] = ["Track", "Infill"];
const FWP_UNITS: MaterialOrderUnit[] = ["LF", "EA"];

type Props = {
  item: TrackItem;
  index: number;
  total: number;
  catalog: TrackCatalog;
  usage: Record<string, number>;
  dragging: boolean;
  dragOver: boolean;
  onChange: (patch: Partial<TrackItem>) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function qtyInputValue(raw: string): string {
  return raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

export function TrackItemRow({
  item,
  index,
  total,
  catalog,
  usage,
  dragging,
  dragOver,
  onChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: Props) {
  const productOptions = item.type ? trackProductsForType(catalog, item.type, usage) : [];
  const unitValue = (FWP_UNITS.includes((item.unit?.trim() || "LF") as MaterialOrderUnit)
    ? item.unit?.trim() || "LF"
    : "LF") as MaterialOrderUnit;

  function onTypeChange(type: TrackItemType) {
    onChange({ type, product: "", mat_code: "" });
  }

  function onProductChange(display: string) {
    const product = stripProductPrefix(display);
    const matCode = findMatCodeForProduct(catalog, product);
    onChange({ product: display, mat_code: matCode });
  }

  return (
    <div
      className={`fwp-item-block${dragging ? " fwp-item-block--dragging" : ""}${dragOver ? " fwp-item-block--dragover" : ""}`}
      data-index={index}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="fwp-item-row" role="row">
        <button
          type="button"
          className="fwp-row-handle"
          draggable
          aria-label={`Reorder row ${index + 1}`}
          title="Drag to reorder"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(index));
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          ⠿
        </button>

        <label className="fwp-check" role="cell">
          <input
            type="checkbox"
            checked={item.order}
            onChange={(e) => onChange({ order: e.target.checked })}
            aria-label={`Order row ${index + 1}`}
          />
        </label>

        <div className="fwp-col fwp-col-type" role="cell">
          <select
            value={item.type}
            onChange={(e) => onTypeChange(e.target.value as TrackItemType)}
            aria-label={`Type row ${index + 1}`}
          >
            <option value="">—</option>
            {TRACK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="fwp-col fwp-col-product" role="cell">
          <select
            value={item.product}
            onChange={(e) => onProductChange(e.target.value)}
            disabled={!item.type}
            aria-label={`Product row ${index + 1}`}
          >
            <option value="">—</option>
            {productOptions.map((opt) => (
              <option key={`${opt.matCode}-${opt.product}`} value={opt.display}>
                {opt.display}
              </option>
            ))}
          </select>
        </div>

        <div className="fwp-col fwp-col-code" role="cell">
          <input
            value={item.mat_code ? matCodeDisplay(item.mat_code, catalog) : ""}
            readOnly
            tabIndex={-1}
            aria-readonly="true"
            aria-label={`Mat code row ${index + 1}`}
          />
        </div>

        <div className="fwp-qty-group" role="cell">
          <input
            className="fwp-qty-input"
            inputMode="decimal"
            value={item.quantity}
            placeholder="Qty"
            onChange={(e) => onChange({ quantity: qtyInputValue(e.target.value) })}
            aria-label={`Quantity row ${index + 1}`}
          />
          <select
            className="fwp-unit-select"
            value={unitValue}
            onChange={(e) => onChange({ unit: e.target.value as MaterialOrderUnit })}
            aria-label={`Unit row ${index + 1}`}
          >
            {FWP_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div className="fwp-row-actions" role="cell">
          <button
            type="button"
            className="btn btn-icon btn-small btn-danger-soft"
            onClick={onRemove}
            disabled={total <= 1}
            title="Remove row"
            aria-label={`Remove row ${index + 1}`}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
