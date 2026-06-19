import { useState } from "react";
import { formatSubmittalHistoryLabel } from "../../lib/submittalHistory";
import type { SubmittalHistoryEntry } from "../../types/tradeDocuments";

type Props = {
  scope: "paint" | "wallcovering";
  history: SubmittalHistoryEntry[];
  selected: number[];
  onSave: (nums: number[]) => void;
  onClose: () => void;
};

export function TransmittalSheetPickerModal({ scope, history, selected, onSave, onClose }: Props) {
  const [picked, setPicked] = useState<Set<number>>(new Set(selected));
  const label = scope === "paint" ? "Paint" : "Wallcovering";

  function toggle(n: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <h3>Choose {label} submittal sheet(s)</h3>
        <p className="muted small">
          Select which saved {label.toLowerCase()} submittal numbers to reference when generating the
          transmittal package.
        </p>
        {!history.length ? (
          <p className="muted">No saved {label.toLowerCase()} submittals yet.</p>
        ) : (
          <ul className="transmittal-sheet-pick-list">
            {[...history]
              .sort((a, b) => (b.submittal_number ?? 0) - (a.submittal_number ?? 0))
              .map((h) => (
                <li key={h.submittal_number}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={picked.has(h.submittal_number)}
                      onChange={() => toggle(h.submittal_number)}
                    />
                    {formatSubmittalHistoryLabel(h)}
                  </label>
                </li>
              ))}
          </ul>
        )}
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSave([...picked].sort((a, b) => a - b))}
          >
            Save selection
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
