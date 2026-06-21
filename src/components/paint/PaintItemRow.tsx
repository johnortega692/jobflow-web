import { useCallback, useEffect, useState } from "react";
import { FLOOR_ORDER } from "../../lib/printCore";
import {
  abbreviateVendorKey,
  getProductDisplay,
  searchPaintColors,
  shouldSkipColorLookup,
  type PaintColorsDb,
  type PaintProduct,
} from "../../lib/paintCatalog";
import type { PaintItem } from "../../types/tradeDocuments";
import { ColorLookupModal } from "./ColorLookupModal";
import { PaintProductSelect, PaintSheenSelect } from "./PaintFieldSelects";

type Props = {
  item: PaintItem;
  index: number;
  total: number;
  products: PaintProduct[];
  sheenOptions: string[];
  colors: PaintColorsDb | null;
  showPreviousColor: boolean;
  onChange: (patch: Partial<PaintItem>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

export function PaintItemRow({
  item,
  index,
  total,
  products,
  sheenOptions,
  colors,
  showPreviousColor,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupMatches, setLookupMatches] = useState<{ display: string; vendor: string }[]>([]);
  const [productDisplay, setProductDisplay] = useState(() =>
    item.product ? getProductDisplay(products, item.product) : "",
  );

  useEffect(() => {
    setProductDisplay(item.product ? getProductDisplay(products, item.product) : "");
  }, [item.product, products]);

  const runColorLookup = useCallback(() => {
    if (!colors || shouldSkipColorLookup(item.color)) return;
    const q = item.color.trim();
    const matches = searchPaintColors(colors, q);
    setLookupQuery(q);
    setLookupMatches(matches);
    setLookupOpen(true);
  }, [colors, item.color]);

  function onColorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      if (!shouldSkipColorLookup(item.color)) {
        e.preventDefault();
        runColorLookup();
      }
    }
  }

  function onLookupSelect(display: string, vendor: string) {
    onChange({ color: display, manufacturer: abbreviateVendorKey(vendor) });
    setLookupOpen(false);
    setLookupMatches([]);
  }

  return (
    <>
      <div className="paint-item-row" data-index={index}>
        <label className="paint-col paint-col-label">
          <span className="paint-col-head">Label</span>
          <input
            value={item.label}
            onChange={(e) => onChange({ label: e.target.value })}
            aria-label={`Label row ${index + 1}`}
          />
        </label>

        <label className="paint-col paint-col-floor">
          <span className="paint-col-head">Floor</span>
          <select
            className="paint-field-select"
            value={item.floor}
            onChange={(e) => onChange({ floor: e.target.value })}
            aria-label={`Floor row ${index + 1}`}
          >
            <option value="">—</option>
            {FLOOR_ORDER.filter(Boolean).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="paint-col paint-col-color">
          <span className="paint-col-head">Color</span>
          <div className="paint-color-field">
            <input
              value={item.color}
              onChange={(e) => onChange({ color: e.target.value })}
              onKeyDown={onColorKeyDown}
              aria-label={`Color row ${index + 1}`}
              title="Type a color number, then Enter, Tab, or Lookup"
            />
            <button
              type="button"
              className="btn btn-small btn-secondary paint-color-lookup-btn"
              disabled={!colors || !item.color.trim() || shouldSkipColorLookup(item.color)}
              onClick={runColorLookup}
              title="Look up color name from catalog"
            >
              Lookup
            </button>
          </div>
        </label>

        {showPreviousColor && (
          <label className="paint-col paint-col-prev">
            <span className="paint-col-head">Prev color</span>
            <input
              value={item.previous_color}
              onChange={(e) => onChange({ previous_color: e.target.value })}
              aria-label={`Previous color row ${index + 1}`}
            />
          </label>
        )}

        <label className="paint-col paint-col-product">
          <span className="paint-col-head">Product</span>
          <PaintProductSelect
            value={productDisplay}
            products={products}
            ariaLabel={`Product row ${index + 1}`}
            onChange={(productName, manufacturer, display) => {
              setProductDisplay(display);
              onChange({ product: productName, manufacturer });
            }}
          />
        </label>

        <label className="paint-col paint-col-sheen">
          <span className="paint-col-head">Sheen</span>
          <PaintSheenSelect
            value={item.sheen}
            options={sheenOptions}
            ariaLabel={`Sheen row ${index + 1}`}
            onChange={(sheen) => onChange({ sheen })}
          />
        </label>

        <div className="paint-row-actions" aria-label={`Row ${index + 1} actions`}>
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

      {lookupOpen && (
        <ColorLookupModal
          query={lookupQuery}
          matches={lookupMatches}
          onSelect={onLookupSelect}
          onClose={() => setLookupOpen(false)}
        />
      )}
    </>
  );
}
