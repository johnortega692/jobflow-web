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

export type ProjectsListSort = "updated" | "attention";

const SORT_STORAGE_KEY = "jobflow-projects-list-sort";

export function loadProjectsListSort(): ProjectsListSort {
  try {
    const stored = sessionStorage.getItem(SORT_STORAGE_KEY);
    if (stored === "attention" || stored === "updated") return stored;
  } catch {
    /* ignore */
  }
  return "updated";
}

export function saveProjectsListSort(sort: ProjectsListSort): void {
  try {
    sessionStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    /* ignore */
  }
}

export function compareProjectsForListSort(
  a: Project,
  b: Project,
  summaries: Map<string, ProjectListSummary>,
  sort: ProjectsListSort,
): number {
  if (sort === "updated") {
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
  }

  const sa = summaries.get(a.id)!;
  const sb = summaries.get(b.id)!;

  if (sa.nextDueDays !== null && sb.nextDueDays !== null) {
    if (sa.nextDueDays !== sb.nextDueDays) return sa.nextDueDays - sb.nextDueDays;
  } else if (sa.nextDueDays !== null) return -1;
  else if (sb.nextDueDays !== null) return 1;

  if (sa.attentionCount !== sb.attentionCount) return sb.attentionCount - sa.attentionCount;

  return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
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
