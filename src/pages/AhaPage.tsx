import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { AhaCompetentPersonsTable } from "../components/aha/AhaCompetentPersonsTable";
import { AhaConsiderationsCard } from "../components/aha/AhaConsiderationsCard";
import { AhaEmergencyCard } from "../components/aha/AhaEmergencyCard";
import { AhaEquipmentTable } from "../components/aha/AhaEquipmentTable";
import { AhaProductsCard } from "../components/aha/AhaProductsCard";
import { AhaLibraryModal, type AhaLibraryPick } from "../components/aha/AhaLibraryModal";
import { AhaReviewLog } from "../components/aha/AhaReviewLog";
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
import {
  emptyEmergency,
  emergencyComplete,
  loadProjectEmergency,
  saveProjectEmergency,
  type AhaEmergencyInfo,
} from "../lib/aha/emergency";
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
  RAC_KEY,
  blankAhaStep,
  cleanAhaStep,
  copyLibrarySteps,
} from "../lib/aha/display";
import { RAC_COLORS, ahaNumber, overallRac } from "../lib/aha/rac";
import type { AhaLibraryItem, AhaStandard, AhaStatus, ProjectAha } from "../lib/aha/types";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import type { ProjectForm } from "../types/database";
import "../components/aha/aha-editor.css";

type Ctx = { project: ProjectForm; projectId: string };

type AhaSection = "hazards" | "steps" | "equipment" | "people" | "products" | "notes" | "emergency";

const STATUS_OPTIONS: { value: AhaStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "accepted", label: "Accepted" },
];

