import { projectStartDaysUntil, type ProjectListSummary, type ProjectsListStageFilter } from "./projectListSummary";
import { gcCompanyName } from "./gcCompanyName";
import type { Project } from "../types/database";

export type ProjectsListStatusId = Exclude<ProjectsListStageFilter, "all">;

export type ProjectsBrushoutFilter = "any" | "added" | "not_added";
export type ProjectsStartFilter = "any" | "started" | "next_30" | "next_90" | "beyond_90";

export type ProjectsListFilters = {
  stages: ProjectsListStatusId[];
  gcs: string[];
  brushouts: ProjectsBrushoutFilter;
  start: ProjectsStartFilter;
  flaggedOnly: boolean;
  includeClosed: boolean;
};

export type ProjectsStatusChip = {
  id: ProjectsListStatusId;
  label: string;
  stage: string;
  dot: string;
};

/** Pipeline order. Ordered, Submitted, and Revision share the active-pill gold. */
export const PROJECT_STATUS_CHIPS: ProjectsStatusChip[] = [
  { id: "not_started", label: "Not started", stage: "Not started", dot: "not-started" },
  { id: "ordered", label: "Ordered", stage: "Ordered", dot: "active" },
  { id: "submitted", label: "Submitted", stage: "Submitted", dot: "active" },
  { id: "revision", label: "Revision", stage: "Revision", dot: "active" },
  { id: "approved", label: "Approved", stage: "Approved", dot: "approved" },
  { id: "match_existing", label: "Match Existing", stage: "Match Existing", dot: "match" },
  { id: "not_needed", label: "Not Needed", stage: "Not Needed", dot: "not-needed" },
];

const STATUS_IDS = new Set<string>(PROJECT_STATUS_CHIPS.map((chip) => chip.id));
const FILTERS_STORAGE_KEY = "jobflow-projects-list-filters";
const LEGACY_STAGE_KEY = "jobflow-projects-list-stage-filter";

export function defaultProjectsListFilters(): ProjectsListFilters {
  return {
    stages: [],
    gcs: [],
    brushouts: "any",
    start: "any",
    flaggedOnly: false,
    includeClosed: false,
  };
}

function stageIdForLabel(stage: string): ProjectsListStatusId | null {
  return PROJECT_STATUS_CHIPS.find((chip) => chip.stage === stage)?.id ?? null;
}

export function projectsListPanelFilterCount(filters: ProjectsListFilters): number {
  let count = filters.gcs.length;
  if (filters.brushouts !== "any") count += 1;
  if (filters.start !== "any") count += 1;
  if (filters.flaggedOnly) count += 1;
  if (filters.includeClosed) count += 1;
  return count;
}

const START_PILL_LABEL: Record<Exclude<ProjectsStartFilter, "any">, string> = {
  started: "Already started",
  next_30: "Next 30 days",
  next_90: "Next 90 days",
  beyond_90: "90+ days out",
};

export type ProjectsActiveFilterPill = {
  key: string;
  label: string;
};

export function projectsListActiveFilterPills(filters: ProjectsListFilters): ProjectsActiveFilterPill[] {
  const pills: ProjectsActiveFilterPill[] = [];
  for (const chip of PROJECT_STATUS_CHIPS) {
    if (filters.stages.includes(chip.id)) {
      pills.push({ key: `stage:${chip.id}`, label: `Status: ${chip.label}` });
    }
  }
  for (const gc of [...filters.gcs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))) {
    pills.push({ key: `gc:${gc}`, label: `GC: ${gc}` });
  }
  if (filters.brushouts === "added") pills.push({ key: "brushouts", label: "Brush-outs: Added" });
  if (filters.brushouts === "not_added") pills.push({ key: "brushouts", label: "Brush-outs: Not added" });
  if (filters.start !== "any") {
    pills.push({ key: "start", label: `Start: ${START_PILL_LABEL[filters.start]}` });
  }
  if (filters.flaggedOnly) pills.push({ key: "flagged", label: "Flagged only" });
  if (filters.includeClosed) pills.push({ key: "closed", label: "Including closed" });
  return pills;
}

export function removeProjectsListFilterPill(
  filters: ProjectsListFilters,
  key: string,
): ProjectsListFilters {
  if (key.startsWith("stage:")) {
    const id = key.slice("stage:".length) as ProjectsListStatusId;
    return { ...filters, stages: filters.stages.filter((stage) => stage !== id) };
  }
  if (key.startsWith("gc:")) {
    const name = key.slice("gc:".length);
    return { ...filters, gcs: filters.gcs.filter((gc) => gc !== name) };
  }
  if (key === "brushouts") return { ...filters, brushouts: "any" };
  if (key === "start") return { ...filters, start: "any" };
  if (key === "flagged") return { ...filters, flaggedOnly: false };
  if (key === "closed") return { ...filters, includeClosed: false };
  return filters;
}

export function resetProjectsListPanelFilters(filters: ProjectsListFilters): ProjectsListFilters {
  return {
    ...filters,
    gcs: [],
    brushouts: "any",
    start: "any",
    flaggedOnly: false,
    includeClosed: false,
  };
}

