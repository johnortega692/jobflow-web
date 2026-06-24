import { useState } from "react";
import { PAINT_VENDOR_OPTIONS } from "../../types/tradeDocuments";

type Action = "add" | "copy";

type Props = {
  action: Action;
  initialVendor: string;
  busy?: boolean;
  onConfirm: (vendor: string) => void;
  onClose: () => void;
};

export function BrushoutsVendorModal({
  action,
  initialVendor,
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  const [vendor, setVendor] = useState(
    PAINT_VENDOR_OPTIONS.includes(initialVendor as (typeof PAINT_VENDOR_OPTIONS)[number])
      ? initialVendor
      : "PPG",
  );

  const title = action === "add" ? "Add to BrushOuts" : "Copy BrushOuts row";
  const confirmLabel = action === "add" ? (busy ? "Sending…" : "Add BrushOuts") : "Copy";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack"
        role="dialog"
        aria-labelledby="brushouts-vendor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="brushouts-vendor-title">{title}</h3>
        <p className="muted small">
          Choose the paint vendor for this brush-out row. It is included in the sheet export.
        </p>
        <label>
          Paint vendor
          <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            {PAINT_VENDOR_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="row-gap wrap">
          <button
            type="button"
            className={`btn ${action === "add" ? "btn-warning" : "btn-primary"}`}
            disabled={busy}
            onClick={() => onConfirm(vendor)}
          >
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
