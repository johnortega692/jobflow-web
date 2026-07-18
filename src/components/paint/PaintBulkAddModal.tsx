import { useMemo, useState } from "react";
import {
  extractProductName,
  formatSheenLabel,
  manufacturerForProduct,
  type PaintProduct,
} from "../../lib/paintCatalog";
import { paintRowAutoLabel } from "../../lib/paintItemLabels";
import type { PaintItem } from "../../types/tradeDocuments";
import { emptyPaintItem } from "../../types/tradeDocuments";
import { PaintProductSelect, PaintSheenSelect } from "./PaintFieldSelects";

type Props = {
  products: PaintProduct[];
  sheenOptions: string[];
  autoLabel: boolean;
  /** Next A/B/C index when auto-label is on (usually current item count). */
  nextAutoLabelIndex: number;
  onAdd: (items: PaintItem[], opts: { turnOffAutoLabel: boolean }) => void;
  onClose: () => void;
};

export function PaintBulkAddModal({
  products,
  sheenOptions,
  autoLabel,
  nextAutoLabelIndex,
  onAdd,
  onClose,
}: Props) {
  const [count, setCount] = useState("1");
  const [prefix, setPrefix] = useState("");
  const [startAt, setStartAt] = useState("1");
  const [productDisplay, setProductDisplay] = useState("");
  const [productName, setProductName] = useState("");
  const [sheen, setSheen] = useState("");
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const num = parseInt(count, 10);
    if (!Number.isFinite(num) || num <= 0) return null;
    const start = parseInt(startAt, 10) || 1;
    const usePrefix = prefix.trim().length > 0;
    let firstLabel: string;
    let lastLabel: string;
    if (usePrefix) {
      firstLabel = `${prefix}${start}`;
      lastLabel = `${prefix}${start + num - 1}`;
    } else if (autoLabel) {
      firstLabel = paintRowAutoLabel(nextAutoLabelIndex);
      lastLabel = paintRowAutoLabel(nextAutoLabelIndex + num - 1);
    } else {
      firstLabel = String(start);
      lastLabel = String(start + num - 1);
    }
    const labelPart =
      num === 1 ? `Creates ${firstLabel}` : `Creates ${firstLabel} … ${lastLabel}`;
    const parts = [labelPart];
    const name = productName || extractProductName(productDisplay);
    if (name) parts.push(name);
    if (sheen.trim()) parts.push(formatSheenLabel(sheen.trim()));
    return parts.join(" · ");
  }, [autoLabel, count, nextAutoLabelIndex, prefix, productDisplay, productName, sheen, startAt]);

  function submit() {
    const num = parseInt(count, 10);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a positive number of items.");
      return;
    }
    const name = productName || extractProductName(productDisplay);
    const mfr = name ? manufacturerForProduct(products, name) : "";
    const start = parseInt(startAt, 10) || 1;
    const usePrefix = prefix.trim().length > 0;
    const items: PaintItem[] = [];
    for (let i = 0; i < num; i++) {
      let label: string;
      if (usePrefix) {
        label = `${prefix}${start + i}`;
      } else if (autoLabel) {
        label = paintRowAutoLabel(nextAutoLabelIndex + i);
      } else {
        label = String(start + i);
      }
      items.push({
        ...emptyPaintItem(),
        label,
        manufacturer: mfr,
        product: name,
        sheen: sheen.trim(),
      });
    }
    onAdd(items, { turnOffAutoLabel: usePrefix });
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-bulk-add"
        role="dialog"
        aria-labelledby="bulk-add-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="bulk-add-title">Add multiple items</h3>

        <label>
          Number of items
          <input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>

        <div className="row-gap">
          <label className="flex-1">
            Label prefix
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="P-" />
          </label>
          <label>
            Start at
            <input type="number" min={1} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </label>
        </div>

        <label>
          Product (applied to all)
          <PaintProductSelect
            value={productDisplay}
            products={products}
            onChange={(name, _mfr, display) => {
              setProductName(name);
              setProductDisplay(display);
            }}
          />
        </label>

        <label>
          Sheen (applied to all)
          <PaintSheenSelect value={sheen} options={sheenOptions} onChange={setSheen} />
        </label>

        {preview && <p className="muted small paint-bulk-preview">{preview}</p>}

        {error && <div className="banner banner-error">{error}</div>}

        <div className="row-gap">
          <button type="button" className="btn btn-primary" onClick={submit}>
            Add items
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
