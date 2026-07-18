import { useMemo } from "react";
import {
  compactSheenLabel,
  extractManufacturerFromDisplay,
  extractProductName,
  groupProductsForSelect,
  manufacturerForProduct,
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
  const savedCustom = value && !options.includes(value);

  return (
    <select
      className={["paint-field-select", className].filter(Boolean).join(" ")}
      value={value}
      title={value || emptyTitle || emptyLabel || undefined}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    >
      <option value="">{emptyLabel}</option>
      {options.map((s) => (
        <option key={s} value={s} title={s}>
          {compactSheenLabel(s)}
        </option>
      ))}
      {savedCustom && (
        <option value={value} title={value}>
          {compactSheenLabel(value)} (saved)
        </option>
      )}
    </select>
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
