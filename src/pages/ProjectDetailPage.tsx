import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Project, Rfi } from "../types/database";
import { normalizeProject } from "../types/database";

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!projectId) return;
    setLoading(true);
    const [projRes, rfiRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).single(),
      supabase
        .from("rfis")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false }),
    ]);
    setLoading(false);
    if (projRes.error) {
      setError(projRes.error.message);
      return;
    }
    if (rfiRes.error) {
      setError(rfiRes.error.message);
      return;
    }
    setProject(normalizeProject(projRes.data));
    setRfis(rfiRes.data ?? []);
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function saveProject(e: FormEvent) {
    e.preventDefault();
    if (!project) return;
    setSaving(true);
    const { error: err } = await supabase
      .from("projects")
      .update({
        job_number: project.job_number,
        job_name: project.job_name,
        job_address: project.job_address,
        job_address2: project.job_address2,
        contractor: project.contractor,
        architect: project.architect,
        owner: project.owner,
      })
      .eq("id", project.id);
    setSaving(false);
    if (err) setError(err.message);
    else await load();
  }

  async function createRfi() {
    if (!projectId) return;
    const nextNum = String(rfis.length + 1).padStart(3, "0");
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("rfis")
      .insert({
        project_id: projectId,
        rfi_number: nextNum,
        subject: "New RFI",
        created_by: userData.user?.id ?? null,
      })
      .select()
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    navigate(`/projects/${projectId}/rfis/${data.id}`);
  }

  if (loading) return <p className="muted">Loading project…</p>;
  if (!project) return <p className="banner banner-error">{error ?? "Project not found"}</p>;

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
        <button type="button" className="btn btn-primary" onClick={() => void createRfi()}>
          New RFI
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <form className="card stack" onSubmit={saveProject}>
        <h2>Project info</h2>
        <div className="grid-2">
          <label>
            Job number
            <input
              value={project.job_number}
              onChange={(e) => setProject({ ...project, job_number: e.target.value })}
            />
          </label>
          <label>
            Job name
            <input
              value={project.job_name}
              onChange={(e) => setProject({ ...project, job_name: e.target.value })}
            />
          </label>
          <label>
            Address
            <input
              value={project.job_address}
              onChange={(e) => setProject({ ...project, job_address: e.target.value })}
            />
          </label>
          <label>
            Address line 2
            <input
              value={project.job_address2}
              onChange={(e) => setProject({ ...project, job_address2: e.target.value })}
            />
          </label>
          <label>
            Contractor
            <input
              value={project.contractor}
              onChange={(e) => setProject({ ...project, contractor: e.target.value })}
            />
          </label>
          <label>
            Architect
            <input
              value={project.architect}
              onChange={(e) => setProject({ ...project, architect: e.target.value })}
            />
          </label>
          <label>
            Owner
            <input
              value={project.owner}
              onChange={(e) => setProject({ ...project, owner: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" className="btn btn-secondary" disabled={saving}>
          {saving ? "Saving…" : "Save project"}
        </button>
      </form>

      <section className="card">
        <h2>RFIs</h2>
        {rfis.length === 0 ? (
          <p className="muted">No RFIs yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rfis.map((r) => (
                  <tr key={r.id}>
                    <td>{r.rfi_number}</td>
                    <td>{r.subject}</td>
                    <td>{r.status}</td>
                    <td className="muted">{new Date(r.updated_at).toLocaleString()}</td>
                    <td>
                      <Link
                        className="btn btn-small"
                        to={`/projects/${projectId}/rfis/${r.id}`}
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
