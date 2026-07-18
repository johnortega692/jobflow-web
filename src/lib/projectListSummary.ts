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

export type ProjectsListSort = "updated" | "attention" | "job" | "name";
export type ProjectsListSortDir = "asc" | "desc";

export type ProjectsListStageFilter =
  | "all"
  | "not_started"
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

const SORT_VALUES: ProjectsListSort[] = ["updated", "attention", "job", "name"];

/** Default direction when first selecting a sort mode. */
export function defaultSortDir(sort: ProjectsListSort): ProjectsListSortDir {
  return sort === "job" || sort === "name" ? "asc" : "desc";
}

const FILTER_VALUES: ProjectsListStageFilter[] = [
  "all",
  "not_started",
  "ordered",
  "submitted",
  "revision",
  "approved",
];

export function loadProjectsListSortState(): ProjectsListSortState {
  try {
    const stored = sessionStorage.getItem(SORT_STORAGE_KEY);
    if (!stored) return { sort: "updated", dir: "desc" };

    // Legacy: plain sort id, or "oldest" (updated asc)
    if (stored === "oldest") return { sort: "updated", dir: "asc" };
    if (SORT_VALUES.includes(stored as ProjectsListSort)) {
      return { sort: stored as ProjectsListSort, dir: defaultSortDir(stored as ProjectsListSort) };
    }

    const parsed = JSON.parse(stored) as Partial<ProjectsListSortState>;
    if (parsed.sort && SORT_VALUES.includes(parsed.sort)) {
      const dir = parsed.dir === "asc" || parsed.dir === "desc" ? parsed.dir : defaultSortDir(parsed.sort);
      return { sort: parsed.sort, dir };
    }
  } catch {
    /* ignore */
  }
  return { sort: "updated", dir: "desc" };
}

/** @deprecated Prefer loadProjectsListSortState */
export function loadProjectsListSort(): ProjectsListSort {
  return loadProjectsListSortState().sort;
}

export function saveProjectsListSortState(state: ProjectsListSortState): void {
  try {
    sessionStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(state));
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

function compareJobNumber(a: string, b: string): number {
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function compareProjectsForListSort(
  a: Project,
  b: Project,
  summaries: Map<string, ProjectListSummary>,
  sort: ProjectsListSort,
  dir: ProjectsListSortDir = defaultSortDir(sort),
): number {
  let cmp = 0;

  if (sort === "updated") {
    cmp = new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime();
  } else if (sort === "job") {
    cmp = compareJobNumber(a.job_number ?? "", b.job_number ?? "");
  } else if (sort === "name") {
    cmp = (a.job_name ?? "").localeCompare(b.job_name ?? "", undefined, {
      sensitivity: "base",
    });
  } else {
    const sa = summaries.get(a.id)!;
    const sb = summaries.get(b.id)!;

    if (sa.attentionCount !== sb.attentionCount) {
      cmp = sa.attentionCount - sb.attentionCount;
    } else if (sa.nextDueDays !== null && sb.nextDueDays !== null) {
      cmp = sa.nextDueDays - sb.nextDueDays;
    } else if (sa.nextDueDays !== null) {
      cmp = -1;
    } else if (sb.nextDueDays !== null) {
      cmp = 1;
    } else {
      cmp = new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime();
    }
  }

  return dir === "asc" ? cmp : -cmp;
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
    return new Date(a.project.updated_at ?? 0).getTime() - new Date(b.project.updated_at ?? 0).getTime();
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
