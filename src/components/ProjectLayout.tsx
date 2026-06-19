import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { PROJECT_MODULES } from "../config/projectModules";
import { supabase } from "../lib/supabase";
import type { ProjectForm } from "../types/database";
import { normalizeProject } from "../types/database";

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <p className="muted">Loading project…</p>;
  if (!project || !projectId) {
    return <p className="banner banner-error">{error ?? "Project not found"}</p>;
  }

  const base = `/projects/${projectId}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="breadcrumb">
            <Link to="/projects">Projects</Link> / {project.job_number}
          </p>
          <h1>
            {project.job_number} — {project.job_name}
          </h1>
        </div>
      </div>

      <nav className="module-tabs" aria-label="Project modules">
        {PROJECT_MODULES.map((mod) => (
          <NavLink
            key={mod.id}
            to={mod.path ? `${base}/${mod.path}` : base}
            end={mod.path === ""}
            className={({ isActive }) =>
              `module-tab${isActive ? " module-tab-active" : ""}${mod.ready ? "" : " module-tab-soon"}`
            }
          >
            {mod.label}
            {!mod.ready && <span className="module-soon">Soon</span>}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ project, projectId, setProject }} />
    </div>
  );
}
