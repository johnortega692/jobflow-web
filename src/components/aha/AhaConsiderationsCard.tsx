import { useState, type KeyboardEvent } from "react";
import { SegmentedControl } from "../SegmentedControl";
import { AHA_CONSIDERATIONS, orderConsiderations, type AhaConsiderationKey } from "../../lib/aha/considerations";
import { combinedPpe, ppeKey } from "../../lib/aha/ppe";

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

type Props = {
  selected: readonly AhaConsiderationKey[];
  standardPpe: readonly string[];
  extraPpe: readonly string[];
  disabled: boolean;
  onChange: (keys: AhaConsiderationKey[]) => void;
  onExtraPpe: (items: string[]) => void;
};

export function AhaConsiderationsCard({ selected, standardPpe, extraPpe, disabled, onChange, onExtraPpe }: Props) {
  const marked = new Set(selected);
  const yesCount = AHA_CONSIDERATIONS.filter((item) => marked.has(item.key)).length;
  const [ppeDraft, setPpeDraft] = useState("");
  const standardKeys = new Set(standardPpe.map(ppeKey));
  const extras = extraPpe.filter((item) => item.trim() && !standardKeys.has(ppeKey(item)));
  const shown = combinedPpe(standardPpe, extras);

  function setKey(key: AhaConsiderationKey, yes: boolean) {
    const next = yes ? [...selected, key] : selected.filter((item) => item !== key);
    onChange(orderConsiderations(next));
  }

  function addPpe() {
    const next = ppeDraft.trim();
    setPpeDraft("");
    if (!next || shown.some((item) => ppeKey(item) === ppeKey(next))) return;
    onExtraPpe([...extras, next]);
  }

  function onPpeKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addPpe();
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <h3>Safety &amp; health considerations</h3>
        <span className="muted small">{yesCount} marked Yes</span>
      </div>
      <div className={`aha-considerations${disabled ? " aha-considerations--locked" : ""}`}>
        {AHA_CONSIDERATIONS.map((item) => {
          const yes = marked.has(item.key);
          return (
            <div key={item.key} className="aha-consideration">
              <span className="aha-consideration-label">{item.label}</span>
              <SegmentedControl
                className={`aha-yesno${yes ? "" : " aha-yesno--no"}`}
                aria-label={item.label}
                options={YES_NO}
                value={yes ? "yes" : "no"}
                onChange={(value) => {
                  if (!disabled) setKey(item.key, value === "yes");
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="stack">
        <span className="muted small">Required PPE</span>
        <div className="paint-spec-sections-chips" role="list" aria-label="Required PPE">
          {shown.map((item) => {
            const locked = standardKeys.has(ppeKey(item));
            return (
              <span key={ppeKey(item)} className="paint-spec-chip" role="listitem">
                <span className="paint-spec-chip-label">{item}</span>
                {locked ? null : (
                  <button
                    type="button"
                    className="paint-spec-chip-remove"
                    aria-label={`Remove ${item}`}
                    disabled={disabled}
                    onClick={() => onExtraPpe(extras.filter((extra) => ppeKey(extra) !== ppeKey(item)))}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <input
          value={ppeDraft}
          disabled={disabled}
          placeholder="Add PPE for this AHA"
          aria-label="Add required PPE"
          onChange={(event) => setPpeDraft(event.target.value)}
          onKeyDown={onPpeKey}
          onBlur={addPpe}
        />
      </div>
    </section>
  );
}
