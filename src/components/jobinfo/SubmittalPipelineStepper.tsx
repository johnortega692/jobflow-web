import { DashboardTablerIcon } from "./DashboardTablerIcon";
import {
  paintSubmittalPipelineSteps,
  type SubmittalPipelineStep,
} from "../../lib/projectDashboardSnapshot";
import type { PaintTrackerState } from "../../types/fieldTracker";

function stepNodeClass(step: SubmittalPipelineStep): string {
  const base = "job-header-submittal-node";
  if (step.done && step.tone === "approved") return `${base} ${base}--approved`;
  if (step.done && step.tone === "revision") return `${base} ${base}--revision`;
  if (step.done) return `${base} ${base}--done`;
  if (step.current) return `${base} ${base}--current`;
  return `${base} ${base}--future`;
}

function stepLabelClass(step: SubmittalPipelineStep): string {
  const base = "job-header-submittal-label";
  if (step.done && step.tone === "revision") return `${base} ${base}--revision`;
  if (step.done && step.tone === "approved") return `${base} ${base}--approved`;
  if (step.done) return `${base} ${base}--done`;
  if (step.current) return `${base} ${base}--current`;
  return `${base} ${base}--future`;
}

type Props = {
  tracker: PaintTrackerState;
  /** Highest paint package revision. 0 means the original was never returned. */
  revisionNumber?: number;
};

export function SubmittalPipelineStepper({ tracker, revisionNumber = 0 }: Props) {
  const steps = paintSubmittalPipelineSteps(tracker, revisionNumber);

  return (
    <div className="job-header-submittal-row">
      <span className="job-header-submittal-kicker">Submittal</span>
      <div className="job-header-submittal-stepper" role="list" aria-label="Submittal pipeline">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={`job-header-submittal-step${index === steps.length - 1 ? " job-header-submittal-step--last" : ""}`}
            role="listitem"
          >
            <div className="job-header-submittal-step-main">
              <div className={stepNodeClass(step)}>{step.done ? <DashboardTablerIcon name="check" size={12} /> : index + 1}</div>
              <span className={stepLabelClass(step)}>{step.label}</span>
              {step.badge ? <span className="job-header-submittal-badge">{step.badge}</span> : null}
            </div>
            {index < steps.length - 1 && (
              <div
                className={`job-header-submittal-connector${
                  step.done && step.tone === "revision"
                    ? " job-header-submittal-connector--revision"
                    : step.done
                      ? " job-header-submittal-connector--done"
                      : ""
                }`}
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
