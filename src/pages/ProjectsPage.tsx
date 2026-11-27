import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ProjectsRouteState } from "../components/ProjectsNavMenu";
import { BrushoutsAddedPill } from "../components/projects/BrushoutsAddedPill";
import { ProjectsActiveFilters } from "../components/projects/ProjectsActiveFilters";
import { ProjectsFiltersMenu } from "../components/projects/ProjectsFiltersMenu";
import { ProjectsListSortControl } from "../components/projects/ProjectsListSortControl";
import { ProjectWeatherChip } from "../components/projects/ProjectWeatherChip";
import { ProjectsRainWatchBanner } from "../components/projects/ProjectsRainWatchBanner";
import { ProjectsStatusChips } from "../components/projects/ProjectsStatusChips";
import { ProjectsAttentionCard } from "../components/projects/ProjectsAttentionCard";
import { FollowUpsColumnPill } from "../components/projects/ProjectsFollowUpsCard";
import { ProjectsNotesDock } from "../components/projects/ProjectsNotesDock";
import type { QuickNoteProject } from "../components/projects/QuickNoteModal";
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
import { listOpenCorNoteCounts, listOpenProjectFollowUps, type OpenProjectFollowUp } from "../lib/projectNotes";
import { supabase } from "../lib/supabase";
import { recordProjectActivity, resolveActivityUser } from "../lib/projectActivity";
import { CUSTOM_GC_STARTUP_ITEM_IDS, catalogSeedForId } from "../config/projectStartupItemsCatalog";
import { applyCustomGcStartupItems, loadDefaultStartupItems } from "../lib/projectStartupItems";
import { listProjectIdsWithApprovedBrushouts } from "../lib/approvedBrushouts";
import { listDoneProjectIds, fetchProjectIsDone } from "../lib/projectDone";
import { isRfiClosed } from "../lib/rfiStatus";
import {
  isRainWatchChip,
  projectListWeatherLabel,
  projectWeatherChip,
  type ProjectWeatherRow,
} from "../lib/projectWeatherDisplay";
import { isRainRelevant } from "../lib/exteriorWorkWindow";
import { normalizeProject, type Project } from "../types/database";
import { formatJobStart } from "../lib/jobStartDisplay";

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
  const location = useLocation();
  const { isAdmin, jobRole } = useAuth();
  const { profile } = useLetterhead();
  const [projects, setProjects] = useState<Project[]>([]);
  const [approvedBrushoutIds, setApprovedBrushoutIds] = useState<Set<string>>(new Set());
  const [openRfiCounts, setOpenRfiCounts] = useState<Map<string, number>>(new Map());
  const [openCorCounts, setOpenCorCounts] = useState<Map<string, number>>(new Map());
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
  const [weatherByProject, setWeatherByProject] = useState<Map<string, ProjectWeatherRow>>(new Map());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [followUps, setFollowUps] = useState<OpenProjectFollowUp[]>([]);
  const [followUpsError, setFollowUpsError] = useState<string | null>(null);
  const [hoveredJob, setHoveredJob] = useState<string | null>(null);
  const [dockOverlay, setDockOverlay] = useState(false);
  const pmDefaultedRef = useRef(false);

  const summaries = useMemo(() => {
    const base = computeProjectListSummaries(projects);
    if (!openRfiCounts.size && !openCorCounts.size) return base;
    const next = new Map(base);
    for (const [id, summary] of next) {
      const openRfiCount = openRfiCounts.get(id) ?? 0;
      const corCount = openCorCounts.get(id) ?? 0;
      if (!openRfiCount && !corCount) continue;
      next.set(id, {
        ...summary,
        openRfiCount,
        attentionCount: summary.attentionCount + openRfiCount + corCount,
      });
    }
    return next;
  }, [projects, openRfiCounts, openCorCounts]);

  const openProjects = useMemo(
    () => projects.filter((project) => !doneIds.has(project.id)),
    [projects, doneIds],
  );
  const openProjectIds = useMemo(() => new Set(openProjects.map((project) => project.id)), [openProjects]);
  const quickNoteProjects = useMemo<QuickNoteProject[]>(
    () =>
      openProjects
        .map((project) => ({ id: project.id, jobNumber: project.job_number ?? "", jobName: project.job_name ?? "" }))
        .sort((a, b) => a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true, sensitivity: "base" })),
    [openProjects],
  );
  const hoveredJobKey = hoveredJob ? normalizeJobNumber(hoveredJob) : "";
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
      weatherByProject,
      nowMs,
    }),
    [search, summaries, approvedBrushoutIds, doneIds, weatherByProject, nowMs],
  );
  const listUniverse = useMemo(
    () => (listFilters.includeClosed ? projects : openProjects),
    [projects, openProjects, listFilters.includeClosed],
  );
  const rainWatchJobs = useMemo(
    () =>
      listUniverse.flatMap((project) => {
        const chip = projectWeatherChip(project, weatherByProject.get(project.id), nowMs);
        if (!isRainWatchChip(chip)) return [];
        const today = new Date(nowMs);
        const tomorrow = new Date(nowMs);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (!isRainRelevant(project, today) && !isRainRelevant(project, tomorrow)) return [];
        return [
          {
            id: project.id,
            jobNumber: project.job_number,
            jobName: project.job_name ?? "",
            label: chip.label,
          },
        ];
      }),
    [listUniverse, weatherByProject, nowMs],
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
    const [{ data, error: err }, doneRes, brushoutIds, , rfiRes, corCounts, followUpsRes, weatherRes] = await Promise.all([
      supabase.from("projects").select("*").order("updated_at", { ascending: false }),
      listDoneProjectIds(),
      listProjectIdsWithApprovedBrushouts().catch(() => new Set<string>()),
      loadDefaultStartupItems(),
      supabase.from("rfis").select("project_id, status"),
      listOpenCorNoteCounts().catch(() => new Map<string, number>()),
      listOpenProjectFollowUps()
        .then((rows) => ({ rows, error: null as string | null }))
        .catch((err: unknown) => ({
          rows: [] as OpenProjectFollowUp[],
          error: err instanceof Error ? err.message : "Could not load follow-ups.",
        })),
      supabase
        .from("job_weather")
        .select("project_id, fetched_at, raining_now, precip_prob_next_hours, next_rain_at, daily"),
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
    setOpenCorCounts(corCounts);
    setFollowUps(followUpsRes.rows);
    setFollowUpsError(followUpsRes.error);
    const weather = new Map<string, ProjectWeatherRow>();
    if (!weatherRes.error) {
      for (const row of weatherRes.data ?? []) {
        weather.set(row.project_id, {
          fetched_at: row.fetched_at,
          raining_now: row.raining_now,
          precip_prob_next_hours: row.precip_prob_next_hours,
          next_rain_at: row.next_rain_at,
          daily: row.daily,
        });
      }
    }
    setWeatherByProject(weather);
    setProjects(data ?? []);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (!(location.state as ProjectsRouteState)?.newProject) return;
    setShowForm(true);
    document.querySelector(".projects-dock-main")?.scrollTo({ top: 0 });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

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
    <div className={`projects-dock-layout${dockOverlay ? " projects-dock-layout--overlay" : ""}`}>
    <div className="projects-dock-main">
    <div className="page">
      <h1 className="sr-only">Projects</h1>
      {!loading && openProjects.length > 0 ? (
        <div className="projects-top-row">
          <ProjectsAttentionCard spotlight={attentionSpotlight} />
        </div>
      ) : null}

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
          <div className="projects-new-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Create project"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                resetCreateForm();
                setShowForm(false);
              }}
            >
              Cancel
            </button>
          </div>
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

          <div className="projects-chips-row">
            <ProjectsStatusChips
              filters={listFilters}
              counts={statusCounts}
              total={statusPool.length}
              onToggle={(id) => applyListFilters(toggleStatusFilter(listFilters, id))}
              onClear={() => applyListFilters({ ...listFilters, stages: [] })}
            />
            <div className="projects-weather-filters" role="group" aria-label="Weather filters">
              <button
                type="button"
                className={`projects-status-chip${listFilters.exteriorOnly ? " projects-status-chip--active" : ""}`}
                aria-pressed={listFilters.exteriorOnly}
                onClick={() =>
                  applyListFilters({ ...listFilters, exteriorOnly: !listFilters.exteriorOnly })
                }
              >
                Exterior only
              </button>
              <button
                type="button"
                className={`projects-status-chip${listFilters.rainRisk ? " projects-status-chip--active" : ""}`}
                aria-pressed={listFilters.rainRisk}
                onClick={() => applyListFilters({ ...listFilters, rainRisk: !listFilters.rainRisk })}
              >
                Rain risk
              </button>
            </div>
            <span className="projects-chips-count">
              {filteredProjects.length} of {listUniverse.length}
            </span>
          </div>

          <ProjectsActiveFilters
            filters={listFilters}
            onRemove={(key) => applyListFilters(removeProjectsListFilterPill(listFilters, key))}
            onClear={() => applyListFilters(defaultProjectsListFilters())}
          />

          <ProjectsRainWatchBanner
            jobs={rainWatchJobs}
            active={listFilters.rainWatchOnly}
            onShowOnly={() =>
              applyListFilters({ ...listFilters, rainWatchOnly: !listFilters.rainWatchOnly })
            }
            onOpen={(projectId) => navigate(`/projects/${projectId}`)}
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
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProjects.length === 0 ? (
                        <tr>
                          <td className="projects-table-empty" colSpan={7}>
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
                        const weatherChip = projectWeatherChip(p, weatherByProject.get(p.id), nowMs);
                        const jobStart = formatJobStart(normalizeProject(p).jobInfo.start_date);
                        const gcName = gcCompanyName(p.contractor ?? "");
                        const dryNote = weatherChip.kind === "dry" ? projectListWeatherLabel(weatherChip) : "";
                        const weatherInAttention = weatherChip.kind !== "interior" && weatherChip.kind !== "dry";
                        return (
                          <tr
                            key={p.id}
                            className={`projects-table-row${
                              hoveredJobKey && normalizeJobNumber(p.job_number ?? "") === hoveredJobKey
                                ? " projects-table-row--linked"
                                : ""
                            }`}
                            onClick={() => navigate(`/projects/${p.id}`)}
                          >
                          <td>{p.job_number}</td>
                            <td className="projects-table-name" title={p.job_name ?? undefined}>
                              <div className="projects-table-job-name">{p.job_name || "Untitled job"}</div>
                              {gcName || dryNote ? (
                                <div className="projects-table-gc muted small">
                                  {gcName ? <span className="projects-table-gc-name">{gcName}</span> : null}
                                  {dryNote ? (
                                    <ProjectWeatherChip
                                      plain
                                      chip={{ ...weatherChip, label: dryNote }}
                                      onOpen={() => navigate(`/projects/${p.id}`)}
                                    />
                                  ) : null}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <SubmittalStagePill stage={summary.submittalStage} />
                            </td>
                            <td>
                              <BrushoutsAddedPill added={approvedBrushoutIds.has(p.id)} />
                            </td>
                            <td>
                              <div className="projects-table-attention">
                                {weatherInAttention ? (
                                  <ProjectWeatherChip
                                    chip={{ ...weatherChip, label: projectListWeatherLabel(weatherChip) }}
                                    onOpen={() => navigate(`/projects/${p.id}`)}
                                  />
                                ) : null}
                                <ProjectStatusBadge
                                  summary={summary}
                                  tableMode
                                  suppressClear={weatherInAttention}
                                />
                              </div>
                            </td>
                            <td>
                              <FollowUpsColumnPill rows={followUpsByProject.get(p.id)} />
                            </td>
                            <td>
                              <div className="projects-start-cell" title={jobStart.title || undefined}>
                                <span className="projects-start-date">{jobStart.dateLabel}</span>
                                {jobStart.marker?.kind === "day" ? (
                                  <span className="projects-start-day">{jobStart.marker.text}</span>
                                ) : null}
                                {jobStart.marker?.kind === "soon" ? (
                                  <span className="projects-start-soon">{jobStart.marker.text}</span>
                                ) : null}
                              </div>
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
    </div>
    <ProjectsNotesDock
      items={followUps}
      activeProjectIds={openProjectIds}
      onChange={setFollowUps}
      loading={loading}
      loadError={followUpsError}
      projects={quickNoteProjects}
      onHoverJob={setHoveredJob}
      onOverlayChange={setDockOverlay}
    />
    </div>
  );
}
