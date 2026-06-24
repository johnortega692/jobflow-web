import { useMemo, useState } from "react";
import type {
  FrpItem,
  PaintItem,
  SubmittalHistoryEntry,
  WallcoveringItem,
} from "../../types/tradeDocuments";
import { formatSubmittalHistoryLabel } from "../../lib/submittalHistory";
import type { SubmittalScope } from "../../lib/submittalHistory";

type Props = {
  scope: SubmittalScope;
  jobNumber: string;
  jobName: string;
  history: SubmittalHistoryEntry[];
  onLoadPaint?: (items: PaintItem[], replace: boolean) => void;
  onLoadWallcovering?: (items: WallcoveringItem[], replace: boolean) => void;
  onLoadFrp?: (items: FrpItem[], replace: boolean) => void;
  onDelete: (submittalNumber: number, revisionNumber: number) => void;
  onClose: () => void;
};

export function SubmittalHistoryModal({
  scope,
  jobNumber,
  jobName,
  history,
  onLoadPaint,
  onLoadWallcovering,
  onLoadFrp,
  onDelete,
  onClose,
}: Props) {
  const sorted = useMemo(
    () =>
      [...history].sort((a, b) => {
        const numDiff = (b.submittal_number ?? 0) - (a.submittal_number ?? 0);
        if (numDiff !== 0) return numDiff;
        return (b.revision_number ?? 0) - (a.revision_number ?? 0);
      }),
    [history],
  );
  const [selected, setSelected] = useState(0);
  const entry = sorted[selected];
  const scopeLabel =
    scope === "paint" ? "Paint" : scope === "wallcovering" ? "Wallcovering" : "FRP";

  function confirmDelete() {
    if (!entry) return;
    if (
      !window.confirm(
        `Remove Submittal #${entry.submittal_number} Rev ${entry.revision_number ?? 0} from history for job ${jobNumber}? This cannot be undone.`,
      )
    ) {
      return;
    }
    onDelete(entry.submittal_number, entry.revision_number ?? 0);
    if (sorted.length <= 1) onClose();
    else setSelected(0);
  }

  if (!sorted.length) {
    return (
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
          <h3>Submittal history</h3>
          <p className="muted">
            No saved {scopeLabel.toLowerCase()} submittals for this job yet. History is saved when you
            print a submittal PDF.
          </p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack paint-history-modal"
        role="dialog"
        aria-labelledby="history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="history-title">{scopeLabel} submittal history</h3>
        <p className="muted small">
          Job {jobNumber} — {jobName}
        </p>

        <div className="paint-history-body">
          <div className="paint-history-list">
            <p className="paint-col-head">Saved submittals</p>
            <ul>
              {sorted.map((h, i) => (
                <li key={`${h.submittal_number}-${h.revision_number ?? 0}`}>
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

          <div className="paint-history-detail">
            <p className="paint-col-head">Items in selected submittal</p>
            {entry?.revision_note ? (
              <p className="muted small">
                <strong>Revision note:</strong> {entry.revision_note}
              </p>
            ) : null}
            <div className="table-wrap">
              {scope === "paint" ? (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Floor</th>
                      <th>Prev</th>
                      <th>Color</th>
                      <th>Product</th>
                      <th>Sheen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((entry?.items ?? []) as PaintItem[]).map((item, i) => (
                      <tr key={i}>
                        <td>{item.label}</td>
                        <td>{item.floor}</td>
                        <td>{item.previous_color}</td>
                        <td>{item.color}</td>
                        <td>{item.product}</td>
                        <td>{item.sheen}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : scope === "wallcovering" ? (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Floor</th>
                      <th>Mfr</th>
                      <th>Product</th>
                      <th>Color</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((entry?.items ?? []) as WallcoveringItem[]).map((item, i) => (
                      <tr key={i}>
                        <td>{item.label}</td>
                        <td>{item.floor}</td>
                        <td>{item.manufacturer}</td>
                        <td>{item.product}</td>
                        <td>{item.color}</td>
                        <td>{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Manufacturer</th>
                      <th>Product</th>
                      <th>Color</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((entry?.items ?? []) as FrpItem[]).map((item, i) => (
                      <tr key={i}>
                        <td>{item.label}</td>
                        <td>{item.manufacturer}</td>
                        <td>{item.product}</td>
                        <td>{item.color}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="row-gap wrap">
          {scope === "paint" && onLoadPaint && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => entry && onLoadPaint(entry.items as PaintItem[], false)}
              >
                Load to paint tab
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => entry && onLoadPaint(entry.items as PaintItem[], true)}
              >
                Replace paint tab
              </button>
            </>
          )}
          {scope === "wallcovering" && onLoadWallcovering && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => entry && onLoadWallcovering(entry.items as WallcoveringItem[], false)}
              >
                Load to wallcovering tab
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => entry && onLoadWallcovering(entry.items as WallcoveringItem[], true)}
              >
                Replace wallcovering tab
              </button>
            </>
          )}
          {scope === "frp" && onLoadFrp && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => entry && onLoadFrp(entry.items as FrpItem[], false)}
              >
                Load to FRP tab
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => entry && onLoadFrp(entry.items as FrpItem[], true)}
              >
                Replace FRP tab
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost btn-danger-soft" onClick={confirmDelete}>
            Delete
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
