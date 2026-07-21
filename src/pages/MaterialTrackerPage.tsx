import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { JobTrackerPanel, type TrackerTab } from "../components/jobinfo/JobTrackerPanel";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

export function MaterialTrackerPage() {
  const { project: initial, projectId, setProject: setProjectCtx } = useOutletContext<Ctx>();
  const [project, setProject] = useState(initial);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    setProject(initial);
  }, [initial]);

  const tabParam = searchParams.get("tab");
  const initialTab: TrackerTab =
    tabParam === "wallcovering" ? "wallcovering" : tabParam === "log" ? "log" : "paint";

  function onProjectUpdate(next: ProjectForm) {
    setProject(next);
    setProjectCtx(next);
  }

  return (
    <div className="stack material-tracker-page">
      <div className="card stack">
        <JobTrackerPanel
          project={project}
          projectId={projectId}
          onProjectUpdate={onProjectUpdate}
          initialTab={initialTab}
          editorMode
        />
      </div>
    </div>
  );
}
