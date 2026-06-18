import { FormEvent, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { orEmpty } from "../lib/strings";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

export function ProjectOverviewPage() {
  const { project: initial, projectId } = useOutletContext<Ctx>();
  const [project, setProject] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function saveProject(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
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
      .eq("id", projectId);
    setSaving(false);
    if (err) setError(err.message);
    else setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      <form className="card stack" onSubmit={saveProject}>
        <div className="row-between">
          <h2>Job info</h2>
          {savedAt && <span className="muted small">Saved {savedAt}</span>}
        </div>
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
              value={orEmpty(project.job_address)}
              onChange={(e) => setProject({ ...project, job_address: e.target.value })}
            />
          </label>
          <label>
            Address line 2
            <input
              value={orEmpty(project.job_address2)}
              onChange={(e) => setProject({ ...project, job_address2: e.target.value })}
            />
          </label>
          <label>
            Contractor / GC
            <input
              value={orEmpty(project.contractor)}
              onChange={(e) => setProject({ ...project, contractor: e.target.value })}
            />
          </label>
          <label>
            Architect
            <input
              value={orEmpty(project.architect)}
              onChange={(e) => setProject({ ...project, architect: e.target.value })}
            />
          </label>
          <label>
            Owner
            <input
              value={orEmpty(project.owner)}
              onChange={(e) => setProject({ ...project, owner: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" className="btn btn-secondary" disabled={saving}>
          {saving ? "Saving…" : "Save project"}
        </button>
      </form>
    </>
  );
}
