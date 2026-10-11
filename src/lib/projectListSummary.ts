import { formatJobDateLabel } from "./manpowerCalendar";
import { toIsoDateValue } from "./dateInputUtils";
import { normalizeProject, type Project } from "../types/database";
import {
  buildAttentionItems,
  paintSubmittalStageLabel,
  parseDashboardStartupItems,
  resolveDashboardPaintTracker,
} from "./projectDashboardSnapshot";
import { daysUntilIso, effectiveDueDateIso } from "./projectStartupItems";

export type ProjectListSummary = {
  submittalStage: string;
  attentionCount: number;
  /** Open RFIs included in `attentionCount`. */
  openRfiCount: number;
  nextDueDate: string | null;
  nextDueDays: number | null;
};

export function computeProjectListSummary(project: Project): ProjectListSummary {
  const form = normalizeProject(project);
  const tracker = resolveDashboardPaintTracker(form);
  const startupItems = parseDashboardStartupItems(form);
  const attentionCount = buildAttentionItems(form, startupItems).length;

  let nextDueDate: string | null = null;
  let nextDueDays: number | null = null;
  for (const item of startupItems.items) {
    if (!item.enabled || item.complete) continue;
    const due = effectiveDueDateIso(item, form.jobInfo);
    if (!due) continue;
    const days = daysUntilIso(due);
    if (days === null) continue;
    if (nextDueDays === null || days < nextDueDays) {
      nextDueDays = days;
      nextDueDate = due;
    }
  }

  return {
    submittalStage: paintSubmittalStageLabel(tracker),
    attentionCount,
    openRfiCount: 0,
    nextDueDate,
    nextDueDays,
  };
}

export function computeProjectListSummaries(projects: Project[]): Map<string, ProjectListSummary> {
  const map = new Map<string, ProjectListSummary>();
  for (const project of projects) {
    map.set(project.id, computeProjectListSummary(project));
  }
  return map;
}

export const PROJECTS_LIST_SORT_DEFAULT_DIR = {
  start: "desc",
  starting_soon: "asc",
  updated: "desc",
  stale: "desc",
  created: "desc",
  attention: "desc",
  submittal: "asc",
  brushouts: "asc",
  job: "desc",
  name: "asc",
  gc: "asc",
} as const;

export type ProjectsListSort = keyof typeof PROJECTS_LIST_SORT_DEFAULT_DIR;
export type ProjectsListSortDir = "asc" | "desc";

export type ProjectsListSortOption = {
  id: ProjectsListSort;
  label: string;
  hint: string;
};

export type ProjectsListSortGroup = {
  label: string;
  options: ProjectsListSortOption[];
};

const SORT_OPTION_META: Record<ProjectsListSort, { label: string; hint: string }> = {
  start: { label: "Job start", hint: "latest first" },
  starting_soon: { label: "Starting soon", hint: "nearest first" },
  updated: { label: "Last updated", hint: "latest first" },
  stale: { label: "Most stale", hint: "oldest first" },
  created: { label: "Date created", hint: "latest first" },
  attention: { label: "Needs attention", hint: "most first" },
  submittal: { label: "Submittal stage", hint: "pipeline order" },
  brushouts: { label: "Brush-outs", hint: "not added first" },
  job: { label: "Job #", hint: "highest first" },
  name: { label: "Name", hint: "A–Z" },
  gc: { label: "GC", hint: "A–Z" },
};

const SORT_GROUP_ORDER: { label: string; ids: ProjectsListSort[] }[] = [
  { label: "Dates", ids: ["start", "starting_soon", "updated", "stale", "created"] },
  { label: "Status", ids: ["attention", "submittal", "brushouts"] },
  { label: "Job", ids: ["job", "name", "gc"] },
];

export const PROJECTS_LIST_SORT_GROUPS: ProjectsListSortGroup[] = SORT_GROUP_ORDER.map((group) => ({
  label: group.label,
  options: group.ids.map((id) => ({ id, ...SORT_OPTION_META[id] })),
}));

/** Table column highlighted for a sort. Starting soon uses Job start; stale/updated/created/GC have no column. */
export type ProjectsListSortColumn = "job" | "name" | "submittal" | "brushouts" | "attention" | "start";

