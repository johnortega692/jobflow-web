import { useMemo, useState } from "react";
import { formatSubmittalHistoryLabel } from "../../lib/submittalHistory";
import type { SubmittalHistoryEntry } from "../../types/tradeDocuments";

type Props = {
  paintHistory: SubmittalHistoryEntry[];
  wcHistory: SubmittalHistoryEntry[];
  onAddPaint: (entry: SubmittalHistoryEntry, replace: boolean) => void;
  onAddWallcovering: (entry: SubmittalHistoryEntry, replace: boolean) => void;
  onClose: () => void;
};

export function TransmittalHistoryPickerModal({
  paintHistory,
  wcHistory,
  onAddPaint,
  onAddWallcovering,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"paint" | "wallcovering">(
    paintHistory.length ? "paint" : "wallcovering",
  );
  const history = tab === "paint" ? paintHistory : wcHistory;
  const sorted = useMemo(
    () => [...history].sort((a, b) => (b.submittal_number ?? 0) - (a.submittal_number ?? 0)),
    [history],
  );
  const [selected, setSelected] = useState(0);
  const entry = sorted[selected];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-history-modal"
        role="dialog"
        aria-labelledby="tx-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="tx-history-title">Submittal history</h3>
        <p className="muted small">Load saved submittal items into the transmittal enclosure list.</p>

        <div className="row-gap">
          <button
            type="button"
            className={`btn btn-small${tab === "paint" ? " btn-primary" : " btn-secondary"}`}
            onClick={() => {
              setTab("paint");
              setSelected(0);
            }}
          >
            Paint ({paintHistory.length})
          </button>
          <button
            type="button"
            className={`btn btn-small${tab === "wallcovering" ? " btn-primary" : " btn-secondary"}`}
            onClick={() => {
              setTab("wallcovering");
              setSelected(0);
            }}
          >
            Wallcovering ({wcHistory.length})
          </button>
        </div>

        {!sorted.length ? (
          <p className="muted">No saved {tab} submittals for this job.</p>
        ) : (
          <div className="paint-history-list" style={{ maxHeight: "14rem", overflow: "auto" }}>
            <ul>
              {sorted.map((h, i) => (
                <li key={h.submittal_number}>
                  <button
                    type="button"
                    className={`paint-history-item${i === selected ? " active" : ""}`}
                    onClick={() => setSelected(i)}
                  >
                    {formatSubmittalHistoryLabel(h)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="row-gap wrap">
          {entry && tab === "paint" && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => onAddPaint(entry, false)}>
                Append to enclosures
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => onAddPaint(entry, true)}>
                Replace enclosures
              </button>
            </>
          )}
          {entry && tab === "wallcovering" && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onAddWallcovering(entry, false)}
              >
                Append to enclosures
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onAddWallcovering(entry, true)}
              >
                Replace enclosures
              </button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
