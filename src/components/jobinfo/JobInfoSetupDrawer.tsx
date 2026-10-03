import { FormEvent, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DateInput } from "../DateInput";
import { GcNameCombobox } from "./GcNameCombobox";
import { EmailAddressWarning } from "../EmailAddressWarning";
import { useAuth } from "../../contexts/AuthContext";
import { loadContactDirectory, lookupGeneralContractor } from "../../lib/contactDirectory";
import { supabase } from "../../lib/supabase";
import { jobCityZipCountyLine, normalizeJobInfo, parseProjectDataBlob, seedJobInfoTeamFromTracker, syncLegacyFieldOrderFields } from "../../lib/jobInfo";
import { applyProposalImportPatch, importJobInfoFromProposalPdf } from "../../lib/proposalPdfImport";
import { commitProjectUpdate, recordProjectActivity } from "../../lib/projectActivity";
import {
  parseStartupChecklist,
  startupChecklistForJobInfo,
} from "../../lib/projectStartupChecklist";
import {
  applyPublicWorksFlag,
  applyWallcoveringScope,
  defaultStartupItems,
  loadDefaultStartupItems,
  parseStartupItems,
  type StartupItemsState,
} from "../../lib/projectStartupItems";
import { syncProjectStartDateToManpower } from "../../lib/syncProjectStartDate";
import { paintWcReassignMode } from "../../lib/reassignPaintWallcovering";
import { fieldAppsSyncReady, syncProjectTradeApps } from "../../lib/tradeAppsSync";
import { resolvePaintTracker } from "../../lib/fieldTrackerProject";
import { parseProjectTradeData } from "../../types/tradeDocuments";
import { IcbiInfoSection } from "./IcbiInfoSection";
import { ReassignJobNumbersModal } from "./ReassignJobNumbersModal";
import { StartupChecklistConfigSection } from "./StartupChecklistConfigSection";
import { TradeAppsSyncSection } from "./TradeAppsSyncSection";
import type { Json, ProjectForm } from "../../types/database";
import type { GcEntry } from "../../types/contactDirectory";
import { JOB_COST_TYPES, JOB_TYPES, type JobInfoData } from "../../types/jobInfo";

type JobSetupTab = "info" | "startup";

type Props = {
  open: boolean;
  project: ProjectForm;
  projectId: string;
  onClose: () => void;
  onSaved: (project: ProjectForm) => void;
  /** Which tab to show when the drawer opens. */
  initialTab?: JobSetupTab;
};

function patchJobInfo(info: JobInfoData, patch: Partial<JobInfoData>): JobInfoData {
  return { ...info, ...patch };
}

const JOB_INFO_SECTIONS = [
  { id: "job-info-sec-job", title: "Project" },
  { id: "job-info-sec-gc", title: "GC" },
  { id: "job-info-sec-architect", title: "Architect" },
  { id: "job-info-sec-owner", title: "Owner" },
  { id: "job-info-sec-icbi", title: "ICBI" },
] as const;

type SectionProgress = { filled: number; total: number };

function countRenderedFields(root: ParentNode | null): SectionProgress {
  if (!root) return { filled: 0, total: 0 };
  let filled = 0;
  let total = 0;
  root.querySelectorAll("input, select").forEach((node) => {
    if (node instanceof HTMLInputElement) {
      const type = node.type;
      if (
        type === "hidden" ||
        type === "checkbox" ||
        type === "radio" ||
        type === "file" ||
        type === "button" ||
        type === "submit" ||
        type === "reset"
      ) {
        return;
      }
      total += 1;
      if (node.value.trim()) filled += 1;
      return;
    }
    if (node instanceof HTMLSelectElement) {
      total += 1;
      filled += 1;
    }
  });
  return { filled, total };
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}

function inputClass(value: string, extra?: string): string | undefined {
  const cls = [extra, isBlank(value) ? "job-info-input-empty" : ""].filter(Boolean).join(" ");
  return cls || undefined;
}

function dateClass(value: string): string {
  return isBlank(value) ? "date-input job-info-input-empty" : "date-input";
}

function fieldClass(filled: boolean, extra?: string): string {
  return [extra, "job-info-field", filled ? "is-filled" : ""].filter(Boolean).join(" ");
}

function sameProgress(a: Record<string, SectionProgress>, b: Record<string, SectionProgress>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key]?.filled !== b[key]?.filled || a[key]?.total !== b[key]?.total) return false;
  }
  return true;
}

