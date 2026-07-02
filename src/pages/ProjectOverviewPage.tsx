import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { JobInfoSetupDrawer } from "../components/jobinfo/JobInfoSetupDrawer";
import { JobTrackerEditModal } from "../components/jobinfo/JobTrackerEditModal";
import { ProjectActivityPanel } from "../components/jobinfo/ProjectActivityPanel";
import { ProjectStartupChecklist } from "../components/jobinfo/ProjectStartupChecklist";
import { ProjectDashboardHeader } from "../components/jobinfo/ProjectDashboardHeader";
import { NeedsAttentionStrip } from "../components/jobinfo/NeedsAttentionStrip";
import { DashboardMetricCards } from "../components/jobinfo/DashboardMetricCards";
import { parseProjectDataBlob } from "../lib/jobInfo";
import { supabase } from "../lib/supabase";
import {
  buildAttentionItems,
  jobSetupStepCounts,
  parseDashboardStartupItems,
  paintSubmittalStageLabel,
  resolveDashboardPaintTracker,
  startupTaskCounts,
  type AttentionItem,
} from "../lib/projectDashboardSnapshot";
import { parseStartupItems, type StartupChecklistGroup } from "../lib/projectStartupItems";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

export function ProjectOverviewPage() {
  const { project: initial, projectId, setProject: setProjectCtx } = useOutletContext<Ctx>();
  const [project, setProject] = useState(initial);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupInitialTab, setSetupInitialTab] = useState<"info" | "startup">("info");
  const [trackerEditOpen, setTrackerEditOpen] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [startupItems, setStartupItems] = useState(() => parseDashboardStartupItems(initial));
  const [startupFocus, setStartupFocus] = useState<{ group: StartupChecklistGroup; itemId: string } | null>(null);

  const startupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setProject(initial);
    setStartupItems(parseDashboardStartupItems(initial));
  }, [initial]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("projects").select("data").eq("id", projectId).single();
      const blob = parseProjectDataBlob(data?.data);
      setStartupItems(parseStartupItems(blob.startup_items, blob.startup_optional));
    })();
  }, [projectId, activityRefreshKey, project.jobInfo.public_works, project.jobInfo.start_date, project.jobInfo.first_furnishing_date]);

  const paintTracker = useMemo(() => resolveDashboardPaintTracker(project), [project]);
  const submittalStage = paintSubmittalStageLabel(paintTracker);
  const attentionItems = useMemo(
    () => buildAttentionItems(project, startupItems),
    [project, startupItems],
  );
  const jobSetupCounts = jobSetupStepCounts(project);
  const startupCounts = startupTaskCounts(startupItems);

  function openJobSetup(tab: "info" | "startup" = "info") {
    setSetupInitialTab(tab);
    setSetupOpen(true);
  }

  function onSaved(next: ProjectForm) {
    setProject(next);
    setProjectCtx(next);
    setStartupItems(parseDashboardStartupItems(next));
    setActivityRefreshKey((k) => k + 1);
  }

  const scrollToStartup = useCallback(() => {
    startupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const clearStartupFocus = useCallback(() => setStartupFocus(null), []);

  function onAttentionItem(item: AttentionItem) {
    if (item.kind === "setup" || item.openJobSetup) {
      openJobSetup("info");
      return;
    }
    if (item.kind === "startup-item" && item.group && item.itemId) {
      setStartupFocus({ group: item.group, itemId: item.itemId });
      scrollToStartup();
    }
  }

  const metrics = useMemo(
    () => [
      {
        id: "job-setup",
        label: "Job setup",
        value: `${jobSetupCounts.done}/${jobSetupCounts.total}`,
        onClick: () => openJobSetup("info"),
      },
      {
        id: "startup",
        label: "Startup",
        value: startupCounts.total ? `${startupCounts.done}/${startupCounts.total}` : "—",
        onClick: () => openJobSetup("startup"),
      },
      {
        id: "submittal",
        label: "Submittal",
        value: submittalStage,
        onClick: () => setTrackerEditOpen(true),
      },
      {
        id: "follow-up",
        label: "Follow up",
        value: paintTracker.followUp.trim() || "Not set",
        onClick: () => setTrackerEditOpen(true),
      },
    ],
    [jobSetupCounts, startupCounts, submittalStage, paintTracker.followUp],
  );

  return (
    <div className="stack job-dashboard">
      <ProjectDashboardHeader
        project={project}
        projectId={projectId}
        attentionCount={attentionItems.length}
        paintTracker={paintTracker}
        onOpenJobSetup={() => openJobSetup("info")}
        onOpenTrackerEdit={() => setTrackerEditOpen(true)}
      />

      <NeedsAttentionStrip items={attentionItems} onItemClick={onAttentionItem} />

      <DashboardMetricCards metrics={metrics} />

      <div ref={startupRef}>
        <ProjectStartupChecklist
          project={project}
          projectId={projectId}
          jobInfoComplete={jobSetupCounts.done === jobSetupCounts.total}
          onOpenJobSetup={() => openJobSetup("info")}
          onConfigureStartup={() => openJobSetup("startup")}
          onActivity={() => setActivityRefreshKey((k) => k + 1)}
          focus={startupFocus}
          onFocusHandled={clearStartupFocus}
          refreshKey={activityRefreshKey}
        />
      </div>

      <JobTrackerEditModal
        open={trackerEditOpen}
        project={project}
        projectId={projectId}
        onClose={() => setTrackerEditOpen(false)}
        onOpenJobSetup={() => openJobSetup("info")}
        onProjectUpdate={onSaved}
      />

      <JobInfoSetupDrawer
        open={setupOpen}
        project={project}
        projectId={projectId}
        onClose={() => setSetupOpen(false)}
        onSaved={onSaved}
        initialTab={setupInitialTab}
      />

      <ProjectActivityPanel project={project} refreshKey={activityRefreshKey} limit={3} />
    </div>
  );
}
