import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ProjectsAttentionCard } from "../components/projects/ProjectsAttentionCard";
import { ProjectStatusBadge } from "../components/projects/ProjectStatusBadge";
import { SubmittalStagePill } from "../components/projects/SubmittalStagePill";
import { StaffContactSelect } from "../components/projects/StaffContactSelect";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { defaultJobInfo } from "../types/jobInfo";
import { defaultProjectBilling } from "../types/projectBilling";
import { loadFieldToolsStaffForJobflow } from "../lib/fieldToolsStaff";
import {
  compareProjectsForListSort,
  computeProjectListSummaries,
  filterProjectsByStage,
  getSpotlight,
  loadProjectsListSortState,
  loadProjectsListStageFilter,
  nextProjectsListSortState,
  saveProjectsListSortState,
  saveProjectsListStageFilter,
  type ProjectsListSort,
  type ProjectsListSortState,
  type ProjectsListStageFilter,
} from "../lib/projectListSummary";
import {
  findStaffContact,
  jobInfoPatchFromStaffSelection,
  loadProjectStaffSettings,
} from "../lib/projectStaffSettings";
import {
  findStaffContactByName,
  jobInfoPatchFromProfilePm,
  shouldDefaultPmFromProfile,
} from "../lib/icbiPmDefaults";
import { supabase } from "../lib/supabase";
import { recordProjectActivity, resolveActivityUser } from "../lib/projectActivity";
import { listDoneProjectIds, fetchProjectIsDone } from "../lib/projectDone";
import { formatDateTime } from "../lib/strings";
import { type Project } from "../types/database";

function projectSearchText(p: Project): string {
  return [p.job_number, p.job_name, p.contractor, p.architect, p.owner, p.job_address, p.job_address2]
    .join(" ")
    .toLowerCase();
}

function normalizeJobNumber(value: string): string {
  return value.trim().toLowerCase();
}

