type Props = {
  tabLabel: string;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export function UnsavedChangesDialog({ tabLabel, saving = false, onSave, onDiscard, onCancel }: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal card stack settings-unsaved-dialog"
        role="alertdialog"
        aria-labelledby="settings-unsaved-title"
        aria-describedby="settings-unsaved-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="settings-unsaved-title">Unsaved changes</h3>
        <p id="settings-unsaved-desc" className="muted small">
          You edited <strong>{tabLabel}</strong> but haven&apos;t saved. Save your changes, discard
          them, or stay on this tab.
        </p>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onDiscard}>
            Don&apos;t save
          </button>
          <button type="button" className="btn btn-ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
