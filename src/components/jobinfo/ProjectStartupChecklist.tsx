import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  JOB_INFO_STARTUP_STEP,
  PROJECT_STARTUP_ACTIONS,
  type ProjectStartupAction,
  type ProjectStartupStepId,
} from "../../config/projectStartupChecklist";
import { parseProjectDataBlob, projectHasWallcovering } from "../../lib/jobInfo";
import { commitProjectUpdate, resolveActivityUser } from "../../lib/projectActivity";
import {
  defaultStartupChecklist,
  parseStartupChecklist,
  startupChecklistForJobInfo,
  startupChecklistProgress,
  visibleStartupSteps,
  type StartupChecklistState,
} from "../../lib/projectStartupChecklist";
import {
  defaultStartupItems,
  parseStartupItems,
  toggleStartupItemComplete,
  type StartupChecklistGroup,
  type StartupItemsState,
} from "../../lib/projectStartupItems";
import { supabase } from "../../lib/supabase";
import type { ProjectForm } from "../../types/database";
import { ProjectStartupItemsCard } from "./ProjectStartupItemsCard";

type Props = {
  project: ProjectForm;
  projectId: string;
  jobInfoComplete: boolean;
  onOpenJobSetup: () => void;
  onConfigureStartup?: () => void;
  onActivity?: () => void;
  focus?: { group: StartupChecklistGroup; itemId: string } | null;
  onFocusHandled?: () => void;
  refreshKey?: string | number;
};

type StepperStep = {
  key: string;
  shortLabel: string;
  fullLabel: string;
  done: boolean;
  stepNumber: number;
  manualId?: ProjectStartupStepId;
  modulePath?: string;
  action?: ProjectStartupAction;
  oneTime?: boolean;
  auto?: boolean;
};

