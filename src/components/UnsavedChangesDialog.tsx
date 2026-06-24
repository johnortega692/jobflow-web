type Props = {
  targetLabel: string;
  saving?: boolean;
  stayHint?: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export function UnsavedChangesDialog({
  targetLabel,
  saving = false,
  stayHint = "stay on this page",
  onSave,
  onDiscard,
  onCancel,
}: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal card stack settings-unsaved-dialog"
        role="alertdialog"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="unsaved-changes-title">Unsaved changes</h3>
        <p id="unsaved-changes-desc" className="muted small">
          You edited <strong>{targetLabel}</strong> but haven&apos;t saved. Save your changes, discard
          them, or {stayHint}.
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
