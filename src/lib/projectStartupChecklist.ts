import {
  PROJECT_STARTUP_STEPS,
  type ProjectStartupStepId,
} from "../config/projectStartupChecklist";
import { anyManpowerBudgetPushed } from "./budgetManpowerPush";
import { projectHasWallcovering } from "./jobInfo";
import type { JobInfoData } from "../types/jobInfo";
import { normalizeBudgetMaker } from "../types/budgetMaker";

export type StartupChecklistState = Record<ProjectStartupStepId, boolean>;

export function defaultStartupChecklist(): StartupChecklistState {
  return Object.fromEntries(PROJECT_STARTUP_STEPS.map((s) => [s.id, false])) as StartupChecklistState;
}

export function parseStartupChecklist(raw: unknown): StartupChecklistState {
  const base = defaultStartupChecklist();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  for (const step of PROJECT_STARTUP_STEPS) {
    if (typeof o[step.id] === "boolean") base[step.id] = o[step.id] as boolean;
  }
  return base;
}

/**
 * System setup Hours follows Budget Maker → Push to Manpower.
 * Live overlay so already-pushed jobs show checked without a re-push.
 */
export function withFieldHoursFromBudgetPush(
  checklist: StartupChecklistState,
  projectData: unknown,
): StartupChecklistState {
  if (checklist.field_has_hours) return checklist;
  const blob =
    projectData && typeof projectData === "object" && !Array.isArray(projectData)
      ? (projectData as Record<string, unknown>)
      : {};
  const budget = normalizeBudgetMaker(blob.budget_maker);
  if (!anyManpowerBudgetPushed(budget)) return checklist;
  return { ...checklist, field_has_hours: true };
}

/** Samples step only when Job Setup → wallcovering contract toggle is on. */
export function startupStepIsVisible(
  step: (typeof PROJECT_STARTUP_STEPS)[number],
  jobInfo: JobInfoData,
): boolean {
  if (step.id === "wc_samples_ordered") {
    return projectHasWallcovering(jobInfo);
  }
  if ("requiresWallcovering" in step && step.requiresWallcovering) {
    return projectHasWallcovering(jobInfo);
  }
  return true;
}

export function visibleStartupSteps(jobInfo: JobInfoData) {
  return PROJECT_STARTUP_STEPS.filter((s) => startupStepIsVisible(s, jobInfo));
}

export function startupChecklistProgress(
  checklist: StartupChecklistState,
  jobInfoComplete: boolean,
  jobInfo: JobInfoData,
): { done: number; total: number; allDone: boolean } {
  const steps = visibleStartupSteps(jobInfo);
  const manualDone = steps.filter((s) => checklist[s.id]).length;
  const done = manualDone + (jobInfoComplete ? 1 : 0);
  const total = steps.length + 1;
  return { done, total, allDone: done === total };
}

/** Clear wallcovering-only steps when the contract toggle is turned off. */
export function startupChecklistForJobInfo(
  checklist: StartupChecklistState,
  jobInfo: JobInfoData,
): StartupChecklistState {
  if (projectHasWallcovering(jobInfo)) return checklist;
  if (!checklist.wc_samples_ordered) return checklist;
  return { ...checklist, wc_samples_ordered: false };
}
