import { useState } from "react";

type Props = {
  showForColumn: boolean;
  onAdd: (payload: { description: string; copies: string; for_field: string }) => void;
  onClose: () => void;
};

export function TransmittalCustomLineModal({ showForColumn, onAdd, onClose }: Props) {
  const [description, setDescription] = useState("");
  const [copies, setCopies] = useState("1");
  const [forField, setForField] = useState("");

  function submit() {
    const desc = description.trim();
    if (!desc) return;
    onAdd({ description: desc, copies: copies.trim() || "1", for_field: forField.trim() });
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <h3>Add custom enclosure line</h3>
        <label>
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        </label>
        <div className="row-gap">
          <label>
            Copies
            <input value={copies} onChange={(e) => setCopies(e.target.value)} style={{ width: "4rem" }} />
          </label>
          {showForColumn && (
            <label>
              For
              <input value={forField} onChange={(e) => setForField(e.target.value)} />
            </label>
          )}
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" onClick={submit}>
            Add
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
