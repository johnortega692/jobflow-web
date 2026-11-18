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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
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
      const menu = menuRef.current;
      if (!el || !menu) return;
      const r = el.getBoundingClientRect();
      const width = menu.offsetWidth;
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      const menuHeight = menu.offsetHeight;
      const below = r.bottom + 4;
      const top =
        below + menuHeight > window.innerHeight - 8 ? Math.max(8, r.top - menuHeight - 4) : below;
      setMenuPos({ top, left });
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
        title={value.trim() ? formatSheenSelection(selected) : emptyTitle || emptyLabel || undefined}
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
            ? { top: menuPos.top, left: menuPos.left }
            : { visibility: "hidden" }
          }
        >
          <p className="paint-sheen-select-hint">Select Required Sheens</p>
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const groups = useMemo(() => groupProductsForSelect(products), [products]);
  const knownDisplays = useMemo(
    () => new Set(groups.flatMap((g) => g.items.map((i) => i.display))),
    [groups],
  );
  const savedCustom = Boolean(value && !knownDisplays.has(value));
  const closedLabel = value ? extractProductName(value) : "";

  function choose(display: string) {
    const name = extractProductName(display);
    const mfr = extractManufacturerFromDisplay(display) || manufacturerForProduct(products, name);
    onChange(name, mfr, display);
    setOpen(false);
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function place() {
      const el = rootRef.current;
      const menu = menuRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = menu?.offsetWidth ?? rect.width;
      const height = menu?.offsetHeight ?? 280;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + 4;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : below;
      setMenuPos({ top, left, minWidth: rect.width });
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
  }, [open, groups, savedCustom]);

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

  return (
    <div ref={rootRef} className={`paint-product-select${open ? " paint-product-select--open" : ""}`}>
      <button
        type="button"
        className="paint-field-select paint-product-select-trigger"
        title={value || undefined}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((next) => !next)}
      >
        <span className={closedLabel ? undefined : "paint-product-select-placeholder"}>
          {closedLabel || "— Select product —"}
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          className="paint-product-select-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={
            menuPos
              ? { top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }
              : { visibility: "hidden" }
          }
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={!value ? "is-selected" : undefined}
            onClick={() => choose("")}
          >
            — Select product —
          </button>
          {groups.map((group) => (
            <div key={group.manufacturer}>
              <div className="paint-product-select-group">{group.manufacturer}</div>
              {group.items.map((item) => (
                <button
                  key={item.display}
                  type="button"
                  role="option"
                  aria-selected={item.display === value}
                  className={item.display === value ? "is-selected" : undefined}
                  title={item.display}
                  onClick={() => choose(item.display)}
                >
                  {item.product}
                </button>
              ))}
            </div>
          ))}
          {savedCustom ? (
            <button type="button" role="option" aria-selected className="is-selected" onClick={() => choose(value)}>
              {value} (saved)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
