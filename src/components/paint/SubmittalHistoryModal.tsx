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
  currentSubmittalNumber?: number;
  currentRevisionNumber?: number;
  onLoadPaint?: (items: PaintItem[], replace: boolean) => void;
  onLoadWallcovering?: (items: WallcoveringItem[], replace: boolean) => void;
  onLoadFrp?: (items: FrpItem[], replace: boolean) => void;
  onOpenPackage?: (entry: SubmittalHistoryEntry) => void;
  onDelete: (submittalNumber: number, revisionNumber: number) => void;
  onClose: () => void;
};

export function SubmittalHistoryModal({
  scope,
  jobNumber,
  jobName,
  history,
  currentSubmittalNumber,
  currentRevisionNumber,
  onLoadPaint,
  onLoadWallcovering,
  onLoadFrp,
  onOpenPackage,
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
  const currentIdx = sorted.findIndex(
    (h) =>
      currentSubmittalNumber != null &&
      h.submittal_number === currentSubmittalNumber &&
      (h.revision_number ?? 0) === (currentRevisionNumber ?? 0),
  );
  const [selected, setSelected] = useState(() => (currentIdx >= 0 ? currentIdx : 0));
  const activeIdx = selected < sorted.length ? selected : 0;
  const entry = sorted[activeIdx];
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
            No saved {scopeLabel.toLowerCase()} submittals for this job yet. Issue a package, or start
            a new package after adding items — both keep a record you can open later.
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
            <p className="muted small">Includes the package currently open on the tab.</p>
            <ul>
              {sorted.map((h, i) => {
                const isCurrent =
                  currentSubmittalNumber != null &&
                  h.submittal_number === currentSubmittalNumber &&
                  (h.revision_number ?? 0) === (currentRevisionNumber ?? 0);
                return (
                <li key={`${h.submittal_number}-${h.revision_number ?? 0}`}>
                  <button
                    type="button"
                    className={`paint-history-item${i === activeIdx ? " active" : ""}`}
                    onClick={() => setSelected(i)}
                  >
                    {formatSubmittalHistoryLabel(h)}
                    {isCurrent ? " · current" : ""}
                  </button>
                </li>
                );
              })}
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

        <p className="muted small paint-history-load-hint">
          {scope === "wallcovering" ? (
            <>
              <strong>Load to wallcovering tab</strong> adds these saved items onto the package you are
              editing. <strong>Replace wallcovering tab</strong> removes the current items and uses only
              this list. Neither changes the submittal number
              {onOpenPackage ? (
                <>
                  {" "}
                  — use <strong>Open this package</strong> to switch to this record
                </>
              ) : null}
              .
            </>
          ) : scope === "paint" ? (
            <>
              <strong>Load to paint tab</strong> adds these saved items onto the package you are editing.{" "}
              <strong>Replace paint tab</strong> removes the current items and uses only this list.
            </>
          ) : (
            <>
              <strong>Load to FRP tab</strong> adds these saved items onto the package you are editing.{" "}
              <strong>Replace FRP tab</strong> removes the current items and uses only this list.
            </>
          )}
        </p>
        <div className="row-gap wrap">
          {onOpenPackage && entry ? (
            <button type="button" className="btn btn-primary" onClick={() => onOpenPackage(entry)}>
              Open this package
            </button>
          ) : null}
          {scope === "paint" && onLoadPaint && (
            <>
              <button
                type="button"
                className={onOpenPackage ? "btn btn-secondary" : "btn btn-primary"}
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
                className={onOpenPackage ? "btn btn-secondary" : "btn btn-primary"}
                title="Add these saved items onto the package currently open on the Wallcovering tab"
                onClick={() => entry && onLoadWallcovering(entry.items as WallcoveringItem[], false)}
              >
                Load to wallcovering tab
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                title="Clear the Wallcovering tab items and use only this saved list"
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
                className={onOpenPackage ? "btn btn-secondary" : "btn btn-primary"}
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
