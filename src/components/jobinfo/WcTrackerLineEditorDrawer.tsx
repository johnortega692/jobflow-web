import { DateInput } from "../DateInput";
import type { WcTrackerLineState } from "../../types/fieldTracker";

function StatusPill({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={`job-status-pill${on ? " job-status-pill--on" : ""}`}>{label}</span>
  );
}

function TrackerCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="checkbox-row paint-tracker-flag">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

type Props = {
  open: boolean;
  line: WcTrackerLineState | null;
  mode: "add" | "edit";
  saving: boolean;
  onClose: () => void;
  onChange: (line: WcTrackerLineState) => void;
  onSave: () => void;
  onDelete?: () => void;
};

export function WcTrackerLineEditorDrawer({
  open,
  line,
  mode,
  saving,
  onClose,
  onChange,
  onSave,
  onDelete,
}: Props) {
  if (!open || !line) return null;

  const current = line;

  function patch(p: Partial<WcTrackerLineState>) {
    onChange({ ...current, ...p });
  }

  return (
    <div className="job-info-drawer-root wc-tracker-editor-root" role="presentation">
      <button type="button" className="job-info-drawer-backdrop" aria-label="Close editor" onClick={onClose} />
      <aside className="job-info-drawer-panel wc-tracker-editor-panel" aria-labelledby="wc-tracker-editor-title">
        <header className="job-info-drawer-header row-between wrap">
          <div>
            <h2 id="wc-tracker-editor-title">{mode === "add" ? "Add wallcovering line" : "Edit wallcovering line"}</h2>
            <p className="muted small">
              {line.label.trim() || line.wallcoveringName.trim() || "New material line"}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="stack job-info-drawer-body wc-tracker-editor-body">
          <div className="job-status-pills" aria-label="Line item status">
            <StatusPill label="Field measure" on={line.fieldMeasurement} />
            <StatusPill label="Shops" on={line.shops} />
            <StatusPill label="Material order" on={line.materialOrder} />
            <StatusPill label="Delivered" on={line.delivered} />
          </div>

          <div className="grid-2">
            <label>
              Label / WC label
              <input value={line.label} onChange={(e) => patch({ label: e.target.value })} />
            </label>
            <label>
              Wallcovering name
              <input
                value={line.wallcoveringName}
                onChange={(e) => patch({ wallcoveringName: e.target.value })}
              />
            </label>
            <label>
              Lead time (weeks)
              <input value={line.leadTime} onChange={(e) => patch({ leadTime: e.target.value })} />
            </label>
            <label>
              Package qty
              <input value={line.packageQty} onChange={(e) => patch({ packageQty: e.target.value })} />
            </label>
            <label>
              Approval received
              <DateInput value={line.approvalReceived} onChange={(v) => patch({ approvalReceived: v })} />
            </label>
            <label>
              Date ordered
              <DateInput value={line.dateOrdered} onChange={(v) => patch({ dateOrdered: v })} />
            </label>
            <label>
              Ship date
              <DateInput value={line.shipDate} onChange={(v) => patch({ shipDate: v })} />
            </label>
            <label>
              Install date
              <DateInput value={line.installDate} onChange={(v) => patch({ installDate: v })} />
            </label>
            <label>
              Follow up
              <DateInput value={line.followUp} onChange={(v) => patch({ followUp: v })} />
            </label>
            <label>
              ESD follow up
              <DateInput value={line.esdFollowUp} onChange={(v) => patch({ esdFollowUp: v })} />
            </label>
            <label>
              Tracking
              <input value={line.tracking} onChange={(e) => patch({ tracking: e.target.value })} />
            </label>
            <label>
              Dropbox link
              <input value={line.dropbox} onChange={(e) => patch({ dropbox: e.target.value })} />
            </label>
            <label>
              Image URL
              <input value={line.imageUrl} onChange={(e) => patch({ imageUrl: e.target.value })} />
            </label>
            <label className="grid-span-2">
              Delivery notes
              <input value={line.notesDelivered} onChange={(e) => patch({ notesDelivered: e.target.value })} />
            </label>
          </div>

          <div className="paint-tracker-flags">
            <TrackerCheckbox label="Panels" checked={line.panels} onChange={(v) => patch({ panels: v })} />
            <TrackerCheckbox
              label="Field measurement"
              checked={line.fieldMeasurement}
              onChange={(v) => patch({ fieldMeasurement: v })}
            />
            <TrackerCheckbox label="Shops" checked={line.shops} onChange={(v) => patch({ shops: v })} />
            <TrackerCheckbox
              label="Material order"
              checked={line.materialOrder}
              onChange={(v) => patch({ materialOrder: v })}
            />
            <TrackerCheckbox label="Delivered" checked={line.delivered} onChange={(v) => patch({ delivered: v })} />
          </div>
        </div>

        <footer className="job-info-drawer-footer row-between wrap">
          <div className="row-gap wrap">
            {mode === "edit" && onDelete && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onDelete}>
                Delete line
              </button>
            )}
          </div>
          <div className="row-gap wrap">
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>
              {saving ? "Saving…" : "Save line"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
