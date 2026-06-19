import { useState } from "react";
import type { WallcoveringItem } from "../../types/tradeDocuments";
import { emptyWallcoveringItem } from "../../types/tradeDocuments";

type Props = {
  onAdd: (items: WallcoveringItem[]) => void;
  onClose: () => void;
};

export function WallcoveringBulkAddModal({ onAdd, onClose }: Props) {
  const [count, setCount] = useState("1");
  const [prefix, setPrefix] = useState("WC-");
  const [startAt, setStartAt] = useState("1");
  const [manufacturer, setManufacturer] = useState("");
  const [product, setProduct] = useState("");
  const [color, setColor] = useState("");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const num = parseInt(count, 10);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a positive number of items.");
      return;
    }
    const start = parseInt(startAt, 10) || 1;
    const items: WallcoveringItem[] = [];
    for (let i = 0; i < num; i++) {
      const label = prefix ? `${prefix}${start + i}` : String(start + i);
      items.push({
        ...emptyWallcoveringItem(),
        label,
        manufacturer,
        product,
        color,
        qty,
        notes,
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
        aria-labelledby="wc-bulk-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="wc-bulk-title">Add multiple wallcovering items</h3>

        <label>
          Number of items
          <input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>

        <div className="row-gap">
          <label className="flex-1">
            Label prefix
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="WC-" />
          </label>
          <label>
            Start at
            <input type="number" min={1} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </label>
        </div>
        <p className="muted small">e.g. prefix &quot;WC-&quot; → WC-1, WC-2…</p>

        <label>
          Manufacturer
          <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        </label>
        <label>
          Product
          <input value={product} onChange={(e) => setProduct(e.target.value)} />
        </label>
        <label>
          Color
          <input value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <div className="row-gap">
          <label className="flex-1">
            QTY
            <input value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="flex-1">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

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
