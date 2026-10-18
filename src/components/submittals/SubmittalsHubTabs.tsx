import { useEffect, useState } from "react";
import { NavLink, useOutletContext } from "react-router-dom";
import { useUnsavedNavigation } from "../../contexts/UnsavedNavigationContext";
import { listProjectBrushouts } from "../../lib/approvedBrushouts";
import { projectHasFrp, projectHasWallcovering } from "../../lib/jobInfo";
import type { ProjectForm } from "../../types/database";

type Ctx = {
  project: ProjectForm;
  projectId: string;
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

type Props = {
  /** Saved approved-line count. When omitted, the tab loads it. */
  badgeCount?: number;
};

export function SubmittalsHubTabs({ badgeCount }: Props) {
  const { project, projectId } = useOutletContext<Ctx>();
  const { requestNavigation } = useUnsavedNavigation();
  const [loadedCount, setLoadedCount] = useState<number | null>(null);
  const base = `/projects/${projectId}/submittals`;
  const approvedTo = `/projects/${projectId}/approved-brushouts`;
  const showWc = projectHasWallcovering(project.jobInfo);
  const showFrp = projectHasFrp(project.jobInfo);

  const tabs = HUB_TABS.filter((tab) => {
    if (tab.requiresWallcovering && !showWc) return false;
    if (tab.requiresFrp && !showFrp) return false;
    return true;
  });

  useEffect(() => {
    if (badgeCount != null) return;
    let cancelled = false;
    void listProjectBrushouts(projectId)
      .then((rows) => {
        if (!cancelled) setLoadedCount(rows.filter((row) => row.approved).length);
      })
      .catch(() => {
        if (!cancelled) setLoadedCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [badgeCount, projectId]);

  const count = badgeCount ?? loadedCount ?? 0;

  return (
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
            className={({ isActive }) => `job-tracker-tab${isActive ? " job-tracker-tab--active" : ""}`}
          >
            {tab.label}
          </NavLink>
        );
      })}
      <span className="submittals-hub-tabs-rule" aria-hidden="true" />
      <NavLink
        to={approvedTo}
        role="tab"
        onClick={(e) => requestNavigation(approvedTo, e)}
        className={({ isActive }) => `job-tracker-tab${isActive ? " job-tracker-tab--active" : ""}`}
      >
        Approved brush-outs
        {count > 0 ? <span className="submittals-hub-tab-count">{count}</span> : null}
      </NavLink>
    </nav>
  );
}
