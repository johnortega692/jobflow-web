import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrushoutsAddedPill } from "../components/projects/BrushoutsAddedPill";
import { ProjectsActiveFilters } from "../components/projects/ProjectsActiveFilters";
import { ProjectsFiltersMenu } from "../components/projects/ProjectsFiltersMenu";
import { ProjectsListSortControl } from "../components/projects/ProjectsListSortControl";
import { ProjectsStatusChips } from "../components/projects/ProjectsStatusChips";
import { ProjectsAttentionCard } from "../components/projects/ProjectsAttentionCard";
import { FollowUpsColumnPill, ProjectsFollowUpsCard } from "../components/projects/ProjectsFollowUpsCard";
import { ProjectStatusBadge } from "../components/projects/ProjectStatusBadge";
import { SubmittalStagePill } from "../components/projects/SubmittalStagePill";
import { StaffContactSelect } from "../components/projects/StaffContactSelect";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { gcCompanyName } from "../lib/gcCompanyName";
import { defaultJobInfo } from "../types/jobInfo";
import { defaultProjectBilling } from "../types/projectBilling";
import { loadFieldToolsStaffForJobflow } from "../lib/fieldToolsStaff";
import {
  compareProjectsForListSort,
  computeProjectListSummaries,
  defaultSortDir,
  getSpotlight,
  projectJobStartLabel,
  projectJobStartRelative,
  loadProjectsListSortState,
  projectsListColumnForSort,
  saveProjectsListSortState,
  type ProjectsListSort,
  type ProjectsListSortColumn,
  type ProjectsListSortState,
} from "../lib/projectListSummary";
import {
  defaultProjectsListFilters,
  filterProjectsForList,
  generalContractorOptions,
  loadProjectsListFilters,
  removeProjectsListFilterPill,
  saveProjectsListFilters,
  statusChipCounts,
  toggleStatusFilter,
  type ProjectsListFilters,
} from "../lib/projectListFilters";
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
import { listOpenProjectFollowUps, type OpenProjectFollowUp } from "../lib/projectNotes";
import { supabase } from "../lib/supabase";
import { recordProjectActivity, resolveActivityUser } from "../lib/projectActivity";
import { CUSTOM_GC_STARTUP_ITEM_IDS, catalogSeedForId } from "../config/projectStartupItemsCatalog";
import { applyCustomGcStartupItems, loadDefaultStartupItems } from "../lib/projectStartupItems";
import { listProjectIdsWithApprovedBrushouts } from "../lib/approvedBrushouts";
import { listDoneProjectIds, fetchProjectIsDone } from "../lib/projectDone";
import { isRfiClosed } from "../lib/rfiStatus";
import { type Project } from "../types/database";

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
  const [approvedBrushoutIds, setApprovedBrushoutIds] = useState<Set<string>>(new Set());
  const [openRfiCounts, setOpenRfiCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [jobNumber, setJobNumber] = useState("");
  const [jobName, setJobName] = useState("");
  const [icbiIsGc, setIcbiIsGc] = useState(false);
  const [customGcStartup, setCustomGcStartup] = useState(false);
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
  const [listFilters, setListFilters] = useState<ProjectsListFilters>(() => loadProjectsListFilters());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [followUps, setFollowUps] = useState<OpenProjectFollowUp[]>([]);
  const [followUpsError, setFollowUpsError] = useState<string | null>(null);
  const pmDefaultedRef = useRef(false);

  const summaries = useMemo(() => {
    const base = computeProjectListSummaries(projects);
    if (!openRfiCounts.size) return base;
    const next = new Map(base);
    for (const [id, summary] of next) {
      const openRfiCount = openRfiCounts.get(id) ?? 0;
      if (!openRfiCount) continue;
      next.set(id, {
        ...summary,
        openRfiCount,
        attentionCount: summary.attentionCount + openRfiCount,
      });
    }
    return next;
  }, [projects, openRfiCounts]);

  const openProjects = useMemo(
    () => projects.filter((project) => !doneIds.has(project.id)),
    [projects, doneIds],
  );
  const openProjectIds = useMemo(() => new Set(openProjects.map((project) => project.id)), [openProjects]);
  const noteFlagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of followUps) {
      if (row.type !== "flag" || !openProjectIds.has(row.projectId)) continue;
      counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1);
    }
    return counts;
  }, [followUps, openProjectIds]);
  const attentionSpotlight = useMemo(() => {
    if (!noteFlagCounts.size) return getSpotlight(openProjects, summaries);
    const augmented = new Map(summaries);
    for (const [id, extra] of noteFlagCounts) {
      const summary = augmented.get(id);
      if (!summary || extra <= 0) continue;
      augmented.set(id, { ...summary, attentionCount: summary.attentionCount + extra });
    }
    return getSpotlight(openProjects, augmented);
  }, [openProjects, summaries, noteFlagCounts]);
  const followUpsByProject = useMemo(() => {
    const grouped = new Map<string, OpenProjectFollowUp[]>();
    for (const row of followUps) {
      const list = grouped.get(row.projectId);
      if (list) list.push(row);
      else grouped.set(row.projectId, [row]);
    }
    return grouped;
  }, [followUps]);
  const filterContext = useMemo(
    () => ({
      search,
      summaries,
      brushoutsAdded: approvedBrushoutIds,
      doneIds,
    }),
    [search, summaries, approvedBrushoutIds, doneIds],
  );
  const listUniverse = useMemo(
    () => (listFilters.includeClosed ? projects : openProjects),
    [projects, openProjects, listFilters.includeClosed],
  );
  const gcOptions = useMemo(() => generalContractorOptions(listUniverse), [listUniverse]);
  const statusPool = useMemo(
    () => filterProjectsForList(projects, listFilters, filterContext, { ignoreStatus: true }),
    [projects, listFilters, filterContext],
  );
  const statusCounts = useMemo(() => statusChipCounts(statusPool, summaries), [statusPool, summaries]);
  const filteredProjects = useMemo(() => {
    const matched = filterProjectsForList(projects, listFilters, filterContext);
    return [...matched].sort((a, b) =>
      compareProjectsForListSort(
        a,
        b,
        summaries,
        listSortState.sort,
        listSortState.dir,
        approvedBrushoutIds,
      ),
    );
  }, [projects, listFilters, filterContext, summaries, listSortState, approvedBrushoutIds]);

  function applyListSort(next: ProjectsListSortState) {
    setListSortState(next);
    saveProjectsListSortState(next);
  }

  function onSelectSort(sort: ProjectsListSort) {
    applyListSort({ sort, dir: defaultSortDir(sort) });
  }

  function onToggleSortDir() {
    applyListSort({
      sort: listSortState.sort,
      dir: listSortState.dir === "asc" ? "desc" : "asc",
    });
  }

  function onColumnSort(column: ProjectsListSortColumn) {
    if (projectsListColumnForSort(listSortState.sort) === column) {
      onToggleSortDir();
      return;
    }
    onSelectSort(column);
  }

  function applyListFilters(next: ProjectsListFilters) {
    setListFilters(next);
    saveProjectsListFilters(next);
  }

  async function loadProjects() {
    setLoading(true);
    const [{ data, error: err }, doneRes, brushoutIds, , rfiRes, followUpsRes] = await Promise.all([
      supabase.from("projects").select("*").order("updated_at", { ascending: false }),
      listDoneProjectIds(),
      listProjectIdsWithApprovedBrushouts().catch(() => new Set<string>()),
      loadDefaultStartupItems(),
      supabase.from("rfis").select("project_id, status"),
      listOpenProjectFollowUps()
        .then((rows) => ({ rows, error: null as string | null }))
        .catch((err: unknown) => ({
          rows: [] as OpenProjectFollowUp[],
          error: err instanceof Error ? err.message : "Could not load follow-ups.",
        })),
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
    setDoneIds(new Set(doneRes.ids));
    setApprovedBrushoutIds(brushoutIds);
    const rfiCounts = new Map<string, number>();
    for (const row of rfiRes.data ?? []) {
      const projectId = row.project_id;
      if (!projectId || isRfiClosed(row.status)) continue;
      rfiCounts.set(projectId, (rfiCounts.get(projectId) ?? 0) + 1);
    }
    setOpenRfiCounts(rfiCounts);
    setFollowUps(followUpsRes.rows);
    setFollowUpsError(followUpsRes.error);
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
    setCustomGcStartup(false);
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
    const startupBase = await loadDefaultStartupItems();
    const startupItems = customGcStartup ? applyCustomGcStartupItems(startupBase) : startupBase;
    const { data: inserted, error: err } = await supabase
      .from("projects")
      .insert({
        job_number: trimmedNumber,
        job_name: trimmedName,
        created_by: userId,
        updated_by: userId,
        data: { job_info: jobInfo, billing, startup_items: startupItems },
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
        <div className="page-header-actions">
          <Link
            to="/projects/by-gc"
            className="btn btn-secondary"
            title="Group this year's projects by GC with job count and contract amount"
          >
            Projects by GC
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => {
            if (showForm) resetCreateForm();
            setShowForm((v) => !v);
          }}>
            {showForm ? "Cancel" : "New project"}
          </button>
        </div>
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
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={customGcStartup}
              onChange={(e) => setCustomGcStartup(e.target.checked)}
            />
            Custom GC startup and field options
          </label>
          {customGcStartup && (
            <ul className="muted small" style={{ margin: "0 0 0 1.6rem" }}>
              {CUSTOM_GC_STARTUP_ITEM_IDS.map((id) => (
                <li key={id}>{catalogSeedForId(id)?.label ?? id}</li>
              ))}
            </ul>
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
          {openProjects.length > 0 && <ProjectsAttentionCard spotlight={attentionSpotlight} />}
          {followUpsError ? (
            <div className="banner banner-error" role="alert">
              {followUpsError}
            </div>
          ) : null}
          <ProjectsFollowUpsCard items={followUps} activeProjectIds={openProjectIds} onChange={setFollowUps} />

          <div className="projects-toolbar">
            <div className="projects-toolbar-search">
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
            <ProjectsListSortControl
              sort={listSortState.sort}
              dir={listSortState.dir}
              onSelect={onSelectSort}
              onToggleDir={onToggleSortDir}
            />
            <ProjectsFiltersMenu
              filters={listFilters}
              gcOptions={gcOptions}
              onChange={applyListFilters}
            />
          </div>

          <ProjectsStatusChips
            filters={listFilters}
            counts={statusCounts}
            total={statusPool.length}
            onToggle={(id) => applyListFilters(toggleStatusFilter(listFilters, id))}
            onClear={() => applyListFilters({ ...listFilters, stages: [] })}
          />

          <ProjectsActiveFilters
            shown={filteredProjects.length}
            total={listUniverse.length}
            filters={listFilters}
            onRemove={(key) => applyListFilters(removeProjectsListFilterPill(listFilters, key))}
            onClear={() => applyListFilters(defaultProjectsListFilters())}
          />

          <div className="card projects-table-shell">
                <div
                  className={`projects-table-scroller${filteredProjects.length > 10 ? " projects-table-scroller--scroll" : ""}`}
                >
                  <table className="projects-table">
                    <thead>
                      <tr>
                        {(
                          [
                            ["job", "Job #"],
                            ["name", "Name"],
                            ["submittal", "Submittal"],
                            ["brushouts", "Brush-outs"],
                            ["attention", "Attention"],
                            ["start", "Job start"],
                          ] as const
                        ).flatMap(([column, label]) => {
                          const active = projectsListColumnForSort(listSortState.sort) === column;
                          const arrowDir = active ? listSortState.dir : defaultSortDir(column);
                          const header = (
                            <th
                              key={column}
                              aria-sort={active ? (listSortState.dir === "asc" ? "ascending" : "descending") : "none"}
                            >
                              <button
                                type="button"
                                className={`projects-table-sort${active ? " projects-table-sort--active" : ""}`}
                                onClick={() => onColumnSort(column)}
                              >
                                {label}
                                <span className="projects-table-sort-arrow" aria-hidden="true">
                                  {arrowDir === "asc" ? "▲" : "▼"}
                                </span>
                              </button>
                            </th>
                          );
                          if (column !== "attention") return [header];
                          return [
                            header,
                            <th key="follow-ups">
                              <span className="projects-followups-colhead">Follow-ups</span>
                            </th>,
                          ];
                        })}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjects.length === 0 ? (
                        <tr>
                          <td className="projects-table-empty" colSpan={8}>
                            No jobs match these filters.{" "}
                            <button
                              type="button"
                              className="projects-filters-clear"
                              onClick={() => applyListFilters(defaultProjectsListFilters())}
                            >
                              Clear filters
                            </button>
                          </td>
                        </tr>
                      ) : null}
                      {filteredProjects.map((p) => {
                        const summary = summaries.get(p.id)!;
                        const startRelative = projectJobStartRelative(p);
                        return (
                          <tr
                            key={p.id}
                            className="projects-table-row"
                            onDoubleClick={() => navigate(`/projects/${p.id}`)}
                          >
                          <td>{p.job_number}</td>
                            <td className="projects-table-name" title={p.job_name ?? undefined}>
                              <div className="projects-table-job-name">{p.job_name || "Untitled job"}</div>
                              {gcCompanyName(p.contractor ?? "") ? (
                                <div className="projects-table-gc muted small">{gcCompanyName(p.contractor ?? "")}</div>
                              ) : null}
                            </td>
                            <td>
                              <SubmittalStagePill stage={summary.submittalStage} />
                            </td>
                            <td>
                              <BrushoutsAddedPill added={approvedBrushoutIds.has(p.id)} />
                            </td>
                            <td>
                              <ProjectStatusBadge summary={summary} tableMode />
                            </td>
                            <td>
                              <FollowUpsColumnPill rows={followUpsByProject.get(p.id)} />
                            </td>
                            <td>
                              <div className="muted">{projectJobStartLabel(p)}</div>
                              {startRelative && (
                                <div
                                  className={`projects-start-relative${startRelative.soon ? " projects-start-relative--soon" : ""}`}
                                >
                                  {startRelative.text}
                                </div>
                              )}
                            </td>
                            <td className="projects-table-open-cell">
                              <Link
                                className="btn btn-icon btn-small projects-table-open"
                                to={`/projects/${p.id}`}
                                aria-label={`Open ${p.job_name || p.job_number || "project"}`}
                                title="Open"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="24"
                                  height="24"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                  aria-hidden
                                >
                                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                                  <path d="M9.707 5.293l6 6a1 1 0 0 1 0 1.414l-6 6a1 1 0 1 1 -1.414 -1.414l5.293 -5.293l-5.293 -5.293a1 1 0 0 1 1.414 -1.414" />
                                </svg>
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
    </div>
  );
}
