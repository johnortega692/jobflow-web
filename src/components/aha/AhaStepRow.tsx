import type { DragEvent } from "react";
import { AHA_PROBABILITIES, AHA_SEVERITIES, formatOshaRef } from "../../lib/aha/display";
import { racFor } from "../../lib/aha/rac";
import type { AhaStep } from "../../lib/aha/types";
import { RacBadge } from "./RacBadge";

type Props = {
  step: AhaStep;
  index: number;
  open: boolean;
  showEm385: boolean;
  dragging: boolean;
  dragOver: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<AhaStep>) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function RefChip({
  label,
  value,
  emptyLabel,
  emptyTitle,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  emptyTitle: string;
}) {
  const text = value.trim();
  return (
    <span className={`aha-ref-chip${text ? "" : " aha-ref-chip--empty"}`} title={text ? undefined : emptyTitle}>
      {text ? label : emptyLabel}
    </span>
  );
}

export function AhaStepRow({
  step,
  index,
  open,
  showEm385,
  dragging,
  dragOver,
  onToggle,
  onPatch,
  onRemove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: Props) {
  const name = step.name.trim() || "Untitled step";
  const rac = racFor(step.prob, step.sev);

  return (
    <div
      className={`aha-step-block${open ? " aha-step-block--open" : ""}${dragging ? " aha-step-block--dragging" : ""}${dragOver ? " aha-step-block--dragover" : ""}`}
      data-step-id={step.id}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
    >
      <div className="aha-step">
        <button
          type="button"
          className="paint-row-handle"
          draggable
          aria-label={`Reorder step ${index + 1}`}
          title="Drag to reorder"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          ⠿
        </button>
        <span className="aha-step-num" aria-hidden="true">
          {index + 1}
        </span>
        <button type="button" className="aha-step-main" onClick={onToggle} aria-expanded={open}>
          <span className="aha-step-title-row">
            <span
              className={`wc-tracker-row-chevron aha-step-chevron${open ? " wc-tracker-row-chevron--open" : ""}`}
              aria-hidden="true"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
            <span className="aha-step-name">{name}</span>
          </span>
          {step.hazards.length > 0 && (
            <ul className="aha-bullet-list">
              {step.hazards.map((hazard, hazardIndex) => (
                <li key={`${hazard}-${hazardIndex}`}>
                  <span className="aha-bullet aha-bullet--hazard" aria-hidden="true">
                    !
                  </span>
                  <span>{hazard}</span>
                </li>
              ))}
            </ul>
          )}
        </button>
        <button type="button" className="aha-step-controls" onClick={onToggle} aria-expanded={open}>
          {step.controls.length > 0 && (
            <ul className="aha-bullet-list">
              {step.controls.map((control, controlIndex) => (
                <li key={`${control}-${controlIndex}`}>
                  <span className="aha-bullet aha-bullet--control" aria-hidden="true">
                    ✓
                  </span>
                  <span>{control}</span>
                </li>
              ))}
            </ul>
          )}
          {(step.osha_refs.trim() || (showEm385 && step.em385_refs.trim())) && (
            <div className="aha-ref-chips">
              {step.osha_refs.trim() && (
                <RefChip
                  label={formatOshaRef(step.osha_refs)}
                  value={step.osha_refs}
                  emptyLabel="add ref"
                  emptyTitle="OSHA reference"
                />
              )}
              {showEm385 && step.em385_refs.trim() && (
                <RefChip
                  label={`EM 385-1-1 § ${step.em385_refs.trim()}`}
                  value={step.em385_refs}
                  emptyLabel="add ref"
                  emptyTitle="EM 385-1-1 reference"
                />
              )}
            </div>
          )}
        </button>
        <div className="aha-step-risk">
          <div className="aha-prob-row">
            <label className="aha-field">
              Probability
              <select
                className="aha-select"
                value={step.prob}
                aria-label={`Probability for step ${index + 1}`}
                onChange={(event) => onPatch({ prob: event.target.value as AhaStep["prob"] })}
              >
                {AHA_PROBABILITIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <RacBadge level={rac} size={36} />
          </div>
          <label className="aha-field">
            Severity
            <select
              className="aha-select"
              value={step.sev}
              aria-label={`Severity for step ${index + 1}`}
              onChange={(event) => onPatch({ sev: event.target.value as AhaStep["sev"] })}
            >
              {AHA_SEVERITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="aha-remove-step" onClick={onRemove}>
            Remove step
          </button>
        </div>
      </div>
      {open && (
        <div className="aha-step-editor">
          <div className="aha-step-editor-grid">
            <label className="aha-step-name-field">
              Step name
              <input value={step.name} onChange={(event) => onPatch({ name: event.target.value })} />
            </label>
            <label>
              Hazards
              <textarea
                rows={4}
                value={step.hazards.join("\n")}
                placeholder="One hazard per line"
                onChange={(event) => onPatch({ hazards: event.target.value.split("\n") })}
              />
            </label>
            <label>
              Controls
              <textarea
                rows={4}
                value={step.controls.join("\n")}
                placeholder="One control per line"
                onChange={(event) => onPatch({ controls: event.target.value.split("\n") })}
              />
            </label>
            <label>
              OSHA refs
              <input
                value={step.osha_refs}
                onChange={(event) => onPatch({ osha_refs: event.target.value })}
              />
            </label>
            {showEm385 && (
              <label>
                EM 385-1-1 refs
                <input
                  value={step.em385_refs}
                  onChange={(event) => onPatch({ em385_refs: event.target.value })}
                />
              </label>
            )}
          </div>
          <div className="aha-step-editor-footer">
            <button type="button" className="btn btn-primary btn-sm" onClick={onToggle}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
