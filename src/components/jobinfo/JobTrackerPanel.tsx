import { useState } from "react";
import { paintTrackerJobLabel, projectHasWallcovering, wcTrackerJobLabel } from "../../lib/jobInfo";
import type { ProjectForm } from "../../types/database";
import { PaintTrackerStatusSection } from "./PaintTrackerStatusSection";
import { WcTrackerStatusSection } from "./WcTrackerStatusSection";

type TrackerTab = "paint" | "wallcovering";

type Props = {
  project: ProjectForm;
  projectId: string;
  onOpenJobSetup?: () => void;
  onProjectUpdate?: (project: ProjectForm) => void;
};

export function JobTrackerPanel({ project, projectId, onOpenJobSetup, onProjectUpdate }: Props) {
  const hasWc = projectHasWallcovering(project.jobInfo);
  const [tab, setTab] = useState<TrackerTab>("paint");

  const activeTab = tab === "wallcovering" && hasWc ? "wallcovering" : "paint";

  return (
    <section className="card job-dashboard-tracker">
      <div className="job-tracker-header">
        <h3 className="job-dashboard-section-title">Job Tracker</h3>
        <div className="job-tracker-header-actions">
          <div className="job-tracker-tabs" role="tablist" aria-label="Tracker sheet">
          <button
            type="button"
            role="tab"
            id="job-tracker-tab-paint"
            aria-selected={activeTab === "paint"}
            aria-controls="job-tracker-panel-paint"
            className={`job-tracker-tab${activeTab === "paint" ? " job-tracker-tab--active" : ""}`}
            onClick={() => setTab("paint")}
          >
            Paint
          </button>
          {hasWc && (
            <button
              type="button"
              role="tab"
              id="job-tracker-tab-wc"
              aria-selected={activeTab === "wallcovering"}
              aria-controls="job-tracker-panel-wc"
              className={`job-tracker-tab${activeTab === "wallcovering" ? " job-tracker-tab--active" : ""}`}
              onClick={() => setTab("wallcovering")}
            >
              Wallcovering
            </button>
          )}
          </div>
        </div>
      </div>

      <p className="muted small job-tracker-job-label">
        {activeTab === "paint" ? paintTrackerJobLabel(project) : wcTrackerJobLabel(project)}
      </p>

      {activeTab === "paint" ? (
        <div id="job-tracker-panel-paint" role="tabpanel" aria-labelledby="job-tracker-tab-paint">
          <PaintTrackerStatusSection
            project={project}
            projectId={projectId}
            onOpenJobSetup={onOpenJobSetup}
            onProjectUpdate={onProjectUpdate}
          />
        </div>
      ) : (
        <div id="job-tracker-panel-wc" role="tabpanel" aria-labelledby="job-tracker-tab-wc">
          <WcTrackerStatusSection
            project={project}
            projectId={projectId}
            onOpenJobSetup={onOpenJobSetup}
            onProjectUpdate={onProjectUpdate}
          />
        </div>
      )}
    </section>
  );
}
