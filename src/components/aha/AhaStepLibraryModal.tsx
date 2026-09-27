import { useEffect, useMemo, useState } from "react";
import { ahaScopeLabel } from "../../lib/aha/display";
import type { AhaLibraryItem, AhaLibraryStep } from "../../lib/aha/types";

type Props = {
  library: AhaLibraryItem[];
  onClose: () => void;
  onPick: (step: AhaLibraryStep) => void;
  onAddTemplate: (template: AhaLibraryItem) => void;
};

export function AhaStepLibraryModal({ library, onClose, onPick, onAddTemplate }: Props) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return library
      .map((template) => {
        const templateHit = template.name.toLowerCase().includes(needle);
        const steps = template.steps.filter((step) => {
          if (!needle || templateHit) return true;
          const haystack = [step.name, ...step.hazards, ...step.controls]
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        });
        return { template, steps };
      })
      .filter((group) => group.steps.length > 0);
  }, [library, query]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack aha-step-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aha-step-library-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row-between wrap">
          <h3 id="aha-step-library-title">Add step from library</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <input
          autoFocus
          value={query}
          placeholder="Search steps"
          aria-label="Search library steps"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="aha-step-modal-list">
          {groups.length === 0 ? (
            <p className="muted">No steps match.</p>
          ) : (
            groups.map(({ template, steps }) => (
              <section key={template.id} className="stack">
                <div className="row-between aha-step-modal-head">
                  <div>
                    <p className="aha-step-modal-group">{template.name}</p>
                    <p className="muted small">
                      {ahaScopeLabel(template.scope)} · {template.csi || "—"} · {template.steps.length}{" "}
                      {template.steps.length === 1 ? "step" : "steps"}
                    </p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAddTemplate(template)}>
                    Add all steps from a template
                  </button>
                </div>
                <div className="stack aha-step-modal-steps">
                  {steps.map((step, index) => (
                    <button
                      key={`${template.id}-${step.id ?? index}`}
                      type="button"
                      className="aha-step-modal-step"
                      onClick={() => onPick(step)}
                    >
                      <span>{step.name}</span>
                      {step.hazards[0] && <span className="muted small">{step.hazards[0]}</span>}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
