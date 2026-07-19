import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import {
  UnsavedNavigationProvider,
  useUnsavedNavigation,
} from "../contexts/UnsavedNavigationContext";
import { ProjectNavIcon } from "./ProjectNavIcon";
import {
  PROJECT_DETAIL_MODULE_IDS,
  PROJECT_MODULES,
  PROJECT_NAV_SECTIONS,
} from "../config/projectModules";
import { projectHasWallcovering } from "../lib/jobInfo";
import { supabase } from "../lib/supabase";
import type { ProjectForm } from "../types/database";
import { normalizeProject } from "../types/database";

function matchModule(pathname: string, base: string) {
  let active = PROJECT_MODULES[0];
  let bestLen = -1;
  for (const mod of PROJECT_MODULES) {
    const modBase = mod.path ? `${base}/${mod.path}` : base;
    const exact = pathname === modBase;
    // Dashboard (empty path) only matches the project root — not every nested route.
    const nested = Boolean(mod.path) && pathname.startsWith(`${modBase}/`);
    if ((exact || nested) && modBase.length > bestLen) {
      bestLen = modBase.length;
      active = mod;
    }
  }
  const modBase = active.path ? `${base}/${active.path}` : base;
  const isDetailView =
    PROJECT_DETAIL_MODULE_IDS.has(active.id) &&
    pathname !== modBase &&
    pathname.startsWith(`${modBase}/`);
  return { activeModule: active, isDetailView };
}

function ProjectLayoutShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const { requestNavigation } = useUnsavedNavigation();
  const [project, setProject] = useState<ProjectForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem("jobflow.project.nav-collapsed") === "1";
    } catch {
      return false;
    }
  });

  function setNavCollapsedPersist(next: boolean) {
    setNavCollapsed(next);
    try {
      localStorage.setItem("jobflow.project.nav-collapsed", next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    async function load() {
      if (!projectId) return;
      setLoading(true);
      const { data, error: err } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      setProject(normalizeProject(data));
    }
    void load();
  }, [projectId]);

  const base = projectId ? `/projects/${projectId}` : "";
  const { activeModule, isDetailView } = useMemo(
    () => (base ? matchModule(location.pathname, base) : { activeModule: PROJECT_MODULES[0], isDetailView: false }),
    [location.pathname, base],
  );

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  if (loading) return <p className="muted">Loading project…</p>;
  if (!project || !projectId) {
    return <p className="banner banner-error">{error ?? "Project not found"}</p>;
  }

  const showModule = (mod: (typeof PROJECT_MODULES)[number]) =>
    !mod.requiresWallcovering || projectHasWallcovering(project.jobInfo);

  return (
    <div
      className={`project-shell${navOpen ? " project-shell--nav-open" : ""}${
        navCollapsed ? " project-shell--nav-collapsed" : ""
      }`}
    >
      {navOpen && (
        <button
          type="button"
          className="project-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}

      {navCollapsed ? (
        <button
          type="button"
          className="project-nav-expand"
          title="Show panel"
          aria-label="Show panel"
          aria-expanded={false}
          aria-controls="project-sidebar"
          onClick={() => setNavCollapsedPersist(false)}
        >
          »
        </button>
      ) : null}

      <aside id="project-sidebar" className="project-sidebar" aria-label="Project navigation">
        <div className="project-sidebar-header">
          <div className="project-sidebar-header-main">
            <p className="project-sidebar-job">{project.job_number}</p>
            <p className="project-sidebar-name" title={project.job_name}>
              {project.job_name}
            </p>
          </div>
          <button
            type="button"
            className="project-nav-collapse"
            title="Hide panel"
            aria-label="Hide panel"
            aria-expanded={true}
            onClick={() => setNavCollapsedPersist(true)}
          >
            «
          </button>
        </div>

        <nav className="project-nav" aria-label="Project modules">
          {PROJECT_NAV_SECTIONS.map((section) => {
            const modules = section.modules.filter(showModule);
            if (!modules.length) return null;
            return (
            <div key={section.id} className="project-nav-section">
              {section.label && (
                <p className="project-nav-section-label">{section.label}</p>
              )}
              <div className="project-nav-section-links">
                {modules.map((mod) => {
                  const modTo = mod.path ? `${base}/${mod.path}` : base;
                  return (
                  <NavLink
                    key={mod.id}
                    to={modTo}
                    end={mod.path === ""}
                    onClick={(e) => requestNavigation(modTo, e)}
                    className={({ isActive }) =>
                      `project-nav-link${isActive ? " project-nav-link--active" : ""}${mod.ready ? "" : " project-nav-link--soon"}`
                    }
                  >
                    <span className="project-nav-link-main">
                      <ProjectNavIcon id={mod.id} />
                      <span className="project-nav-label">{mod.label}</span>
                    </span>
                    {!mod.ready && <span className="module-soon">Soon</span>}
                  </NavLink>
                  );
                })}
              </div>
            </div>
            );
          })}
        </nav>
      </aside>

      <div className="project-main">
        <div className="project-main-toolbar">
          <button
            type="button"
            className="btn btn-ghost project-nav-toggle"
            aria-expanded={navOpen}
            aria-controls="project-sidebar"
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? "Close menu" : activeModule.label}
          </button>
          {!isDetailView && activeModule.id !== "submittals" && activeModule.id !== "orders" && (
            <div className="page-header project-page-header">
              <h1>{activeModule.label}</h1>
            </div>
          )}
        </div>

        <Outlet context={{ project, projectId, setProject }} />
      </div>
    </div>
  );
}

export function ProjectLayout() {
  return (
    <UnsavedNavigationProvider>
      <ProjectLayoutShell />
    </UnsavedNavigationProvider>
  );
}
