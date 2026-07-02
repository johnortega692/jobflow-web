import { paintSubmittalPipelineSteps } from "../../lib/projectDashboardSnapshot";
import type { PaintTrackerState } from "../../types/fieldTracker";

type Props = {
  tracker: PaintTrackerState;
  stage: string;
};

function stageLabelClass(stage: string): string {
  if (stage === "Approved") return "project-mini-pipeline-stage project-mini-pipeline-stage--approved";
  if (stage === "Not started") return "project-mini-pipeline-stage project-mini-pipeline-stage--muted";
  return "project-mini-pipeline-stage project-mini-pipeline-stage--active";
}

export function ProjectMiniPipeline({ tracker, stage }: Props) {
  const steps = paintSubmittalPipelineSteps(tracker);

  return (
    <div className="project-mini-pipeline" aria-label={`Submittal: ${stage}`}>
      <div className="project-mini-pipeline-dots" aria-hidden>
        {steps.map((step, index) => (
          <div key={step.id} className="project-mini-pipeline-step">
            <div
              className={`project-mini-pipeline-dot${
                step.done
                  ? " project-mini-pipeline-dot--done"
                  : step.current
                    ? " project-mini-pipeline-dot--current"
                    : ""
              }`}
            />
            {index < steps.length - 1 && (
              <div className={`project-mini-pipeline-connector${step.done ? " project-mini-pipeline-connector--done" : ""}`} />
            )}
          </div>
        ))}
      </div>
      <span className={stageLabelClass(stage)}>{stage}</span>
    </div>
  );
}
