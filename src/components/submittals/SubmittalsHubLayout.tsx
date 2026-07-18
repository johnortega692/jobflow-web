import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { useUnsavedNavigation } from "../../contexts/UnsavedNavigationContext";
import { projectHasWallcovering } from "../../lib/jobInfo";
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
};

const HUB_TABS: HubTab[] = [
  { id: "log", label: "Log", path: "" },
  { id: "paint", label: "Paint", path: "paint" },
  { id: "wallcovering", label: "Wallcovering", path: "wallcovering", requiresWallcovering: true },
  { id: "frp", label: "FRP", path: "frp" },
  { id: "package", label: "Package", path: "package" },
  { id: "transmittal", label: "Transmittal", path: "transmittal" },
];

export function SubmittalsHubLayout() {
  const ctx = useOutletContext<Ctx>();
  const { project, projectId } = ctx;
  const { requestNavigation } = useUnsavedNavigation();
  const base = `/projects/${projectId}/submittals`;
  const showWc = projectHasWallcovering(project.jobInfo);

  const tabs = HUB_TABS.filter((tab) => !tab.requiresWallcovering || showWc);

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
      <Outlet context={ctx} />
    </div>
  );
}
