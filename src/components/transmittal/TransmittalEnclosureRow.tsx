import type { DragEvent } from "react";
import { enclosureOutputDescription } from "../../lib/transmittalHelpers";
import type { TransmittalEnclosure } from "../../types/tradeDocuments";

type Props = {
  row: TransmittalEnclosure;
  index: number;
  showForColumn: boolean;
  dragging: boolean;
  dragOver: boolean;
  onChange: (patch: Partial<TransmittalEnclosure>) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

export function TransmittalEnclosureRow({
  row,
  showForColumn,
  dragging,
  dragOver,
  onChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: Props) {
  const displayDesc = enclosureOutputDescription(row);

  return (
    <div
      className={`transmittal-enc-row${showForColumn ? " transmittal-enc-row--for" : ""}${dragging ? " transmittal-enc-row--dragging" : ""}${dragOver ? " transmittal-enc-row--dragover" : ""}${row.included ? "" : " transmittal-enc-row--excluded"}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <button
        type="button"
        className="transmittal-enc-handle"
        draggable
        aria-label="Drag to reorder"
        title="Drag to reorder"
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(row.id));
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        ⋮⋮
      </button>
      <label className="transmittal-enc-check">
        <input
          type="checkbox"
          checked={row.included}
          onChange={(e) => onChange({ included: e.target.checked })}
          aria-label="Include on transmittal"
        />
      </label>
      <span className="transmittal-enc-desc" title={displayDesc}>
        {displayDesc || "Untitled enclosure"}
      </span>
      <button
        type="button"
        className={`transmittal-dc-btn${row.digital_copy ? " active" : ""}`}
        title="Stamp digital copy on this enclosure description in the PDF"
        aria-label="Stamp digital copy"
        aria-pressed={row.digital_copy}
        onClick={() => onChange({ digital_copy: !row.digital_copy })}
      >
        📄
      </button>
      <input
        className="transmittal-enc-copies"
        value={row.copies}
        onChange={(e) => onChange({ copies: e.target.value })}
        aria-label="Copies"
      />
      {showForColumn && (
        <input
          className="transmittal-enc-for"
          value={row.for_field}
          onChange={(e) => onChange({ for_field: e.target.value })}
          aria-label="For"
          placeholder="For"
        />
      )}
      <button
        type="button"
        className="btn btn-ghost btn-small transmittal-enc-remove"
        onClick={onRemove}
        title="Remove"
        aria-label="Remove enclosure"
      >
        ×
      </button>
    </div>
  );
}