/** Find an existing project with the same job number (includes completed jobs). */
async function findDuplicateJobNumber(jobNumber: string): Promise<{
  id: string;
  job_number: string;
  job_name: string;
  isDone: boolean;
} | null> {
  const needle = normalizeJobNumber(jobNumber);
  if (!needle) return null;
  const { data, error } = await supabase.from("projects").select("id, job_number, job_name");
  if (error || !data?.length) return null;
  const match = data.find((p) => normalizeJobNumber(p.job_number ?? "") === needle);
  if (!match) return null;
  const { isDone } = await fetchProjectIsDone(match.id);
  return {
    id: match.id,
    job_number: match.job_number ?? "",
    job_name: match.job_name ?? "",
    isDone,
  };
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { isAdmin, jobRole } = useAuth();
  const { profile } = useLetterhead();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [jobNumber, setJobNumber] = useState("");
  const [jobName, setJobName] = useState("");
  const [icbiIsGc, setIcbiIsGc] = useState(false);
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
  const [listSortState, setListSortState] = useState<ProjectsListSortState>(() =>
    loadProjectsListSortState(),
  );
  const [stageFilter, setStageFilter] = useState<ProjectsListStageFilter>(() =>
    loadProjectsListStageFilter(),
  );
  const pmDefaultedRef = useRef(false);

  const summaries = useMemo(() => computeProjectListSummaries(projects), [projects]);

  const attentionSpotlight = useMemo(() => getSpotlight(projects, summaries), [projects, summaries]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = q ? projects.filter((p) => projectSearchText(p).includes(q)) : projects;
    const staged = filterProjectsByStage(searched, summaries, stageFilter);
    return [...staged].sort((a, b) =>
      compareProjectsForListSort(a, b, summaries, listSortState.sort, listSortState.dir),
    );
  }, [projects, search, summaries, listSortState, stageFilter]);

  function onListSortChange(sort: ProjectsListSort) {
    const next = nextProjectsListSortState(listSortState, sort);
    setListSortState(next);
    saveProjectsListSortState(next);
  }

  function onStageFilterChange(filter: ProjectsListStageFilter) {
    setStageFilter(filter);
    saveProjectsListStageFilter(filter);
  }

  async function loadProjects() {
    setLoading(true);
    const [{ data, error: err }, doneRes] = await Promise.all([
      supabase.from("projects").select("*").order("updated_at", { ascending: false }),
      listDoneProjectIds(),
    ]);
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (doneRes.error) {
      setError(doneRes.error);
      return;
    }
    const done = new Set(doneRes.ids);
    setProjects((data ?? []).filter((p) => !done.has(p.id)));
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

  useEffect(() => {
    if (!showForm || staffLoading || pmId || pmDefaultedRef.current) return;
    if (!shouldDefaultPmFromProfile(profile, staffPms, jobRole)) return;
    const match = findStaffContactByName(staffPms, profile.name);
    if (match) {
      pmDefaultedRef.current = true;
      setPmId(match.id);
    }
  }, [showForm, staffLoading, pmId, profile, staffPms, jobRole]);

  function resetCreateForm() {
    setJobNumber("");
    setJobName("");
    setIcbiIsGc(false);
    setSuperId("");
    setForemanId("");
    setPmId("");
    pmDefaultedRef.current = false;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const trimmedNumber = jobNumber.trim();
    const trimmedName = jobName.trim();
    const duplicate = await findDuplicateJobNumber(trimmedNumber);
    if (duplicate) {
      const status = duplicate.isDone ? "marked completed" : "still active";
      const existingName = duplicate.job_name.trim() || "Untitled job";
      const ok = window.confirm(
        `Job number "${duplicate.job_number}" is already used by "${existingName}" (${status}).\n\nCreate another project with this job number anyway?`,
      );
      if (!ok) {
        setSaving(false);
        return;
      }
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    const superContact = findStaffContact(staffSupers, superId);
    const foremanContact = findStaffContact(staffForemen, foremanId);
    const pmContact = findStaffContact(staffPms, pmId);
    const jobInfo = {
      ...defaultJobInfo(),
      icbi_is_gc: icbiIsGc,
      ...jobInfoPatchFromStaffSelection(superContact, foremanContact, pmContact),
      ...(!pmContact ? jobInfoPatchFromProfilePm(profile, staffPms, jobRole) : {}),
    };
    const billing = defaultProjectBilling();
    const { data: inserted, error: err } = await supabase
      .from("projects")
      .insert({
        job_number: trimmedNumber,
        job_name: trimmedName,
        created_by: userId,
        updated_by: userId,
        data: { job_info: jobInfo, billing },
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
        summary: `Project created: ${trimmedNumber} · ${trimmedName}`,
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
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={icbiIsGc}
              onChange={(e) => setIcbiIsGc(e.target.checked)}
            />
            ICBI is the GC on this project
          </label>
          {icbiIsGc && (
            <p className="muted small">
              Self-perform paint POs get a trailing <strong>P</strong> (e.g. <code>1126-001P</code>) to
              tell them apart from ICBI's GC-side PO accounting.
            </p>
          )}
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
          {projects.length > 0 && <ProjectsAttentionCard spotlight={attentionSpotlight} />}

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
              <p>
                {search.trim()
                  ? `No projects match “${search.trim()}”.`
                  : "No projects match this filter."}
              </p>
            </div>
          ) : (
            <>
              <div className="projects-list-controls">
                <div className="projects-list-sort" role="group" aria-label="Sort projects">
                  <span className="projects-list-sort-label muted small">Sort</span>
                  {(
                    [
                      ["updated", "Updated"],
                      ["attention", "Needs attention"],
                      ["job", "Job #"],
                      ["name", "Name"],
                    ] as const
                  ).map(([id, label]) => {
                    const active = listSortState.sort === id;
                    const dirMark = active ? (listSortState.dir === "asc" ? " ↑" : " ↓") : "";
                    const title = active
                      ? `Sort by ${label} (${listSortState.dir === "asc" ? "ascending" : "descending"}). Click again to reverse.`
                      : `Sort by ${label}`;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`projects-list-sort-btn${active ? " projects-list-sort-btn--active" : ""}`}
                        onClick={() => onListSortChange(id)}
                        title={title}
                        aria-pressed={active}
                        aria-label={title}
                      >
                        {label}
                        {dirMark}
                      </button>
                    );
                  })}
                </div>
                <span className="projects-list-controls-sep" aria-hidden="true" />
                <div className="projects-list-sort" role="group" aria-label="Filter by submittal stage">
                  <span className="projects-list-sort-label muted small">Filter</span>
                  {(
                    [
                      ["all", "All"],
                      ["not_started", "Not started"],
                      ["not_needed", "Not Needed"],
                      ["ordered", "Ordered"],
                      ["submitted", "Submitted"],
                      ["revision", "Revision"],
                      ["approved", "Approved"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`projects-list-sort-btn projects-list-filter-btn${stageFilter === id ? " projects-list-filter-btn--active" : ""}`}
                      onClick={() => onStageFilterChange(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="card projects-table-shell">
                <div
                  className={`projects-table-scroller${filteredProjects.length > 10 ? " projects-table-scroller--scroll" : ""}`}
                >
                  <table className="projects-table">
                    <thead>
                      <tr>
                        <th>Job #</th>
                        <th>Name</th>
                        <th>Submittal</th>
                        <th>Attention</th>
                        <th>Updated</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjects.map((p) => {
                        const summary = summaries.get(p.id)!;
                        return (
                          <tr
                            key={p.id}
                            className="projects-table-row"
                            onDoubleClick={() => navigate(`/projects/${p.id}`)}
                          >
                          <td>{p.job_number}</td>
                            <td className="projects-table-name" title={p.job_name ?? undefined}>
                              <div className="projects-table-job-name">{p.job_name || "Untitled job"}</div>
                              {p.contractor?.trim() ? (
                                <div className="projects-table-gc muted small">{p.contractor.trim()}</div>
                              ) : null}
                            </td>
                            <td>
                              <SubmittalStagePill stage={summary.submittalStage} />
                            </td>
                            <td>
                              <ProjectStatusBadge summary={summary} tableMode />
                            </td>
                            <td className="muted">{formatDateTime(p.updated_at)}</td>
                            <td>
                              <Link className="btn btn-small" to={`/projects/${p.id}`}>
                                Open
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
