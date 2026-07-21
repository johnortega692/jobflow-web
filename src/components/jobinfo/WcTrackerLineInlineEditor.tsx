import { DateInput } from "../DateInput";
import { applyWcLineStage, type WcFieldStatus } from "../../lib/fieldTrackerStatus";
import { FlagSwitch, StageStepper } from "./StageStepper";
import type { WcTrackerLineState } from "../../types/fieldTracker";

/** Required lifecycle stages. Field measure and Shops are independent options. */
const STEPPER_STAGES: { status: WcFieldStatus; label: string; flag: keyof WcTrackerLineState }[] = [
  { status: "Submittal Ordered", label: "Ordered", flag: "ordered" },
  { status: "Submitted for Approval", label: "Sent approval", flag: "sentForApproval" },
  { status: "Approved", label: "Approved", flag: "approved" },
  { status: "Material Ordered", label: "Material order", flag: "materialOrder" },
  { status: "Delivered", label: "Delivered", flag: "delivered" },
];

type Props = {
  line: WcTrackerLineState;
  mode: "add" | "edit";
  saving: boolean;
  onChange: (line: WcTrackerLineState) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
};

/** Inline (in-table) editor for a wallcovering tracker line. */
export function WcTrackerLineInlineEditor({
  line,
  mode,
  saving,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: Props) {
  function patch(p: Partial<WcTrackerLineState>) {
    onChange({ ...line, ...p });
  }

  // Highest flagged stage = current; everything before it = done.
  const currentIdx = STEPPER_STAGES.reduce((acc, s, i) => (line[s.flag] ? i : acc), -1);

  return (
    <div className="stack wc-tracker-inline-editor">
      <div className="wc-stage-stepper-row">
        <StageStepper
          ariaLabel="Pipeline stage"
          items={STEPPER_STAGES.map((stage, i) => ({
            key: stage.status,
            label: stage.label,
            state: i < currentIdx ? "done" : i === currentIdx ? "current" : "todo",
            title: `Set stage: ${stage.label}`,
          }))}
          onSelect={(key) => onChange(applyWcLineStage(line, key as WcFieldStatus))}
        />
      </div>

      <div className="wc-tracker-editor-grid">
        <label>
          Label / WC label
          <input value={line.label} onChange={(e) => patch({ label: e.target.value })} />
        </label>
        <label className="wc-col-3">
          Wallcovering name
          <input
            value={line.wallcoveringName}
            onChange={(e) => patch({ wallcoveringName: e.target.value })}
          />
        </label>
      </div>

      <div className="wc-tracker-editor-grid">
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
      </div>

      <div className="wc-tracker-editor-flags">
        <FlagSwitch
          label="Field measure"
          tone="ok"
          checked={line.fieldMeasurement}
          onChange={(v) => patch({ fieldMeasurement: v })}
        />
        <FlagSwitch label="Shops" tone="ok" checked={line.shops} onChange={(v) => patch({ shops: v })} />
        <FlagSwitch label="Panels" tone="accent" checked={line.panels} onChange={(v) => patch({ panels: v })} />
        <FlagSwitch
          label="Needs revision"
          tone="warn"
          checked={line.revision}
          onChange={(v) =>
            patch(
              v
                ? {
                    revision: true,
                    approved: false,
                    fieldMeasurement: false,
                    shops: false,
                    materialOrder: false,
                    delivered: false,
                  }
                : { revision: false },
            )
          }
        />
      </div>

      <details className="wc-tracker-editor-more" open={line.revision ? true : undefined}>
        <summary>Follow-ups, notes &amp; procurement</summary>
        <div className="wc-tracker-editor-grid wc-tracker-editor-more-body">
          <label>
            Lead time (weeks)
            <input value={line.leadTime} onChange={(e) => patch({ leadTime: e.target.value })} />
          </label>
          <label>
            Package qty
            <input value={line.packageQty} onChange={(e) => patch({ packageQty: e.target.value })} />
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
          <label className="wc-col-2">
            Dropbox link
            <input value={line.dropbox} onChange={(e) => patch({ dropbox: e.target.value })} />
          </label>
          <label>
            Image URL
            <input value={line.imageUrl} onChange={(e) => patch({ imageUrl: e.target.value })} />
          </label>
          <label className="wc-col-4">
            Delivery notes
            <textarea
              rows={2}
              value={line.notesDelivered}
              onChange={(e) => patch({ notesDelivered: e.target.value })}
            />
          </label>
          {line.revision && (
            <label className="wc-col-4">
              Revision notes
              <textarea
                rows={3}
                value={line.revisionNotes}
                placeholder="Required while this wallcovering needs revision"
                onChange={(e) => patch({ revisionNotes: e.target.value })}
              />
            </label>
          )}
        </div>
      </details>

      <div className="row-between wrap wc-tracker-inline-editor-footer">
        <div className="row-gap wrap">
          {mode === "edit" && onDelete && (
            <button
              type="button"
              className="btn btn-ghost btn-sm wc-tracker-delete-btn"
              disabled={saving}
              onClick={onDelete}
            >
              Delete line
            </button>
          )}
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save line"}
          </button>
        </div>
      </div>
    </div>
  );
}