export function projectsListColumnForSort(sort: ProjectsListSort): ProjectsListSortColumn | null {
  switch (sort) {
    case "starting_soon":
    case "start":
      return "start";
    case "job":
    case "name":
    case "submittal":
    case "brushouts":
    case "attention":
      return sort;
    default:
      return null;
  }
}

export function projectsListSortLabel(sort: ProjectsListSort): string {
  return SORT_OPTION_META[sort].label;
}

export type ProjectsListStageFilter =
  | "all"
  | "not_started"
  | "not_needed"
  | "match_existing"
  | "ordered"
  | "submitted"
  | "revision"
  | "approved";

export type ProjectsListSortState = {
  sort: ProjectsListSort;
  dir: ProjectsListSortDir;
};

const SORT_STORAGE_KEY = "jobflow-projects-list-sort";
const FILTER_STORAGE_KEY = "jobflow-projects-list-stage-filter";

const SORT_VALUES = Object.keys(PROJECTS_LIST_SORT_DEFAULT_DIR) as ProjectsListSort[];

/** Default direction when first selecting a sort mode. */
export function defaultSortDir(sort: ProjectsListSort): ProjectsListSortDir {
  return PROJECTS_LIST_SORT_DEFAULT_DIR[sort];
}

export function projectJobStartLabel(project: Project): string {
  return formatJobDateLabel(normalizeProject(project).jobInfo.start_date) ?? "—";
}

function projectJobStartMs(project: Project): number | null {
  const iso = toIsoDateValue(normalizeProject(project).jobInfo.start_date.trim());
  if (!iso) return null;
  const time = new Date(`${iso}T12:00:00`).getTime();
  return Number.isNaN(time) ? null : time;
}

const FILTER_VALUES: ProjectsListStageFilter[] = [
  "all",
  "not_started",
  "not_needed",
  "match_existing",
  "ordered",
  "submitted",
  "revision",
  "approved",
];

const DEFAULT_SORT_STATE: ProjectsListSortState = { sort: "start", dir: "desc" };

