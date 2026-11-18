import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
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
  onDuplicate?: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function PaintRowMenu({
  index,
  total,
  tracked,
  onTrack,
  onDuplicate,
  onRemove,
}: {
  index: number;
  total: number;
  tracked: boolean;
  onTrack: () => void;
  onDuplicate?: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 168;
    const height = onDuplicate ? 132 : 96;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below;
    setPos({ top, left });
  }, [onDuplicate]);

  useEffect(() => {
    if (!open) return;
    place();
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function close() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, place]);

  return (
    <div className="paint-row-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="paint-row-more"
        aria-label={`More actions for row ${index + 1}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          place();
          setOpen(true);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && pos ? (
        <div className="paint-row-menu-pop" role="menu" style={{ top: pos.top, left: pos.left }}>
          <button
            type="button"
            role="menuitem"
            className={tracked ? "is-on" : undefined}
            aria-pressed={tracked}
            title={
              tracked
                ? "On Material Tracker under Paint → Special orders. Click to remove it."
                : "Add this finish to Material Tracker as a special order."
            }
            onClick={() => {
              setOpen(false);
              onTrack();
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.2" />
            </svg>
            Track
          </button>
          {onDuplicate ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDuplicate();
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="8" y="8" width="12" height="12" rx="2" />
                <path d="M4 16V6a2 2 0 0 1 2-2h10" />
              </svg>
              Copy
            </button>
          ) : null}
          <div className="paint-row-menu-rule" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="paint-row-menu-delete"
            disabled={total <= 1}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

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
  onDuplicate,
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
    if (!colors) return;
    const q = item.color.trim();
    if (!q) return;
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
            {item.color_hex && item.color.trim() ? (
              <span
                className="paint-color-swatch"
                style={{ background: item.color_hex }}
                role="img"
                aria-label={`${item.color.trim()} swatch`}
                title={`${item.color_hex} (screen approximation)`}
              />
            ) : null}
            <input
              value={item.color}
              placeholder="SW7004 or color name"
              onChange={(e) => onChange(item.color_hex ? { color: e.target.value, color_hex: "" } : { color: e.target.value })}
              onKeyDown={onColorKeyDown}
              aria-label={`Color row ${index + 1}`}
              title={item.color.trim() || "Type a color number, then Enter, Tab, or search"}
            />
            <button
              type="button"
              className="btn btn-small btn-secondary paint-color-lookup-btn paint-color-lookup-btn--icon"
              disabled={!colors || !item.color.trim()}
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
          <PaintRowMenu
            index={index}
            total={total}
            tracked={Boolean(item.special_order)}
            onTrack={() => onChange({ special_order: !item.special_order })}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
          />
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
