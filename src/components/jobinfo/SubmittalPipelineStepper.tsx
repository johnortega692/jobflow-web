import { DashboardTablerIcon } from "./DashboardTablerIcon";
import {
  paintSubmittalPipelineSteps,
  type SubmittalPipelineStep,
} from "../../lib/projectDashboardSnapshot";
import type { PaintTrackerState } from "../../types/fieldTracker";

function stepNodeClass(step: SubmittalPipelineStep): string {
  if (step.done) return "job-header-submittal-node job-header-submittal-node--done";
  if (step.current) return "job-header-submittal-node job-header-submittal-node--current";
  return "job-header-submittal-node job-header-submittal-node--future";
}

function stepLabelClass(step: SubmittalPipelineStep): string {
  if (step.done) return "job-header-submittal-label job-header-submittal-label--done";
  if (step.current) return "job-header-submittal-label job-header-submittal-label--current";
  return "job-header-submittal-label job-header-submittal-label--future";
}

type Props = {
  tracker: PaintTrackerState;
};

export function SubmittalPipelineStepper({ tracker }: Props) {
  const steps = paintSubmittalPipelineSteps(tracker);

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
            </div>
            {index < steps.length - 1 && (
              <div
                className={`job-header-submittal-connector${step.done ? " job-header-submittal-connector--done" : ""}`}
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
