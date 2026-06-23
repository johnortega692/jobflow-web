import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { GcContactLine } from "../components/jobinfo/GcContactLine";
import { JobTrackerPanel } from "../components/jobinfo/JobTrackerPanel";
import { JobInfoSetupDrawer } from "../components/jobinfo/JobInfoSetupDrawer";
import { ProjectActivityPanel } from "../components/jobinfo/ProjectActivityPanel";
import { ProjectStartupChecklist } from "../components/jobinfo/ProjectStartupChecklist";
import { jobSetupStatus } from "../lib/jobInfoCompleteness";
import {
  frpJobLabel,
  hasDistinctFrpContract,
  hasDistinctTrackContract,
  hasDistinctWcContract,
  trackJobLabel,
  wcTrackerJobLabel,
} from "../lib/jobInfo";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

export function ProjectOverviewPage() {
  const { project: initial, projectId, setProject: setProjectCtx } = useOutletContext<Ctx>();
  const [project, setProject] = useState(initial);
  const [setupOpen, setSetupOpen] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

  useEffect(() => {
    setProject(initial);
  }, [initial]);

  const setup = jobSetupStatus(project);
  const j = project.jobInfo;

  function onSaved(next: ProjectForm) {
    setProject(next);
    setProjectCtx(next);
    setActivityRefreshKey((k) => k + 1);
  }

  return (
    <div className="stack job-dashboard">
      <header className="card job-dashboard-header">
        <div className="job-dashboard-title">
          <p className="job-dashboard-kicker muted small">Project dashboard</p>
          <h2 className="job-dashboard-heading">
            {project.job_number || "—"}
            {project.job_name ? ` · ${project.job_name}` : ""}
          </h2>
          {project.contractor && <p className="muted job-dashboard-gc">{project.contractor}</p>}
          {hasDistinctWcContract(project) && (
            <p className="muted small job-dashboard-wc-contract">
              Wallcovering contract: {wcTrackerJobLabel(project)}
            </p>
          )}
          {hasDistinctFrpContract(project) && (
            <p className="muted small job-dashboard-wc-contract">
              FRP contract: {frpJobLabel(project)}
            </p>
          )}
          {hasDistinctTrackContract(project) && (
            <p className="muted small job-dashboard-wc-contract">
              Track contract: {trackJobLabel(project)}
            </p>
          )}
          <GcContactLine
            label="GC PM"
            name={j.gc_pm.trim()}
            phone={j.gc_pm_phone.trim()}
            email={j.gc_pm_email.trim()}
          />
          <GcContactLine
            label="GC Super"
            name={j.gc_superintendent.trim()}
            phone={j.gc_super_phone.trim()}
            email={j.gc_super_email.trim()}
          />
          {(j.icbi_foreman.trim() || j.icbi_foreman_email.trim()) && (
            <GcContactLine
              label="Foreman"
              name={j.icbi_foreman.trim()}
              phone=""
              email={j.icbi_foreman_email.trim()}
            />
          )}
        </div>
        <div className="row-gap wrap job-dashboard-actions">
          {!setup.complete && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSetupOpen(true)}>
              Complete setup ({setup.missing.length} missing)
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSetupOpen(true)}>
            Job setup
          </button>
          <Link to={`/projects/${projectId}/paint`} className="btn btn-ghost btn-sm">
            Paint
          </Link>
        </div>
      </header>

      {!setup.complete && (
        <div className="banner banner-warn job-dashboard-setup-hint">
          One-time job setup feeds templates, submittals, and sheet pushes. Missing:{" "}
          {setup.missing.join(", ")}.{" "}
          <button type="button" className="link-btn" onClick={() => setSetupOpen(true)}>
            Open job setup
          </button>
        </div>
      )}

      <ProjectStartupChecklist
        project={project}
        projectId={projectId}
        jobInfoComplete={setup.complete}
        onOpenJobSetup={() => setSetupOpen(true)}
        onActivity={() => setActivityRefreshKey((k) => k + 1)}
      />

      <JobTrackerPanel
        project={project}
        projectId={projectId}
        onOpenJobSetup={() => setSetupOpen(true)}
        onProjectUpdate={onSaved}
      />

      <JobInfoSetupDrawer
        open={setupOpen}
        project={project}
        projectId={projectId}
        onClose={() => setSetupOpen(false)}
        onSaved={onSaved}
      />

      <ProjectActivityPanel project={project} refreshKey={activityRefreshKey} />
    </div>
  );
}
