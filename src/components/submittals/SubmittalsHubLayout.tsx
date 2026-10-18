import { Navigate, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { projectHasFrp, projectHasWallcovering } from "../../lib/jobInfo";
import type { ProjectForm } from "../../types/database";
import { SubmittalsHubTabs } from "./SubmittalsHubTabs";

type Ctx = {
  project: ProjectForm;
  projectId: string;
  setProject: (p: ProjectForm) => void;
};

export function SubmittalsHubLayout() {
  const ctx = useOutletContext<Ctx>();
  const { project, projectId } = ctx;
  const location = useLocation();
  const base = `/projects/${projectId}/submittals`;
  const showWc = projectHasWallcovering(project.jobInfo);
  const showFrp = projectHasFrp(project.jobInfo);

  const onHiddenTrade =
    (!showWc && location.pathname.startsWith(`${base}/wallcovering`)) ||
    (!showFrp && location.pathname.startsWith(`${base}/frp`));

  return (
    <div className="submittals-hub stack">
      <SubmittalsHubTabs />
      {onHiddenTrade ? <Navigate to={base} replace /> : <Outlet context={ctx} />}
    </div>
  );
}
