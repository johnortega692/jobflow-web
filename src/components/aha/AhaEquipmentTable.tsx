import { useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { AhaEquipmentRow } from "../../lib/aha/types";

type Props = {
  rows: AhaEquipmentRow[];
  disabled: boolean;
  onChange: (rows: AhaEquipmentRow[]) => void;
};

function GrowTextarea({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      className="aha-cell-input"
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next;
}

export function AhaEquipmentTable({ rows, disabled, onChange }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function patch(id: string, partial: Partial<AhaEquipmentRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...partial } : row)));
  }

  function clearDrag() {
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <section className="card stack aha-table-card">
      <h3>Equipment, training, and inspection</h3>
      <div className="aha-table-scroll">
        <table className="aha-grid-table">
          <thead>
            <tr>
              <th className="aha-col-handle" aria-hidden="true" />
              <th>Equipment</th>
              <th>Training requirements</th>
              <th>Inspection requirements</th>
              <th className="aha-col-action" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                className={`${dragFrom === index ? "aha-row--dragging" : ""}${dragOver === index ? " aha-row--dragover" : ""}`}
                onDragOver={(event: DragEvent) => {
                  event.preventDefault();
                  setDragOver(index);
                }}
                onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
                onDrop={() => {
                  if (dragFrom !== null && dragFrom !== index) onChange(moveItem(rows, dragFrom, index));
                  clearDrag();
                }}
              >
                <td>
                  <button
                    type="button"
                    className="paint-row-handle"
                    draggable={!disabled}
                    aria-label={`Reorder equipment row ${index + 1}`}
                    title="Drag to reorder"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(index));
                      setDragFrom(index);
                    }}
                    onDragEnd={clearDrag}
                  >
                    ⠿
                  </button>
                </td>
                <td>
                  <GrowTextarea
                    value={row.equipment}
                    label={`Equipment ${index + 1}`}
                    disabled={disabled}
                    onChange={(equipment) => patch(row.id, { equipment })}
                  />
                </td>
                <td>
                  <GrowTextarea
                    value={row.training}
                    label={`Training ${index + 1}`}
                    disabled={disabled}
                    onChange={(training) => patch(row.id, { training })}
                  />
                </td>
                <td>
                  <GrowTextarea
                    value={row.inspection}
                    label={`Inspection ${index + 1}`}
                    disabled={disabled}
                    onChange={(inspection) => patch(row.id, { inspection })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="aha-row-delete"
                    aria-label={`Remove equipment row ${index + 1}`}
                    disabled={disabled}
                    onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="aha-step-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          onClick={() =>
            onChange([...rows, { id: crypto.randomUUID(), equipment: "", training: "", inspection: "" }])
          }
        >
          + Add equipment
        </button>
      </div>
    </section>
  );
}