function parseFilters(raw: string): ProjectsListFilters | null {
  const parsed = JSON.parse(raw) as Partial<ProjectsListFilters>;
  const base = defaultProjectsListFilters();
  const stages = Array.isArray(parsed.stages)
    ? parsed.stages.filter((id): id is ProjectsListStatusId => typeof id === "string" && STATUS_IDS.has(id))
    : [];
  const gcs = Array.isArray(parsed.gcs)
    ? [...new Set(parsed.gcs.filter((name): name is string => typeof name === "string" && name.trim().length > 0).map((name) => name.trim()))]
    : [];
  const brushouts: ProjectsBrushoutFilter =
    parsed.brushouts === "added" || parsed.brushouts === "not_added" || parsed.brushouts === "any"
      ? parsed.brushouts
      : "any";
  const start: ProjectsStartFilter =
    parsed.start === "started" ||
    parsed.start === "next_30" ||
    parsed.start === "next_90" ||
    parsed.start === "beyond_90" ||
    parsed.start === "any"
      ? parsed.start
      : "any";
  return {
    ...base,
    stages,
    gcs,
    brushouts,
    start,
    flaggedOnly: Boolean(parsed.flaggedOnly),
    includeClosed: Boolean(parsed.includeClosed),
  };
}

function legacyStages(): ProjectsListStatusId[] {
  try {
    const stored = sessionStorage.getItem(LEGACY_STAGE_KEY);
    if (stored && STATUS_IDS.has(stored)) return [stored as ProjectsListStatusId];
  } catch {
    /* ignore */
  }
  return [];
}

export function loadProjectsListFilters(): ProjectsListFilters {
  try {
    const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (stored) {
      const parsed = parseFilters(stored);
      if (parsed) return parsed;
    }
  } catch {
    /* ignore */
  }
  const stages = legacyStages();
  return stages.length ? { ...defaultProjectsListFilters(), stages } : defaultProjectsListFilters();
}

export function saveProjectsListFilters(filters: ProjectsListFilters): void {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}

export type ProjectsFilterContext = {
  search: string;
  summaries: Map<string, ProjectListSummary>;
  brushoutsAdded: ReadonlySet<string>;
  doneIds: ReadonlySet<string>;
};

function matchesSearch(project: Project, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [project.job_number, project.job_name, project.contractor, project.architect, project.owner, project.job_address, project.job_address2]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function matchesStart(project: Project, start: ProjectsStartFilter): boolean {
  if (start === "any") return true;
  const days = projectStartDaysUntil(project);
  if (days === null) return false;
  if (start === "started") return days < 0;
  if (start === "next_30") return days >= 0 && days <= 30;
  if (start === "next_90") return days >= 0 && days <= 90;
  return days > 90;
}

export function projectMatchesListFilters(
  project: Project,
  filters: ProjectsListFilters,
  ctx: ProjectsFilterContext,
  options?: { ignoreStatus?: boolean },
): boolean {
  if (!filters.includeClosed && ctx.doneIds.has(project.id)) return false;
  if (!matchesSearch(project, ctx.search)) return false;
  if (filters.gcs.length) {
    const name = gcCompanyName(project.contractor ?? "");
    if (!filters.gcs.some((gc) => gcCompanyName(gc) === name)) return false;
  }
  if (filters.brushouts === "added" && !ctx.brushoutsAdded.has(project.id)) return false;
  if (filters.brushouts === "not_added" && ctx.brushoutsAdded.has(project.id)) return false;
  if (!matchesStart(project, filters.start)) return false;
  if (filters.flaggedOnly && (ctx.summaries.get(project.id)?.attentionCount ?? 0) <= 0) return false;
  if (!options?.ignoreStatus && filters.stages.length) {
    const stage = ctx.summaries.get(project.id)?.submittalStage ?? "";
    const id = stageIdForLabel(stage);
    if (!id || !filters.stages.includes(id)) return false;
  }
  return true;
}

export function filterProjectsForList(
  projects: Project[],
  filters: ProjectsListFilters,
  ctx: ProjectsFilterContext,
  options?: { ignoreStatus?: boolean },
): Project[] {
  return projects.filter((project) => projectMatchesListFilters(project, filters, ctx, options));
}

export function statusChipCounts(
  projects: Project[],
  summaries: Map<string, ProjectListSummary>,
): Record<ProjectsListStatusId, number> {
  const counts = Object.fromEntries(PROJECT_STATUS_CHIPS.map((chip) => [chip.id, 0])) as Record<
    ProjectsListStatusId,
    number
  >;
  for (const project of projects) {
    const id = stageIdForLabel(summaries.get(project.id)?.submittalStage ?? "");
    if (id) counts[id] += 1;
  }
  return counts;
}

export function generalContractorOptions(
  projects: Project[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const name = gcCompanyName(project.contractor ?? "");
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function toggleStatusFilter(
  filters: ProjectsListFilters,
  id: ProjectsListStatusId,
): ProjectsListFilters {
  const stages = filters.stages.includes(id)
    ? filters.stages.filter((stage) => stage !== id)
    : [...filters.stages, id];
  return { ...filters, stages };
}

export function toggleGcFilter(filters: ProjectsListFilters, name: string): ProjectsListFilters {
  const gcs = filters.gcs.includes(name)
    ? filters.gcs.filter((gc) => gc !== name)
    : [...filters.gcs, name];
  return { ...filters, gcs };
}
