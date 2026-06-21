import type { BrushoutPrepRecord } from "../../lib/paintUserSettings";

type Props = {
  preps: BrushoutPrepRecord[];
  onOpen: (prepId: string) => void;
  onClose: () => void;
};

export function OpenBrushoutPrepModal({ preps, onOpen, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal card stack paint-prep-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Open brush-out prep</h3>
        {!preps.length ? (
          <>
            <p className="muted">No saved brush-out preps yet.</p>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table compact selectable">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Internal ref</th>
                    <th>Site</th>
                    <th>Lines</th>
                    <th>Status</th>
                    <th>Modified</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {preps.map((p) => (
                    <tr key={p.prep_id}>
                      <td>{p.prep_id}</td>
                      <td>{p.internal_reference}</td>
                      <td>{p.site_location}</td>
                      <td>{p.line_count ?? p.paint_items?.length ?? 0}</td>
                      <td>{p.status ?? "open"}</td>
                      <td className="muted small">{p.last_modified ?? p.created}</td>
                      <td>
                        <button type="button" className="btn btn-small" onClick={() => onOpen(p.prep_id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
