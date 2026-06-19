import { useCallback, useEffect, useId, useState } from "react";
import { FLOOR_ORDER } from "../../lib/printCore";
import {
  abbreviateVendorKey,
  extractManufacturerFromDisplay,
  extractProductName,
  getProductDisplay,
  manufacturerForProduct,
  searchPaintColors,
  shouldSkipColorLookup,
  type PaintColorsDb,
  type PaintProduct,
} from "../../lib/paintCatalog";
import type { PaintItem } from "../../types/tradeDocuments";
import { ColorLookupModal } from "./ColorLookupModal";

type Props = {
  item: PaintItem;
  index: number;
  total: number;
  products: PaintProduct[];
  productOptions: string[];
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
  productOptions,
  sheenOptions,
  colors,
  showPreviousColor,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props) {
  const uid = useId();
  const productListId = `${uid}-products`;
  const sheenListId = `${uid}-sheens`;
  const [lookupMatches, setLookupMatches] = useState<{ display: string; vendor: string }[] | null>(
    null,
  );
  const [productDisplay, setProductDisplay] = useState(() =>
    item.product ? getProductDisplay(products, item.product) : "",
  );

  useEffect(() => {
    setProductDisplay(item.product ? getProductDisplay(products, item.product) : "");
  }, [item.product, products]);

  const runColorLookup = useCallback(() => {
    if (!colors || shouldSkipColorLookup(item.color)) return;
    const matches = searchPaintColors(colors, item.color, productDisplay);
    if (matches.length === 1) {
      const m = matches[0]!;
      onChange({ color: m.display, manufacturer: abbreviateVendorKey(m.vendor) });
    } else if (matches.length > 1) {
      setLookupMatches(matches);
    }
  }, [colors, item.color, item.manufacturer, onChange, productDisplay]);

  function onColorKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      if (!shouldSkipColorLookup(item.color)) {
        e.preventDefault();
        runColorLookup();
      }
    }
  }

  function onProductBlur() {
    const name = extractProductName(productDisplay);
    const mfr = extractManufacturerFromDisplay(productDisplay) || manufacturerForProduct(products, name);
    onChange({ product: name, manufacturer: mfr });
  }

  function onLookupSelect(display: string, vendor: string) {
    onChange({ color: display, manufacturer: abbreviateVendorKey(vendor) });
    setLookupMatches(null);
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
          <input
            value={item.color}
            onChange={(e) => onChange({ color: e.target.value })}
            onKeyDown={onColorKeyDown}
            aria-label={`Color row ${index + 1}`}
            title="Type a color number and press Enter or Tab to look up"
          />
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
          <input
            list={productListId}
            value={productDisplay}
            onChange={(e) => setProductDisplay(e.target.value)}
            onBlur={onProductBlur}
            aria-label={`Product row ${index + 1}`}
          />
          <datalist id={productListId}>
            {productOptions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>

        <label className="paint-col paint-col-sheen">
          <span className="paint-col-head">Sheen</span>
          <input
            list={sheenListId}
            value={item.sheen}
            onChange={(e) => onChange({ sheen: e.target.value })}
            aria-label={`Sheen row ${index + 1}`}
          />
          <datalist id={sheenListId}>
            {sheenOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
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

      {lookupMatches && lookupMatches.length > 0 && (
        <ColorLookupModal
          matches={lookupMatches}
          onSelect={onLookupSelect}
          onClose={() => setLookupMatches(null)}
        />
      )}
    </>
  );
}
