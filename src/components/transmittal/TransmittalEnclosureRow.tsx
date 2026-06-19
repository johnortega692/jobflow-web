import { enclosureOutputDescription } from "../../lib/transmittalHelpers";
import type { TransmittalEnclosure } from "../../types/tradeDocuments";

type Props = {
  row: TransmittalEnclosure;
  index: number;
  showForColumn: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (patch: Partial<TransmittalEnclosure>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

export function TransmittalEnclosureRow({
  row,
  showForColumn,
  canMoveUp,
  canMoveDown,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props) {
  const displayDesc = enclosureOutputDescription(row);

  return (
    <div className="transmittal-enc-row">
      <label className="transmittal-enc-check">
        <input
          type="checkbox"
          checked={row.included}
          onChange={(e) => onChange({ included: e.target.checked })}
          aria-label="Include on transmittal"
        />
      </label>
      <input
        className="transmittal-enc-desc"
        value={row.description}
        onChange={(e) => onChange({ description: e.target.value })}
        title={displayDesc}
        placeholder="Description"
      />
      <button
        type="button"
        className={`transmittal-dc-btn${row.digital_copy ? " active" : ""}`}
        title="Toggle digital copy (appends to PDF description)"
        aria-pressed={row.digital_copy}
        onClick={() => onChange({ digital_copy: !row.digital_copy })}
      >
        📄
      </button>
      <span className="transmittal-enc-copies-label">Copies:</span>
      <input
        className="transmittal-enc-copies"
        value={row.copies}
        onChange={(e) => onChange({ copies: e.target.value })}
        aria-label="Copies"
      />
      {showForColumn && (
        <>
          <span className="transmittal-enc-for-label">For:</span>
          <input
            className="transmittal-enc-for"
            value={row.for_field}
            onChange={(e) => onChange({ for_field: e.target.value })}
            aria-label="For"
          />
        </>
      )}
      <div className="transmittal-enc-actions">
        <button type="button" className="btn btn-secondary btn-icon" disabled={!canMoveUp} onClick={onMoveUp} title="Move up">
          ↑
        </button>
        <button type="button" className="btn btn-secondary btn-icon" disabled={!canMoveDown} onClick={onMoveDown} title="Move down">
          ↓
        </button>
        <button type="button" className="btn btn-secondary btn-icon" onClick={onRemove} title="Remove">
          ×
        </button>
      </div>
    </div>
  );
}