export function ProjectStartupChecklist({
  project,
  projectId,
  jobInfoComplete,
  onOpenJobSetup,
  onConfigureStartup,
  onActivity,
  focus,
  onFocusHandled,
  refreshKey = 0,
}: Props) {
  const navigate = useNavigate();
  const [checklist, setChecklist] = useState<StartupChecklistState>(() => defaultStartupChecklist());
  const [startupItems, setStartupItems] = useState<StartupItemsState>(() => defaultStartupItems());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const hasWallcovering = projectHasWallcovering(project.jobInfo);
  const progress = startupChecklistProgress(checklist, jobInfoComplete, project.jobInfo);

  const steps = useMemo<StepperStep[]>(() => {
    const rows: StepperStep[] = [
      {
        key: JOB_INFO_STARTUP_STEP.id,
        shortLabel: JOB_INFO_STARTUP_STEP.shortLabel,
        fullLabel: JOB_INFO_STARTUP_STEP.label,
        done: jobInfoComplete,
        stepNumber: 1,
        auto: true,
      },
    ];
    visibleStartupSteps(project.jobInfo).forEach((step, i) => {
      rows.push({
        key: step.id,
        shortLabel: step.shortLabel,
        fullLabel: step.label,
        done: checklist[step.id],
        stepNumber: i + 2,
        manualId: step.id,
        modulePath: "modulePath" in step ? step.modulePath : undefined,
        action: "action" in step ? step.action : undefined,
        oneTime: "oneTime" in step && step.oneTime === true ? true : undefined,
      });
    });
    return rows;
  }, [checklist, jobInfoComplete, project.jobInfo]);

  useEffect(() => {
    if (hasWallcovering) return;
    if (activeKey !== "wc_samples_ordered") return;
    setActiveKey(null);
  }, [hasWallcovering, activeKey]);

  useEffect(() => {
    if (hasWallcovering) return;
    setChecklist((prev) => startupChecklistForJobInfo(prev, project.jobInfo));
  }, [hasWallcovering, project.jobInfo]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from("projects")
          .select("data")
          .eq("id", projectId)
          .single();
        if (err) throw new Error(err.message);
        const blob = parseProjectDataBlob(data?.data);
        const parsed = parseStartupChecklist(blob.startup_checklist);
        setChecklist(startupChecklistForJobInfo(parsed, project.jobInfo));
        setStartupItems(parseStartupItems(blob.startup_items, blob.startup_optional));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load startup checklist");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, refreshKey, project.jobInfo.public_works, project.jobInfo.start_date, project.jobInfo.first_furnishing_date]);

  async function persistChecklist(next: StartupChecklistState) {
    const err = await commitProjectUpdate({
      projectId,
      mergeData: { startup_checklist: next },
      activity: {
        action: "startup_checklist_updated",
        summary: "Startup checklist updated",
      },
    });
    if (err) {
      setError(err);
      return false;
    }
    setError(null);
    onActivity?.();
    return true;
  }

  async function persistStartupItems(next: StartupItemsState, summary: string) {
    const err = await commitProjectUpdate({
      projectId,
      mergeData: { startup_items: next },
      activity: {
        action: "startup_checklist_updated",
        summary,
      },
    });
    if (err) {
      setError(err);
      return false;
    }
    setError(null);
    onActivity?.();
    return true;
  }

  async function onToggleManualItem(itemId: string, complete: boolean) {
    const actor = await resolveActivityUser();
    const item = startupItems.items.find((row) => row.id === itemId);
    if (!item || item.source !== "manual") return;

    const next = toggleStartupItemComplete(startupItems, itemId, complete, actor.userName);
    setStartupItems(next);
    setSavingId(itemId);
    await persistStartupItems(
      next,
      complete ? `Startup checklist · ${item.label} completed` : `Startup checklist · ${item.label} unchecked`,
    );
    setSavingId(null);
  }

  async function onToggle(stepId: ProjectStartupStepId, checked: boolean) {
    const next = { ...checklist, [stepId]: checked };
    setChecklist(next);
    setSavingId(stepId);
    await persistChecklist(next);
    setSavingId(null);
  }

  function runStartupAction(step: StepperStep) {
    if (!step.manualId || !step.action) return;

    if (step.action === PROJECT_STARTUP_ACTIONS.open_approved_brushouts) {
      navigate(`/projects/${projectId}/approved-brushouts`);
      return;
    }

    if (step.action === PROJECT_STARTUP_ACTIONS.open_job_setup) {
      if (!step.done && !jobInfoComplete) {
        onOpenJobSetup();
        return;
      }
      void onToggle(step.manualId, !step.done);
    }
  }

  function onStepClick(step: StepperStep) {
    setActiveKey(step.key);
    if (step.auto) {
      if (!step.done) onOpenJobSetup();
      return;
    }
    if (!step.manualId || loading || savingId === step.manualId) return;

    if (step.oneTime && step.done) return;

    if (step.action) {
      const canRepeatWhenDone = step.action === PROJECT_STARTUP_ACTIONS.open_approved_brushouts;
      if (step.done && !canRepeatWhenDone) {
        void onToggle(step.manualId, false);
        return;
      }
      runStartupAction(step);
      return;
    }

    void onToggle(step.manualId, !step.done);
  }

  const activeStep = steps.find((s) => s.key === activeKey) ?? steps.find((s) => !s.done) ?? steps[0];
  const activeBusy = Boolean(activeStep?.manualId && savingId === activeStep.manualId);

  return (
    <section className="card job-startup-checklist" id="startup-checklist">
      {error && <div className="banner banner-error job-startup-banner">{error}</div>}

      <ProjectStartupItemsCard
        items={startupItems}
        jobInfo={project.jobInfo}
        focus={focus}
        onFocusHandled={onFocusHandled}
        onOpenJobSetup={onOpenJobSetup}
        onConfigureStartup={onConfigureStartup}
        onToggleManualItem={(itemId, complete) => void onToggleManualItem(itemId, complete)}
        savingId={savingId}
      />

      <div className="job-startup-system-divider" />

      <div className="job-startup-system">
        <div className="job-startup-stepper-header">
          <h4 className="job-startup-system-title">System setup</h4>
          <span className="job-startup-stepper-count muted small">
            {progress.done}/{progress.total} complete
          </span>
        </div>

        <div className="job-startup-stepper job-startup-stepper--compact" role="list" aria-label="System setup progress">
          {steps.map((step, index) => (
            <Fragment key={step.key}>
              <button
                type="button"
                role="listitem"
                className={`job-startup-step${step.done ? " job-startup-step--done" : ""}${step.oneTime && step.done ? " job-startup-step--locked" : ""}${activeKey === step.key ? " job-startup-step--active" : ""}`}
                title={step.fullLabel}
                disabled={Boolean(step.manualId && (loading || savingId === step.manualId))}
                onClick={() => onStepClick(step)}
              >
                <span className="job-startup-step-node" aria-hidden>
                  {step.done ? (
                    <svg viewBox="0 0 16 16" className="job-startup-check" focusable="false">
                      <path
                        d="M3.5 8.2 6.4 11 12.5 5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    step.stepNumber
                  )}
                </span>
                <span className="job-startup-step-label">{step.shortLabel}</span>
              </button>
              {index < steps.length - 1 && (
                <div
                  className={`job-startup-connector${step.done ? " job-startup-connector--done" : ""}`}
                  aria-hidden
                />
              )}
            </Fragment>
          ))}
        </div>

        {activeStep && (
          <div className="job-startup-step-detail muted small">
            <span>{activeStep.fullLabel}</span>
            {activeStep.done ? (
              <span className="job-startup-detail-status">
                {" "}
                · Done
                {activeStep.oneTime
                  ? " · Locked — one-time step"
                  : activeStep.action === PROJECT_STARTUP_ACTIONS.open_approved_brushouts
                    ? " · Click to open again"
                    : activeStep.action
                      ? " · Click to uncheck"
                      : ""}
              </span>
            ) : activeStep.auto ? (
              <>
                {" "}
                ·{" "}
                <button type="button" className="link-btn" onClick={onOpenJobSetup}>
                  Open job setup
                </button>
              </>
            ) : activeStep.action ? (
              <>
                {" "}
                · Click to{" "}
                {activeStep.action === PROJECT_STARTUP_ACTIONS.open_approved_brushouts
                  ? "open approved brush-outs"
                  : jobInfoComplete
                    ? "mark done"
                    : "open job setup"}
                {activeBusy ? "…" : ""}
                {activeStep.modulePath ? (
                  <>
                    {" "}
                    ·{" "}
                    <Link
                      to={`/projects/${projectId}/${activeStep.modulePath}`}
                      className="job-startup-detail-link"
                    >
                      {activeStep.action === PROJECT_STARTUP_ACTIONS.open_approved_brushouts
                        ? "Add colors on Paint tab"
                        : `Open ${activeStep.modulePath} tab`}
                    </Link>
                  </>
                ) : null}
              </>
            ) : activeStep.modulePath ? (
              <>
                {" "}
                ·{" "}
                <Link to={`/projects/${projectId}/${activeStep.modulePath}`} className="job-startup-detail-link">
                  Open tab
                </Link>{" "}
                · Click step to mark done
              </>
            ) : (
              <span className="job-startup-detail-status"> · Click step to mark done</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
