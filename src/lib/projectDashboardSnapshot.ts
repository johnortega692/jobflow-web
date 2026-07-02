import { CORE_JOB_SETUP_FIELD_COUNT, jobSetupStatus } from "./jobInfoCompleteness";
import { resolvePaintTracker } from "./fieldTrackerProject";
import {
  daysUntilIso,
  effectiveDueDateIso,
  itemNeedsAttention,
  parseDashboardStartupItems,
  prelimNeedsStartDate,
  shortAttentionLabel,
  startupItemsProgress,
  type StartupChecklistGroup,
  type StartupItemsState,
} from "./projectStartupItems";
import { parseProjectTradeData } from "../types/tradeDocuments";
import type { PaintTrackerState } from "../types/fieldTracker";
import type { ProjectForm, Json } from "../types/database";

export type SubmittalPipelineStep = {
  id: "ordered" | "submitted" | "revision" | "approved";
  label: string;
  done: boolean;
  current: boolean;
};

export type AttentionItem = {
  id: string;
  label: string;
  kind: "setup" | "startup-item";
  itemId?: string;
  group?: StartupChecklistGroup;
  openJobSetup?: boolean;
  sortDays?: number;
};

export function resolveDashboardPaintTracker(project: ProjectForm): PaintTrackerState {
  return resolvePaintTracker(parseProjectTradeData(project.data as Json));
}

export function paintSubmittalStageLabel(tracker: PaintTrackerState): string {
  if (tracker.approved) return "Approved";
  if (tracker.revision) return "Revision";
  if (tracker.submittedForApproval) return "Submitted";
  if (tracker.submittalOrdered) return "Ordered";
  return "Not started";
}

export function paintSubmittalPipelineSteps(tracker: PaintTrackerState): SubmittalPipelineStep[] {
  const ordered = tracker.submittalOrdered;
  const submitted = tracker.submittedForApproval;
  const revision = tracker.revision;
  const approved = tracker.approved;

  const raw = [
    { id: "ordered" as const, label: "Ordered", done: ordered },
    { id: "submitted" as const, label: "Submitted", done: submitted },
    { id: "revision" as const, label: "Revision", done: revision || approved },
    { id: "approved" as const, label: "Approved", done: approved },
  ];

  let currentId: SubmittalPipelineStep["id"] | null = null;
  if (!ordered) currentId = "ordered";
  else if (!submitted) currentId = "submitted";
  else if (revision && !approved) currentId = "revision";
  else if (!approved) currentId = "approved";

  return raw.map((step) => ({
    ...step,
    current: currentId === step.id,
  }));
}

export function paintTrackerFlagsLabel(tracker: PaintTrackerState): string {
  const flags = paintTrackerActiveFlags(tracker);
  return flags.length ? flags.join(", ") : "None";
}

export function paintTrackerActiveFlags(tracker: PaintTrackerState): string[] {
  const flags: string[] = [];
  if (tracker.matchExisting) flags.push("Match existing");
  if (tracker.nightsWeekends) flags.push("Nights");
  if (tracker.noPaint) flags.push("No paint");
  return flags;
}

export function buildAttentionItems(project: ProjectForm, startupItems: StartupItemsState): AttentionItem[] {
  const { missing } = jobSetupStatus(project);
  const setupItems: AttentionItem[] = missing.map((label) => ({
    id: `setup-${label.toLowerCase().replace(/\s+/g, "-")}`,
    label,
    kind: "setup" as const,
  }));

  const checklistItems: AttentionItem[] = [];
  for (const item of startupItems.items) {
    if (!itemNeedsAttention(item, project.jobInfo)) continue;
    const due = effectiveDueDateIso(item, project.jobInfo);
    const days = due ? daysUntilIso(due) : null;
    checklistItems.push({
      id: `startup-${item.id}`,
      label: shortAttentionLabel(item, project.jobInfo),
      kind: "startup-item",
      itemId: item.id,
      group: item.group,
      openJobSetup: prelimNeedsStartDate(item, project.jobInfo),
      sortDays: days ?? Number.MAX_SAFE_INTEGER,
    });
  }

  checklistItems.sort((a, b) => (a.sortDays ?? Number.MAX_SAFE_INTEGER) - (b.sortDays ?? Number.MAX_SAFE_INTEGER));

  return [...checklistItems, ...setupItems];
}

export function jobSetupStepCounts(project: ProjectForm): { done: number; total: number } {
  const { missing } = jobSetupStatus(project);
  return {
    done: CORE_JOB_SETUP_FIELD_COUNT - missing.length,
    total: CORE_JOB_SETUP_FIELD_COUNT,
  };
}

export function startupTaskCounts(startupItems: StartupItemsState): { done: number; total: number } {
  return startupItemsProgress(startupItems);
}

export { parseDashboardStartupItems };
