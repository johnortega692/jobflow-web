import { useMemo } from "react";
import {
  extractManufacturerFromDisplay,
  extractProductName,
  formatSheenLabel,
  groupProductsForSelect,
  manufacturerForProduct,
  type PaintProduct,
} from "../../lib/paintCatalog";

export function PaintSheenSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (sheen: string) => void;
  ariaLabel?: string;
}) {
  const savedCustom = value && !options.includes(value);

  return (
    <select
      className="paint-field-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    >
      <option value="">— Select sheen —</option>
      {options.map((s) => (
        <option key={s} value={s}>
          {formatSheenLabel(s)}
        </option>
      ))}
      {savedCustom && (
        <option value={value}>{formatSheenLabel(value)} (saved)</option>
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
      className="paint-field-select"
      value={value}
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
            <option key={item.display} value={item.display}>
              {item.product}
            </option>
          ))}
        </optgroup>
      ))}
      {savedCustom && (
        <option value={value}>{extractProductName(value)} (saved)</option>
      )}
    </select>
  );
}
