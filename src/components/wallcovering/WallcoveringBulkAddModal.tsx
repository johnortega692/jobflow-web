import { useMemo, useState } from "react";
import { wcRowAutoLabel } from "../../lib/wcItemLabels";
import type { WallcoveringItem } from "../../types/tradeDocuments";
import { emptyWallcoveringItem } from "../../types/tradeDocuments";

type Props = {
  autoLabel: boolean;
  nextAutoLabelIndex: number;
  onAdd: (items: WallcoveringItem[], opts: { turnOffAutoLabel: boolean }) => void;
  onClose: () => void;
};

export function WallcoveringBulkAddModal({
  autoLabel,
  nextAutoLabelIndex,
  onAdd,
  onClose,
}: Props) {
  const [count, setCount] = useState("1");
  const [prefix, setPrefix] = useState("");
  const [startAt, setStartAt] = useState("1");
  const [manufacturer, setManufacturer] = useState("");
  const [product, setProduct] = useState("");
  const [color, setColor] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("LY");
  const [notes, setNotes] = useState("");
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
      firstLabel = wcRowAutoLabel(nextAutoLabelIndex);
      lastLabel = wcRowAutoLabel(nextAutoLabelIndex + num - 1);
    } else {
      firstLabel = String(start);
      lastLabel = String(start + num - 1);
    }
    const labelPart =
      num === 1 ? `Creates ${firstLabel}` : `Creates ${firstLabel} … ${lastLabel}`;
    const parts = [labelPart];
    if (manufacturer.trim()) parts.push(manufacturer.trim());
    if (product.trim()) parts.push(product.trim());
    if (color.trim()) parts.push(color.trim());
    if (qty.trim()) parts.push(`${qty.trim()} ${unit}`);
    return parts.join(" · ");
  }, [
    autoLabel,
    color,
    count,
    manufacturer,
    nextAutoLabelIndex,
    prefix,
    product,
    qty,
    startAt,
    unit,
  ]);

  function submit() {
    const num = parseInt(count, 10);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a positive number of items.");
      return;
    }
    const start = parseInt(startAt, 10) || 1;
    const usePrefix = prefix.trim().length > 0;
    const items: WallcoveringItem[] = [];
    for (let i = 0; i < num; i++) {
      let label: string;
      if (usePrefix) {
        label = `${prefix}${start + i}`;
      } else if (autoLabel) {
        label = wcRowAutoLabel(nextAutoLabelIndex + i);
      } else {
        label = String(start + i);
      }
      items.push({
        ...emptyWallcoveringItem(),
        label,
        manufacturer,
        product,
        color,
        qty: qty.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"),
        unit,
        notes,
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
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="W-" />
          </label>
          <label>
            Start at
            <input type="number" min={1} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </label>
        </div>

        <label>
          Manufacturer (applied to all)
          <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        </label>
        <label>
          Product (applied to all)
          <input value={product} onChange={(e) => setProduct(e.target.value)} />
        </label>
        <label>
          Color / Pattern (applied to all)
          <input value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <div className="row-gap">
          <label>
            Qty
            <input
              inputMode="decimal"
              value={qty}
              onChange={(e) =>
                setQty(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))
              }
            />
          </label>
          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {["LY", "SY", "RL", "EA"].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
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
