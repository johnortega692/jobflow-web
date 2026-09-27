import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { AhaCompetentPersonsTable } from "../components/aha/AhaCompetentPersonsTable";
import { AhaConsiderationsCard } from "../components/aha/AhaConsiderationsCard";
import { AhaEmergencyCard } from "../components/aha/AhaEmergencyCard";
import { AhaEquipmentTable } from "../components/aha/AhaEquipmentTable";
import { AhaProductsCard } from "../components/aha/AhaProductsCard";
import { AhaReviewLog } from "../components/aha/AhaReviewLog";
import { AhaStepLibraryModal } from "../components/aha/AhaStepLibraryModal";
import { AhaStepRow } from "../components/aha/AhaStepRow";
import { RacBadge } from "../components/aha/RacBadge";
import { SegmentedControl } from "../components/SegmentedControl";
import { FlagSwitch } from "../components/jobinfo/StageStepper";
import { useLetterhead } from "../contexts/LetterheadContext";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import {
  createProjectAhaFromLibrary,
  deleteProjectAha,
  listLibrary,
  listProjectAhas,
  updateProjectAha,
} from "../lib/aha/api";
import { downloadAhaPdf } from "../lib/aha/ahaPdf";
import {
  cloneCompetentPersons,
  cloneEquipmentRows,
  mergeCompetentPersons,
  mergeConsiderations,
  mergeEquipmentRows,
} from "../lib/aha/equipmentRows";
import { RECOMMENDED_BUNDLES } from "../lib/aha/bundles";
import { emptyEmergency, loadProjectEmergency, saveProjectEmergency, type AhaEmergencyInfo } from "../lib/aha/emergency";
import { formatAddress } from "../lib/aha/format";
import { mergePulledProducts, productsFromJob } from "../lib/aha/jobProducts";
import { DEFAULT_STANDARD_PPE, parseStandardPpe } from "../lib/aha/ppe";
import { loadOrgSettingsBlob } from "../lib/orgSettings";
import { supabase } from "../lib/supabase";
import { parseProjectTradeData } from "../types/tradeDocuments";
import {
  ahaPdfFilename,
  ahaReadiness,
  ahaScopeLabel,
  ahaStatusLabel,
  RAC_KEY,
  blankAhaStep,
  cleanAhaStep,
  copyLibrarySteps,
  suggestedAhaName,
} from "../lib/aha/display";
import { overallRac } from "../lib/aha/rac";
import type { AhaLibraryItem, AhaLibraryStep, AhaScope, AhaStandard, AhaStatus, ProjectAha } from "../lib/aha/types";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import type { ProjectForm } from "../types/database";
import "../components/aha/aha-editor.css";

type Ctx = { project: ProjectForm; projectId: string };

type ScopeFilter = "all" | AhaScope;

const STATUS_OPTIONS: { value: AhaStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "accepted", label: "Accepted" },
];

const STANDARD_OPTIONS: { value: AhaStandard; label: string }[] = [
  { value: "calosha", label: "Cal/OSHA" },
  { value: "em385", label: "EM 385-1-1" },
];

const SCOPE_FILTERS: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paint", label: "Paint" },
  { id: "wallcovering", label: "Wallcovering" },
  { id: "access", label: "Access" },
  { id: "general", label: "General" },
];

function cloneAha(aha: ProjectAha): ProjectAha {
  return structuredClone(aha);
}

