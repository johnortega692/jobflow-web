import { useState } from "react";
import {
  formatTransmittalHistoryDetail,
  formatTransmittalHistoryLabel,
} from "../../lib/transmittalSendHistory";
import { normalizeTransmittal, type TransmittalHistoryEntry } from "../../types/tradeDocuments";

type Props = {
  history: TransmittalHistoryEntry[];
  onLoadSnapshot: (entry: TransmittalHistoryEntry) => void;
  onClose: () => void;
};

export function TransmittalSentHistoryModal({ history, onLoadSnapshot, onClose }: Props) {
  const [selectedId, setSelectedId] = useState(history[0]?.id ?? "");

  const selected = history.find((h) => h.id === selectedId);

  function onLoad() {
    if (!selected) return;
    if (
      !window.confirm(
        `Load transmittal ${selected.transmittal_number} into the current draft? Unsaved changes will be replaced.`,
      )
    ) {
      return;
    }
    onLoadSnapshot(selected);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal card stack transmittal-sent-history-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Transmittal history</h3>
        <p className="muted small">
          Past transmittals downloaded from this project. Select one to review details or reload into the draft.
        </p>
        {!history.length ? (
          <p className="muted">No transmittals generated yet.</p>
        ) : (
          <div className="transmittal-sent-history-body">
            <ul className="transmittal-sent-history-list" role="listbox">
              {history.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={entry.id === selectedId}
                    className={`transmittal-sent-history-item${entry.id === selectedId ? " selected" : ""}`}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    {formatTransmittalHistoryLabel(entry)}
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <div className="transmittal-sent-history-detail muted small">
                <pre className="transmittal-sent-history-pre">{formatTransmittalHistoryDetail(selected)}</pre>
                <p>
                  <strong>Remarks:</strong> {selected.snapshot.remarks.trim() || "—"}
                </p>
                <p>
                  <strong>To:</strong> {selected.snapshot.to_name.trim() || "—"}
                  {selected.snapshot.gc_name.trim() ? ` · ${selected.snapshot.gc_name.trim()}` : ""}
                </p>
              </div>
            )}
          </div>
        )}
        <div className="row-gap wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected}
            onClick={onLoad}
          >
            Load into draft
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function transmittalFromHistoryEntry(entry: TransmittalHistoryEntry) {
  return normalizeTransmittal(entry.snapshot);
}
