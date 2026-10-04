import { NavLink, Navigate, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { useUnsavedNavigation } from "../../contexts/UnsavedNavigationContext";
import { projectHasFrp, projectHasWallcovering } from "../../lib/jobInfo";
import type { ProjectForm } from "../../types/database";

type Ctx = {
  project: ProjectForm;
  projectId: string;
  setProject: (p: ProjectForm) => void;
};

type HubTab = {
  id: string;
  label: string;
  /** Path under /submittals; empty string = log (index). */
  path: string;
  requiresWallcovering?: boolean;
  requiresFrp?: boolean;
};

const HUB_TABS: HubTab[] = [
  { id: "log", label: "Log", path: "" },
  { id: "paint", label: "Paint", path: "paint" },
  { id: "wallcovering", label: "Wallcovering", path: "wallcovering", requiresWallcovering: true },
  { id: "frp", label: "FRP", path: "frp", requiresFrp: true },
  { id: "package", label: "Package", path: "package" },
  { id: "transmittal", label: "Transmittal", path: "transmittal" },
];

export function SubmittalsHubLayout() {
  const ctx = useOutletContext<Ctx>();
  const { project, projectId } = ctx;
  const { requestNavigation } = useUnsavedNavigation();
  const location = useLocation();
  const base = `/projects/${projectId}/submittals`;
  const showWc = projectHasWallcovering(project.jobInfo);
  const showFrp = projectHasFrp(project.jobInfo);

  const tabs = HUB_TABS.filter((tab) => {
    if (tab.requiresWallcovering && !showWc) return false;
    if (tab.requiresFrp && !showFrp) return false;
    return true;
  });

  const onHiddenTrade =
    (!showWc && location.pathname.startsWith(`${base}/wallcovering`)) ||
    (!showFrp && location.pathname.startsWith(`${base}/frp`));

  return (
    <div className="submittals-hub stack">
      <nav className="submittals-hub-tabs job-tracker-tabs" aria-label="Submittals sections" role="tablist">
        {tabs.map((tab) => {
          const to = tab.path ? `${base}/${tab.path}` : base;
          return (
            <NavLink
              key={tab.id}
              to={to}
              end={tab.path === ""}
              role="tab"
              onClick={(e) => requestNavigation(to, e)}
              className={({ isActive }) =>
                `job-tracker-tab${isActive ? " job-tracker-tab--active" : ""}`
              }
            >
              {tab.label}
            </NavLink>
          );
        })}
      </nav>
      {onHiddenTrade ? <Navigate to={base} replace /> : <Outlet context={ctx} />}
    </div>
  );
}
