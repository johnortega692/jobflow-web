import type { WorkOrderFormData } from "../../types/workOrder";

export type WorkOrderOptionsModalProps = {
  open: boolean;
  onClose: () => void;
  form: WorkOrderFormData;
  hasTotalOverlays: boolean;
  onFieldChange: <K extends keyof WorkOrderFormData>(key: K, value: WorkOrderFormData[K]) => void;
  onInitializeTotals: () => void;
  onSaveTotalPositionsDefault: () => void;
  onRestoreTotalPositions: () => void;
  onResetFactoryTotalPositions: () => void;
};

export function WorkOrderOptionsModal({
  open,
  onClose,
  form,
  hasTotalOverlays,
  onFieldChange,
  onInitializeTotals,
  onSaveTotalPositionsDefault,
  onRestoreTotalPositions,
  onResetFactoryTotalPositions,
}: WorkOrderOptionsModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack ewo-options-modal"
        role="dialog"
        aria-labelledby="ewo-options-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between wrap">
          <h3 id="ewo-options-title">Options</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="stack">
          <h4 className="small">Text on document</h4>
          <div className="stack">
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_material_names}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, show_material_names: e.target.checked })
                }
              />
              Show material names
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_material_quantity}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, show_material_quantity: e.target.checked })
                }
              />
              Show material quantity
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_labor_names}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, show_labor_names: e.target.checked })
                }
              />
              Show labor rate names
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_hours}
                onChange={(e) => onFieldChange("display", { ...form.display, show_hours: e.target.checked })}
              />
              Show labor hours
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_supervision_hours}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, show_supervision_hours: e.target.checked })
                }
              />
              Show supervision hours
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_total_labels}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, show_total_labels: e.target.checked })
                }
              />
              Show total labels on canvas
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.export_totals}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, export_totals: e.target.checked })
                }
              />
              Include total labels on PDF export
            </label>
          </div>
        </section>

        <section className="stack">
          <h4 className="small">Totals on document</h4>
          <p className="muted small">
            Total fields appear on the canvas when you upload a form. Drag them to align with your template, then save
            the layout as your default.
          </p>
          <div className="row-gap wrap">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onInitializeTotals}>
              Place / refresh totals
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!hasTotalOverlays}
              onClick={() => void onSaveTotalPositionsDefault()}
            >
              Save layout as default
            </button>
          </div>
          <div className="row-gap wrap">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!hasTotalOverlays}
              onClick={onRestoreTotalPositions}
            >
              Restore saved layout
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!hasTotalOverlays}
              onClick={onResetFactoryTotalPositions}
            >
              Reset to factory defaults
            </button>
          </div>
          <div className="stack">
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_material_total_1}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, show_material_total_1: e.target.checked })
                }
              />
              Show Material Total 1
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.display.show_labor_total}
                onChange={(e) =>
                  onFieldChange("display", { ...form.display, show_labor_total: e.target.checked })
                }
              />
              Show Labor Total 1
            </label>
          </div>
          <p className="muted small">
            Material Total 2, Labor Total 2, and Grand Total always export dollar amounts. Inline totals above can be
            hidden with the toggles above.
          </p>
        </section>
      </div>
    </div>
  );
}