function JobSection({
  id,
  title,
  progress,
  children,
}: {
  id: string;
  title: string;
  progress?: SectionProgress;
  children: ReactNode;
}) {
  const complete = progress != null && progress.total > 0 && progress.filled === progress.total;
  return (
    <section id={id} className="job-info-block stack">
      <h3 className="job-info-block-heading">
        <span>{title}</span>
        {progress && (
          <span className={`job-info-count${complete ? " job-info-count--complete" : ""}`}>
            {progress.filled}/{progress.total}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

export function JobInfoSetupDrawer({ open, project: initial, projectId, onClose, onSaved, initialTab = "info" }: Props) {
  const { user } = useAuth();
  const [project, setProject] = useState(initial);
  const [activeTab, setActiveTab] = useState<JobSetupTab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [startupItems, setStartupItems] = useState<StartupItemsState>(() => defaultStartupItems());
  const [reassignOpen, setReassignOpen] = useState(false);
  const [gcDirectory, setGcDirectory] = useState<GcEntry[]>([]);
  const [sectionCounts, setSectionCounts] = useState<Record<string, SectionProgress>>({});
  const [activeSection, setActiveSection] = useState<(typeof JOB_INFO_SECTIONS)[number]["id"]>(
    JOB_INFO_SECTIONS[0].id,
  );
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [gcFillUndo, setGcFillUndo] = useState<{
    contractor: string;
    gc_address: string | null;
    gc_office_phone: string | null;
  } | null>(null);
  const [gcFlash, setGcFlash] = useState({ name: false, address: false, phone: false });
  const gcFlashTimer = useRef<number | null>(null);
  const proposalInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLFormElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const chipStripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setProject({
        ...initial,
        jobInfo: seedJobInfoTeamFromTracker(
          initial.jobInfo,
          resolvePaintTracker(parseProjectTradeData(initial.data as Json)).creativeTeam,
        ),
      });
      setActiveTab(initialTab);
      setReassignOpen(false);
    }
  }, [open, initial, projectId, initialTab]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      await loadDefaultStartupItems();
      const { data, error: err } = await supabase.from("projects").select("data").eq("id", projectId).single();
      if (err) return;
      const blob = parseProjectDataBlob(data?.data);
      setStartupItems(parseStartupItems(blob.startup_items, blob.startup_optional));
    })();
  }, [open, projectId]);

  useEffect(() => {
    return () => {
      if (gcFlashTimer.current != null) window.clearTimeout(gcFlashTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open || !user?.id) {
      setGcDirectory([]);
      return;
    }
    let cancelled = false;
    void loadContactDirectory(user.id)
      .then((dir) => {
        if (!cancelled) setGcDirectory(dir.general_contractors);
      })
      .catch(() => {
        if (!cancelled) setGcDirectory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  useLayoutEffect(() => {
    const panel = infoPanelRef.current;
    if (!open || !panel) return;
    const measure = () => {
      const next: Record<string, SectionProgress> = {};
      for (const section of JOB_INFO_SECTIONS) {
        next[section.id] = countRenderedFields(panel.querySelector(`#${section.id}`));
      }
      setSectionCounts((prev) => (sameProgress(prev, next) ? prev : next));
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(panel, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, project, activeTab, gcDirectory]);

  useEffect(() => {
    const scroller = bodyRef.current;
    if (!open || activeTab !== "info" || !scroller) return;
    const update = () => {
      const visible = JOB_INFO_SECTIONS.filter((section) => {
        const el = document.getElementById(section.id);
        return el != null && el.getClientRects().length > 0;
      });
      if (visible.length === 0) return;
      const lastId = visible[visible.length - 1].id;
      const overflow = scroller.scrollHeight - scroller.clientHeight > 2;
      const atBottom = overflow && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atBottom) {
        setActiveSection((prev) => (prev === lastId ? prev : lastId));
        return;
      }
      const scrollerTop = scroller.getBoundingClientRect().top;
      let current: (typeof JOB_INFO_SECTIONS)[number]["id"] = visible[0].id;
      for (const section of visible) {
        const el = document.getElementById(section.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - scrollerTop <= 8) current = section.id;
      }
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [open, activeTab, emptyOnly]);

  useEffect(() => {
    if (!open || activeTab !== "info") return;
    const chip = chipStripRef.current?.querySelector<HTMLElement>(`[data-section-id="${activeSection}"]`);
    if (!chip) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chip.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [activeSection, open, activeTab]);

  function setEmptyOnlyMode(next: boolean) {
    setEmptyOnly(next);
    const scroller = bodyRef.current;
    if (!scroller) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  function scrollToSection(id: (typeof JOB_INFO_SECTIONS)[number]["id"]) {
    const scroller = bodyRef.current;
    const el = document.getElementById(id);
    if (!scroller || !el) return;
    const top = scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
    setActiveSection(id);
  }

  function setJobInfo(patch: Partial<JobInfoData>) {
    setProject((p) => ({ ...p, jobInfo: patchJobInfo(p.jobInfo, patch) }));
  }

  function applyGcFromDirectory(name: string) {
    const hit = lookupGeneralContractor(gcDirectory, name);
    if (!hit) {
      setProject((p) => ({ ...p, contractor: name }));
      return;
    }
    setProject((p) => ({
      ...p,
      contractor: hit.name,
      jobInfo: patchJobInfo(p.jobInfo, {
        gc_address: hit.address,
        ...(hit.office_phone.trim() ? { gc_office_phone: hit.office_phone } : {}),
      }),
    }));
  }

  function clearGcFillUndo() {
    setGcFillUndo(null);
  }

  function triggerGcFlash(address: boolean, phone: boolean) {
    setGcFlash({ name: false, address: false, phone: false });
    window.requestAnimationFrame(() => {
      setGcFlash({ name: true, address, phone });
      if (gcFlashTimer.current != null) window.clearTimeout(gcFlashTimer.current);
      gcFlashTimer.current = window.setTimeout(() => {
        setGcFlash({ name: false, address: false, phone: false });
      }, 600);
    });
  }

  function pickSavedGc(name: string) {
    const hit = lookupGeneralContractor(gcDirectory, name);
    setGcFillUndo({
      contractor: project.contractor,
      gc_address: hit ? project.jobInfo.gc_address : null,
      gc_office_phone: hit?.office_phone.trim() ? project.jobInfo.gc_office_phone : null,
    });
    applyGcFromDirectory(name);
    triggerGcFlash(Boolean(hit), Boolean(hit?.office_phone.trim()));
  }

  function undoGcFill() {
    const snap = gcFillUndo;
    if (!snap) return;
    setProject((p) => ({
      ...p,
      contractor: snap.contractor,
      jobInfo: patchJobInfo(p.jobInfo, {
        ...(snap.gc_address !== null ? { gc_address: snap.gc_address } : {}),
        ...(snap.gc_office_phone !== null ? { gc_office_phone: snap.gc_office_phone } : {}),
      }),
    }));
    setGcFillUndo(null);
  }

  function applyJobNumberReassign(result: {
    job_number: string;
    job_name: string;
    jobInfo: JobInfoData;
    summary: string;
  }) {
    const wasWallcovering = project.jobInfo.has_wallcovering;
    setProject((p) => ({
      ...p,
      job_number: result.job_number,
      job_name: result.job_name,
      jobInfo: result.jobInfo,
    }));
    setStartupItems((items) => applyWallcoveringScope(items, result.jobInfo.has_wallcovering, wasWallcovering).state);
    setReassignOpen(false);
    setImportSuccess(`${result.summary}. Save job info to keep this.`);
    setError(null);
  }

  async function onImportProposal(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportSuccess(null);
    try {
      const result = await importJobInfoFromProposalPdf(file);
      const next = applyProposalImportPatch(project, result);
      setProject({
        ...next,
        job_number: project.job_number,
        job_name: project.job_name,
      });
      const layout =
        result.source === "ironwood"
          ? "Ironwood paint bid proposal"
          : result.source === "po"
            ? "Ironwood purchase order"
            : "Project / Address / Scope markers";
      setImportSuccess(`Imported from ${file.name} (${layout}). Save when ready.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Proposal import failed");
    } finally {
      setImporting(false);
      if (proposalInputRef.current) proposalInputRef.current.value = "";
    }
  }

  async function saveProject(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSyncStatus(null);

    const { data: row, error: loadErr } = await supabase
      .from("projects")
      .select("data")
      .eq("id", projectId)
      .single();
    if (loadErr) {
      setSaving(false);
      setError(loadErr.message);
      return;
    }

    const cityLine = jobCityZipCountyLine(project.jobInfo);
    const baseData = parseProjectDataBlob(row?.data);
    const prevJobInfo = normalizeJobInfo(baseData.job_info, project);
    const jobInfo = syncLegacyFieldOrderFields(project.jobInfo);
    const startupChecklist = startupChecklistForJobInfo(
      parseStartupChecklist(baseData.startup_checklist),
      jobInfo,
    );
    const { state: afterPublicWorks, activityNotes: publicWorksNotes } = applyPublicWorksFlag(
      startupItems,
      jobInfo.public_works,
      prevJobInfo.public_works,
    );
    const { state: nextStartupItems, activityNotes: wallcoveringNotes } = applyWallcoveringScope(
      afterPublicWorks,
      jobInfo.has_wallcovering,
      prevJobInfo.has_wallcovering,
    );
    const activityNotes = [...publicWorksNotes, ...wallcoveringNotes];
    const errMsg = await commitProjectUpdate({
      projectId,
      columns: {
        job_number: project.job_number,
        job_name: project.job_name,
        job_address: project.job_address,
        job_address2: cityLine || project.job_address2,
        contractor: project.contractor,
        architect: project.architect,
        owner: project.owner,
        data: {
          ...baseData,
          job_info: jobInfo,
          startup_checklist: startupChecklist,
          startup_items: nextStartupItems,
        },
      },
      activity: {
        action: "job_info_saved",
        summary:
          project.job_number.trim() !== initial.job_number.trim()
            ? `Job numbers updated: paint ${project.job_number.trim()}${
                jobInfo.has_wallcovering && jobInfo.wc_job_number.trim()
                  ? `, wallcovering ${jobInfo.wc_job_number.trim()}`
                  : ""
              }`
            : "Job setup saved",
      },
    });

    if (errMsg) {
      setSaving(false);
      setError(errMsg);
      return;
    }

    if (jobInfo.start_date.trim() !== prevJobInfo.start_date.trim()) {
      try {
        await syncProjectStartDateToManpower(projectId);
      } catch {
        // Best-effort; job setup save already succeeded.
      }
    }

    for (const note of activityNotes) {
      await recordProjectActivity({
        projectId,
        action: "startup_checklist_updated",
        summary: note,
      });
    }

    const next = {
      ...project,
      jobInfo,
      job_address2: cityLine || project.job_address2,
      data: {
        ...baseData,
        job_info: jobInfo,
        startup_checklist: startupChecklist,
        startup_items: nextStartupItems,
      },
    };
    let savedProject = next;

    if (fieldAppsSyncReady(next)) {
      const sync = await syncProjectTradeApps(next, projectId);
      if (sync.messages.length) setSyncStatus(`Synced: ${sync.messages.join(" · ")}`);
      if (sync.errors.length) {
        setError(sync.errors.join(" "));
      } else if (sync.ok && !startupChecklist.field_request_app) {
        const syncedChecklist = { ...startupChecklist, field_request_app: true };
        const checklistErr = await commitProjectUpdate({
          projectId,
          mergeData: { startup_checklist: syncedChecklist },
          activity: {
            action: "job_info_saved",
            summary: "Field Tools & Manpower synced from job setup",
          },
        });
        if (checklistErr) {
          setError(checklistErr);
        } else {
          savedProject = {
            ...next,
            data: {
              ...baseData,
              job_info: jobInfo,
              startup_checklist: syncedChecklist,
              startup_items: nextStartupItems,
            },
          };
        }
      }
    }

    setSaving(false);
    setProject(savedProject);
    onSaved(savedProject);
    setSavedAt(new Date().toLocaleTimeString());
  }

  const j = project.jobInfo;

  if (!open) return null;

  return (
    <div className="job-info-drawer-root" role="presentation">
      <button type="button" className="job-info-drawer-backdrop" aria-label="Close job setup" onClick={onClose} />
      <aside className="job-info-drawer-panel" aria-labelledby="job-info-drawer-title">
        <header className="job-info-drawer-header row-between wrap">
          <div>
            <h2 id="job-info-drawer-title">Job info</h2>
          </div>
          <div className="row-gap wrap job-info-drawer-header-actions">
            {savedAt && <span className="muted small">Saved {savedAt}</span>}
            <button type="submit" form="job-setup-form" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Saving…" : "Save job info"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm job-info-drawer-close"
              onClick={onClose}
              aria-label="Close job setup"
            >
              ✕
            </button>
          </div>
        </header>

        {(error || importSuccess || syncStatus) && (
          <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>
            {error ?? syncStatus ?? importSuccess}
          </div>
        )}

        <div className="job-info-drawer-tabs" role="tablist" aria-label="Job info sections">
          <button
            type="button"
            role="tab"
            id="job-setup-tab-info"
            aria-selected={activeTab === "info"}
            aria-controls="job-setup-panel-info"
            className={`job-info-drawer-tab${activeTab === "info" ? " job-info-drawer-tab--active" : ""}`}
            onClick={() => setActiveTab("info")}
          >
            Job info
          </button>
          <button
            type="button"
            role="tab"
            id="job-setup-tab-startup"
            aria-selected={activeTab === "startup"}
            aria-controls="job-setup-panel-startup"
            className={`job-info-drawer-tab${activeTab === "startup" ? " job-info-drawer-tab--active" : ""}`}
            onClick={() => setActiveTab("startup")}
          >
            Startup &amp; field
          </button>
        </div>

        {activeTab === "info" && (
          <nav className="job-info-section-nav jobinfo-form" aria-label="Jump to section">
            <div className="job-info-section-chips" ref={chipStripRef}>
              {JOB_INFO_SECTIONS.map((section) => {
                const progress = sectionCounts[section.id];
                const complete = progress != null && progress.total > 0 && progress.filled === progress.total;
                return (
                  <button
                    key={section.id}
                    type="button"
                    data-section-id={section.id}
                    className={`job-info-section-chip${activeSection === section.id ? " job-info-section-chip--active" : ""}`}
                    onClick={() => scrollToSection(section.id)}
                  >
                    <span>{section.title}</span>
                    {progress && (
                      <span className={`job-info-count${complete ? " job-info-count--complete" : ""}`}>
                        {progress.filled}/{progress.total}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <label className="job-info-switch job-info-empty-only-switch">
              <input
                type="checkbox"
                role="switch"
                checked={emptyOnly}
                onChange={(e) => setEmptyOnlyMode(e.target.checked)}
              />
              Empty only
            </label>
          </nav>
        )}

        <form
          id="job-setup-form"
          ref={bodyRef}
          className="stack job-info-form job-info-drawer-body"
          onSubmit={saveProject}
        >
          <input
            ref={proposalInputRef}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            onChange={(e) => void onImportProposal(e.target.files?.[0] ?? null)}
          />

          <div
            id="job-setup-panel-info"
            ref={infoPanelRef}
            role="tabpanel"
            aria-labelledby="job-setup-tab-info"
            hidden={activeTab !== "info"}
            className={`job-info-drawer-tab-panel stack jobinfo-form${emptyOnly && activeTab === "info" ? " is-empty-only" : ""}`}
          >
          <div className="job-info-import-strip">
            <p className="job-info-import-help">Fill fields from the proposal PDF</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={importing || saving}
              onClick={() => proposalInputRef.current?.click()}
            >
              {importing ? "Reading PDF…" : "Import from proposal PDF"}
            </button>
          </div>
          {emptyOnly &&
            JOB_INFO_SECTIONS.every((section) => {
              const progress = sectionCounts[section.id];
              return progress != null && progress.total > 0 && progress.filled === progress.total;
            }) && <p className="job-info-all-filled muted">Every field is filled.</p>}
          <JobSection id="job-info-sec-job" title="Project" progress={sectionCounts["job-info-sec-job"]}>
            <div className="job-info-subgroup">
              <h4 className="job-info-subgroup-heading">Identity</h4>
              <div className="job-info-grid">
                <label className={fieldClass(!isBlank(project.job_number), "job-info-span-2 job-info-job-number-field")}>
                  Job #
                  <input className={inputClass(project.job_number, "readonly")} value={project.job_number} readOnly aria-readonly />
                  <button
                    type="button"
                    className="job-info-text-link"
                    disabled={saving || !project.job_number.trim()}
                    onClick={() => setReassignOpen(true)}
                  >
                    {paintWcReassignMode(project) === "swap" ? "Swap with wallcovering" : "Reassign…"}
                  </button>
                </label>
                <label className={fieldClass(!isBlank(project.job_name), "job-info-span-4")}>
                  Job name
                  <span className="job-info-name-row">
                    <input
                      className={inputClass(project.job_name, "readonly")}
                      value={project.job_name}
                      readOnly
                      aria-readonly
                      aria-describedby="job-name-note"
                    />
                    <span className="job-info-note">
                      <button
                        type="button"
                        className="job-info-note-btn"
                        aria-label="Job name is set when the project is created. If the office assigned this number to wallcovering, reassign it instead of creating a second project."
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
                          <path d="M8 7.2V11.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                          <circle cx="8" cy="5.1" r="0.7" fill="currentColor" />
                        </svg>
                      </button>
                      <span id="job-name-note" className="job-info-note-pop" role="tooltip">
                        Job name is set when the project is created. If the office assigned this number to
                        wallcovering, reassign it instead of creating a second project.
                      </span>
                    </span>
                  </span>
                </label>
                <label className={fieldClass(!isBlank(j.job_date), "job-info-span-2")}>
                  Date
                  <DateInput className={dateClass(j.job_date)} value={j.job_date} onChange={(v) => setJobInfo({ job_date: v })} />
                </label>
                <label className={fieldClass(true, "job-info-span-2")}>
                  Job type
                  <select value={j.job_type} onChange={(e) => setJobInfo({ job_type: e.target.value })}>
                    {JOB_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldClass(true, "job-info-span-2")}>
                  Cost type
                  <select value={j.job_cost_type} onChange={(e) => setJobInfo({ job_cost_type: e.target.value })}>
                    {JOB_COST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="job-info-subgroup">
              <h4 className="job-info-subgroup-heading">Location</h4>
              <div className="job-info-grid">
                <label className={fieldClass(!isBlank(project.job_address), "job-info-span-6")}>
                  Job address
                  <input
                    className={inputClass(project.job_address)}
                    value={project.job_address}
                    onChange={(e) => setProject({ ...project, job_address: e.target.value })}
                  />
                </label>
                <label className={fieldClass(!isBlank(j.job_city), "job-info-span-2")}>
                  City
                  <input className={inputClass(j.job_city)} value={j.job_city} onChange={(e) => setJobInfo({ job_city: e.target.value })} />
                </label>
                <label className={fieldClass(!isBlank(j.job_county), "job-info-span-2")}>
                  County / State
                  <input className={inputClass(j.job_county)} value={j.job_county} onChange={(e) => setJobInfo({ job_county: e.target.value })} />
                </label>
                <label className={fieldClass(!isBlank(j.job_zip), "job-info-span-2")}>
                  Zip
                  <input className={inputClass(j.job_zip)} value={j.job_zip} onChange={(e) => setJobInfo({ job_zip: e.target.value })} />
                </label>
              </div>
            </div>
            <div className="job-info-subgroup">
              <h4 className="job-info-subgroup-heading">Contract &amp; schedule</h4>
              <div className="job-info-grid">
                <label className={fieldClass(!isBlank(j.contract_amount), "job-info-span-2")}>
                  Paint contract amount
                  <span className="job-info-money">
                    <span className="job-info-money-prefix" aria-hidden="true">$</span>
                    <input className={inputClass(j.contract_amount)} value={j.contract_amount} onChange={(e) => setJobInfo({ contract_amount: e.target.value })} />
                  </span>
                </label>
                <label className={fieldClass(!isBlank(j.start_date), "job-info-span-2")}>
                  Estimated start date
                  <DateInput className={dateClass(j.start_date)} value={j.start_date} onChange={(v) => setJobInfo({ start_date: v })} />
                </label>
                <label className={fieldClass(!isBlank(j.end_date), "job-info-span-2")}>
                  Estimated end date
                  <DateInput className={dateClass(j.end_date)} value={j.end_date} onChange={(v) => setJobInfo({ end_date: v })} />
                </label>
                <label className={fieldClass(true, "job-info-span-2")}>
                  Billing Due
                  <select
                    value={j.billing_due_day}
                    onChange={(e) => setJobInfo({ billing_due_day: e.target.value })}
                  >
                    <option value="">Day of month…</option>
                    {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                  <span className="muted small job-info-field-help">
                    Same day every month (e.g. 15 = the 15th).
                  </span>
                </label>
              </div>
            </div>
            <div className="job-info-subgroup">
              <h4 className="job-info-subgroup-heading">Additional contracts</h4>
              <label className="checkbox-row job-info-wc-toggle job-info-switch job-info-nonfield">
                <input
                  type="checkbox"
                  role="switch"
                  checked={j.public_works}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    const wasPublicWorks = j.public_works;
                    setJobInfo({ public_works: checked });
                    setStartupItems((items) => applyPublicWorksFlag(items, checked, wasPublicWorks).state);
                  }}
                />
                Public works project
              </label>
              <div className="job-info-switch-block">
                <label className="checkbox-row job-info-wc-toggle job-info-switch job-info-nonfield">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={j.has_wallcovering}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const wasWallcovering = j.has_wallcovering;
                      setJobInfo({ has_wallcovering: checked });
                      setStartupItems((items) => applyWallcoveringScope(items, checked, wasWallcovering).state);
                    }}
                  />
                  This project includes wallcovering (separate contract / job #)
                </label>
                {j.has_wallcovering && (
                  <div className="job-info-grid job-info-switch-fields job-info-wc-fields">
                    <label className={fieldClass(!isBlank(j.wc_job_number), "job-info-span-2")}>
                      Wallcovering job #
                      <input
                        className={inputClass(j.wc_job_number)}
                        value={j.wc_job_number}
                        placeholder={project.job_number || "Same as paint job #"}
                        onChange={(e) => setJobInfo({ wc_job_number: e.target.value })}
                      />
                    </label>
                    <label className={fieldClass(!isBlank(j.wc_job_name), "job-info-span-2")}>
                      Wallcovering job name
                      <input
                        className={inputClass(j.wc_job_name)}
                        value={j.wc_job_name}
                        placeholder={project.job_name || "Same as paint job name"}
                        onChange={(e) => setJobInfo({ wc_job_name: e.target.value })}
                      />
                    </label>
                    <label className={fieldClass(!isBlank(j.wc_contract_amount), "job-info-span-2")}>
                      Wallcovering contract amount
                      <span className="job-info-money">
                        <span className="job-info-money-prefix" aria-hidden="true">$</span>
                        <input
                          className={inputClass(j.wc_contract_amount)}
                          value={j.wc_contract_amount}
                          placeholder={j.contract_amount || "Same as paint contract amount"}
                          onChange={(e) => setJobInfo({ wc_contract_amount: e.target.value })}
                        />
                      </span>
                    </label>
                  </div>
                )}
              </div>
              <div className="job-info-switch-block">
                <label className="checkbox-row job-info-wc-toggle job-info-switch job-info-nonfield">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={j.has_frp}
                    onChange={(e) => setJobInfo({ has_frp: e.target.checked })}
                  />
                  This project includes FRP (separate contract / job #)
                </label>
                {j.has_frp && (
                  <div className="job-info-grid job-info-switch-fields job-info-wc-fields">
                    <label className={fieldClass(!isBlank(j.frp_job_number), "job-info-span-2")}>
                      FRP job #
                      <input
                        className={inputClass(j.frp_job_number)}
                        value={j.frp_job_number}
                        placeholder={project.job_number || "Same as paint job #"}
                        onChange={(e) => setJobInfo({ frp_job_number: e.target.value })}
                      />
                    </label>
                    <label className={fieldClass(!isBlank(j.frp_job_name), "job-info-span-2")}>
                      FRP job name
                      <input
                        className={inputClass(j.frp_job_name)}
                        value={j.frp_job_name}
                        placeholder={project.job_name || "Same as paint job name"}
                        onChange={(e) => setJobInfo({ frp_job_name: e.target.value })}
                      />
                    </label>
                    <label className={fieldClass(!isBlank(j.frp_contract_amount), "job-info-span-2")}>
                      FRP contract amount
                      <span className="job-info-money">
                        <span className="job-info-money-prefix" aria-hidden="true">$</span>
                        <input
                          className={inputClass(j.frp_contract_amount)}
                          value={j.frp_contract_amount}
                          placeholder={j.contract_amount || "Same as paint contract amount"}
                          onChange={(e) => setJobInfo({ frp_contract_amount: e.target.value })}
                        />
                      </span>
                    </label>
                  </div>
                )}
              </div>
              <div className="job-info-switch-block">
                <label className="checkbox-row job-info-wc-toggle job-info-switch job-info-nonfield">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={j.has_track}
                    onChange={(e) => setJobInfo({ has_track: e.target.checked })}
                  />
                  This project includes FWP (separate contract / job #)
                </label>
                {j.has_track && (
                  <div className="job-info-grid job-info-switch-fields job-info-wc-fields">
                    <label className={fieldClass(!isBlank(j.track_job_number), "job-info-span-2")}>
                      Track job #
                      <input
                        className={inputClass(j.track_job_number)}
                        value={j.track_job_number}
                        placeholder={project.job_number || "Same as paint job #"}
                        onChange={(e) => setJobInfo({ track_job_number: e.target.value })}
                      />
                    </label>
                    <label className={fieldClass(!isBlank(j.track_job_name), "job-info-span-2")}>
                      Track job name
                      <input
                        className={inputClass(j.track_job_name)}
                        value={j.track_job_name}
                        placeholder={project.job_name || "Same as paint job name"}
                        onChange={(e) => setJobInfo({ track_job_name: e.target.value })}
                      />
                    </label>
                    <label className={fieldClass(!isBlank(j.track_contract_amount), "job-info-span-2")}>
                      Track contract amount
                      <span className="job-info-money">
                        <span className="job-info-money-prefix" aria-hidden="true">$</span>
                        <input
                          className={inputClass(j.track_contract_amount)}
                          value={j.track_contract_amount}
                          placeholder={j.contract_amount || "Same as paint contract amount"}
                          onChange={(e) => setJobInfo({ track_contract_amount: e.target.value })}
                        />
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="job-info-subgroup">
              <h4 className="job-info-subgroup-heading">Scope</h4>
              <div className="job-info-grid">
                <label className={fieldClass(!isBlank(j.scope_of_out_work), "job-info-span-6")}>
                  Scope of out work
                  <input className={inputClass(j.scope_of_out_work)} value={j.scope_of_out_work} onChange={(e) => setJobInfo({ scope_of_out_work: e.target.value })} />
                </label>
                <label className={fieldClass(!isBlank(j.project_description), "job-info-span-6")}>
                  Description of project
                  <input
                    className={inputClass(j.project_description)}
                    value={j.project_description}
                    onChange={(e) => setJobInfo({ project_description: e.target.value })}
                  />
                </label>
              </div>
            </div>
          </JobSection>

          <JobSection id="job-info-sec-gc" title="GC" progress={sectionCounts["job-info-sec-gc"]}>
            <div className="job-info-subgroup">
              <h4 className="job-info-subgroup-heading">Company</h4>
              <div className="job-info-grid">
                <div className={fieldClass(!isBlank(project.contractor), "job-info-span-4")}>
                  <label htmlFor="job-info-gc-name">GC name</label>
                  <GcNameCombobox
                    id="job-info-gc-name"
                    value={project.contractor}
                    directory={gcDirectory}
                    className={inputClass(project.contractor)}
                    flash={gcFlash.name}
                    filledNotice={gcFillUndo != null}
                    onValueChange={(name) => {
                      clearGcFillUndo();
                      setProject((p) => ({ ...p, contractor: name }));
                    }}
                    onPick={pickSavedGc}
                    onUndo={undoGcFill}
                  />
                </div>
                <label className={fieldClass(!isBlank(j.gc_job_number), "job-info-span-2")}>
                  GC job #
                  <input className={inputClass(j.gc_job_number)} value={j.gc_job_number} onChange={(e) => setJobInfo({ gc_job_number: e.target.value })} />
                </label>
                <label className={fieldClass(!isBlank(j.gc_address), "job-info-span-6")}>
                  Address
                  <input
                    className={[inputClass(j.gc_address), gcFlash.address ? "job-info-gc-flash" : ""].filter(Boolean).join(" ") || undefined}
                    value={j.gc_address}
                    onChange={(e) => {
                      clearGcFillUndo();
                      setJobInfo({ gc_address: e.target.value });
                    }}
                  />
                </label>
                <label className={fieldClass(!isBlank(j.gc_office_phone), "job-info-span-3")}>
                  Office phone
                  <input
                    className={[inputClass(j.gc_office_phone), gcFlash.phone ? "job-info-gc-flash" : ""].filter(Boolean).join(" ") || undefined}
                    value={j.gc_office_phone}
                    onChange={(e) => {
                      clearGcFillUndo();
                      setJobInfo({ gc_office_phone: e.target.value });
                    }}
                  />
                </label>
                <label className={fieldClass(!isBlank(j.gc_fax), "job-info-span-3")}>
                  Fax
                  <input className={inputClass(j.gc_fax)} value={j.gc_fax} onChange={(e) => setJobInfo({ gc_fax: e.target.value })} />
                </label>
              </div>
            </div>
            <div className="job-info-subgroup">
              <h4 className="job-info-subgroup-heading">People</h4>
              <div className="job-info-people job-info-people--gc">
                <div className="job-info-people-head" aria-hidden="true">
                  <span />
                  <span>Name</span>
                  <span>Phone</span>
                  <span>Email</span>
                </div>
                <div className={fieldClass(!isBlank(j.gc_pm) && !isBlank(j.gc_pm_phone) && !isBlank(j.gc_pm_email), "job-info-people-row")}>
                  <span className="job-info-people-role">PM</span>
                  <input aria-label="PM" className={inputClass(j.gc_pm)} value={j.gc_pm} onChange={(e) => setJobInfo({ gc_pm: e.target.value })} />
                  <input
                    aria-label="PM phone"
                    type="tel"
                    className={inputClass(j.gc_pm_phone)}
                    value={j.gc_pm_phone}
                    onChange={(e) => setJobInfo({ gc_pm_phone: e.target.value })}
                  />
                  <div className="job-info-people-cell">
                    <input
                      aria-label="PM email"
                      type="email"
                      className={inputClass(j.gc_pm_email)}
                      value={j.gc_pm_email}
                      onChange={(e) => setJobInfo({ gc_pm_email: e.target.value })}
                    />
                    <EmailAddressWarning value={j.gc_pm_email} compact />
                  </div>
                </div>
                <div className={fieldClass(!isBlank(j.gc_superintendent) && !isBlank(j.gc_super_phone) && !isBlank(j.gc_super_email), "job-info-people-row")}>
                  <span className="job-info-people-role">Super</span>
                  <input
                    aria-label="GC superintendent"
                    className={inputClass(j.gc_superintendent)}
                    value={j.gc_superintendent}
                    onChange={(e) => setJobInfo({ gc_superintendent: e.target.value })}
                  />
                  <input
                    aria-label="GC super phone"
                    type="tel"
                    className={inputClass(j.gc_super_phone)}
                    value={j.gc_super_phone}
                    onChange={(e) => setJobInfo({ gc_super_phone: e.target.value })}
                  />
                  <div className="job-info-people-cell">
                    <input
                      aria-label="GC super email"
                      type="email"
                      className={inputClass(j.gc_super_email)}
                      value={j.gc_super_email}
                      onChange={(e) => setJobInfo({ gc_super_email: e.target.value })}
                    />
                    <EmailAddressWarning value={j.gc_super_email} compact />
                  </div>
                </div>
                <div className={fieldClass(!isBlank(j.gc_estimator), "job-info-people-row")}>
                  <span className="job-info-people-role">Estimator</span>
                  <input
                    aria-label="Estimator"
                    className={inputClass(j.gc_estimator)}
                    value={j.gc_estimator}
                    onChange={(e) => setJobInfo({ gc_estimator: e.target.value })}
                  />
                  <span className="job-info-people-blank" aria-hidden="true">—</span>
                  <span className="job-info-people-blank" aria-hidden="true">—</span>
                </div>
                <div className={fieldClass(!isBlank(j.gc_engineer), "job-info-people-row")}>
                  <span className="job-info-people-role">PE</span>
                  <input
                    aria-label="Project engineer"
                    className={inputClass(j.gc_engineer)}
                    value={j.gc_engineer}
                    onChange={(e) => setJobInfo({ gc_engineer: e.target.value })}
                  />
                  <span className="job-info-people-blank" aria-hidden="true">—</span>
                  <span className="job-info-people-blank" aria-hidden="true">—</span>
                </div>
              </div>
            </div>
          </JobSection>

          <JobSection id="job-info-sec-architect" title="Architect" progress={sectionCounts["job-info-sec-architect"]}>
            <div className="job-info-grid">
              <label className={fieldClass(!isBlank(project.architect), "job-info-span-4")}>
                Architect
                <input
                  className={inputClass(project.architect)}
                  value={project.architect}
                  onChange={(e) => setProject({ ...project, architect: e.target.value })}
                />
              </label>
              <label className={fieldClass(!isBlank(j.drawings), "job-info-span-2")}>
                Drawings
                <input className={inputClass(j.drawings)} value={j.drawings} onChange={(e) => setJobInfo({ drawings: e.target.value })} />
              </label>
              <label className={fieldClass(!isBlank(j.architect_address), "job-info-span-6")}>
                Address
                <input
                  className={inputClass(j.architect_address)}
                  value={j.architect_address}
                  onChange={(e) => setJobInfo({ architect_address: e.target.value })}
                />
              </label>
              <label className={fieldClass(!isBlank(j.architect_city_state_zip), "job-info-span-6")}>
                City, state, zip
                <input
                  className={inputClass(j.architect_city_state_zip)}
                  value={j.architect_city_state_zip}
                  onChange={(e) => setJobInfo({ architect_city_state_zip: e.target.value })}
                />
              </label>
              <label className={fieldClass(!isBlank(j.architect_contact), "job-info-span-3")}>
                Contact
                <input className={inputClass(j.architect_contact)} value={j.architect_contact} onChange={(e) => setJobInfo({ architect_contact: e.target.value })} />
              </label>
              <label className={fieldClass(!isBlank(j.architect_phone), "job-info-span-3")}>
                Phone
                <input className={inputClass(j.architect_phone)} value={j.architect_phone} onChange={(e) => setJobInfo({ architect_phone: e.target.value })} />
              </label>
            </div>
          </JobSection>

          <JobSection id="job-info-sec-owner" title="Owner" progress={sectionCounts["job-info-sec-owner"]}>
            <div className="job-info-grid">
              <label className={fieldClass(!isBlank(project.owner), "job-info-span-6")}>
                Name
                <input className={inputClass(project.owner)} value={project.owner} onChange={(e) => setProject({ ...project, owner: e.target.value })} />
              </label>
              <label className={fieldClass(!isBlank(j.owner_address), "job-info-span-6")}>
                Address
                <input className={inputClass(j.owner_address)} value={j.owner_address} onChange={(e) => setJobInfo({ owner_address: e.target.value })} />
              </label>
              <label className={fieldClass(!isBlank(j.owner_city_state_zip), "job-info-span-6")}>
                City, state, zip
                <input
                  className={inputClass(j.owner_city_state_zip)}
                  value={j.owner_city_state_zip}
                  onChange={(e) => setJobInfo({ owner_city_state_zip: e.target.value })}
                />
              </label>
              <label className={fieldClass(!isBlank(j.owner_contact), "job-info-span-3")}>
                Contact
                <input className={inputClass(j.owner_contact)} value={j.owner_contact} onChange={(e) => setJobInfo({ owner_contact: e.target.value })} />
              </label>
              <label className={fieldClass(!isBlank(j.owner_phone), "job-info-span-3")}>
                Phone
                <input className={inputClass(j.owner_phone)} value={j.owner_phone} onChange={(e) => setJobInfo({ owner_phone: e.target.value })} />
              </label>
            </div>
          </JobSection>

          <IcbiInfoSection
            key={projectId}
            jobInfo={j}
            onChange={setJobInfo}
            progress={sectionCounts["job-info-sec-icbi"]}
          />
          </div>

          <div
            id="job-setup-panel-startup"
            role="tabpanel"
            aria-labelledby="job-setup-tab-startup"
            hidden={activeTab !== "startup"}
            className="job-info-drawer-tab-panel stack"
          >
            <StartupChecklistConfigSection value={startupItems} jobInfo={j} onChange={setStartupItems} embedded />
            <TradeAppsSyncSection project={project} projectId={projectId} embedded />
          </div>
        </form>
      </aside>
      <ReassignJobNumbersModal
        open={reassignOpen}
        project={project}
        projectId={projectId}
        onClose={() => setReassignOpen(false)}
        onApply={applyJobNumberReassign}
      />
    </div>
  );
}
