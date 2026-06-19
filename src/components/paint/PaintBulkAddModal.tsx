import { useState } from "react";
import { extractProductName } from "../../lib/paintCatalog";
import type { PaintItem } from "../../types/tradeDocuments";

type Props = {
  productOptions: string[];
  sheenOptions: string[];
  onAdd: (items: PaintItem[]) => void;
  onClose: () => void;
};

export function PaintBulkAddModal({ productOptions, sheenOptions, onAdd, onClose }: Props) {
  const [count, setCount] = useState("1");
  const [prefix, setPrefix] = useState("");
  const [startAt, setStartAt] = useState("1");
  const [product, setProduct] = useState("");
  const [sheen, setSheen] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const num = parseInt(count, 10);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a positive number of items.");
      return;
    }
    const productName = extractProductName(product);
    if (!productName || !sheen.trim()) {
      setError("Select both product and sheen.");
      return;
    }
    const start = parseInt(startAt, 10) || 1;
    const items: PaintItem[] = [];
    for (let i = 0; i < num; i++) {
      const label = prefix ? `${prefix}${start + i}` : String(start + i);
      items.push({
        label,
        floor: "",
        manufacturer: "",
        color: "",
        product: productName,
        sheen: sheen.trim(),
        previous_color: "",
      });
    }
    onAdd(items);
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
        <p className="muted small">e.g. prefix &quot;P-&quot; → P-1, P-2…</p>

        <label>
          Product
          <input
            list="bulk-product-list"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="Speed Hide Zero (PPG)"
          />
          <datalist id="bulk-product-list">
            {productOptions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>

        <label>
          Sheen
          <input list="bulk-sheen-list" value={sheen} onChange={(e) => setSheen(e.target.value)} />
          <datalist id="bulk-sheen-list">
            {sheenOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

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
