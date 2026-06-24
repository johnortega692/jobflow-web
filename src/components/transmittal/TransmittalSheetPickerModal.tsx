import { useState } from "react";
import {
  formatSubmittalHistoryLabel,
  isLockedPackageStatus,
  latestHistoryEntryPerPackage,
  normalizeHistoryEntry,
} from "../../lib/submittalHistory";
import type { SubmittalHistoryEntry } from "../../types/tradeDocuments";

type Props = {
  scope: "paint" | "wallcovering" | "frp";
  history: SubmittalHistoryEntry[];
  selected: number[];
  onSave: (nums: number[]) => void;
  onClose: () => void;
};

export function TransmittalSheetPickerModal({ scope, history, selected, onSave, onClose }: Props) {
  const [picked, setPicked] = useState<Set<number>>(new Set(selected));
  const label = scope === "paint" ? "Paint" : scope === "wallcovering" ? "Wallcovering" : "FRP";
  const packages = latestHistoryEntryPerPackage(history);

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
          Select which {label.toLowerCase()} submittal numbers to append when combining the PDF. Issued
          revisions are preferred; the live tab draft is used if nothing is issued yet.
        </p>
        {!packages.length ? (
          <p className="muted">No saved {label.toLowerCase()} submittals yet — save the {label} tab first.</p>
        ) : (
          <ul className="transmittal-sheet-pick-list">
            {packages.map((h) => {
              const normalized = normalizeHistoryEntry(h);
              const issued = isLockedPackageStatus(normalized.issue_status);
              return (
                <li key={`${h.submittal_number}-${h.revision_number ?? 0}`}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={picked.has(h.submittal_number)}
                      onChange={() => toggle(h.submittal_number)}
                    />
                    {formatSubmittalHistoryLabel(h)}
                    {!issued ? (
                      <span className="transmittal-sheet-pick-draft muted small"> · draft</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
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
