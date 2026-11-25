import { useEffect, useState } from "react";
import { PEOPLE_PRINT_KEY, type WeeklyPrintLayout, type WeeklyPrintMeasure } from "../../lib/weeklyHoursPrint";

type Props = {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPrint: (measure: WeeklyPrintMeasure, layout: WeeklyPrintLayout) => void;
};

export function WeeklyHoursPrintDialog({ busy, error, onClose, onPrint }: Props) {
  const [measure, setMeasure] = useState<WeeklyPrintMeasure>("hours");
  const [layout, setLayout] = useState<WeeklyPrintLayout>("week");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="modal card stack weekly-print-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-print-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row-between wrap gap">
          <h2 id="weekly-print-title" className="billing-card-title">Print weekly hours</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="weekly-print-field">
          <span id="weekly-print-measure">Show</span>
          <div className="transmittal-segment" role="group" aria-labelledby="weekly-print-measure">
            <button type="button" className={measure === "hours" ? "is-on" : ""} aria-pressed={measure === "hours"} onClick={() => setMeasure("hours")}>
              Hours
            </button>
            <button type="button" className={measure === "people" ? "is-on" : ""} aria-pressed={measure === "people"} onClick={() => setMeasure("people")}>
              People
            </button>
          </div>
          <p className="muted small">{measure === "people" ? PEOPLE_PRINT_KEY : "Hours prints the planned hours as they are."}</p>
        </div>

        <div className="weekly-print-field">
          <span id="weekly-print-layout">Layout</span>
          <div className="transmittal-segment" role="group" aria-labelledby="weekly-print-layout">
            <button type="button" className={layout === "week" ? "is-on" : ""} aria-pressed={layout === "week"} onClick={() => setLayout("week")}>
              Week totals
            </button>
            <button type="button" className={layout === "days" ? "is-on" : ""} aria-pressed={layout === "days"} onClick={() => setLayout("days")}>
              Monday through Sunday
            </button>
          </div>
          <p className="muted small">
            Week totals print one number for each week. Monday through Sunday opens every week into a calendar, the way a scheduler prints a timescale.
          </p>
        </div>

        {error ? <p className="banner banner-error">{error}</p> : null}

        <div className="row-between">
          <span />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onPrint(measure, layout)}>
            {busy ? "Preparing…" : "Print"}
          </button>
        </div>
      </div>
    </div>
  );
}
