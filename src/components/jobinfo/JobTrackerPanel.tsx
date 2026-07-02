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
  /** Hide status pills in editor (pipeline card shows them read-only). */
  editorMode?: boolean;
};

export function JobTrackerPanel({ project, projectId, onOpenJobSetup, onProjectUpdate, editorMode }: Props) {
  const hasWc = projectHasWallcovering(project.jobInfo);
  const [tab, setTab] = useState<TrackerTab>("paint");

  const activeTab = tab === "wallcovering" && hasWc ? "wallcovering" : "paint";

  return (
    <section className={editorMode ? "stack job-dashboard-tracker job-dashboard-tracker--editor" : "card job-dashboard-tracker"}>
      {!editorMode && (
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
      )}

      {editorMode && hasWc && (
        <div className="job-tracker-tabs job-tracker-tabs--editor" role="tablist" aria-label="Tracker sheet">
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
        </div>
      )}

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
            showStatusPills={!editorMode}
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
