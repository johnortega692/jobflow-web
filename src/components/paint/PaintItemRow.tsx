import { useCallback, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  abbreviateVendorKey,
  formatSheenSelection,
  getProductDisplay,
  groupPrimersForSelect,
  isStandardColorSystem,
  paintItemPrimerView,
  parseSheenSelection,
  primerOverrideAfterProductChange,
  searchPaintColors,
  sheensForPaintProduct,
  shouldSkipColorLookup,
  type PaintColorMatch,
  type PaintColorsDb,
  type PaintProduct,
} from "../../lib/paintCatalog";
import {
  nextPaintRevisionChange,
  PAINT_PRIMER_OVERRIDE_NONE,
  type PaintItem,
  type PaintRevisionChange,
} from "../../types/tradeDocuments";
import { paintItemProductVendor } from "../../lib/paintPackageLink";
import { ColorLookupModal } from "./ColorLookupModal";
import { PaintProductSelect, PaintSheenSelect } from "./PaintFieldSelects";

type Props = {
  item: PaintItem;
  index: number;
  total: number;
  products: PaintProduct[];
  /** Full catalog, including products hidden from the finish dropdown. Primer lookup uses this. */
  catalogProducts?: PaintProduct[];
  sheenOptions: string[];
  colors: PaintColorsDb | null;
  showPreviousColor: boolean;
  showFloor: boolean;
  revisionChange?: PaintRevisionChange | null;
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

function PaintPrimerLine({
  item,
  products,
  index,
  onChange,
}: {
  item: PaintItem;
  products: PaintProduct[];
  index: number;
  onChange: (patch: Partial<PaintItem>) => void;
}) {
  const primer = useMemo(() => paintItemPrimerView(item, products), [item, products]);
  const primerGroups = useMemo(() => groupPrimersForSelect(primer.primers), [primer.primers]);
  if (!primer.show) return null;
  const tagLabel =
    primer.tag === "paired" ? "Paired" : primer.tag === "override" ? "Override" : primer.tag === "missing" ? "None set" : "";
  return (
    <div className="paint-primer-line">
      <span className="paint-primer-label">Primer</span>
      <select
        className={`paint-field-select paint-primer-select${primer.tag === "override" ? " paint-primer-select--override" : ""}`}
        value={primer.selectValue}
        aria-label={`Primer row ${index + 1}`}
        title={
          primer.selectValue === PAINT_PRIMER_OVERRIDE_NONE
            ? "None (self-priming)"
            : primer.selectValue
              ? (primer.primers.find((option) => option.id === primer.selectValue)?.name ?? primer.firstLabel)
              : primer.firstLabel
        }
        onChange={(event) => {
          const value = event.target.value;
          onChange({ primer_override_id: value ? value : null });
        }}
      >
        <option value="">{primer.firstLabel}</option>
        {primerGroups.map((group) => (
          <optgroup key={group.manufacturer} label={group.manufacturer}>
            {group.items.map((option) => (
              <option key={`${option.id}::${option.manufacturer}`} value={option.id}>
                {option.name}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={PAINT_PRIMER_OVERRIDE_NONE}>None (self-priming)</option>
      </select>
      {tagLabel ? <span className={`paint-primer-tag paint-primer-tag--${primer.tag}`}>{tagLabel}</span> : null}
    </div>
  );
}

export function PaintItemRow({
  item,
  index,
  products,
  catalogProducts,
  sheenOptions,
  colors,
  showPreviousColor,
  showFloor,
  revisionChange = null,
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
  const productDisplay = item.product ? getProductDisplay(products, item.product) : "";

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

  function onLookupSelect(display: string, vendor: string, hex?: string) {
    const manufacturer = isStandardColorSystem(vendor)
      ? null
      : paintItemProductVendor(
          { product: item.product, manufacturer: abbreviateVendorKey(vendor) },
          catalogProducts ?? products,
        );
    onChange({
      color: display,
      color_hex: hex || "",
      ...(manufacturer ? { manufacturer } : {}),
    });
    setLookupOpen(false);
    setLookupMatches([]);
  }

  const missingColor = !item.color.trim();
  const missingSheen = !item.sheen.trim();
  const productSheens = useMemo(
    () => sheensForPaintProduct(products, item.product, sheenOptions),
    [item.product, products, sheenOptions],
  );

  return (
    <>
      <div
        className={`paint-item-row${dragging ? " paint-item-row--dragging" : ""}${dragOver ? " paint-item-row--dragover" : ""}${item.pdf_hidden ? " paint-item-row--pdf-hidden" : ""}`}
        data-index={index}
        role="row"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
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
            title={item.label.trim() || undefined}
          />
        </div>

        {showFloor && (
          <div className="paint-col paint-col-floor" role="cell">
            <input
              value={item.floor}
              placeholder="Walls, ceilings…"
              onChange={(e) => onChange({ floor: e.target.value })}
              aria-label={`Location row ${index + 1}`}
              title={item.floor.trim() || undefined}
            />
          </div>
        )}

        <div className="paint-col paint-col-color" role="cell">
          <div className={`paint-color-field${missingColor ? " paint-color-field--warn" : ""}`}>
            <input
              value={item.color}
              placeholder="SW7004 or color name"
              onChange={(e) => onChange({ color: e.target.value })}
              onKeyDown={onColorKeyDown}
              aria-label={`Color row ${index + 1}`}
              title={item.color.trim() || "Type a color number, then Enter, Tab, or search"}
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
              title={item.previous_color.trim() || undefined}
            />
          </div>
        )}

        <div className="paint-col paint-col-product" role="cell">
          <PaintProductSelect
            value={productDisplay}
            products={products}
            ariaLabel={`Product row ${index + 1}`}
            onChange={(productName, manufacturer) => {
              const nextOptions = sheensForPaintProduct(products, productName, sheenOptions);
              const kept = parseSheenSelection(item.sheen, nextOptions).filter((sheen) =>
                nextOptions.some((option) => option.toLowerCase() === sheen.toLowerCase()),
              );
              onChange({
                product: productName,
                manufacturer,
                sheen: formatSheenSelection(kept),
                primer_override_id: primerOverrideAfterProductChange(
                  productName,
                  manufacturer,
                  item.primer_override_id,
                  products,
                ),
              });
            }}
          />
          <PaintPrimerLine
            item={item}
            products={catalogProducts?.length ? catalogProducts : products}
            index={index}
            onChange={onChange}
          />
        </div>

        <div className="paint-col paint-col-sheen" role="cell">
          <PaintSheenSelect
            value={item.sheen}
            options={productSheens}
            emptyLabel="⚠ Sheen"
            emptyTitle="⚠ Select sheen"
            className={missingSheen ? "paint-field-select--warn" : undefined}
            ariaLabel={`Sheen row ${index + 1}`}
            onChange={(sheen) => onChange({ sheen })}
          />
        </div>

        {revisionChange ? (
          <div className="paint-col paint-col-rev-status" role="cell">
            <button
              type="button"
              className={`paint-rev-status${
                revisionChange === "NEW"
                  ? " paint-rev-status--new"
                  : revisionChange === "REVISED"
                    ? " paint-rev-status--revised"
                    : revisionChange === "Removed"
                      ? " paint-rev-status--removed"
                      : " paint-rev-status--unchanged"
              }`}
              title="Click to change status (REVISED → NEW → No Change → Removed)"
              aria-label={`Status ${revisionChange}. Click to change.`}
              onClick={() => onChange({ revision_change: nextPaintRevisionChange(revisionChange) })}
            >
              {revisionChange}
            </button>
          </div>
        ) : null}

        <div className="paint-row-actions" role="cell">
          <button
            type="button"
            className={`paint-pdf-toggle${item.pdf_hidden ? " is-off" : ""}`}
            aria-pressed={!item.pdf_hidden}
            title={
              item.pdf_hidden
                ? "Hidden from the downloaded PDF. Click to show it."
                : "Shown on the downloaded PDF. Click to hide it."
            }
            aria-label={
              item.pdf_hidden
                ? `Show row ${index + 1} on the PDF`
                : `Hide row ${index + 1} from the PDF`
            }
            onClick={() => onChange({ pdf_hidden: !item.pdf_hidden })}
          >
            PDF
          </button>
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
