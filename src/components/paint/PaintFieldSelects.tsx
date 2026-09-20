import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  compactSheenLabel,
  extractManufacturerFromDisplay,
  extractProductName,
  formatSheenSelection,
  groupProductsForSelect,
  manufacturerForProduct,
  parseSheenSelection,
  toggleSheenSelection,
  type PaintProduct,
} from "../../lib/paintCatalog";

export function PaintSheenSelect({
  value,
  options,
  onChange,
  ariaLabel,
  emptyLabel = "— Select sheen —",
  emptyTitle,
  className,
}: {
  value: string;
  options: string[];
  onChange: (sheen: string) => void;
  ariaLabel?: string;
  emptyLabel?: string;
  /** Tooltip when empty (defaults to emptyLabel). */
  emptyTitle?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = useMemo(() => parseSheenSelection(value, options), [options, value]);
  const selectedSet = useMemo(
    () => new Set(selected.map((sheen) => sheen.toLowerCase())),
    [selected],
  );
  const extras = selected.filter(
    (sheen) => !options.some((option) => option.toLowerCase() === sheen.toLowerCase()),
  );
  const display = value.trim() ? compactSheenLabel(value, options) : "";
  const warn = Boolean(className?.includes("paint-field-select--warn"));

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function place() {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 220);
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      const menuHeight = menuRef.current?.offsetHeight ?? Math.min(options.length * 32 + 64, 280);
      const below = r.bottom + 4;
      const top =
        below + menuHeight > window.innerHeight - 8 ? Math.max(8, r.top - menuHeight - 4) : below;
      setMenuPos({ top, left, width });
    }
    place();
    const frame = window.requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, options.length, selected.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(option: string) {
    onChange(toggleSheenSelection(value, option, options));
  }

  return (
    <div
      ref={rootRef}
      className={["paint-sheen-select", open ? "paint-sheen-select--open" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className={[
          "paint-field-select paint-sheen-select-trigger",
          warn ? "paint-field-select--warn" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={value || emptyTitle || emptyLabel || undefined}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((next) => !next)}
      >
        <span className={display ? undefined : "paint-sheen-select-placeholder"}>
          {display || emptyLabel}
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          className="paint-sheen-select-menu"
          role="group"
          aria-label={ariaLabel}
          style={
            menuPos
              ? { top: menuPos.top, left: menuPos.left, width: menuPos.width }
              : { visibility: "hidden" }
          }
        >
          <p className="paint-sheen-select-hint">Check every sheen this item needs</p>
          {!options.length && !extras.length ? (
            <p className="muted small paint-sheen-select-empty">No sheens for this product.</p>
          ) : (
            <div className="paint-sheen-select-options">
              {options.map((option) => {
                const checked = selectedSet.has(option.toLowerCase());
                return (
                  <label key={option} className="paint-sheen-select-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(option)}
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
              {extras.map((option) => (
                <label key={`saved-${option}`} className="paint-sheen-select-option">
                  <input type="checkbox" checked onChange={() => toggle(option)} />
                  <span>
                    {option} <span className="muted">(saved)</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {selected.length > 1 ? (
            <p className="muted small paint-sheen-select-summary">{formatSheenSelection(selected)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PaintProductSelect({
  value,
  products,
  onChange,
  ariaLabel,
}: {
  value: string;
  products: PaintProduct[];
  onChange: (productName: string, manufacturer: string, display: string) => void;
  ariaLabel?: string;
}) {
  const groups = useMemo(() => groupProductsForSelect(products), [products]);
  const knownDisplays = useMemo(
    () => new Set(groups.flatMap((g) => g.items.map((i) => i.display))),
    [groups],
  );
  const savedCustom = value && !knownDisplays.has(value);

  return (
    <select
      className="paint-field-select paint-field-select--ellipsis"
      value={value}
      title={value || undefined}
      onChange={(e) => {
        const display = e.target.value;
        const name = extractProductName(display);
        const mfr =
          extractManufacturerFromDisplay(display) || manufacturerForProduct(products, name);
        onChange(name, mfr, display);
      }}
      aria-label={ariaLabel}
    >
      <option value="">— Select product —</option>
      {groups.map((group) => (
        <optgroup key={group.manufacturer} label={group.manufacturer}>
          {group.items.map((item) => (
            <option key={item.display} value={item.display} title={item.display}>
              {item.product}
            </option>
          ))}
        </optgroup>
      ))}
      {savedCustom && (
        <option value={value} title={value}>
          {extractProductName(value)} (saved)
        </option>
      )}
    </select>
  );
}
