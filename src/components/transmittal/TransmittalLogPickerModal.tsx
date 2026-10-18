import { useState } from "react";
import type { SubmittalLogRow } from "../../types/submittalLog";

type Props = {
  rows: SubmittalLogRow[];
  labelFor: (row: SubmittalLogRow) => string;
  onAdd: (rows: SubmittalLogRow[]) => void;
  onClose: () => void;
};

export function TransmittalLogPickerModal({ rows, labelFor, onAdd, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((row) => row.id)));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selected = rows.filter((row) => picked.has(row.id));
  const allOn = rows.length > 0 && selected.length === rows.length;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack"
        role="dialog"
        aria-labelledby="transmittal-log-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="transmittal-log-picker-title">From the submittal log</h3>
        <p className="muted small">Select the Ready log rows to add as enclosures.</p>
        {!rows.length ? (
          <p className="muted">No Ready log rows are waiting to be added.</p>
        ) : (
          <ul className="transmittal-sheet-pick-list">
            <li>
              <label className="check">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((row) => row.id)))}
                />
                Select all
              </label>
            </li>
            {rows.map((row) => (
              <li key={row.id}>
                <label className="check">
                  <input type="checkbox" checked={picked.has(row.id)} onChange={() => toggle(row.id)} />
                  {labelFor(row)}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected.length}
            onClick={() => onAdd(selected)}
          >
            Add selected
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
