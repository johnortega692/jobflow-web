import { useState } from "react";
import type { BrushoutPrepLink, PaintItem } from "../../types/tradeDocuments";
import type { BrushoutPrepRecord } from "../../lib/paintUserSettings";

type Props = {
  preps: BrushoutPrepRecord[];
  onImport: (items: PaintItem[], replace: boolean, link: BrushoutPrepLink) => void;
  onClose: () => void;
};

function prepToPaintItems(prep: BrushoutPrepRecord): PaintItem[] {
  return (prep.paint_items ?? []).map((item) => ({
    label: item.label ?? "",
    floor: item.floor ?? "",
    manufacturer: item.manufacturer ?? "",
    color: item.color ?? "",
    product: item.product ?? "",
    sheen: item.sheen ?? "",
    previous_color: item.previous_color ?? "",
  }));
}

export function ImportBrushoutPrepModal({ preps, onImport, onClose }: Props) {
  const [selectedId, setSelectedId] = useState(preps[0]?.prep_id ?? "");
  const [mode, setMode] = useState<"replace" | "append">("replace");

  const selected = preps.find((p) => p.prep_id === selectedId);

  function submit() {
    const prep = preps.find((p) => p.prep_id === selectedId);
    if (!prep) return;
    const items = prepToPaintItems(prep);
    onImport(items, mode === "replace", {
      prep_id: prep.prep_id,
      site_location: prep.site_location,
      gc: prep.gc,
      internal_reference: prep.internal_reference,
      emailed_date: prep.emailed_date,
    });
    onClose();
  }

  if (!preps.length) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
          <h3>Import brush-out prep</h3>
          <p className="muted">
            No open brush-out preps in your account settings. Save preps from the desktop Brush-Out Request tab
            into <code>user_settings.brushout_preps</code>, or add them in Settings later.
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
      <div className="modal card stack paint-prep-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import brush-out prep</h3>
        <p className="muted small">
          Import paint lines from a saved brush-out prep into this job&apos;s paint submittals.
        </p>

        <div className="table-wrap">
          <table className="data-table compact selectable">
            <thead>
              <tr>
                <th />
                <th>ID</th>
                <th>Internal ref</th>
                <th>Site</th>
                <th>Lines</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preps.map((p) => (
                <tr
                  key={p.prep_id}
                  className={selectedId === p.prep_id ? "selected" : ""}
                  onClick={() => setSelectedId(p.prep_id)}
                >
                  <td>
                    <input
                      type="radio"
                      name="prep"
                      checked={selectedId === p.prep_id}
                      onChange={() => setSelectedId(p.prep_id)}
                    />
                  </td>
                  <td>{p.prep_id}</td>
                  <td>{p.internal_reference}</td>
                  <td>{p.site_location}</td>
                  <td>{p.line_count ?? p.paint_items?.length ?? 0}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row-gap">
          <label className="check">
            <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
            Replace existing rows
          </label>
          <label className="check">
            <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} />
            Append to list
          </label>
        </div>

        {selected && (
          <p className="muted small">
            Will import {prepToPaintItems(selected).length} line(s) from {selected.prep_id}.
          </p>
        )}

        <div className="row-gap">
          <button type="button" className="btn btn-primary" disabled={!selectedId} onClick={submit}>
            Import
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