const STANDARD_OPTIONS: { value: AhaStandard; label: string }[] = [
  { value: "calosha", label: "Cal/OSHA" },
  { value: "em385", label: "EM 385-1-1" },
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
  const [libraryModal, setLibraryModal] = useState<null | "create" | "add">(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [section, setSection] = useState<AhaSection>("steps");
  const [editingName, setEditingName] = useState(false);
  const [nameBeforeEdit, setNameBeforeEdit] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [emergency, setEmergency] = useState<AhaEmergencyInfo>(emptyEmergency);
  const [standardPpe, setStandardPpe] = useState<string[]>(DEFAULT_STANDARD_PPE);
  const [pullingProducts, setPullingProducts] = useState(false);
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
        setExpandedIds([]);
        setEditingName(false);
        return;
      }
      const copy = cloneAha(next);
      syncBaseline(copy);
      setDraft(copy);
      setSelectedId(copy.id);
      setExpandedIds([]);
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
    setExpandedIds([]);
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
        setExpandedIds([]);
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
    setExpandedIds([]);
    setEditingName(false);
  }, [readBaseline]);

  useUnsavedNavigationGuard({
    sectionLabel: "Activity Hazard Analysis",
    isDirty,
    onSave: () => persist(true),
    onDiscard: onDiscardUnsaved,
  });

  useEffect(() => {
    if (!switcherOpen) return;
    function onPointer(event: MouseEvent) {
      if (!switcherRef.current?.contains(event.target as Node)) setSwitcherOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSwitcherOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

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

  async function createFromLibrary(input: { libraryIds: string[]; name: string; csi: string }) {
    if (!input.libraryIds.length || creating) return;
    if (!confirmDiscard()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createProjectAhaFromLibrary(projectId, input);
      setAhas((rows) => [...rows, created]);
      setLibraryModal(null);
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
      commitSelection(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this AHA.");
    } finally {
      setDeleting(false);
    }
  }

  function toggleStep(id: string) {
    const closing = expandedIds.includes(id);
    if (closing) {
      setDraft((current) =>
        current
          ? { ...current, steps: current.steps.map((step) => (step.id === id ? cleanAhaStep(step) : step)) }
          : current,
      );
      setExpandedIds((current) => current.filter((item) => item !== id));
      return;
    }
    setExpandedIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function toggleExpandAll() {
    if (!draft) return;
    const allOpen = draft.steps.length > 0 && draft.steps.every((step) => expandedIds.includes(step.id));
    if (allOpen) {
      setDraft({ ...draft, steps: draft.steps.map((step) => cleanAhaStep(step)) });
      setExpandedIds([]);
      return;
    }
    setExpandedIds(draft.steps.map((step) => step.id));
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
    setExpandedIds((current) => current.filter((item) => item !== id));
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
      const steps = current.steps.map((item) => (expandedIds.includes(item.id) ? cleanAhaStep(item) : item));
      return { ...current, steps: [...steps, step] };
    });
    setExpandedIds([step.id]);
    requestAnimationFrame(() => {
      document.querySelector(`[data-step-id="${step.id}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function addFromLibrary(picks: AhaLibraryPick[]) {
    const incoming = picks.filter((pick) => pick.steps.length > 0);
    const steps = copyLibrarySteps(incoming.flatMap((pick) => pick.steps));
    if (!steps.length) return;
    const last = steps[steps.length - 1];
    setDraft((current) => {
      if (!current) return current;
      let equipment = current.equipment_rows;
      let people = current.competent_persons;
      const ids = [...current.library_ids];
      for (const pick of incoming) {
        equipment = mergeEquipmentRows(equipment, cloneEquipmentRows(pick.template.equipment_rows));
        people = mergeCompetentPersons(people, cloneCompetentPersons(pick.template.competent_persons));
        if (!ids.includes(pick.template.id)) ids.push(pick.template.id);
      }
      return {
        ...current,
        library_ids: ids,
        considerations: mergeConsiderations([
          current.considerations,
          ...incoming.map((pick) => pick.template.considerations),
        ]),
        equipment_rows: equipment,
        competent_persons: people,
        steps: [...current.steps, ...steps],
      };
    });
    setLibraryModal(null);
    if (!last) return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-step-id="${last.id}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  const activeLibrary = library.filter((item) => !item.archived);
  const preparedBy = profile.name.trim();
  const preparedByPdf = [
    preparedBy,
    settings.pdf_show.signer_title ? profile.title.trim() : "",
  ]
    .filter(Boolean)
    .join(", ");
  const readiness = draft ? ahaReadiness(draft, emergency) : null;
  const readyOk = readiness?.items.filter((item) => item.ok).length ?? 0;
  const readyTotal = readiness?.items.length ?? 0;
  const emergencyReady = emergencyComplete(emergency);
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
    <div className="aha-page">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="aha-header">
        <div className="aha-job-bar">
          {ahas.length > 0 && (
            <div className="aha-switcher" ref={switcherRef}>
              <button
                type="button"
                className="aha-switcher-btn"
                aria-haspopup="listbox"
                aria-expanded={switcherOpen}
                onClick={() => setSwitcherOpen((open) => !open)}
              >
                <span>
                  {draft
                    ? `${ahaNumber(project.job_number, draft.seq)} · ${draft.name.trim() || "Untitled AHA"}`
                    : "Select an AHA"}
                </span>
                {draft && <RacBadge level={overallRac(draft.steps)} size={30} />}
              </button>
              {switcherOpen && (
                <div className="aha-switcher-menu" role="listbox" aria-label="AHAs on this job">
                  {ahas.map((aha) => {
                    const row = draft && draft.id === aha.id ? draft : aha;
                    const selected = row.id === selectedId;
                    return (
                      <button
                        key={aha.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`aha-switcher-option${selected ? " aha-switcher-option--selected" : ""}`}
                        onClick={() => {
                          setSwitcherOpen(false);
                          selectAha(aha.id);
                        }}
                      >
                        <span className="aha-switcher-copy">
                          <span>
                            {ahaNumber(project.job_number, row.seq)} · {row.name.trim() || "Untitled AHA"}
                          </span>
                          <span className="aha-mono">{row.csi || "—"}</span>
                        </span>
                        <RacBadge level={overallRac(row.steps)} size={30} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={loading}
            onClick={() => {
              setError(null);
              setLibraryModal("create");
            }}
          >
            + From library
          </button>
        </div>
        {draft && (
          <>
              <section className="aha-sheet-head">
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
                <div className="aha-sheet-rac" title="Overall RAC, highest step code">
                  <RacBadge level={overallRac(draft.steps)} size={36} />
                  <span className="muted small">highest step</span>
                </div>
                <SegmentedControl
                  aria-label="AHA status"
                  options={STATUS_OPTIONS}
                  value={draft.status}
                  onChange={(status) => void onStatus(status)}
                />
                <div className="aha-title-actions">
                  <span className={`aha-ready-pill${readyOk === readyTotal && readyTotal > 0 ? " aha-ready-pill--done" : ""}`}>
                    {readyOk} of {readyTotal} ready
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={printing || saving || deleting}
                    onClick={() => void onDownload()}
                  >
                    {printing ? "Generating…" : "Download PDF"}
                  </button>
                  <button
                    type="button"
                    className={`btn btn-primary btn-sm${isDirty ? " aha-save--dirty" : ""}`}
                    disabled={saving || deleting}
                    onClick={() => void persist(false)}
                  >
                    {saving ? "Saving…" : "Save"}
                    {isDirty && <span className="aha-dirty-dot" aria-hidden="true" />}
                    {isDirty && <span className="sr-only">Unsaved changes</span>}
                  </button>
                  <details className="aha-more">
                    <summary className="btn btn-secondary btn-sm" aria-label="More actions">
                      ···
                    </summary>
                    <div className="aha-more-menu">
                      <button
                        type="button"
                        className="aha-more-delete"
                        disabled={deleting || saving}
                        onClick={() => void onDelete()}
                      >
                        {deleting ? "Deleting…" : "Delete AHA"}
                      </button>
                    </div>
                  </details>
                </div>
              </section>
              {statusSaving && <p className="muted small">Saving status…</p>}
              <div className="aha-tabs" role="tablist" aria-label="AHA sections">
                {(
                  [
                    ["hazards", "Hazards & PPE", String(draft.considerations.length) + " Yes"],
                    ["steps", "Steps", String(draft.steps.length)],
                    [
                      "equipment",
                      "Equipment",
                      String(
                        draft.equipment_rows.filter((row) => row.equipment.trim() || row.training.trim() || row.inspection.trim())
                          .length,
                      ),
                    ],
                    [
                      "people",
                      "Competent persons",
                      String(
                        draft.competent_persons.filter((row) => row.activity.trim() || row.note.trim() || row.employee.trim())
                          .length,
                      ),
                    ],
                    [
                      "products",
                      "Products / SDS",
                      String(draft.products.filter((row) => row.product.trim() || row.manufacturer.trim()).length),
                    ],
                    ["notes", "Notes", ""],
                    ["emergency", "Site & emergency", ""],
                  ] as const
                ).map(([id, label, badge]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={section === id}
                    className={`aha-tab${section === id ? " aha-tab--active" : ""}`}
                    onClick={() => setSection(id)}
                  >
                    {label}
                    {badge ? <span className="aha-tab-badge">{badge}</span> : null}
                    {id === "emergency" && !emergencyReady && <span className="aha-tab-warn" aria-hidden="true" />}
                    {id === "emergency" && <span className="aha-job-badge">Job</span>}
                  </button>
                ))}
              </div>
          </>
        )}
      </div>

      <div className="aha-layout">
        <div className="aha-main stack">
          {loading ? (
            <section className="card">
              <p className="muted">Loading AHAs…</p>
            </section>
          ) : !draft ? (
            <section className="card aha-empty">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setError(null);
                  setLibraryModal("create");
                }}
              >
                Create your first AHA
              </button>
            </section>
          ) : (
            <>
              {section === "hazards" && (
              <AhaConsiderationsCard
                selected={draft.considerations}
                standardPpe={standardPpe}
                extraPpe={draft.extra_ppe}
                disabled={saving}
                onChange={(considerations) => setDraft({ ...draft, considerations })}
                onExtraPpe={(extra_ppe) => setDraft({ ...draft, extra_ppe })}
              />
              )}

              {section === "steps" && (
              <section className="card aha-steps-card">
                <div className="aha-steps-toolbar">
                  <div>
                    <h3>Steps</h3>
                    <p className="muted small">
                      {draft.steps.length} {draft.steps.length === 1 ? "step" : "steps"} · click a row to edit
                    </p>
                  </div>
                  <div className="aha-rac-legend">
                    {RAC_KEY.map((item) => (
                      <span key={item.level} className="aha-legend-item">
                        <span
                          className="aha-legend-pip"
                          style={{ background: RAC_COLORS[item.level].background, color: RAC_COLORS[item.level].color }}
                        >
                          {item.level}
                        </span>
                        {item.level === "E" ? "Extreme" : item.label}
                      </span>
                    ))}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={toggleExpandAll}>
                      {draft.steps.length > 0 && draft.steps.every((step) => expandedIds.includes(step.id))
                        ? "Collapse all"
                        : "Expand all"}
                    </button>
                  </div>
                </div>
                <div className="aha-steps-scroll">
                  {draft.steps.map((step, index) => (
                    <AhaStepRow
                      key={step.id}
                      step={step}
                      index={index}
                      open={expandedIds.includes(step.id)}
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
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setError(null);
                      setLibraryModal("add");
                    }}
                  >
                    + Add step from library
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addCustomStep}>
                    + Custom step
                  </button>
                </div>
              </section>
              )}

              {section === "equipment" && (
              <AhaEquipmentTable
                rows={draft.equipment_rows}
                disabled={saving}
                onChange={(equipment_rows) => setDraft({ ...draft, equipment_rows })}
              />
              )}

              {section === "people" && (
              <AhaCompetentPersonsTable
                rows={draft.competent_persons}
                disabled={saving}
                onChange={(competent_persons) => setDraft({ ...draft, competent_persons })}
              />
              )}

              {section === "notes" && (
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
              )}

              {section === "products" && (
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
              )}

              {section === "emergency" && (
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
              )}
            </>
          )}
        </div>

        <aside className="stack aha-rail" aria-label="AHA actions">
          <section className="card stack rfi-editor-rail-card">
            <div className="row-between">
              <h3>Ready to submit</h3>
              <span className="muted small">
                {readyOk} / {readyTotal}
              </span>
            </div>
            {readiness ? (
              <ul className="rfi-readiness-list" aria-label="PDF readiness">
                {readiness.items.map((item) => (
                  <li key={item.id} className={`aha-readiness-item${item.ok ? " aha-readiness-item--ok" : ""}`}>
                    <span className="aha-readiness-dot" aria-hidden="true" />
                    <span>{item.label}</span>
                    {!item.ok && (
                      <button
                        type="button"
                        className="aha-fix"
                        onClick={() => {
                          if (item.id === "steps" || item.id === "em385") setSection("steps");
                          else if (item.id === "competent-names") setSection("people");
                          else if (item.id === "emergency") setSection("emergency");
                          else document.getElementById("aha-signoff")?.setAttribute("open", "");
                          if (item.id === "foreman" || item.id === "competent") {
                            document.getElementById("aha-foreman")?.focus();
                          }
                        }}
                      >
                        Fix
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Add an AHA to check readiness.</p>
            )}
          </section>

          <details id="aha-signoff" className="card stack rfi-editor-rail-card aha-disclosure" open>
            <summary>
              <span>Sign-off &amp; review</span>
            </summary>
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
                    id="aha-foreman"
                    className={draft.foreman.trim() ? undefined : "aha-input--needed"}
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
                  id="aha-foreman"
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
              {draft && (
                <AhaReviewLog
                  key={draft.id}
                  entries={draft.review_log}
                  profileName={preparedBy}
                  disabled={saving}
                  onChange={(review_log) => setDraft({ ...draft, review_log })}
                />
              )}
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
          </details>

          <details className="card stack rfi-editor-rail-card aha-disclosure">
            <summary>
              <span>PDF options</span>
              <span className="muted small">{draft?.options.standard === "em385" ? "EM 385-1-1" : "Cal/OSHA"}</span>
            </summary>
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
          </details>
        </aside>
      </div>

      {libraryModal && (
        <AhaLibraryModal
          mode={libraryModal}
          library={activeLibrary}
          ahaName={draft?.name ?? ""}
          busy={creating}
          error={error}
          onClose={() => {
            if (!creating) setLibraryModal(null);
          }}
          onCreate={(input) => void createFromLibrary(input)}
          onAdd={addFromLibrary}
        />
      )}
    </div>
  );
}