export function AhaPage() {
  const { project, projectId } = useOutletContext<Ctx>();
  const { profile, settings } = useLetterhead();
  const [library, setLibrary] = useState<AhaLibraryItem[]>([]);
  const [ahas, setAhas] = useState<ProjectAha[]>([]);
  const [draft, setDraft] = useState<ProjectAha | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameBeforeEdit, setNameBeforeEdit] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [emergency, setEmergency] = useState<AhaEmergencyInfo>(emptyEmergency);
  const [standardPpe, setStandardPpe] = useState<string[]>(DEFAULT_STANDARD_PPE);
  const [pullingProducts, setPullingProducts] = useState(false);
  const [checkedLibraryIds, setCheckedLibraryIds] = useState<string[]>([]);
  const [createName, setCreateName] = useState("");
  const [createCsi, setCreateCsi] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [csiTouched, setCsiTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusSavingRef = useRef(false);
  const printingRef = useRef(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const { isDirty, syncBaseline, readBaseline } = useTradeDraftDirty(draft, draft !== null);

  const commitSelection = useCallback(
    (next: ProjectAha | null) => {
      if (!next) {
        setDraft(null);
        setSelectedId(null);
        setExpandedStepId(null);
        setEditingName(false);
        return;
      }
      const copy = cloneAha(next);
      syncBaseline(copy);
      setDraft(copy);
      setSelectedId(copy.id);
      setExpandedStepId(null);
      setEditingName(false);
    },
    [syncBaseline],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDraft(null);
    setSelectedId(null);
    setExpandedStepId(null);
    setCheckedLibraryIds([]);
    setNameTouched(false);
    setCsiTouched(false);
    setCreateName("");
    setCreateCsi("");
    void (async () => {
      try {
        const [templates, rows, emergencyInfo, org] = await Promise.all([
          listLibrary(),
          listProjectAhas(projectId),
          loadProjectEmergency(projectId),
          loadOrgSettingsBlob(),
        ]);
        if (cancelled) return;
        setLibrary(templates);
        setAhas(rows);
        setEmergency(emergencyInfo);
        setStandardPpe(parseStandardPpe(org.aha_standard_ppe));
        if (rows[0]) {
          const copy = cloneAha(rows[0]);
          setDraft(copy);
          setSelectedId(copy.id);
          setLibraryOpen(false);
        } else {
          setLibraryOpen(true);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load AHAs.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const selected = checkedLibraryIds
      .map((id) => library.find((item) => item.id === id))
      .filter((item): item is AhaLibraryItem => Boolean(item));
    if (!nameTouched) setCreateName(suggestedAhaName(selected.map((item) => item.scope)));
    if (!csiTouched) setCreateCsi(selected[0]?.csi ?? "");
  }, [checkedLibraryIds, library, nameTouched, csiTouched]);

  const persist = useCallback(
    async (skipConfirm: boolean): Promise<boolean> => {
      if (!draft) return false;
      const readiness = ahaReadiness(draft, emergency);
      if (!skipConfirm && readiness.confirmMessage && !window.confirm(readiness.confirmMessage)) {
        return false;
      }
      setSaving(true);
      setError(null);
      try {
        const saved = await updateProjectAha(draft.id, {
          name: draft.name,
          scope: draft.scope,
          csi: draft.csi,
          status: draft.status,
          competent_person: draft.competent_person,
          considerations: draft.considerations,
          equipment_rows: draft.equipment_rows,
          competent_persons: draft.competent_persons,
          project_manager: draft.project_manager,
          superintendent: draft.superintendent,
          foreman: draft.foreman,
          reviewed_by: draft.reviewed_by,
          notes: draft.notes,
          review_log: draft.review_log,
          products: draft.products,
          extra_ppe: draft.extra_ppe,
          steps: draft.steps.map(cleanAhaStep),
          options: draft.options,
          library_ids: draft.library_ids,
        });
        syncBaseline(saved);
        setDraft(saved);
        setAhas((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
        setExpandedStepId(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save this AHA.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [draft, emergency, syncBaseline],
  );

  const onDiscardUnsaved = useCallback(() => {
    const baseline = readBaseline();
    if (baseline) setDraft(baseline);
    setExpandedStepId(null);
    setEditingName(false);
  }, [readBaseline]);

  useUnsavedNavigationGuard({
    sectionLabel: "Activity Hazard Analysis",
    isDirty,
    onSave: () => persist(true),
    onDiscard: onDiscardUnsaved,
  });

  function confirmDiscard(): boolean {
    if (!isDirty) return true;
    return window.confirm("Discard unsaved changes to this AHA?");
  }

  function selectAha(id: string) {
    if (id === selectedId) return;
    if (!confirmDiscard()) return;
    const row = ahas.find((aha) => aha.id === id);
    if (row) commitSelection(row);
  }

  async function onStatus(status: AhaStatus) {
    if (!draft || draft.status === status || statusSavingRef.current) return;
    const previous = draft.status;
    const baseline = readBaseline();
    statusSavingRef.current = true;
    setDraft({ ...draft, status });
    if (baseline) syncBaseline({ ...baseline, status });
    setStatusSaving(true);
    setError(null);
    try {
      const saved = await updateProjectAha(draft.id, { status });
      setAhas((rows) =>
        rows.map((row) =>
          row.id === saved.id ? { ...row, status: saved.status, updated_at: saved.updated_at } : row,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status.");
      setDraft((current) => (current && current.id === draft.id ? { ...current, status: previous } : current));
      if (baseline) syncBaseline(baseline);
    } finally {
      statusSavingRef.current = false;
      setStatusSaving(false);
    }
  }

  function toggleLibraryTemplate(id: string) {
    setCheckedLibraryIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function createFromLibrary() {
    if (!checkedLibraryIds.length || creating) return;
    if (!confirmDiscard()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createProjectAhaFromLibrary(projectId, {
        libraryIds: checkedLibraryIds,
        name: nameTouched ? createName : suggestedName,
        csi: csiTouched ? createCsi : suggestedCsi,
      });
      setAhas((rows) => [...rows, created]);
      setCheckedLibraryIds([]);
      setNameTouched(false);
      setCsiTouched(false);
      setCreateName("");
      setCreateCsi("");
      setLibraryOpen(false);
      commitSelection(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create this AHA.");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete() {
    if (!draft || deleting) return;
    const label = draft.name.trim() || "this AHA";
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProjectAha(draft.id);
      const index = ahas.findIndex((aha) => aha.id === draft.id);
      const remaining = ahas.filter((aha) => aha.id !== draft.id);
      setAhas(remaining);
      const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null;
      if (!next) setLibraryOpen(true);
      commitSelection(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this AHA.");
    } finally {
      setDeleting(false);
    }
  }

  function toggleStep(id: string) {
    setDraft((current) => {
      if (!current || !expandedStepId) return current;
      return {
        ...current,
        steps: current.steps.map((step) => (step.id === expandedStepId ? cleanAhaStep(step) : step)),
      };
    });
    setExpandedStepId((current) => (current === id ? null : id));
  }

  function patchStep(id: string, patch: Partial<ProjectAha["steps"][number]>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
          }
        : current,
    );
  }

  function removeStep(id: string) {
    const step = draft?.steps.find((item) => item.id === id);
    const label = step?.name.trim() || "this step";
    if (!window.confirm(`Remove "${label}"?`)) return;
    setDraft((current) =>
      current ? { ...current, steps: current.steps.filter((item) => item.id !== id) } : current,
    );
    setExpandedStepId((current) => (current === id ? null : current));
  }

  function reorderSteps(from: number, to: number) {
    if (from === to) return;
    setDraft((current) => {
      if (!current) return current;
      const steps = [...current.steps];
      const [moved] = steps.splice(from, 1);
      if (!moved) return current;
      steps.splice(to, 0, moved);
      return { ...current, steps };
    });
  }

  function clearDrag() {
    setDragFrom(null);
    setDragOver(null);
  }

  function addCustomStep() {
    const step = blankAhaStep();
    setDraft((current) => {
      if (!current) return current;
      const steps = expandedStepId
        ? current.steps.map((item) => (item.id === expandedStepId ? cleanAhaStep(item) : item))
        : current.steps;
      return { ...current, steps: [...steps, step] };
    });
    setExpandedStepId(step.id);
    requestAnimationFrame(() => {
      document.querySelector(`[data-step-id="${step.id}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function addLibraryStep(source: AhaLibraryStep) {
    const step = copyLibrarySteps([source])[0];
    if (!step) return;
    setDraft((current) => (current ? { ...current, steps: [...current.steps, step] } : current));
    setPickerOpen(false);
    requestAnimationFrame(() => {
      document.querySelector(`[data-step-id="${step.id}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function addLibraryTemplate(template: AhaLibraryItem) {
    const steps = copyLibrarySteps(template.steps);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        library_ids: current.library_ids.includes(template.id)
          ? current.library_ids
          : [...current.library_ids, template.id],
        considerations: mergeConsiderations([current.considerations, template.considerations]),
        equipment_rows: mergeEquipmentRows(current.equipment_rows, cloneEquipmentRows(template.equipment_rows)),
        competent_persons: mergeCompetentPersons(
          current.competent_persons,
          cloneCompetentPersons(template.competent_persons),
        ),
        steps: [...current.steps, ...steps],
      };
    });
    setPickerOpen(false);
    const last = steps[steps.length - 1];
    if (!last) return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-step-id="${last.id}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  const activeLibrary = library.filter((item) => !item.archived);
  const visibleLibrary = activeLibrary.filter((item) => scopeFilter === "all" || item.scope === scopeFilter);
  const selectedTemplates = checkedLibraryIds
    .map((id) => library.find((item) => item.id === id))
    .filter((item): item is AhaLibraryItem => Boolean(item));
  const suggestedName = suggestedAhaName(selectedTemplates.map((item) => item.scope));
  const suggestedCsi = selectedTemplates[0]?.csi ?? "";
  const selectedStepCount = selectedTemplates.reduce((sum, item) => sum + item.steps.length, 0);
  const preparedBy = profile.name.trim();
  const preparedByPdf = [
    preparedBy,
    settings.pdf_show.signer_title ? profile.title.trim() : "",
  ]
    .filter(Boolean)
    .join(", ");
  const jobMeta = `${project.job_name.trim() || "—"} · Job ${project.job_number.trim() || "—"} · GC ${
    project.contractor.trim() || "—"
  }`;
  const readiness = draft ? ahaReadiness(draft, emergency) : null;
  const filename = draft ? ahaPdfFilename(project.job_number, draft.name, draft.options.standard) : "";
  const projectAddress = formatAddress({
    street: project.job_address,
    city: project.jobInfo.job_city,
    state: project.jobInfo.job_county,
    zip: project.jobInfo.job_zip,
    fallbackLine: project.job_address2,
  });

  async function onDownload() {
    if (!draft || printingRef.current) return;
    const check = ahaReadiness(draft, emergency, "Download");
    if (check.confirmMessage && !window.confirm(check.confirmMessage)) return;
    printingRef.current = true;
    setPrinting(true);
    setError(null);
    try {
      await downloadAhaPdf({
        aha: draft,
        jobNumber: project.job_number,
        jobName: project.job_name,
        address: projectAddress,
        gc: project.contractor,
        preparedBy: preparedByPdf,
        filename,
        letterhead: {
          companyName: settings.pdf_show.company_name ? settings.company_name.trim() : "",
          companyAddress: settings.pdf_show.company_address ? settings.company_address.trim() : "",
        },
        emergency,
        siteAddress: emergency.site_address_override.trim() || projectAddress,
        standardPpe,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the AHA PDF.");
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }

  return (
    <div className="stack aha-page">
      <div>
        <h2>Activity Hazard Analyses</h2>
        <p className="muted small aha-page-meta">{jobMeta}</p>
      </div>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="aha-layout">
        <aside className="card stack aha-list-col" aria-label="AHAs on this job">
          <div className="row-between aha-list-head">
            <h3>
              This job · {ahas.length} {ahas.length === 1 ? "AHA" : "AHAs"}
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setLibraryOpen((open) => !open)}
            >
              {libraryOpen ? "Close library" : "+ From library"}
            </button>
          </div>

          {loading ? (
            <p className="muted">Loading AHAs…</p>
          ) : ahas.length === 0 ? (
            <p className="muted">No AHAs yet. Add one from the library.</p>
          ) : (
            <div className="aha-list" role="list">
              {ahas.map((aha) => {
                const row = draft && draft.id === aha.id ? draft : aha;
                const selected = row.id === selectedId;
                const steps = row.steps.length;
                return (
                  <button
                    key={aha.id}
                    type="button"
                    role="listitem"
                    className={`aha-list-row${selected ? " aha-list-row--selected" : ""}`}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => selectAha(aha.id)}
                  >
                    <span className="aha-list-row-copy">
                      <span className="aha-list-row-name">{row.name.trim() || "Untitled AHA"}</span>
                      <span className="muted small">
                        {ahaScopeLabel(row.scope)} · {row.csi || "—"} · {steps} {steps === 1 ? "step" : "steps"} ·{" "}
                        {ahaStatusLabel(row.status)}
                      </span>
                    </span>
                    <RacBadge level={overallRac(row.steps)} size={30} />
                  </button>
                );
              })}
            </div>
          )}

          {libraryOpen && (
            <div className="stack aha-library">
              <div className="filter-chips" role="group" aria-label="Recommended AHA bundles">
                {RECOMMENDED_BUNDLES.map((bundle) => (
                  <button
                    key={bundle.name}
                    type="button"
                    className="filter-chip"
                    onClick={() => {
                      const ids = bundle.slugs.flatMap((slug) => {
                        const match = activeLibrary.find((item) => item.slug === slug);
                        return match ? [match.id] : [];
                      });
                      setCheckedLibraryIds(ids);
                      setCreateName(bundle.name);
                      setNameTouched(true);
                    }}
                  >
                    {bundle.name}
                  </button>
                ))}
              </div>
              <div className="filter-chips" role="group" aria-label="Filter library by scope">
                {SCOPE_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={`filter-chip${scopeFilter === filter.id ? " filter-chip--active" : ""}`}
                    aria-pressed={scopeFilter === filter.id}
                    onClick={() => setScopeFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              {visibleLibrary.length === 0 ? (
                <p className="muted">No templates in this scope.</p>
              ) : (
                <div className="stack aha-library-list">
                  {visibleLibrary.map((item) => {
                    const steps = item.steps.length;
                    const checked = checkedLibraryIds.includes(item.id);
                    return (
                      <label key={item.id} className={`aha-library-row${checked ? " aha-library-row--checked" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLibraryTemplate(item.id)}
                        />
                        <span>
                          <span className="aha-library-name">{item.name}</span>
                          <span className="aha-library-sub muted">
                            {ahaScopeLabel(item.scope)} · {item.csi || "—"} · {steps} {steps === 1 ? "step" : "steps"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="stack aha-library-footer">
                <label className="stack aha-library-field">
                  <span className="muted small">AHA name</span>
                  <input
                    value={nameTouched ? createName : suggestedName}
                    placeholder="e.g. Painting"
                    aria-label="AHA name"
                    onChange={(event) => {
                      setNameTouched(true);
                      setCreateName(event.target.value);
                    }}
                  />
                </label>
                <label className="stack aha-library-field">
                  <span className="muted small">CSI</span>
                  <input
                    value={csiTouched ? createCsi : suggestedCsi}
                    aria-label="CSI"
                    onChange={(event) => {
                      setCsiTouched(true);
                      setCreateCsi(event.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={selectedTemplates.length === 0 || creating}
                  onClick={() => void createFromLibrary()}
                >
                  {creating
                    ? "Creating…"
                    : selectedTemplates.length === 0
                      ? "Create AHA"
                      : `Create AHA (${selectedTemplates.length} ${
                          selectedTemplates.length === 1 ? "template" : "templates"
                        } · ${selectedStepCount} ${selectedStepCount === 1 ? "step" : "steps"})`}
                </button>
              </div>
              <p className="muted small">Library AHAs are Ironwood templates. Edits on a job stay on that job.</p>
            </div>
          )}
        </aside>

        <div className="aha-main stack">
          {!draft ? (
            <section className="card">
              <p className="muted">No AHAs yet. Add one from the library.</p>
            </section>
          ) : (
            <>
              <section className="card aha-sheet-head">
                <div className="aha-sheet-title">
                  <p className="aha-mono">
                    {draft.csi || "—"} · {ahaScopeLabel(draft.scope)}
                  </p>
                  {editingName ? (
                    <input
                      className="aha-name-input"
                      autoFocus
                      value={draft.name}
                      aria-label="AHA name"
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      onBlur={() => setEditingName(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          setDraft({ ...draft, name: nameBeforeEdit });
                          setEditingName(false);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="aha-sheet-name"
                      onClick={() => {
                        setNameBeforeEdit(draft.name);
                        setEditingName(true);
                      }}
                    >
                      {draft.name.trim() || "Untitled AHA"}
                    </button>
                  )}
                </div>
                <div className="aha-sheet-rac">
                  <div>
                    <p className="aha-kicker">Overall RAC</p>
                    <p className="muted small">highest step code</p>
                  </div>
                  <RacBadge level={overallRac(draft.steps)} size={48} />
                </div>
              </section>

              <AhaConsiderationsCard
                selected={draft.considerations}
                standardPpe={standardPpe}
                extraPpe={draft.extra_ppe}
                disabled={saving}
                onChange={(considerations) => setDraft({ ...draft, considerations })}
                onExtraPpe={(extra_ppe) => setDraft({ ...draft, extra_ppe })}
              />

              <section className="card aha-steps-card">
                <div className="aha-colhead" aria-hidden="true">
                  <span />
                  <span>#</span>
                  <span>Step · Hazards</span>
                  <span>Controls</span>
                  <span className="aha-colhead-risk">Risk assessment</span>
                </div>
                <div className="aha-steps-scroll">
                  {draft.steps.map((step, index) => (
                    <AhaStepRow
                      key={step.id}
                      step={step}
                      index={index}
                      open={expandedStepId === step.id}
                      showEm385={draft.options.standard === "em385"}
                      dragging={dragFrom === index}
                      dragOver={dragOver === index}
                      onToggle={() => toggleStep(step.id)}
                      onPatch={(patch) => patchStep(step.id, patch)}
                      onRemove={() => removeStep(step.id)}
                      onDragStart={() => setDragFrom(index)}
                      onDragOver={(event: DragEvent) => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "move";
                        setDragOver(index);
                      }}
                      onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
                      onDrop={() => {
                        if (dragFrom !== null && dragFrom !== index) reorderSteps(dragFrom, index);
                        clearDrag();
                      }}
                      onDragEnd={clearDrag}
                    />
                  ))}
                </div>
                <div className="aha-step-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}>
                    + Add step from library
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addCustomStep}>
                    + Custom step
                  </button>
                </div>
              </section>

              <AhaEquipmentTable
                rows={draft.equipment_rows}
                disabled={saving}
                onChange={(equipment_rows) => setDraft({ ...draft, equipment_rows })}
              />

              <AhaCompetentPersonsTable
                rows={draft.competent_persons}
                disabled={saving}
                onChange={(competent_persons) => setDraft({ ...draft, competent_persons })}
              />

              <section className="card stack">
                <label className="aha-field">
                  Notes (field notes, review comments)
                  <textarea
                    className="aha-notes"
                    rows={4}
                    value={draft.notes}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  />
                </label>
              </section>

              <AhaProductsCard
                rows={draft.products}
                disabled={saving}
                pulling={pullingProducts}
                onChange={(products) => setDraft({ ...draft, products })}
                onPull={() => {
                  void (async () => {
                    setPullingProducts(true);
                    setError(null);
                    try {
                      const { data, error: loadError } = await supabase
                        .from("projects")
                        .select("data")
                        .eq("id", projectId)
                        .single();
                      if (loadError) throw new Error(loadError.message);
                      const incoming = productsFromJob(parseProjectTradeData(data?.data));
                      setDraft((current) =>
                        current ? { ...current, products: mergePulledProducts(current.products, incoming) } : current,
                      );
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not pull products.");
                    } finally {
                      setPullingProducts(false);
                    }
                  })();
                }}
              />
            </>
          )}
        </div>

        <aside className="stack aha-rail" aria-label="AHA actions">
          <AhaEmergencyCard
            info={emergency}
            projectAddress={projectAddress}
            disabled={saving}
            onChange={setEmergency}
            onCommit={(info) => {
              setEmergency(info);
              void (async () => {
                try {
                  await saveProjectEmergency(projectId, info);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save emergency info.");
                }
              })();
            }}
          />
          <section className="card stack rfi-editor-rail-card">
            <h3>Status</h3>
            {draft ? (
              <SegmentedControl
                aria-label="AHA status"
                options={STATUS_OPTIONS}
                value={draft.status}
                onChange={(status) => void onStatus(status)}
              />
            ) : (
              <p className="muted small">Add an AHA to set its status.</p>
            )}
            {statusSaving && <p className="muted small">Saving status…</p>}
          </section>

          <section className="card stack rfi-editor-rail-card">
            <h3>Sign-off</h3>
            {draft?.options.standard === "calosha" ? (
              <>
                <label className="aha-field">
                  Project manager
                  <input
                    value={draft.project_manager}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, project_manager: event.target.value })}
                  />
                </label>
                <label className="aha-field">
                  Superintendent
                  <input
                    value={draft.superintendent}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, superintendent: event.target.value })}
                  />
                </label>
                <label className="aha-field">
                  Foreman
                  <input
                    value={draft.foreman}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, foreman: event.target.value })}
                  />
                </label>
                <label className="aha-field">
                  JHA reviewed by
                  <input
                    value={draft.reviewed_by}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, reviewed_by: event.target.value })}
                  />
                </label>
              </>
            ) : (
              <label className="aha-field">
                Competent person / foreman
                <input
                  value={draft?.competent_person ?? ""}
                  disabled={!draft || saving}
                  onChange={(event) => draft && setDraft({ ...draft, competent_person: event.target.value })}
                />
              </label>
            )}
            <div className="aha-readonly-list">
              <div className="aha-readonly-row">
                <span>Prepared by</span>
                <span>{preparedBy}</span>
              </div>
              {draft?.options.standard !== "calosha" && (
                <>
                  <div className="aha-readonly-row">
                    <span>SSHO review</span>
                    <span className="muted">Pending</span>
                  </div>
                  <div className="aha-readonly-row">
                    <span>QA reviewed by</span>
                    <span className="muted">Pending</span>
                  </div>
                </>
              )}
            </div>
          </section>

          {draft && (
            <AhaReviewLog
              key={draft.id}
              entries={draft.review_log}
              profileName={preparedBy}
              disabled={saving}
              onChange={(review_log) => setDraft({ ...draft, review_log })}
            />
          )}

          <section className="card stack rfi-editor-rail-card">
            <h3>PDF options</h3>
            {draft && (
              <SegmentedControl
                aria-label="Safety standard"
                options={STANDARD_OPTIONS}
                value={draft.options.standard}
                onChange={(standard) => setDraft({ ...draft, options: { ...draft.options, standard } })}
              />
            )}
            <div className="stack aha-pdf-switches">
              <FlagSwitch
                label="Include RAC matrix & key"
                tone="accent"
                checked={draft?.options.matrix ?? true}
                disabled={!draft || saving}
                onChange={(matrix) =>
                  draft && setDraft({ ...draft, options: { ...draft.options, matrix } })
                }
              />
              <FlagSwitch
                label="Show regulation references"
                tone="accent"
                checked={draft?.options.show_refs ?? false}
                disabled={!draft || saving}
                onChange={(show_refs) =>
                  draft && setDraft({ ...draft, options: { ...draft.options, show_refs } })
                }
              />
              {draft?.options.standard === "calosha" && (
                <FlagSwitch
                  label="Include JHA modified and reviewed"
                  tone="accent"
                  checked={draft.options.reviewLog}
                  disabled={saving}
                  onChange={(reviewLog) =>
                    setDraft({ ...draft, options: { ...draft.options, reviewLog } })
                  }
                />
              )}
            </div>
            {draft && (
              <p className="aha-will-save">
                <span className="muted small">Will save as</span>
                <span className="aha-mono">{filename}</span>
              </p>
            )}
            {readiness && (
              <ul className="rfi-readiness-list" aria-label="PDF readiness">
                {readiness.items.map((item) => (
                  <li
                    key={item.id}
                    className={`aha-readiness-item${item.ok ? " aha-readiness-item--ok" : ""}`}
                  >
                    <span className="aha-readiness-dot" aria-hidden="true" />
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="stack rfi-editor-rail-actions aha-rail-actions">
              {isDirty && <p className="aha-dirty-note">Unsaved changes</p>}
              <button
                type="button"
                className={`btn btn-primary${isDirty ? " aha-save--dirty" : ""}`}
                disabled={!draft || saving || deleting}
                onClick={() => void persist(false)}
              >
                {saving ? "Saving…" : "Save"}
                {isDirty && <span className="aha-dirty-dot" aria-hidden="true" />}
                {isDirty && <span className="sr-only">Unsaved changes</span>}
              </button>
              <span className="paint-toolbar-download-wrap pdf-filename-hover">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!draft || printing || saving || deleting}
                  onClick={() => void onDownload()}
                >
                  {printing ? "Generating…" : "Download PDF"}
                </button>
                {filename ? (
                  <span className="paint-toolbar-download-tip" role="tooltip">
                    {filename}
                  </span>
                ) : null}
              </span>
            </div>
          </section>

          <section className="card stack rfi-editor-rail-card">
            <h3>RAC key</h3>
            <ul className="aha-rac-key">
              {RAC_KEY.map((item) => (
                <li key={item.level}>
                  <RacBadge level={item.level} size={30} />
                  <span>
                    {item.level} {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {draft && (
            <button
              type="button"
              className="ewo-header-delete"
              disabled={deleting || saving}
              onClick={() => void onDelete()}
            >
              {deleting ? "Deleting…" : "Delete AHA"}
            </button>
          )}
        </aside>
      </div>

      {pickerOpen && (
        <AhaStepLibraryModal
          library={activeLibrary}
          onClose={() => setPickerOpen(false)}
          onPick={addLibraryStep}
          onAddTemplate={addLibraryTemplate}
        />
      )}
    </div>
  );
}
