import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { parseProjectDataBlob, projectHasWallcovering } from "../../lib/jobInfo";
import { commitProjectUpdate, resolveActivityUser } from "../../lib/projectActivity";
import { addDaysToTodayDisplay } from "../../lib/dateInputUtils";
import { reloadProject, resolvePaintTracker, savePaintTrackerState } from "../../lib/fieldTrackerProject";
import {
  defaultStartupChecklist,
  parseStartupChecklist,
  startupChecklistForJobInfo,
  systemSetupAfterStartupGroupToggle,
  withFieldHoursFromBudgetPush,
  withSystemSetupFromStartupGroups,
  type StartupChecklistState,
} from "../../lib/projectStartupChecklist";
import {
  defaultStartupItems,
  loadDefaultStartupItems,
  parseStartupItems,
  startupItemsProgress,
  toggleStartupItemComplete,
  withSubmitBrushoutsFromMaterialTracker,
  type StartupChecklistGroup,
  type StartupItemsState,
} from "../../lib/projectStartupItems";
import { supabase } from "../../lib/supabase";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import type { Json, ProjectForm } from "../../types/database";
import { DashboardProjectNotes } from "./DashboardProjectNotes";
import { ProjectStartupItemsCard } from "./ProjectStartupItemsCard";

type PanelTab = "startup" | "notes";

type Props = {
  project: ProjectForm;
  projectId: string;
  jobInfoComplete: boolean;
  onOpenJobSetup: () => void;
  onConfigureStartup?: () => void;
  onActivity?: () => void;
  onProjectUpdate?: (project: ProjectForm) => void;
  focus?: { group: StartupChecklistGroup; itemId: string } | null;
  onFocusHandled?: () => void;
  noteFocus?: string | null;
  onNoteFocusHandled?: () => void;
  refreshKey?: string | number;
};

