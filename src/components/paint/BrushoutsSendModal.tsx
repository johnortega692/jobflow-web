import { useMemo, useState } from "react";
import {
  BRUSHOUT_LINE_STATUS_LABEL,
  brushoutColorLine,
  brushoutLineStatus,
  defaultBrushoutSelection,
  type BrushoutLineStatus,
} from "../../lib/paintBrushouts";
import { PAINT_VENDOR_OPTIONS, type PaintItem } from "../../types/tradeDocuments";

type Props = {
  items: PaintItem[];
  pushed: Record<string, string> | undefined;
  initialVendor: string;
  busy?: boolean;
  onConfirm: (vendor: string, selectedIndices: number[]) => void;
  onClose: () => void;
};

function statusClass(status: BrushoutLineStatus): string {
  if (status === "on_sheet") return "brushout-status-pill brushout-status-pill--on-sheet";
  if (status === "revised") return "brushout-status-pill brushout-status-pill--revised";
  if (status === "new") return "brushout-status-pill brushout-status-pill--new";
  return "brushout-status-pill brushout-status-pill--pending";
}

export function BrushoutsSendModal({
  items,
  pushed,
  initialVendor,
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  const rows = useMemo(
    () =>
      items.map((item, index) => ({
        index,
        item,
        line: brushoutColorLine(item),
        status: brushoutLineStatus(item, pushed),
      })),
    [items, pushed],
  );

  const colorRows = rows.filter((r) => r.line);

  const [vendor, setVendor] = useState(
    PAINT_VENDOR_OPTIONS.includes(initialVendor as (typeof PAINT_VENDOR_OPTIONS)[number])
      ? initialVendor
      : "PPG",
  );
  const [selected, setSelected] = useState<Set<number>>(() =>
    defaultBrushoutSelection(items, pushed),
  );

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectPreset(mode: "not_on_sheet" | "revised" | "all") {
    if (mode === "all") {
      setSelected(new Set(colorRows.map((r) => r.index)));
      return;
    }
    if (mode === "revised") {
      setSelected(new Set(colorRows.filter((r) => r.status === "revised").map((r) => r.index)));
      return;
    }
    setSelected(new Set(colorRows.filter((r) => r.status !== "on_sheet").map((r) => r.index)));
  }

  const selectedCount = colorRows.filter((r) => selected.has(r.index)).length;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack brushouts-send-modal"
        role="dialog"
        aria-labelledby="brushouts-send-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="brushouts-send-title">Push to BrushOuts</h3>
        <p className="muted small">
          Select colors to send. Merge mode updates matching label/floor slots on the same job row and
          appends new lines — previous waves stay on the sheet.
        </p>

        <label>
          Paint vendor
          <select value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={busy}>
            {PAINT_VENDOR_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <div className="row-gap wrap brushouts-send-presets">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => selectPreset("not_on_sheet")}>
            Not on sheet
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => selectPreset("revised")}>
            Revised only
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => selectPreset("all")}>
            Select all
          </button>
        </div>

        <div className="brushouts-send-list" role="list">
          {colorRows.length === 0 && (
            <p className="muted small">No paint lines with colors yet. Add colors before pushing.</p>
          )}
          {colorRows.map(({ index, item, line, status }) => (
            <label key={index} className="brushouts-send-row check" role="listitem">
              <input
                type="checkbox"
                checked={selected.has(index)}
                disabled={busy}
                onChange={() => toggle(index)}
              />
              <span className="brushouts-send-row-main">
                <span className="brushouts-send-label">
                  {item.label.trim() || `Row ${index + 1}`}
                  {item.floor.trim() ? ` · ${item.floor.trim()}` : ""}
                </span>
                <span className="brushouts-send-color muted small">{line}</span>
              </span>
              <span className={statusClass(status)}>{BRUSHOUT_LINE_STATUS_LABEL[status]}</span>
            </label>
          ))}
        </div>

        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-warning"
            disabled={busy || selectedCount === 0}
            onClick={() =>
              onConfirm(
                vendor,
                colorRows.filter((r) => selected.has(r.index)).map((r) => r.index),
              )
            }
          >
            {busy ? "Sending…" : `Push ${selectedCount} to BrushOuts`}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
