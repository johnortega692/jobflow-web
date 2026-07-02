import { useState } from "react";
import { PROJECT_STARTUP_OPTIONAL_STEPS } from "../../config/projectStartupOptionalSteps";
import {
  newCustomOptionalStepId,
  type StartupOptionalState,
} from "../../lib/projectStartupOptional";

type Props = {
  value: StartupOptionalState;
  onChange: (next: StartupOptionalState) => void;
};

export function StartupOptionalStepsSection({ value, onChange }: Props) {
  const [customLabel, setCustomLabel] = useState("");

  function toggleCatalog(id: string, checked: boolean) {
    const enabled = checked
      ? [...new Set([...value.enabled, id])]
      : value.enabled.filter((x) => x !== id);
    onChange({ ...value, enabled });
  }

  function addCustom() {
    const label = customLabel.trim();
    if (!label) return;
    const id = newCustomOptionalStepId(label);
    onChange({
      ...value,
      custom: [...value.custom, { id, label }],
    });
    setCustomLabel("");
  }

  function removeCustom(id: string) {
    const { [id]: _removed, ...restChecked } = value.checked;
    onChange({
      ...value,
      custom: value.custom.filter((c) => c.id !== id),
      checked: restChecked,
    });
  }

  const enabledCount = value.enabled.length + value.custom.length;

  return (
    <details className="job-section card stack" open={enabledCount > 0}>
      <summary className="job-section-summary">
        <h3>Additional startup checklist</h3>
      </summary>
      <p className="muted small" style={{ marginTop: 0 }}>
        Turn on tasks for this job. Enabled items appear on the project dashboard startup checklist for
        check-off — separate from the standard startup steps.
      </p>

      <div className="startup-optional-catalog stack">
        {PROJECT_STARTUP_OPTIONAL_STEPS.map((step) => (
          <label key={step.id} className="checkbox-row startup-optional-row">
            <input
              type="checkbox"
              checked={value.enabled.includes(step.id)}
              onChange={(e) => toggleCatalog(step.id, e.target.checked)}
            />
            {step.label}
          </label>
        ))}
      </div>

      {value.custom.length > 0 && (
        <div className="stack">
          <p className="paint-col-head">Custom tasks</p>
          <ul className="startup-optional-custom-list">
            {value.custom.map((row) => (
              <li key={row.id} className="startup-optional-custom-item row-between wrap gap">
                <span>{row.label}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => removeCustom(row.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row-gap wrap">
        <input
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          placeholder="Add custom task…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className="btn btn-secondary btn-small" onClick={addCustom} disabled={!customLabel.trim()}>
          Add task
        </button>
      </div>
    </details>
  );
}