export function ProjectStartupChecklist({
  project,
  projectId,
  onOpenJobSetup,
  onConfigureStartup,
  onActivity,
  onProjectUpdate,
  focus,
  onFocusHandled,
  noteFocus,
  onNoteFocusHandled,
  refreshKey = 0,
}: Props) {
  const [checklist, setChecklist] = useState<StartupChecklistState>(() => defaultStartupChecklist());
  const [startupItems, setStartupItems] = useState<StartupItemsState>(() => defaultStartupItems());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualTab, setManualTab] = useState<PanelTab | null>(null);
  const [openNoteCount, setOpenNoteCount] = useState(0);
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});

  const hasWallcovering = projectHasWallcovering(project.jobInfo);

  useEffect(() => {
    if (hasWallcovering) return;
    setChecklist((prev) => startupChecklistForJobInfo(prev, project.jobInfo));
  }, [hasWallcovering, project.jobInfo]);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        await loadDefaultStartupItems();
        const { data, error: err } = await supabase
          .from("projects")
          .select("data")
          .eq("id", projectId)
          .single();
        if (err) throw new Error(err.message);
        const blob = parseProjectDataBlob(data?.data);
        const parsed = parseStartupChecklist(blob.startup_checklist);
        const items = withSubmitBrushoutsFromMaterialTracker(
          parseStartupItems(blob.startup_items, blob.startup_optional),
          {
            ...project,
            data: blob as import("../../types/database").Json,
          },
        );
        setStartupItems(items);
        setChecklist(
          withSystemSetupFromStartupGroups(
            withFieldHoursFromBudgetPush(startupChecklistForJobInfo(parsed, project.jobInfo), blob),
            items,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load startup checklist");
      }
    })();
  }, [projectId, refreshKey, project.jobInfo.public_works, project.jobInfo.start_date]);

  async function onToggleManualItem(itemId: string, complete: boolean) {
    const actor = await resolveActivityUser();
    const item = startupItems.items.find((row) => row.id === itemId);
    if (!item || item.source !== "manual") return;

    const next = toggleStartupItemComplete(startupItems, itemId, complete, actor.userName);
    const nextChecklist = systemSetupAfterStartupGroupToggle(checklist, next, item.group);
    setStartupItems(next);
    if (nextChecklist !== checklist) setChecklist(nextChecklist);
    setSavingId(itemId);

    if (item.id === "submitted_for_approval") {
      const trade = parseProjectTradeData(project.data as Json);
      const tracker = resolvePaintTracker(trade);
      const trackerErr = await savePaintTrackerState(
        projectId,
        complete
          ? { ...tracker, submittedForApproval: true, followUp: addDaysToTodayDisplay(14) }
          : { ...tracker, submittedForApproval: false },
        complete ? "Submitted for approval" : "Submitted for approval cleared",
      );
      if (trackerErr) {
        setStartupItems(startupItems);
        if (nextChecklist !== checklist) setChecklist(checklist);
        setError(trackerErr);
        setSavingId(null);
        return;
      }
      const updated = await reloadProject(projectId);
      if (updated) onProjectUpdate?.(updated);
    }

    const err = await commitProjectUpdate({
      projectId,
      mergeData:
        nextChecklist !== checklist
          ? { startup_items: next, startup_checklist: nextChecklist }
          : { startup_items: next },
      activity: {
        action: "startup_checklist_updated",
        summary: complete
          ? `Startup checklist · ${item.label} completed`
          : `Startup checklist · ${item.label} unchecked`,
      },
    });
    if (err) {
      setError(err);
      setSavingId(null);
      return;
    }
    setError(null);
    onActivity?.();
    setSavingId(null);
  }

  const startupProgress = startupItemsProgress(startupItems);
  const startupComplete = startupProgress.total > 0 && startupProgress.done === startupProgress.total;
  const tabOrder: PanelTab[] = startupComplete ? ["notes", "startup"] : ["startup", "notes"];
  const activeTab: PanelTab = noteFocus
    ? "notes"
    : focus
      ? "startup"
      : (manualTab ?? (startupComplete ? "notes" : "startup"));

  useEffect(() => {
    if (!noteFocus) return;
    setManualTab("notes");
  }, [noteFocus]);

  const rememberStartupFocus = useCallback(() => {
    setManualTab("startup");
    onFocusHandled?.();
  }, [onFocusHandled]);

  function selectTab(next: PanelTab, focusTab = false) {
    setManualTab(next);
    if (noteFocus) onNoteFocusHandled?.();
    if (focusTab) tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: PanelTab) {
    const index = tabOrder.indexOf(current);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabOrder.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabOrder.length) % tabOrder.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabOrder.length - 1;
    else return;
    event.preventDefault();
    const next = tabOrder[nextIndex];
    if (next) selectTab(next, true);
  }

  const startupBadge = `${startupProgress.done}/${startupProgress.total}`;

  return (
    <section className="card job-startup-checklist" id="startup-checklist">
      {error && <div className="banner banner-error job-startup-banner">{error}</div>}

      <div
        className="submittals-hub-tabs job-tracker-tabs job-tracker-tabs--underline"
        role="tablist"
        aria-label="Project notes and startup"
      >
        {tabOrder.map((tab) => {
          const selected = activeTab === tab;
          const label = tab === "startup" ? "Project startup" : "Notes";
          const badge =
            tab === "startup" ? (
              <span
                className={`submittals-hub-tab-count${startupComplete ? " job-startup-group-count--done" : ""}`}
              >
                {startupBadge}
              </span>
            ) : (
              <span className="submittals-hub-tab-count">{openNoteCount} open</span>
            );
          return (
            <button
              key={tab}
              ref={(node) => {
                tabRefs.current[tab] = node;
              }}
              type="button"
              role="tab"
              id={`dashboard-panel-tab-${tab}`}
              className={`job-tracker-tab${selected ? " job-tracker-tab--active" : ""}`}
              aria-selected={selected}
              aria-controls={`dashboard-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) => onTabKeyDown(event, tab)}
            >
              {label}
              {badge}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="dashboard-panel-startup"
        aria-labelledby="dashboard-panel-tab-startup"
        hidden={activeTab !== "startup"}
      >
        <ProjectStartupItemsCard
          items={startupItems}
          projectId={projectId}
          jobInfo={project.jobInfo}
          focus={focus}
          onFocusHandled={rememberStartupFocus}
          onOpenJobSetup={onOpenJobSetup}
          onConfigureStartup={onConfigureStartup}
          onToggleManualItem={(itemId, complete) => void onToggleManualItem(itemId, complete)}
          savingId={savingId}
        />
      </div>

      <div
        role="tabpanel"
        id="dashboard-panel-notes"
        aria-labelledby="dashboard-panel-tab-notes"
        hidden={activeTab !== "notes"}
      >
        <DashboardProjectNotes
          projectId={projectId}
          jobNumber={project.job_number}
          onOpenCount={setOpenNoteCount}
          focusNoteId={noteFocus}
          onFocusHandled={onNoteFocusHandled}
        />
      </div>
    </section>
  );
}
