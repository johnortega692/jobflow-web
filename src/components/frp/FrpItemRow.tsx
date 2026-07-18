import type { DragEvent } from "react";
import type { FrpCatalog } from "../../lib/frpCatalog";
import {
  frpColorsForProduct,
  frpIsTrimProduct,
  frpManufacturers,
  frpPanelSizes,
  frpProductsForManufacturer,
  frpTrimProducts,
  frpTrimSizes,
} from "../../lib/frpCatalog";
import type { FrpItem } from "../../types/tradeDocuments";

const PANEL_UNITS = ["EA", "SHT"] as const;
const TRIM_UNITS = ["EA", "LF"] as const;

type Props = {
  item: FrpItem;
  index: number;
  total: number;
  catalog: FrpCatalog;
  autoLabel: boolean;
  dragging: boolean;
  dragOver: boolean;
  onChange: (patch: Partial<FrpItem>) => void;
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

export function FrpItemRow({
  item,
  index,
  total,
  catalog,
  autoLabel,
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
  const isTrim = frpIsTrimProduct(catalog, item.manufacturer, item.product);
  const manufacturers = frpManufacturers(catalog);
  const products = item.manufacturer
    ? isTrim
      ? frpTrimProducts(catalog, item.manufacturer)
      : frpProductsForManufacturer(catalog, item.manufacturer)
    : [];
  // Keep current product visible even if not in filtered list (e.g. legacy)
  const productOptions =
    item.product && !products.includes(item.product) ? [item.product, ...products] : products;
  const colors =
    item.manufacturer && item.product
      ? frpColorsForProduct(catalog, item.manufacturer, item.product)
      : [];
  const panelSizes = frpPanelSizes(catalog);
  const trimSizes = frpTrimSizes(catalog);
  const unitOptions: readonly string[] = isTrim ? TRIM_UNITS : PANEL_UNITS;
  const unitValue = unitOptions.includes(item.unit) ? item.unit : isTrim ? "LF" : "EA";

  const missingMfr = !item.manufacturer.trim();
  const missingProduct = !item.product.trim();
  const missingColor = !item.color.trim();
  const missingQty = !item.quantity.trim();

  function onManufacturerChange(manufacturer: string) {
    onChange({ manufacturer, product: "", color: "" });
  }

  function onProductChange(product: string) {
    const nextIsTrim = frpIsTrimProduct(catalog, item.manufacturer, product);
    onChange({
      product,
      color: "",
      panel_size: nextIsTrim ? "" : item.panel_size,
      unit: nextIsTrim ? (TRIM_UNITS.includes(item.unit as (typeof TRIM_UNITS)[number]) ? item.unit : "LF") : PANEL_UNITS.includes(item.unit as (typeof PANEL_UNITS)[number]) ? item.unit : "EA",
    });
  }

  return (
    <div
      className={`frp-item-block${isTrim ? " frp-item-block--trim" : " frp-item-block--panel"}${item.include_in_submittal === false ? " frp-item-block--off-pdf" : ""}${dragging ? " frp-item-block--dragging" : ""}${dragOver ? " frp-item-block--dragover" : ""}`}
      data-index={index}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="frp-item-body">
      <div className="frp-item-tier1" role="row">
        <button
          type="button"
          className="frp-row-handle"
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

        <div className="frp-col frp-col-label" role="cell">
          <input
            value={item.label}
            readOnly={autoLabel}
            className={autoLabel ? "readonly" : undefined}
            onChange={(e) => onChange({ label: e.target.value })}
            aria-label={`Label row ${index + 1}`}
          />
        </div>

        <div className="frp-col frp-col-mfr" role="cell">
          <select
            className={missingMfr ? "frp-field--warn" : undefined}
            value={item.manufacturer}
            title={missingMfr ? "⚠ Add manufacturer" : undefined}
            onChange={(e) => onManufacturerChange(e.target.value)}
            aria-label={`Manufacturer row ${index + 1}`}
          >
            <option value="">{missingMfr ? "⚠ Manufacturer" : "—"}</option>
            {manufacturers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="frp-col frp-col-product" role="cell">
          <select
            className={missingProduct ? "frp-field--warn" : undefined}
            value={item.product}
            title={missingProduct ? "⚠ Add product" : item.product || undefined}
            disabled={!item.manufacturer}
            onChange={(e) => onProductChange(e.target.value)}
            aria-label={`Product row ${index + 1}`}
          >
            <option value="">{missingProduct ? "⚠ Product" : "—"}</option>
            {productOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="frp-col frp-col-color" role="cell">
          <select
            className={missingColor ? "frp-field--warn" : undefined}
            value={item.color}
            title={missingColor ? "⚠ Add color" : item.color || undefined}
            disabled={!item.product}
            onChange={(e) => onChange({ color: e.target.value })}
            aria-label={`Color row ${index + 1}`}
          >
            <option value="">{missingColor ? "⚠ Color" : "—"}</option>
            {colors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="frp-row-actions" role="cell">
          <button
            type="button"
            className="btn btn-icon btn-small btn-danger-soft"
            disabled={total <= 1}
            onClick={onRemove}
            title="Remove row"
            aria-label={`Remove row ${index + 1}`}
          >
            ×
          </button>
        </div>
      </div>

      <div className="frp-item-tier2" role="row">
        <label className="frp-inline-check">
          <input
            type="checkbox"
            checked={item.order}
            onChange={(e) => onChange({ order: e.target.checked })}
          />
          Order
        </label>

        <label className="frp-inline-check">
          <input
            type="checkbox"
            checked={item.include_in_submittal !== false}
            onChange={(e) => onChange({ include_in_submittal: e.target.checked })}
            title={
              item.include_in_submittal !== false
                ? "Included on submittal PDF"
                : "Excluded from submittal PDF"
            }
          />
          Submittal
        </label>

        <div className={`frp-qty-group${missingQty ? " frp-qty-group--warn" : ""}`}>
          <span className={`frp-qty-prefix${missingQty ? " frp-qty-prefix--warn" : ""}`}>Qty</span>
          <input
            className={`frp-qty-input${missingQty ? " frp-field--warn" : ""}`}
            inputMode="decimal"
            value={item.quantity}
            placeholder={missingQty ? "⚠" : ""}
            title={missingQty ? "⚠ Add quantity" : undefined}
            onChange={(e) => onChange({ quantity: qtyInputValue(e.target.value) })}
            aria-label={`Quantity row ${index + 1}`}
          />
          <select
            className="frp-unit-select"
            value={unitValue}
            onChange={(e) => onChange({ unit: e.target.value })}
            aria-label={`Unit row ${index + 1}`}
          >
            {unitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        {!isTrim && (
          <label className="frp-inline-select">
            <span>Panel</span>
            <select
              value={item.panel_size}
              onChange={(e) => onChange({ panel_size: e.target.value })}
              aria-label={`Panel size row ${index + 1}`}
            >
              <option value="">—</option>
              {panelSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="frp-inline-select">
          <span>Length</span>
          <select
            value={item.trim_size}
            onChange={(e) => onChange({ trim_size: e.target.value })}
            aria-label={`Length row ${index + 1}`}
          >
            <option value="">—</option>
            {trimSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="frp-col-notes">
          <input
            value={item.notes}
            placeholder="Notes"
            onChange={(e) => onChange({ notes: e.target.value })}
            aria-label={`Notes row ${index + 1}`}
          />
        </div>
      </div>
      </div>
      <span
        className={`frp-type-rail${isTrim ? " frp-type-rail--trim" : " frp-type-rail--panel"}`}
        title={isTrim ? "Trim item" : "Panel item"}
        aria-label={isTrim ? "Trim item" : "Panel item"}
      >
        {isTrim ? "TRIM" : "PANEL"}
      </span>
    </div>
  );
}