export function loadProjectsListSortState(): ProjectsListSortState {
  try {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    if (!stored) return DEFAULT_SORT_STATE;

    if (SORT_VALUES.includes(stored as ProjectsListSort)) {
      const sort = stored as ProjectsListSort;
      return { sort, dir: defaultSortDir(sort) };
    }

    const parsed = JSON.parse(stored) as { sort?: string; dir?: string };
    if (parsed.sort && SORT_VALUES.includes(parsed.sort as ProjectsListSort)) {
      const sort = parsed.sort as ProjectsListSort;
      const dir = parsed.dir === "asc" || parsed.dir === "desc" ? parsed.dir : defaultSortDir(sort);
      return { sort, dir };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SORT_STATE;
}

/** @deprecated Prefer loadProjectsListSortState */
export function loadProjectsListSort(): ProjectsListSort {
  return loadProjectsListSortState().sort;
}

export function saveProjectsListSortState(state: ProjectsListSortState): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** @deprecated Prefer saveProjectsListSortState */
export function saveProjectsListSort(sort: ProjectsListSort): void {
  saveProjectsListSortState({ sort, dir: defaultSortDir(sort) });
}

export function nextProjectsListSortState(
  current: ProjectsListSortState,
  nextSort: ProjectsListSort,
): ProjectsListSortState {
  if (current.sort === nextSort) {
    return { sort: nextSort, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { sort: nextSort, dir: defaultSortDir(nextSort) };
}

export function loadProjectsListStageFilter(): ProjectsListStageFilter {
  try {
    const stored = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (stored && FILTER_VALUES.includes(stored as ProjectsListStageFilter)) {
      return stored as ProjectsListStageFilter;
    }
  } catch {
    /* ignore */
  }
  return "all";
}

export function saveProjectsListStageFilter(filter: ProjectsListStageFilter): void {
  try {
    sessionStorage.setItem(FILTER_STORAGE_KEY, filter);
  } catch {
    /* ignore */
  }
}

function stageMatchesFilter(stage: string, filter: ProjectsListStageFilter): boolean {
  if (filter === "all") return true;
  const map: Record<Exclude<ProjectsListStageFilter, "all">, string> = {
    not_started: "Not started",
    not_needed: "Not Needed",
    match_existing: "Match Existing",
    ordered: "Ordered",
    submitted: "Submitted",
    revision: "Revision",
    approved: "Approved",
  };
  return stage === map[filter];
}

export function filterProjectsByStage(
  projects: Project[],
  summaries: Map<string, ProjectListSummary>,
  filter: ProjectsListStageFilter,
): Project[] {
  if (filter === "all") return projects;
  return projects.filter((p) => stageMatchesFilter(summaries.get(p.id)?.submittalStage ?? "", filter));
}

const SUBMITTAL_STAGE_ORDER = [
  "Not started",
  "Ordered",
  "Submitted",
  "Revision",
  "Approved",
  "Match Existing",
  "Not Needed",
];

function compareJobNumber(a: string, b: string): number {
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareName(a: Project, b: Project): number {
  return (a.job_name ?? "").localeCompare(b.job_name ?? "", undefined, { sensitivity: "base" });
}

function applyDir(cmp: number, dir: ProjectsListSortDir): number {
  return dir === "asc" ? cmp : -cmp;
}

/** Direction applies to the primary key. Equal keys fall back to Name A–Z. */
function finishSort(cmp: number, dir: ProjectsListSortDir, a: Project, b: Project): number {
  if (cmp !== 0) return applyDir(cmp, dir);
  return compareName(a, b);
}

function timestampOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Missing updates count as the oldest timestamp, matching the spotlight tie-break. */
function attentionUpdatedMs(project: Project): number {
  return timestampOrNull(project.updated_at) ?? 0;
}

function compareMissingLast(
  aValue: number | null,
  bValue: number | null,
  dir: ProjectsListSortDir,
  a: Project,
  b: Project,
  compareValues: (left: number, right: number) => number,
): number {
  if (aValue === null && bValue === null) return compareName(a, b);
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  return finishSort(compareValues(aValue, bValue), dir, a, b);
}

function startIso(project: Project): string | null {
  const iso = toIsoDateValue(normalizeProject(project).jobInfo.start_date.trim());
  return iso || null;
}

export function projectStartDaysUntil(project: Project): number | null {
  const iso = startIso(project);
  if (!iso) return null;
  return daysUntilIso(iso);
}

/**
 * Ascending rank for Starting soon: today and future dates by days-until,
 * then jobs that have already started (most recently started first).
 */
function startingSoonRank(iso: string): number {
  const days = daysUntilIso(iso);
  if (days === null) return Number.MAX_SAFE_INTEGER;
  if (days >= 0) return days;
  return 100_000 + -days;
}

function submittalRank(stage: string): number {
  const index = SUBMITTAL_STAGE_ORDER.indexOf(stage);
  return index === -1 ? SUBMITTAL_STAGE_ORDER.length : index;
}

export function projectJobStartRelative(project: Project): { text: string; soon: boolean } | null {
  const days = projectStartDaysUntil(project);
  if (days === null) return null;
  if (days === 0) return { text: "today", soon: true };
  if (days > 0) return { text: `in ${days}d`, soon: days <= 30 };
  return { text: `${-days}d ago`, soon: false };
}

export function compareProjectsForListSort(
  a: Project,
  b: Project,
  summaries: Map<string, ProjectListSummary>,
  sort: ProjectsListSort,
  dir: ProjectsListSortDir = defaultSortDir(sort),
  brushoutsAdded?: ReadonlySet<string>,
): number {
  if (sort === "start") {
    return compareMissingLast(projectJobStartMs(a), projectJobStartMs(b), dir, a, b, (left, right) => left - right);
  }

  if (sort === "starting_soon") {
    const isoA = startIso(a);
    const isoB = startIso(b);
    const rankA = isoA ? startingSoonRank(isoA) : null;
    const rankB = isoB ? startingSoonRank(isoB) : null;
    return compareMissingLast(rankA, rankB, dir, a, b, (left, right) => left - right);
  }

  if (sort === "updated" || sort === "created") {
    const read = sort === "updated" ? timestampOrNull(a.updated_at) : timestampOrNull(a.created_at);
    const other = sort === "updated" ? timestampOrNull(b.updated_at) : timestampOrNull(b.created_at);
    return compareMissingLast(read, other, dir, a, b, (left, right) => left - right);
  }

  if (sort === "stale") {
    return compareMissingLast(
      timestampOrNull(a.updated_at),
      timestampOrNull(b.updated_at),
      dir,
      a,
      b,
      (left, right) => right - left,
    );
  }

  if (sort === "job") {
    return finishSort(compareJobNumber(a.job_number ?? "", b.job_number ?? ""), dir, a, b);
  }

  if (sort === "name") {
    return finishSort(compareName(a, b), dir, a, b);
  }

  if (sort === "gc") {
    const ga = (a.contractor ?? "").trim();
    const gb = (b.contractor ?? "").trim();
    if (!ga && !gb) return compareName(a, b);
    if (!ga) return 1;
    if (!gb) return -1;
    return finishSort(ga.localeCompare(gb, undefined, { sensitivity: "base" }), dir, a, b);
  }

  if (sort === "submittal") {
    const ra = submittalRank(summaries.get(a.id)?.submittalStage ?? "");
    const rb = submittalRank(summaries.get(b.id)?.submittalStage ?? "");
    return finishSort(ra - rb, dir, a, b);
  }

  if (sort === "brushouts") {
    const ba = brushoutsAdded?.has(a.id) ? 1 : 0;
    const bb = brushoutsAdded?.has(b.id) ? 1 : 0;
    return finishSort(ba - bb, dir, a, b);
  }

  const flagsA = summaries.get(a.id)?.attentionCount ?? 0;
  const flagsB = summaries.get(b.id)?.attentionCount ?? 0;
  if (flagsA !== flagsB) return finishSort(flagsA - flagsB, dir, a, b);
  const stale = attentionUpdatedMs(a) - attentionUpdatedMs(b);
  if (stale !== 0) return stale;
  return compareName(a, b);
}

export type ProjectsAttentionSpotlight = {
  kind: "attention";
  project: Project;
  summary: ProjectListSummary;
  /** Sum of attention flags across flagged projects. */
  totalFlags: number;
  /** Count of projects with at least one flag. */
  jobCount: number;
  daysStale: number;
};

export type ProjectsClearSpotlight = {
  kind: "clear";
  /** Total active projects in the list (all clean). */
  projectCount: number;
};

export type ProjectsSpotlight = ProjectsAttentionSpotlight | ProjectsClearSpotlight;

/**
 * Pick the projects-list spotlight banner model.
 * Flagged jobs: highest flag count, then stalest `updated_at`.
 * No flags: all-clear state.
 */
export function getSpotlight(
  projects: Project[],
  summaries: Map<string, ProjectListSummary>,
): ProjectsSpotlight {
  const flagged = projects
    .map((project) => {
      const summary = summaries.get(project.id);
      const flagCount = summary?.attentionCount ?? 0;
      return summary && flagCount > 0 ? { project, summary, flagCount } : null;
    })
    .filter((row): row is { project: Project; summary: ProjectListSummary; flagCount: number } => row != null);

  if (!flagged.length) {
    return { kind: "clear", projectCount: projects.length };
  }

  flagged.sort((a, b) => {
    if (b.flagCount !== a.flagCount) return b.flagCount - a.flagCount;
    return attentionUpdatedMs(a.project) - attentionUpdatedMs(b.project);
  });

  const top = flagged[0]!;
  const totalFlags = flagged.reduce((sum, row) => sum + row.flagCount, 0);
  const updated = top.project.updated_at ? new Date(top.project.updated_at).getTime() : Date.now();
  const daysStale = Math.max(0, Math.floor((Date.now() - updated) / 86_400_000));

  return {
    kind: "attention",
    project: top.project,
    summary: top.summary,
    totalFlags,
    jobCount: flagged.length,
    daysStale,
  };
}

/** @deprecated Prefer getSpotlight */
export function computeProjectsAttentionSpotlight(
  projects: Project[],
  summaries: Map<string, ProjectListSummary>,
): ProjectsAttentionSpotlight | null {
  const spot = getSpotlight(projects, summaries);
  return spot.kind === "attention" ? spot : null;
}

export function formatProjectUpdatedShort(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

export function isDueSoonOrOverdue(summary: ProjectListSummary): boolean {
  return summary.nextDueDays !== null && summary.nextDueDays <= 7;
}

export function statusBadgeDueLabel(summary: ProjectListSummary): string | null {
  if (summary.nextDueDays === null) return null;
  if (summary.nextDueDays < 0) return "Overdue";
  if (summary.nextDueDays === 0) return "Due today";
  return `Due ${summary.nextDueDays}d`;
}
