import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { FrpAddTrimModal } from "../components/frp/FrpAddTrimModal";
import { FrpItemRow } from "../components/frp/FrpItemRow";
import { FrpSubmittalMetaPanel } from "../components/frp/FrpSubmittalMetaPanel";
import { SubmittalHistoryModal } from "../components/paint/SubmittalHistoryModal";
import { useLetterhead } from "../contexts/LetterheadContext";
import type { FrpCatalog } from "../lib/frpCatalog";
import { loadFrpCatalog } from "../lib/frpCatalog";
import {
  applyFrpAutoLabels,
  frpItemsReadiness,
  frpRowAutoLabel,
} from "../lib/frpItemLabels";
import { downloadFrpSubmittal } from "../lib/frpSubmittalPrint";
import {
  applyTransmittalContractIfDistinct,
  frpJobLabel,
  frpJobName,
  frpJobNumber,
  frpPrintInfo,
  hasDistinctFrpContract,
} from "../lib/jobInfo";
import { frpSubmittalFilename } from "../lib/pdfFilenames";
import {
  addSubmittalToHistory,
  createNewSubmittalPackageDraft,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { issueSubmittalDraft, startNextRevision, submittalDraftIsLocked } from "../lib/submittalPackageActions";
import { applySubmittalEdit } from "../lib/submittalDraftGuard";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { parseSpecSectionForLog } from "../lib/submittalLogHelpers";
import { loadTransmittalContentAutoOn } from "../lib/transmittalCategories";
import { queuePendingItem } from "../lib/transmittalHelpers";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import type { ProjectForm } from "../types/database";
import {
  defaultFrpSubmittal,
  defaultTransmittal,
  emptyFrpItem,
  FRP_PACKAGE_TYPE_OPTIONS,
  frpSubjectForPackage,
  normalizeFrpSubmittal,
  type FrpItem,
  type FrpSubmittalData,
  type SubmittalHistoryEntry,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function frpItemHasContent(item: FrpItem): boolean {
  return Boolean(
    item.manufacturer.trim() || item.product.trim() || item.label.trim() || item.color.trim(),
  );
}

export function FrpSubmittalsPage() {
  const { branding } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<FrpSubmittalData>(defaultFrpSubmittal());
  const [history, setHistory] = useState<SubmittalHistoryEntry[]>([]);
  const [catalog, setCatalog] = useState<FrpCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [trimOpen, setTrimOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const dirtyState = useMemo(() => ({ draft, history }), [draft, history]);
  const { isDirty, syncBaseline, readBaseline } = useTradeDraftDirty(dirtyState, !loading);

  const persist = useCallback(
    async (nextDraft: FrpSubmittalData, nextHistory = history) => {
      const ok = await save({
        ...tradeData,
        frp_submittal: nextDraft,
        frp_submittal_history: nextHistory,
      });
      if (ok) {
        setDraft(nextDraft);
        setHistory(nextHistory);
        syncBaseline({ draft: nextDraft, history: nextHistory });
        setError(null);
      }
      return ok;
    },
    [history, tradeData, save, setError, syncBaseline],
  );

  const onDiscardUnsaved = useCallback(() => {
    const baseline = readBaseline();
    if (!baseline) return;
    setDraft(baseline.draft);
    setHistory(baseline.history);
  }, [readBaseline]);

  useUnsavedNavigationGuard({
    sectionLabel: "FRP submittals",
    isDirty,
    onSave: () => persist(draft, history),
    onDiscard: onDiscardUnsaved,
  });

  useEffect(() => {
    if (!loading) {
      const d = normalizeFrpSubmittal(tradeData.frp_submittal);
      const h = tradeData.frp_submittal_history ?? [];
      setDraft(d);
      setHistory(h);
      syncBaseline({ draft: d, history: h });
    }
  }, [loading, tradeData.frp_submittal, tradeData.frp_submittal_history, syncBaseline]);

  useEffect(() => {
    let cancelled = false;
    void loadFrpCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load FRP catalog");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setError]);

  const draftLocked = submittalDraftIsLocked(draft);
  const autoLabel = draft.auto_label !== false;
  const frpPrint = useMemo(() => frpPrintInfo(project, project.jobInfo), [project]);
  const frpNum = frpJobNumber(project);
  const frpName = frpJobName(project);
  const itemsReadiness = useMemo(() => frpItemsReadiness(draft.items), [draft.items]);

  function updateDraft(updater: (d: FrpSubmittalData) => FrpSubmittalData) {
    setDraft((current) => {
      const next = applySubmittalEdit(current, history, updater);
      if (!next) return current;
      if (next.revision_number !== current.revision_number) {
        setStatus(`Now editing Rev ${next.revision_number} (draft).`);
      }
      return next;
    });
  }

  function withMaybeAutoLabels(items: FrpItem[], enabled: boolean): FrpItem[] {
    return enabled ? applyFrpAutoLabels(items) : items;
  }

  function patchItem(index: number, patch: Partial<FrpItem>) {
    updateDraft((d) => {
      const enabled = d.auto_label !== false;
      const items = d.items.map((item, i) => (i === index ? { ...item, ...patch } : item));
      return { ...d, items: withMaybeAutoLabels(items, enabled) };
    });
  }

  function reorderItems(from: number, to: number) {
    updateDraft((d) => ({
      ...d,
      items: withMaybeAutoLabels(moveItem(d.items, from, to), d.auto_label !== false),
    }));
  }

  function confirmGapsIfNeeded(): boolean {
    const readiness = frpItemsReadiness(draft.items);
    if (readiness.complete || readiness.gaps === 0) return true;
    return window.confirm(readiness.confirmMessage);
  }

  function loadHistoryItems(items: FrpItem[], replace: boolean) {
    const mapped = items.length
      ? items.map((i) => ({
          ...emptyFrpItem(),
          ...i,
          order: i.order ?? false,
          include_in_submittal: i.include_in_submittal !== false,
        }))
      : [emptyFrpItem()];
    updateDraft((d) => {
      const enabled = d.auto_label !== false;
      const next = replace ? mapped : [...d.items.filter(frpItemHasContent), ...mapped];
      return { ...d, items: withMaybeAutoLabels(next, enabled) };
    });
    setHistoryOpen(false);
    setStatus(`Loaded ${items.length} item(s) from history. Save to keep changes.`);
  }

  async function onSave() {
    await persist(draft, history);
    setStatus("FRP submittal saved.");
  }

  async function onSubmittalPdf() {
    if (!confirmGapsIfNeeded()) return;
    const items = draft.items.filter(frpItemHasContent);
    if (!items.length) {
      setError("Add FRP items before generating a submittal.");
      return;
    }
    if (!frpNum || !frpName) {
      setError("Job number and job name are required.");
      return;
    }
    try {
      await downloadFrpSubmittal(frpPrint, draft, branding);
      let nextHistory = history;
      if (draftLocked) {
        nextHistory = addSubmittalToHistory(
          history,
          draft.submittal_number,
          draft.revision_number,
          draft.items,
          undefined,
          "frp",
          {
            revisionNote: draft.revision_note,
            issueStatus: draft.issue_status,
            locked: true,
            packageType: draft.package_type,
            date: draft.date,
            specSection: draft.spec_section,
          },
        );
      }
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const parsed = parseSpecSectionForLog(draft.spec_section);
        const row = await recordPdfLogRow(projectId, {
          submittal_type: draft.package_type,
          scope: "FRP",
          spec: parsed.spec || "066000",
          section: parsed.section || draft.spec_section,
          notes: `FRP submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* optional */
      }
      const autoOn = await loadTransmittalContentAutoOn();
      let transmittal = queuePendingItem(
        tradeData.transmittal ?? defaultTransmittal(),
        {
          submittal_type: draft.package_type,
          scope: "FRP",
          source: "frp_submittal",
          trade_submittal_number: String(draft.submittal_number),
          log_row_id: logRowId,
          spec_section: draft.spec_section,
          section: draft.spec_section,
        },
        autoOn,
      );
      transmittal = applyTransmittalContractIfDistinct(project, transmittal, "frp");
      await save({
        ...tradeData,
        frp_submittal: draft,
        frp_submittal_history: nextHistory,
        transmittal,
      });
      setStatus(
        draftLocked
          ? `Submittal #${String(draft.submittal_number).padStart(3, "0")} Rev ${draft.revision_number} PDF downloaded.`
          : `Submittal PDF downloaded. Issue this package to lock Rev ${draft.revision_number} in history.`,
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed");
    }
  }

  async function onIssueSubmittal() {
    if (!confirmGapsIfNeeded()) return;
    const { draft: issued, history: nextHistory } = issueSubmittalDraft(draft, history, "frp");
    const ok = await persist(issued, nextHistory);
    if (ok) {
      setStatus(
        `Submittal #${String(issued.submittal_number).padStart(3, "0")} Rev ${issued.revision_number} issued and locked.`,
      );
    }
  }

  function onCreateRevision() {
    const next = startNextRevision(draft, history);
    if (next === draft) return;
    setDraft(next);
    setStatus(`Editing Rev ${next.revision_number} (draft). Add a revision note before issuing.`);
  }

  function onNewSubmittalPackage() {
    if (
      !window.confirm(
        "Start a new submittal package? This assigns the next submittal number and resets revision to 0.",
      )
    ) {
      return;
    }
    setDraft({
      ...createNewSubmittalPackageDraft(draft, history),
      subject: frpSubjectForPackage(draft.package_type),
      items: applyFrpAutoLabels([emptyFrpItem()]),
      auto_label: true,
    });
    setStatus("New submittal package started (Rev 0, draft).");
  }

  async function onDeleteHistory(submittalNumber: number, revisionNumber: number) {
    const nextHistory = removeSubmittalFromHistory(history, submittalNumber, revisionNumber);
    setHistory(nextHistory);
    await persist(draft, nextHistory);
    setStatus(`Removed submittal #${submittalNumber} Rev ${revisionNumber} from history.`);
  }

  function addTrimItems(items: FrpItem[]) {
    updateDraft((d) => {
      const enabled = d.auto_label !== false;
      const existing = d.items.filter(frpItemHasContent);
      const labeled = items.map((item, i) =>
        enabled ? { ...item, label: frpRowAutoLabel(existing.length + i) } : item,
      );
      const merged = [...existing, ...labeled];
      return {
        ...d,
        items: withMaybeAutoLabels(merged.length ? merged : [emptyFrpItem()], enabled),
      };
    });
    setStatus(`Added ${items.length} trim item(s). Save to keep changes.`);
  }

  const submittalPdfFilename = useMemo(
    () =>
      frpSubmittalFilename(frpPrint.job_name, frpPrint.job_number, draft.submittal_number, draft.spec_section),
    [frpPrint.job_name, frpPrint.job_number, draft.submittal_number, draft.spec_section],
  );

  if (loading || catalogLoading) return <p className="muted">Loading FRP submittal…</p>;
  if (!catalog) return <p className="muted">FRP catalog unavailable.</p>;

  return (
    <div className="stack frp-submittal-page">
      <div className="stack frp-submittal-page-header">
        <div>
          <h2>FRP</h2>
          {hasDistinctFrpContract(project) && (
            <p className="muted small">Contract: {frpJobLabel(project)}.</p>
          )}
        </div>
        <div className="row-gap wrap frp-submittal-header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <button
            type="button"
            className="btn btn-outline-accent"
            title="Assign the next submittal number (Rev 0, draft). Does not lock or issue."
            onClick={onNewSubmittalPackage}
          >
            New submittal package
          </button>
          {!draftLocked && (
            <button
              type="button"
              className="btn btn-success"
              disabled={saving}
              title="Lock this revision in history as issued"
              onClick={() => void onIssueSubmittal()}
            >
              Issue submittal
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onSubmittalPdf()}>
            Download PDF
          </button>
        </div>
      </div>

      <p className="sds-filename-preview muted small">
        PDF filename: <code>{submittalPdfFilename}</code>
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      {draftLocked && (
        <div className="banner banner-warn">
          This revision is <strong>{draft.issue_status.replace(/_/g, " ")}</strong>. Create a new revision to
          change items, or update issue status below.
        </div>
      )}

      <FrpSubmittalMetaPanel
        draft={draft}
        draftLocked={draftLocked}
        packageTypeOptions={FRP_PACKAGE_TYPE_OPTIONS}
        onSubmittalNumberChange={(submittal_number) => setDraft({ ...draft, submittal_number })}
        onIssueStatusChange={(issue_status) => setDraft({ ...draft, issue_status })}
        onDateChange={(date) => setDraft({ ...draft, date })}
        onPackageTypeChange={(package_type) =>
          updateDraft((d) => ({
            ...d,
            package_type,
            subject: frpSubjectForPackage(package_type),
          }))
        }
        onSubjectChange={(subject) => setDraft({ ...draft, subject })}
        onSpecSectionChange={(spec_section) => setDraft({ ...draft, spec_section })}
        onRevisionNoteChange={(revision_note) => setDraft({ ...draft, revision_note })}
        onCreateNextRevision={draftLocked ? onCreateRevision : undefined}
      />

      <section className="card stack frp-items-section">
        <div className="row-between frp-items-toolbar">
          <div>
            <h3>FRP items ({draft.items.length})</h3>
          </div>
          <div className="frp-items-toolbar-actions">
            <label className="check frp-auto-label">
              <input
                type="checkbox"
                checked={autoLabel}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  updateDraft((d) => ({
                    ...d,
                    auto_label: enabled,
                    items: enabled ? applyFrpAutoLabels(d.items) : d.items,
                  }));
                }}
              />
              Auto-label by order
            </label>
            <div className="paint-add-buttons">
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() =>
                  updateDraft((d) => {
                    const enabled = d.auto_label !== false;
                    const row = emptyFrpItem();
                    if (enabled) row.label = frpRowAutoLabel(d.items.filter(frpItemHasContent).length);
                    const next = [...d.items.filter(frpItemHasContent), row];
                    return { ...d, items: withMaybeAutoLabels(next, enabled) };
                  })
                }
              >
                + Add row
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setTrimOpen(true)}
              >
                + Add trim
              </button>
            </div>
          </div>
        </div>

        <div className="frp-items-list" role="table" aria-label="FRP items">
          <div className="frp-items-header" role="row">
            <span className="frp-row-handle-spacer" aria-hidden />
            <span className="frp-col-head frp-col-label">Label</span>
            <span className="frp-col-head frp-col-mfr">Manufacturer</span>
            <span className="frp-col-head frp-col-product">Product</span>
            <span className="frp-col-head frp-col-color">Color</span>
            <span className="frp-col-head frp-col-head-actions" aria-hidden />
          </div>
          {draft.items.map((item, index) => (
            <FrpItemRow
              key={index}
              item={item}
              index={index}
              total={draft.items.length}
              catalog={catalog}
              autoLabel={autoLabel}
              dragging={dragFrom === index}
              dragOver={dragOver === index}
              onChange={(patch) => patchItem(index, patch)}
              onDragStart={() => setDragFrom(index)}
              onDragOver={(e: DragEvent) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(index);
              }}
              onDragLeave={() => setDragOver((cur) => (cur === index ? null : cur))}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== index) reorderItems(dragFrom, index);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onRemove={() =>
                updateDraft((d) => {
                  const next = d.items.filter((_, i) => i !== index);
                  return {
                    ...d,
                    items: withMaybeAutoLabels(
                      next.length ? next : [emptyFrpItem()],
                      d.auto_label !== false,
                    ),
                  };
                })
              }
            />
          ))}
        </div>

        <div className="row-between frp-items-footer">
          <p className="muted small frp-items-drag-hint">
            {autoLabel ? "Drag ⠿ to reorder · labels follow order" : "Drag ⠿ to reorder"}
          </p>
          <p
            className={`small frp-items-readiness${
              itemsReadiness.gaps > 0
                ? " frp-items-readiness--warn"
                : itemsReadiness.count > 0
                  ? " frp-items-readiness--ok"
                  : ""
            }`}
          >
            {itemsReadiness.summaryLine}
          </p>
        </div>
      </section>

      {trimOpen && (
        <FrpAddTrimModal catalog={catalog} onAdd={addTrimItems} onClose={() => setTrimOpen(false)} />
      )}

      {historyOpen && (
        <SubmittalHistoryModal
          scope="frp"
          jobNumber={frpNum}
          jobName={frpName}
          history={history}
          onLoadFrp={loadHistoryItems}
          onDelete={(n, r) => void onDeleteHistory(n, r)}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
