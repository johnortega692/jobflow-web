import { useCallback, useEffect, useState, type DragEvent, type KeyboardEvent } from "react";
import { FLOOR_ORDER } from "../../lib/printCore";
import {
  abbreviateVendorKey,
  getProductDisplay,
  searchPaintColors,
  shouldSkipColorLookup,
  type PaintColorMatch,
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
  showFloor: boolean;
  autoLabel: boolean;
  dragging: boolean;
  dragOver: boolean;
  onChange: (patch: Partial<PaintItem>) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242 1.106a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"
      />
    </svg>
  );
}

export function PaintItemRow({
  item,
  index,
  products,
  sheenOptions,
  colors,
  showPreviousColor,
  showFloor,
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
  total,
}: Props) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupMatches, setLookupMatches] = useState<PaintColorMatch[]>([]);
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

  function onColorKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      if (!shouldSkipColorLookup(item.color)) {
        e.preventDefault();
        runColorLookup();
      }
    }
  }

  function onLookupSelect(display: string, vendor: string) {
    onChange({
      color: display,
      manufacturer: abbreviateVendorKey(vendor),
    });
    setLookupOpen(false);
    setLookupMatches([]);
  }

  const missingColor = !item.color.trim();
  const missingSheen = !item.sheen.trim();

  return (
    <>
      <div
        className={`paint-item-row${dragging ? " paint-item-row--dragging" : ""}${dragOver ? " paint-item-row--dragover" : ""}`}
        data-index={index}
        role="row"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          e.preventDefault();
          onDrop();
        }}
      >
        <button
          type="button"
          className="paint-row-handle"
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

        <div className="paint-col paint-col-label" role="cell">
          <input
            value={item.label}
            readOnly={autoLabel}
            className={autoLabel ? "readonly" : undefined}
            onChange={(e) => onChange({ label: e.target.value })}
            aria-label={`Label row ${index + 1}`}
          />
        </div>

        {showFloor && (
          <div className="paint-col paint-col-floor" role="cell">
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
          </div>
        )}

        <div className="paint-col paint-col-color" role="cell">
          <div className={`paint-color-field${missingColor ? " paint-color-field--warn" : ""}`}>
            <input
              value={item.color}
              placeholder="⚠ Add color"
              onChange={(e) => onChange({ color: e.target.value })}
              onKeyDown={onColorKeyDown}
              aria-label={`Color row ${index + 1}`}
              title="Type a color number, then Enter, Tab, or search"
            />
            <button
              type="button"
              className="btn btn-small btn-secondary paint-color-lookup-btn paint-color-lookup-btn--icon"
              disabled={!colors || !item.color.trim() || shouldSkipColorLookup(item.color)}
              onClick={runColorLookup}
              title="Look up color name from catalog"
              aria-label="Look up color"
            >
              <SearchIcon />
            </button>
          </div>
        </div>

        {showPreviousColor && (
          <div className="paint-col paint-col-prev" role="cell">
            <input
              value={item.previous_color}
              onChange={(e) => onChange({ previous_color: e.target.value })}
              aria-label={`Previous color row ${index + 1}`}
            />
          </div>
        )}

        <div className="paint-col paint-col-product" role="cell">
          <PaintProductSelect
            value={productDisplay}
            products={products}
            ariaLabel={`Product row ${index + 1}`}
            onChange={(productName, manufacturer, display) => {
              setProductDisplay(display);
              onChange({ product: productName, manufacturer });
            }}
          />
        </div>

        <div className="paint-col paint-col-sheen" role="cell">
          <PaintSheenSelect
            value={item.sheen}
            options={sheenOptions}
            emptyLabel="⚠ Sheen"
            emptyTitle="⚠ Select sheen"
            className={missingSheen ? "paint-field-select--warn" : undefined}
            ariaLabel={`Sheen row ${index + 1}`}
            onChange={(sheen) => onChange({ sheen })}
          />
        </div>

        <div className="paint-row-actions" role="cell">
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
