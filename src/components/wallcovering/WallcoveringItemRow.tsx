import type { DragEvent } from "react";
import { FLOOR_ORDER } from "../../lib/printCore";
import { isTrackInfillItem } from "../../lib/wcTrackInfill";
import type { WallcoveringItem } from "../../types/tradeDocuments";

const CONTENT_UNITS = ["LY", "SY", "RL", "EA"] as const;
const TRACK_UNITS = ["LF", "EA"] as const;

type Props = {
  item: WallcoveringItem;
  index: number;
  totalContent: number;
  showPreviousColor: boolean;
  autoLabel: boolean;
  showFloor: boolean;
  dragging: boolean;
  dragOver: boolean;
  onChange: (patch: Partial<WallcoveringItem>) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function qtyInputValue(raw: string): string {
  return raw.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

export function WallcoveringItemRow({
  item,
  index,
  totalContent,
  showPreviousColor,
  autoLabel,
  showFloor,
  dragging,
  dragOver,
  onChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: Props) {
  const isTrack = isTrackInfillItem(item);
  const missingMfr = !isTrack && !item.manufacturer.trim();
  const missingColor = !isTrack && !item.color.trim();
  const missingQty = !isTrack && !item.qty.trim();
  const unitOptions: readonly string[] = isTrack ? TRACK_UNITS : CONTENT_UNITS;
  const unitValue = unitOptions.includes(item.unit) ? item.unit : isTrack ? "LF" : "LY";

  return (
    <div
      className={`wc-item-block${isTrack ? " wc-item-block--track" : ""}${dragging ? " wc-item-block--dragging" : ""}${dragOver ? " wc-item-block--dragover" : ""}`}
      data-index={index}
      onDragOver={isTrack ? undefined : onDragOver}
      onDragLeave={isTrack ? undefined : onDragLeave}
      onDrop={
        isTrack
          ? undefined
          : (e) => {
              e.preventDefault();
              onDrop();
            }
      }
    >
      <div
        className={`wc-item-tier1${showPreviousColor ? " wc-item-tier1--substitution" : ""}`}
        role="row"
      >
        {isTrack ? (
          <span className="wc-row-handle-spacer" aria-hidden />
        ) : (
          <button
            type="button"
            className="wc-row-handle"
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
        )}

        <div className="wc-col wc-col-label" role="cell">
          {isTrack ? (
            <span className="wc-track-badge">TRACK</span>
          ) : (
            <input
              value={item.label}
              readOnly={autoLabel}
              className={autoLabel ? "readonly" : undefined}
              onChange={(e) => onChange({ label: e.target.value })}
              aria-label={`Label row ${index + 1}`}
            />
          )}
        </div>

        <div className="wc-col wc-col-mfr" role="cell">
          <input
            value={item.manufacturer}
            className={missingMfr ? "wc-field--warn" : undefined}
            title={missingMfr ? "⚠ Add manufacturer" : undefined}
            onChange={(e) => onChange({ manufacturer: e.target.value })}
            aria-label={`Manufacturer row ${index + 1}`}
            readOnly={isTrack}
          />
        </div>

        <div className="wc-col wc-col-product" role="cell">
          <input
            value={item.product}
            title={item.product || undefined}
            onChange={(e) => onChange({ product: e.target.value })}
            aria-label={`Product row ${index + 1}`}
            readOnly={isTrack}
          />
        </div>

        {showPreviousColor && !isTrack && (
          <div className="wc-col wc-col-prev" role="cell">
            <input
              value={item.previous_color}
              onChange={(e) => onChange({ previous_color: e.target.value })}
              aria-label={`Previous color row ${index + 1}`}
            />
          </div>
        )}

        <div className="wc-col wc-col-color" role="cell">
          <input
            value={isTrack ? "" : item.color}
            placeholder={isTrack ? "—" : missingColor ? "⚠ Color" : ""}
            className={missingColor ? "wc-field--warn" : undefined}
            title={missingColor ? "⚠ Add color / pattern" : undefined}
            disabled={isTrack}
            onChange={(e) => onChange({ color: e.target.value })}
            aria-label={`Color / pattern row ${index + 1}`}
          />
        </div>

        <div className="wc-row-actions" role="cell">
          {!isTrack && (
            <button
              type="button"
              className="btn btn-icon btn-small btn-danger-soft"
              disabled={totalContent <= 1}
              onClick={onRemove}
              title="Remove row"
              aria-label={`Remove row ${index + 1}`}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="wc-item-tier2" role="row">
        {isTrack ? (
          <>
            <p className="wc-track-hint muted small">Tracker sheet only — not printed on the submittal</p>
            <div className="wc-qty-group">
              <span className="wc-qty-prefix">Qty</span>
              <input
                className="wc-qty-input"
                inputMode="decimal"
                value={item.qty}
                onChange={(e) => onChange({ qty: qtyInputValue(e.target.value) })}
                aria-label="Track quantity"
              />
              <select
                className="wc-unit-select"
                value={unitValue}
                onChange={(e) => onChange({ unit: e.target.value })}
                aria-label="Track unit"
              >
                {TRACK_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div className="wc-col-notes">
              <input
                value={item.notes}
                placeholder="Notes"
                onChange={(e) => onChange({ notes: e.target.value })}
                aria-label="Track notes"
              />
            </div>
          </>
        ) : (
          <>
            <label className="wc-inline-check">
              <input
                type="checkbox"
                checked={item.order}
                onChange={(e) => onChange({ order: e.target.checked })}
              />
              Order
            </label>
            <label className="wc-inline-check">
              <input
                type="checkbox"
                checked={item.panels}
                onChange={(e) => onChange({ panels: e.target.checked })}
              />
              Panel
            </label>
            <label className="wc-inline-check">
              <input
                type="checkbox"
                checked={item.include_in_submittal}
                onChange={(e) => onChange({ include_in_submittal: e.target.checked })}
              />
              Submittal
            </label>
            {showFloor && (
              <label className="wc-inline-floor">
                <span>Floor</span>
                <select value={item.floor} onChange={(e) => onChange({ floor: e.target.value })}>
                  <option value="">—</option>
                  {FLOOR_ORDER.filter(Boolean).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className={`wc-qty-group${missingQty ? " wc-qty-group--warn" : ""}`}>
              <span className={`wc-qty-prefix${missingQty ? " wc-qty-prefix--warn" : ""}`}>Qty</span>
              <input
                className={`wc-qty-input${missingQty ? " wc-field--warn" : ""}`}
                inputMode="decimal"
                value={item.qty}
                placeholder={missingQty ? "⚠" : ""}
                title={missingQty ? "⚠ Add quantity" : undefined}
                onChange={(e) => onChange({ qty: qtyInputValue(e.target.value) })}
                aria-label={`Quantity row ${index + 1}`}
              />
              <select
                className="wc-unit-select"
                value={unitValue}
                onChange={(e) => onChange({ unit: e.target.value })}
                aria-label={`Unit row ${index + 1}`}
              >
                {CONTENT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div className="wc-col-notes">
              <input
                value={item.notes}
                placeholder="Notes"
                onChange={(e) => onChange({ notes: e.target.value })}
                aria-label={`Notes row ${index + 1}`}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
