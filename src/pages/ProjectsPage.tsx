import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StaffContactSelect } from "../components/projects/StaffContactSelect";
import { useAuth } from "../contexts/AuthContext";
import { defaultJobInfo } from "../types/jobInfo";
import { loadFieldToolsStaffForJobflow } from "../lib/fieldToolsStaff";
import {
  findStaffContact,
  jobInfoPatchFromStaffSelection,
  loadProjectStaffSettings,
} from "../lib/projectStaffSettings";
import { supabase } from "../lib/supabase";
import { recordProjectActivity, resolveActivityUser } from "../lib/projectActivity";
import { formatDateTime } from "../lib/strings";
import type { Project } from "../types/database";

function projectSearchText(p: Project): string {
  return [p.job_number, p.job_name, p.contractor, p.architect, p.owner, p.job_address, p.job_address2]
    .join(" ")
    .toLowerCase();
}

export function ProjectsPage() {
  const { isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [jobNumber, setJobNumber] = useState("");
  const [jobName, setJobName] = useState("");
  const [superId, setSuperId] = useState("");
  const [foremanId, setForemanId] = useState("");
  const [pmId, setPmId] = useState("");
  const [staffSupers, setStaffSupers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [staffForemen, setStaffForemen] = useState<{ id: string; name: string; email: string }[]>([]);
  const [staffPms, setStaffPms] = useState<{ id: string; name: string; email: string }[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [fieldStaffError, setFieldStaffError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const recentProjects = useMemo(() => projects.slice(0, 3), [projects]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => projectSearchText(p).includes(q));
  }, [projects, search]);

  async function loadProjects() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setProjects(data ?? []);
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!showForm) return;
    setStaffLoading(true);
    setFieldStaffError(null);
    void Promise.all([loadFieldToolsStaffForJobflow(), loadProjectStaffSettings()])
      .then(([fieldStaff, officeStaff]) => {
        setStaffSupers(fieldStaff.lists.supers);
        setStaffForemen(fieldStaff.lists.foremen);
        setStaffPms(officeStaff.project_staff_pms);
        setFieldStaffError(fieldStaff.error);
      })
      .catch(() => {
        setStaffSupers([]);
        setStaffForemen([]);
        setStaffPms([]);
        setFieldStaffError("Could not load Field Tools staff.");
      })
      .finally(() => setStaffLoading(false));
  }, [showForm]);

  function resetCreateForm() {
    setJobNumber("");
    setJobName("");
    setSuperId("");
    setForemanId("");
    setPmId("");
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    const superContact = findStaffContact(staffSupers, superId);
    const foremanContact = findStaffContact(staffForemen, foremanId);
    const pmContact = findStaffContact(staffPms, pmId);
    const jobInfo = {
      ...defaultJobInfo(),
      ...jobInfoPatchFromStaffSelection(superContact, foremanContact, pmContact),
    };
    const { data: inserted, error: err } = await supabase
      .from("projects")
      .insert({
        job_number: jobNumber.trim(),
        job_name: jobName.trim(),
        created_by: userId,
        updated_by: userId,
        data: { job_info: jobInfo },
      })
      .select("id")
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (inserted?.id) {
      const actor = await resolveActivityUser();
      await recordProjectActivity({
        projectId: inserted.id,
        action: "project_created",
        summary: `Project created: ${jobNumber.trim()} · ${jobName.trim()}`,
        user: actor,
      });
    }
    resetCreateForm();
    setShowForm(false);
    await loadProjects();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => {
          if (showForm) resetCreateForm();
          setShowForm((v) => !v);
        }}>
          {showForm ? "Cancel" : "New project"}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {showForm && (
        <form className="card stack" onSubmit={onCreate}>
          <h2>New project</h2>
          <div className="grid-2">
            <label>
              Job number
              <input
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                placeholder="25-P2044"
                required
              />
            </label>
            <label>
              Job name
              <input
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="Sample Building"
                required
              />
            </label>
          </div>
          <div className="grid-3">
            <StaffContactSelect
              label="PM"
              contacts={staffPms}
              value={pmId}
              onChange={setPmId}
              emptyHint={
                staffLoading
                  ? "Loading staff list…"
                  : isAdmin
                    ? "Add PMs in Settings → Project staff."
                    : "Ask an admin to add PMs in Settings."
              }
            />
            <StaffContactSelect
              label="Super"
              contacts={staffSupers}
              value={superId}
              onChange={setSuperId}
              emptyHint={
                staffLoading
                  ? "Loading staff list…"
                  : "Add supers in Field Tools admin (Field app)."
              }
            />
            <StaffContactSelect
              label="Foreman"
              contacts={staffForemen}
              value={foremanId}
              onChange={setForemanId}
              emptyHint={
                staffLoading
                  ? "Loading staff list…"
                  : "Add foremen in Field Tools admin (Field app)."
              }
            />
          </div>
          {fieldStaffError && (
            <p className="banner banner-warn">{fieldStaffError}</p>
          )}
          {isAdmin && !staffLoading && !staffPms.length ? (
            <p className="muted small">
              PMs:{" "}
              <Link to="/settings" state={{ tab: "project-staff" }}>
                Settings → Project staff
              </Link>
              . Supers &amp; foremen:{" "}
              <Link to="/field" target="_blank" rel="noopener noreferrer">
                Field Tools
              </Link>
              .
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Create project"}
          </button>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading projects…</p>
      ) : projects.length === 0 ? (
        <div className="card empty-state">
          <p>No projects yet. Create one to start RFIs.</p>
        </div>
      ) : (
        <>
          {recentProjects.length > 0 && (
            <section className="projects-recent-section">
              <h2 className="projects-recent-heading">Recently updated</h2>
              <div className="projects-recent-grid">
                {recentProjects.map((p) => (
                  <Link key={p.id} className="projects-recent-card card" to={`/projects/${p.id}`}>
                    <div className="projects-recent-job">{p.job_number}</div>
                    <div className="projects-recent-name">{p.job_name || "Untitled job"}</div>
                    {p.contractor?.trim() && (
                      <div className="projects-recent-meta muted small">{p.contractor}</div>
                    )}
                    <div className="projects-recent-meta muted small">
                      {formatDateTime(p.updated_at)}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="projects-search-wrap">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job #, name, GC, address…"
              aria-label="Search projects"
            />
            {search.trim() && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearch("")}>
                Clear
              </button>
            )}
          </div>

          {filteredProjects.length === 0 ? (
            <div className="card empty-state">
              <p>No projects match &ldquo;{search.trim()}&rdquo;.</p>
            </div>
          ) : (
            <div className="table-wrap card">
              <table>
                <thead>
                  <tr>
                    <th>Job #</th>
                    <th>Name</th>
                    <th>Updated</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.job_number}</td>
                      <td>{p.job_name}</td>
                      <td className="muted">{formatDateTime(p.updated_at)}</td>
                      <td>
                        <Link className="btn btn-small" to={`/projects/${p.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
