import { useEffect, useMemo, useState } from "react";
import { brushoutColorLine } from "../../lib/paintBrushouts";
import {
  brushoutImportLineDetail,
  defaultApprovedBrushoutImportSelection,
  pickDefaultBrushoutImportSourceId,
  type ApprovedBrushoutDraft,
  type BrushoutImportLineStatus,
  type BrushoutImportSource,
} from "../../lib/approvedBrushouts";
import type { PaintItem } from "../../types/tradeDocuments";

type Props = {
  sources: BrushoutImportSource[];
  existingRows: ApprovedBrushoutDraft[];
  busy?: boolean;
  onConfirm: (items: PaintItem[]) => void;
  onClose: () => void;
};

function statusClass(status: BrushoutImportLineStatus): string {
  if (status === "on_list") return "brushout-status-pill brushout-status-pill--added";
  if (status === "revised") return "brushout-status-pill brushout-status-pill--revised";
  return "brushout-status-pill brushout-status-pill--import-new";
}

function statusLabel(status: BrushoutImportLineStatus, previousColor: string): string {
  if (status === "on_list") return "Already added";
  if (status === "revised") return previousColor ? `Revised · was ${previousColor}` : "Revised";
  return "New";
}

export function ImportApprovedBrushoutsModal({
  sources,
  existingRows,
  busy = false,
  onConfirm,
  onClose,
}: Props) {
  const [sourceId, setSourceId] = useState(() => pickDefaultBrushoutImportSourceId(sources, existingRows));
  const activeSource = sources.find((s) => s.id === sourceId) ?? sources[0];
  const items = activeSource?.items ?? [];

  const rows = useMemo(
    () =>
      items.map((item, index) => {
        const detail = brushoutImportLineDetail(item, existingRows);
        return {
          index,
          item,
          line: brushoutColorLine(item),
          status: detail.status,
          previousColor: detail.previousColor,
        };
      }),
    [items, existingRows],
  );

  const colorRows = rows.filter((r) => r.line);
  const newCount = colorRows.filter((r) => r.status === "new").length;
  const revisedCount = colorRows.filter((r) => r.status === "revised").length;
  const availableCount = newCount + revisedCount;
  const allAlreadyAdded = colorRows.length > 0 && availableCount === 0;

  const [selected, setSelected] = useState<Set<number>>(() =>
    defaultApprovedBrushoutImportSelection(items, existingRows),
  );

  useEffect(() => {
    const nextItems = sources.find((s) => s.id === sourceId)?.items ?? sources[0]?.items ?? [];
    setSelected(defaultApprovedBrushoutImportSelection(nextItems, existingRows));
  }, [sourceId, sources, existingRows]);

  function toggle(index: number) {
    const row = colorRows.find((r) => r.index === index);
    if (!row || row.status === "on_list") return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectPreset(mode: "new" | "revised" | "available") {
    if (mode === "available") {
      setSelected(new Set(colorRows.filter((r) => r.status !== "on_list").map((r) => r.index)));
      return;
    }
    if (mode === "revised") {
      setSelected(new Set(colorRows.filter((r) => r.status === "revised").map((r) => r.index)));
      return;
    }
    setSelected(new Set(colorRows.filter((r) => r.status === "new").map((r) => r.index)));
  }

  const selectedCount = colorRows.filter((r) => r.status !== "on_list" && selected.has(r.index)).length;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack brushouts-send-modal"
        role="dialog"
        aria-labelledby="import-approved-brushouts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="import-approved-brushouts-title">Import from paint submittal</h3>
        <p className="muted small">
          Choose a saved submittal package, then pick which colors to add. The paint tab may only show the latest
          revision — use history for earlier batches (e.g. Original with 5 colors).
        </p>

        {sources.length > 1 ? (
          <label className="stack gap-xs">
            <span className="label">Import from</span>
            <select
              className="input"
              value={sourceId}
              disabled={busy}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
        ) : activeSource ? (
          <p className="muted small">
            Source: <strong>{activeSource.label}</strong>
          </p>
        ) : null}

        {allAlreadyAdded ? (
          <div className="brushouts-import-empty">
            <p className="brushouts-import-empty-title">
              All {colorRows.length} colors are already on the list
            </p>
            <p className="muted small">
              Pick an earlier revision above to pull colors that were dropped or changed.
            </p>
          </div>
        ) : (
          <>
            {colorRows.length > 0 ? (
              <div className="row-gap wrap brushouts-send-presets">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || newCount === 0}
                  onClick={() => selectPreset("new")}
                >
                  New only ({newCount})
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || revisedCount === 0}
                  onClick={() => selectPreset("revised")}
                >
                  Revised only ({revisedCount})
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || availableCount === 0}
                  onClick={() => selectPreset("available")}
                >
                  Select all available
                </button>
              </div>
            ) : null}

            <div className="brushouts-send-list" role="list">
              {!sources.length ? (
                <p className="muted small">No paint colors found on the paint tab or in submittal history.</p>
              ) : colorRows.length === 0 ? (
                <p className="muted small">This package has no lines with colors.</p>
              ) : (
                colorRows.map(({ index, line, status, previousColor }) => (
                  <label
                    key={`${sourceId}-${index}`}
                    className={`brushouts-send-row check${status === "on_list" ? " is-added" : ""}`}
                    role="listitem"
                  >
                    <input
                      type="checkbox"
                      checked={status === "on_list" || selected.has(index)}
                      disabled={busy || status === "on_list"}
                      onChange={() => toggle(index)}
                    />
                    <span className="brushouts-send-row-main">
                      <span className="brushouts-send-color">{line}</span>
                    </span>
                    <span className={statusClass(status)}>{statusLabel(status, previousColor)}</span>
                  </label>
                ))
              )}
            </div>
          </>
        )}

        <div className="row-gap wrap">
          {allAlreadyAdded ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || selectedCount === 0}
                onClick={() =>
                  onConfirm(
                    colorRows.filter((r) => r.status !== "on_list" && selected.has(r.index)).map((r) => r.item),
                  )
                }
              >
                {busy ? "Adding…" : `Add ${selectedCount} to list`}
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
