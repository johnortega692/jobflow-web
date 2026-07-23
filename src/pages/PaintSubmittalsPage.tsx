import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { StartRevisionFromHistoryModal } from "../components/submittals/StartRevisionFromHistoryModal";
import { applySubmittalEdit } from "../lib/submittalDraftGuard";
import { EmailVendorModal } from "../components/paint/EmailVendorModal";
import { ImportBrushoutPrepModal } from "../components/paint/ImportBrushoutPrepModal";
import { PaintBulkAddModal } from "../components/paint/PaintBulkAddModal";
import { PaintSubmittalMetaPanel } from "../components/paint/PaintSubmittalMetaPanel";
import { PaintItemRow } from "../components/paint/PaintItemRow";
import { SubmittalHistoryModal } from "../components/paint/SubmittalHistoryModal";
import { PaintImageImport } from "../components/PaintImageImport";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import {
  loadPaintColors,
  loadPaintProducts,
  loadPaintSheens,
  type PaintColorsDb,
  type PaintProduct,
} from "../lib/paintCatalog";
import {
  applyPaintAutoLabels,
  paintItemsReadiness,
  paintRowAutoLabel,
} from "../lib/paintItemLabels";
import type { ExtractedPaintRow } from "../lib/paintImageImport";
import { applyTransmittalContractIfDistinct, gcSuperEmail, gcSuperintendentContact, projectPrintInfo } from "../lib/jobInfo";
import { downloadPaintSubmittal } from "../lib/paintSubmittalPrint";
import { paintSubmittalFilename } from "../lib/pdfFilenames";
import { patchPaintTrackerSubmittalOrdered, reloadProject, resolvePaintTracker, withSyncedPaintVendor } from "../lib/fieldTrackerProject";
import {
  addSubmittalToHistory,
  createNewSubmittalPackageDraft,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { issueSubmittalDraft, startNextRevision, submittalDraftIsLocked } from "../lib/submittalPackageActions";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { parseSpecSectionForLog } from "../lib/submittalLogHelpers";
import { loadTransmittalContentAutoOn } from "../lib/transmittalCategories";
import { queuePendingItem } from "../lib/transmittalHelpers";
import { listOpenBrushoutPreps, loadPaintUserSettings } from "../lib/paintUserSettings";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import type { ProjectForm } from "../types/database";
import {
  defaultPaintSubmittal,
  defaultTransmittal,
  emptyPaintItem,
  normalizePaintSubmittal,
  paintDualSpecEnabled,
  paintItemSpecScope,
  paintSpecSectionShortLabel,
  PAINT_PACKAGE_TYPE_OPTIONS,
  paintSubjectForPackage,
  withPaintSpecSections,
  type BrushoutPrepLink,
  type PaintItem,
  type PaintItemSpecScope,
  type PaintSubmittalData,
  type SubmittalHistoryEntry,
  type TradeSubmittalType,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string; setProject: (p: ProjectForm) => void };

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function paintItemHasContent(item: PaintItem): boolean {
  return Boolean(item.label.trim() || item.color.trim() || item.product.trim());
}

export function PaintSubmittalsPage() {
  const { user } = useAuth();
  const { branding } = useLetterhead();
  const { project, projectId, setProject } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<PaintSubmittalData>(defaultPaintSubmittal());
  const [history, setHistory] = useState<SubmittalHistoryEntry[]>([]);
  const [products, setProducts] = useState<PaintProduct[]>([]);
  const [sheens, setSheens] = useState<string[]>([]);
  const [colors, setColors] = useState<PaintColorsDb | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [startRevisionOpen, setStartRevisionOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<PaintSubmittalData | null>(null);
  const [prepOpen, setPrepOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [dragOverScope, setDragOverScope] = useState<PaintItemSpecScope | null>(null);
  const [userSettings, setUserSettings] = useState<Awaited<ReturnType<typeof loadPaintUserSettings>> | null>(
    null,
  );

  const dirtyState = useMemo(() => ({ draft, history }), [draft, history]);
  const { isDirty, syncBaseline, readBaseline } = useTradeDraftDirty(dirtyState, !loading);

  const persist = useCallback(
    async (nextDraft: PaintSubmittalData, nextHistory = history) => {
      const syncedTrade = withSyncedPaintVendor(tradeData, nextDraft);
      const ok = await save({
        ...syncedTrade,
        paint_submittal_history: nextHistory,
      });
      if (ok) {
        const nextSubmittal = syncedTrade.paint_submittal!;
        setDraft(nextSubmittal);
        setHistory(nextHistory);
        syncBaseline({ draft: nextSubmittal, history: nextHistory });
        setError(null);
        const updated = await reloadProject(projectId);
        if (updated) setProject(updated);
      }
      return ok;
    },
    [history, tradeData, save, setError, syncBaseline, projectId, setProject],
  );

  const onDiscardUnsaved = useCallback(() => {
    const baseline = readBaseline();
    if (!baseline) return;
    setDraft(baseline.draft);
    setHistory(baseline.history);
  }, [readBaseline]);

  useUnsavedNavigationGuard({
    sectionLabel: "Paint submittals",
    isDirty,
    onSave: () => persist(draft, history),
    onDiscard: onDiscardUnsaved,
  });

  useEffect(() => {
    if (!loading) {
      const vendor = resolvePaintTracker(tradeData).paintVendor;
      const d = { ...normalizePaintSubmittal(tradeData.paint_submittal), paint_vendor: vendor };
      const h = tradeData.paint_submittal_history ?? [];
      setDraft(d);
      setHistory(h);
      syncBaseline({ draft: d, history: h });
    }
  }, [loading, tradeData, syncBaseline]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const uid = user?.id ?? null;
        const [p, s, c] = await Promise.all([
          loadPaintProducts(uid),
          loadPaintSheens(uid),
          loadPaintColors(),
        ]);
        if (!cancelled) {
          setProducts(p);
          setSheens(s);
          setColors(c);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load paint catalogs");
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setError, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPaintUserSettings(user.id).then(setUserSettings);
  }, [user?.id]);

  const openPreps = useMemo(
    () => listOpenBrushoutPreps(userSettings?.brushout_preps ?? []),
    [userSettings?.brushout_preps],
  );
  const showPreviousColor = draft.submittal_type === "substitution";
  const draftLocked = submittalDraftIsLocked(draft);
  const autoLabel = draft.auto_label !== false;
  const secondaryOn = paintDualSpecEnabled(draft);
  const secondaryLabel = paintSpecSectionShortLabel(draft.spec_sections?.[1] ?? "");
  const secondarySection = draft.spec_sections?.[1] ?? "";
  const leadSection = draft.spec_sections?.[0] ?? draft.spec_section;
  const itemsReadiness = useMemo(() => paintItemsReadiness(draft.items), [draft.items]);

  const primaryIndexed = useMemo(
    () =>
      draft.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !secondaryOn || paintItemSpecScope(item) === "primary"),
    [draft.items, secondaryOn],
  );
  const secondaryIndexed = useMemo(
    () =>
      draft.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => paintItemSpecScope(item) === "secondary"),
    [draft.items],
  );

  function updateDraft(updater: (d: PaintSubmittalData) => PaintSubmittalData) {
    setDraft((current) => {
      const next = applySubmittalEdit(current, history, updater);
      if (!next) return current;
      if (next.revision_number !== current.revision_number) {
        setStatus(`Now editing Rev ${next.revision_number} (draft).`);
      }
      return next;
    });
  }

  function setType(t: TradeSubmittalType) {
    updateDraft((d) => ({
      ...d,
      submittal_type: t,
      subject: paintSubjectForPackage(d.package_type, t),
    }));
  }

  function addPaintRow(scope: PaintItemSpecScope = "primary") {
    updateDraft((d) => {
      const enabled = d.auto_label !== false;
      const row = emptyPaintItem();
      row.spec_scope = scope;
      if (enabled) row.label = paintRowAutoLabel(d.items.length);
      return { ...d, items: [...d.items, row] };
    });
  }

  function clearDragState() {
    setDragFrom(null);
    setDragOver(null);
    setDragOverScope(null);
  }

  /** Move a row into a CSI table (append within that scope). Works even when the target table is empty. */
  function moveItemToScope(from: number, scope: PaintItemSpecScope) {
    updateDraft((d) => {
      const current = d.items[from];
      if (!current) return d;
      if (paintItemSpecScope(current) === scope) return d;

      const without = d.items.filter((_, i) => i !== from);
      const moved = { ...current, spec_scope: scope };
      let insertAt = without.length;

      for (let i = without.length - 1; i >= 0; i--) {
        if (paintItemSpecScope(without[i]!) === scope) {
          insertAt = i + 1;
          break;
        }
      }

      if (!without.some((item) => paintItemSpecScope(item) === scope)) {
        if (scope === "primary") {
          const firstSecondary = without.findIndex((item) => paintItemSpecScope(item) === "secondary");
          insertAt = firstSecondary >= 0 ? firstSecondary : without.length;
        } else {
          insertAt = without.length;
        }
      }

      const next = [...without];
      next.splice(insertAt, 0, moved);
      return { ...d, items: withMaybeAutoLabels(next, d.auto_label !== false) };
    });
  }

  function renderPaintItemsTable(
    indexedRows: { item: PaintItem; index: number }[],
    options: {
      showFloor: boolean;
      ariaLabel: string;
      scope: PaintItemSpecScope;
      emptyHint?: string;
    },
  ) {
    return (
      <div
        className={`paint-items-grid${showPreviousColor ? " paint-items-grid--substitution" : ""}${
          !options.showFloor ? " paint-items-grid--no-floor" : ""
        }${dragFrom !== null && dragOverScope === options.scope ? " paint-items-grid--scope-dragover" : ""}`}
        role="table"
        aria-label={options.ariaLabel}
        onDragOver={(e: DragEvent) => {
          if (dragFrom === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOverScope(options.scope);
        }}
        onDragLeave={(e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOverScope((cur) => (cur === options.scope ? null : cur));
          }
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          if (dragFrom !== null) moveItemToScope(dragFrom, options.scope);
          clearDragState();
        }}
      >
        <div className="paint-items-header" role="row">
          <span className="paint-row-handle-spacer" aria-hidden />
          <span className="paint-col-head paint-col-label">Label</span>
          {options.showFloor && <span className="paint-col-head paint-col-floor">Floor</span>}
          <span className="paint-col-head paint-col-color">Color</span>
          {showPreviousColor && <span className="paint-col-head paint-col-prev">Previous</span>}
          <span className="paint-col-head paint-col-product">Product</span>
          <span className="paint-col-head paint-col-sheen">Sheen</span>
          <span className="paint-col-head paint-col-head-actions" aria-hidden />
        </div>
        {indexedRows.map(({ item, index }) => (
          <PaintItemRow
            key={index}
            item={item}
            index={index}
            total={draft.items.length}
            products={products}
            sheenOptions={sheens}
            colors={colors}
            showPreviousColor={showPreviousColor}
            showFloor={options.showFloor}
            autoLabel={autoLabel}
            dragging={dragFrom === index}
            dragOver={dragOver === index}
            onChange={(patch) => patchItem(index, patch)}
            onDragStart={() => setDragFrom(index)}
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setDragOver(index);
              setDragOverScope(options.scope);
            }}
            onDragLeave={() => setDragOver((cur) => (cur === index ? null : cur))}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== index) reorderItems(dragFrom, index);
              clearDragState();
            }}
            onDragEnd={clearDragState}
            onRemove={() =>
              updateDraft((d) => {
                const filtered =
                  d.items.length > 1 ? d.items.filter((_, i) => i !== index) : d.items;
                return {
                  ...d,
                  items: withMaybeAutoLabels(filtered, d.auto_label !== false),
                };
              })
            }
          />
        ))}
        {indexedRows.length === 0 && options.emptyHint ? (
          <div className="paint-items-drop-empty" role="status">
            {options.emptyHint}
          </div>
        ) : null}
      </div>
    );
  }

  function withMaybeAutoLabels(items: PaintItem[], enabled: boolean): PaintItem[] {
    return enabled ? applyPaintAutoLabels(items) : items;
  }

  function patchItem(index: number, patch: Partial<PaintItem>) {
    updateDraft((d) => {
      const enabled = d.auto_label !== false;
      const items = d.items.map((item, i) => {
        if (i !== index) return item;
        const next = { ...item, ...patch };
        if (enabled) next.label = paintRowAutoLabel(index);
        return next;
      });
      return { ...d, items };
    });
  }

  function reorderItems(from: number, to: number) {
    updateDraft((d) => {
      const targetScope = paintItemSpecScope(d.items[to]!);
      const scoped = d.items.map((item, i) =>
        i === from ? { ...item, spec_scope: targetScope } : item,
      );
      const moved = moveItem(scoped, from, to);
      return { ...d, items: withMaybeAutoLabels(moved, d.auto_label !== false) };
    });
  }

  function confirmGapsIfNeeded(): boolean {
    const readiness = paintItemsReadiness(draft.items);
    if (readiness.complete || (readiness.missingColor === 0 && readiness.missingSheen === 0)) {
      return true;
    }
    return window.confirm(readiness.confirmMessage);
  }

  function onImported(rows: ExtractedPaintRow[]) {
    const mapped: PaintItem[] = rows.map((r) => ({
      label: r.label,
      floor: r.floor,
      manufacturer: r.manufacturer,
      color: r.color,
      product: r.product,
      sheen: r.sheen,
      previous_color: "",
      spec_scope: "primary" as const,
    }));
    updateDraft((d) => {
      const existing = d.items.filter(paintItemHasContent);
      const merged = [...existing, ...mapped];
      return {
        ...d,
        items: merged.length ? merged : [emptyPaintItem()],
      };
    });
    setError(null);
  }

  function loadHistoryItems(items: PaintItem[], replace: boolean) {
    const mapped = items.length ? items.map((i) => ({ ...emptyPaintItem(), ...i })) : [emptyPaintItem()];
    updateDraft((d) => ({
      ...d,
      items: replace ? mapped : [...d.items.filter((i) => i.label || i.color || i.product), ...mapped],
    }));
    setHistoryOpen(false);
    setStatus(`Loaded ${items.length} item(s) from history. Save to keep changes.`);
  }

  function importPrepItems(items: PaintItem[], replace: boolean, link: BrushoutPrepLink) {
    const mapped = items.length ? items.map((i) => ({ ...emptyPaintItem(), ...i })) : [emptyPaintItem()];
    updateDraft((d) => ({
      ...d,
      items: replace ? mapped : [...d.items.filter((i) => i.label || i.color || i.product), ...mapped],
      brushout_prep: link,
    }));
    setStatus(`Imported ${items.length} line(s) from prep ${link.prep_id}. Save to keep changes.`);
  }

  async function onSave() {
    await persist(draft, history);
  }

  async function onDownloadPdf() {
    if (!confirmGapsIfNeeded()) return;
    try {
      await downloadPaintSubmittal(projectPrintInfo(project, project.jobInfo), draft, branding);
      let nextHistory = history;
      if (draftLocked) {
        nextHistory = addSubmittalToHistory(
          history,
          draft.submittal_number,
          draft.revision_number,
          draft.items,
          draft.submittal_type,
          "paint",
          {
            revisionNote: draft.revision_note,
            issueStatus: draft.issue_status,
            locked: true,
            packageType: draft.package_type,
            date: draft.date,
            specSection: draft.spec_section,
            specSectionSecondary: draft.spec_sections?.[1],
          },
        );
      }
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const parsed = parseSpecSectionForLog(draft.spec_section);
        const row = await recordPdfLogRow(projectId, {
          submittal_type: draft.package_type,
          scope: "Paint",
          spec: parsed.spec || "099000",
          section: parsed.section || draft.spec_section,
          notes: `Paint submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* log row optional */
      }
      const autoOn = await loadTransmittalContentAutoOn(user?.id);
      let transmittal = queuePendingItem(
        tradeData.transmittal ?? defaultTransmittal(),
        {
          submittal_type: draft.package_type,
          scope: "Paint",
          source: "paint_submittal",
          trade_submittal_number: String(draft.submittal_number),
          log_row_id: logRowId,
          spec_section: draft.spec_section,
          spec: "",
          section: draft.spec_section,
        },
        autoOn,
      );
      transmittal = applyTransmittalContractIfDistinct(project, transmittal, "paint");
      await save({
        ...withSyncedPaintVendor(tradeData, draft),
        paint_submittal_history: nextHistory,
        transmittal,
      });
      setStatus(
        draftLocked
          ? `Submittal #${String(draft.submittal_number).padStart(3, "0")} Rev ${draft.revision_number} PDF downloaded.`
          : `Submittal PDF downloaded. Issue this package to lock Rev ${draft.revision_number} in history.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed");
    }
  }

  async function onSubmittalOrderedChange(checked: boolean) {
    const next = { ...draft, submittal_ordered: checked };
    setDraft(next);
    const ok = await persist(next, history);
    if (!ok) return;
    const trackerErr = await patchPaintTrackerSubmittalOrdered(projectId, checked);
    if (trackerErr) {
      setStatus(`Saved submittal. Paint tracker update failed: ${trackerErr}`);
      return;
    }
    const updated = await reloadProject(projectId);
    if (updated) setProject(updated);
    setStatus(checked ? "Submittal marked ordered." : "Submittal ordered cleared.");
  }

  async function onIssueSubmittal() {
    if (!confirmGapsIfNeeded()) return;
    const { draft: issued, history: nextHistory } = issueSubmittalDraft(draft, history, "paint");
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
    setStatus(
      `Editing Rev ${next.revision_number} (draft). Add a revision note before issuing.`,
    );
  }

  function onNewSubmittalPackage() {
    if (
      !window.confirm(
        "Start a new submittal package? This assigns the next submittal number and resets revision to 0.",
      )
    ) {
      return;
    }
    const nextBase = {
      ...createNewSubmittalPackageDraft(draft, history),
      submittal_type: "new" as const,
      subject: paintSubjectForPackage(draft.package_type, "new"),
      auto_label: true,
      items: withMaybeAutoLabels([emptyPaintItem()], true),
    };
    const leadOnly = (draft.spec_sections?.[0] || draft.spec_section || "").trim();
    setDraft(withPaintSpecSections(nextBase, leadOnly ? [leadOnly] : ["09 91 23 - Interior Painting"]));
    setStatus("New submittal package started (Rev 0, draft).");
  }

  async function onDeleteHistory(submittalNumber: number, revisionNumber: number) {
    const nextHistory = removeSubmittalFromHistory(history, submittalNumber, revisionNumber);
    setHistory(nextHistory);
    await persist(draft, nextHistory);
    setStatus(`Removed submittal #${submittalNumber} Rev ${revisionNumber} from history.`);
  }

  const submittalPdfFilename = useMemo(
    () =>
      paintSubmittalFilename(
        project.job_name,
        project.job_number,
        draft.submittal_number,
        draft.submittal_type,
        draft.spec_section,
      ),
    [project.job_name, project.job_number, draft.submittal_number, draft.submittal_type, draft.spec_section],
  );

  if (loading) return <p className="muted">Loading paint submittal…</p>;

  return (
    <div className="stack paint-submittal-page">
      <div className="row-gap wrap paint-submittal-header-actions">
          <div className="row-gap wrap">
            <button
              type="button"
              className="btn btn-outline-accent"
              title="Assign the next submittal number (Rev 0, draft). Does not lock or issue."
              onClick={onNewSubmittalPackage}
            >
              New submittal package
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setStartRevisionOpen(true)}>
              Start revision from…
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
          </div>
          <div className="row-gap wrap">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void onDownloadPdf()}>
              Download PDF
            </button>
          </div>
        </div>

      <p className="sds-filename-preview muted small">
        Filename: <code>{submittalPdfFilename}</code>
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      {draftLocked && (
        <div className="banner banner-warn">
          This revision is <strong>{draft.issue_status.replace(/_/g, " ")}</strong>. Create a new revision to
          change items, or update issue status below.
        </div>
      )}

      <section className="card paint-action-row">
        <button type="button" className="btn btn-secondary" onClick={() => setEmailOpen(true)}>
          Order Brushouts
        </button>
        <label className="check paint-action-check">
          <input
            type="checkbox"
            checked={Boolean(draft.submittal_ordered)}
            onChange={(e) => void onSubmittalOrderedChange(e.target.checked)}
          />
          Ordered
        </label>
        <span className="paint-action-sep" aria-hidden="true" />
        <button type="button" className="btn btn-secondary" onClick={() => setPrepOpen(true)}>
          Import Prep List
        </button>
        <Link className="btn btn-secondary" to={`/projects/${projectId}/approved-brushouts`}>
          Approved brush-outs
        </Link>
        <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
          History
        </button>
        {draft.brushout_prep?.prep_id && (
          <span className="muted small paint-action-linked">
            Linked prep: {draft.brushout_prep.prep_id}
            {draft.brushout_prep.site_location ? ` · ${draft.brushout_prep.site_location}` : ""}
          </span>
        )}
      </section>

      <PaintSubmittalMetaPanel
        draft={draft}
        draftLocked={draftLocked}
        packageTypeOptions={PAINT_PACKAGE_TYPE_OPTIONS}
        onSubmittalNumberChange={(submittal_number) => setDraft({ ...draft, submittal_number })}
        onIssueStatusChange={(issue_status) => setDraft({ ...draft, issue_status })}
        onDateChange={(date) => setDraft({ ...draft, date })}
        onPackageTypeChange={(package_type) =>
          updateDraft((d) => ({
            ...d,
            package_type,
            subject: paintSubjectForPackage(package_type, d.submittal_type),
          }))
        }
        onTypeChange={setType}
        onSubjectChange={(subject) => setDraft({ ...draft, subject })}
        onSpecSectionsChange={updateDraft}
        onRevisionNoteChange={(revision_note) => setDraft({ ...draft, revision_note })}
        onPaintVendorChange={(paint_vendor) => setDraft({ ...draft, paint_vendor })}
        onCreateNextRevision={draftLocked ? onCreateRevision : undefined}
      />

      <PaintImageImport onImported={onImported} layout="row" />

      <section className="card stack paint-items-section">
        <div className="row-between paint-items-toolbar">
          <div>
            <h3>Paint items ({draft.items.length})</h3>
            <p className="muted small paint-lookup-hint">
              Search by color name or number (e.g. <code>SW7004</code> or <code>7004</code>). Press{" "}
              <kbd>Enter</kbd>, <kbd>Tab</kbd>, or the search button.
            </p>
          </div>
          <div className="paint-items-toolbar-actions">
            <label className="check paint-floor-toggle">
              <input
                type="checkbox"
                checked={draft.show_floor === true}
                onChange={(e) => setDraft({ ...draft, show_floor: e.target.checked })}
              />
              Show floor
              {secondaryOn ? <span className="muted"> (primary table only)</span> : null}
            </label>
            <label className="check paint-floor-toggle">
              <input
                type="checkbox"
                checked={autoLabel}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  updateDraft((d) => ({
                    ...d,
                    auto_label: enabled,
                    items: enabled ? applyPaintAutoLabels(d.items) : d.items,
                  }));
                }}
              />
              Auto-label by order
            </label>
            {!secondaryOn && (
              <div className="paint-add-buttons">
                <button type="button" className="btn btn-primary btn-small" onClick={() => addPaintRow("primary")}>
                  + Add row
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={catalogLoading}
                  onClick={() => setBulkOpen(true)}
                >
                  Add multiple…
                </button>
              </div>
            )}
          </div>
        </div>

        {catalogLoading && <p className="muted small">Loading color catalog…</p>}

        {secondaryOn ? (
          <>
            <div className="paint-items-scope-block">
              <div className="paint-items-scope-heading">
                <div>
                  <h4>Primary · {leadSection || "Spec section"}</h4>
                  <p className="muted small">{primaryIndexed.length} line(s)</p>
                </div>
                <div className="paint-add-buttons">
                  <button type="button" className="btn btn-primary btn-small" onClick={() => addPaintRow("primary")}>
                    + Add row
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    disabled={catalogLoading}
                    onClick={() => setBulkOpen(true)}
                  >
                    Add multiple…
                  </button>
                </div>
              </div>
              {renderPaintItemsTable(primaryIndexed, {
                showFloor: draft.show_floor === true,
                ariaLabel: "Primary paint items",
                scope: "primary",
                emptyHint: "Drop rows here for the primary spec",
              })}
            </div>

            <div className="paint-items-scope-block">
              <div className="paint-items-scope-heading">
                <div>
                  <h4>
                    {secondaryLabel} · {secondarySection}
                  </h4>
                  <p className="muted small">{secondaryIndexed.length} line(s) · no floor column</p>
                </div>
                <div className="paint-add-buttons">
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => addPaintRow("secondary")}
                  >
                    + Add row
                  </button>
                </div>
              </div>
              {renderPaintItemsTable(secondaryIndexed, {
                showFloor: false,
                ariaLabel: `${secondaryLabel} paint items`,
                scope: "secondary",
                emptyHint: `Drag ⠿ rows here from primary for ${secondaryLabel}`,
              })}
            </div>
          </>
        ) : (
          renderPaintItemsTable(primaryIndexed, {
            showFloor: draft.show_floor === true,
            ariaLabel: "Paint items",
            scope: "primary",
          })
        )}

        <div className="row-between paint-items-footer">
          <p className="muted small paint-items-drag-hint">
            {secondaryOn
              ? autoLabel
                ? "Drag ⠿ to reorder or move between primary / exterior tables · labels follow order"
                : "Drag ⠿ to reorder or move between primary / exterior tables"
              : autoLabel
                ? "Drag ⠿ to reorder · labels follow order"
                : "Drag ⠿ to reorder"}
          </p>
          <p
            className={`small paint-items-readiness${
              itemsReadiness.missingColor > 0 || itemsReadiness.missingSheen > 0
                ? " paint-items-readiness--warn"
                : itemsReadiness.count > 0
                  ? " paint-items-readiness--ok"
                  : ""
            }`}
          >
            {itemsReadiness.summaryLine}
          </p>
        </div>
      </section>

      {bulkOpen && (
        <PaintBulkAddModal
          products={products}
          sheenOptions={sheens}
          autoLabel={autoLabel}
          nextAutoLabelIndex={draft.items.filter(paintItemHasContent).length || draft.items.length}
          onAdd={(items, opts) =>
            updateDraft((d) => {
              const kept = d.items.filter((i) => i.label || i.color || i.product);
              const merged = [...kept, ...items];
              if (opts.turnOffAutoLabel) {
                return { ...d, auto_label: false, items: merged };
              }
              const enabled = d.auto_label !== false;
              return { ...d, items: withMaybeAutoLabels(merged, enabled) };
            })
          }
          onClose={() => setBulkOpen(false)}
        />
      )}

      {historyOpen && (
        <SubmittalHistoryModal
          scope="paint"
          jobNumber={project.job_number}
          jobName={project.job_name}
          history={history}
          onLoadPaint={loadHistoryItems}
          onDelete={(n, r) => void onDeleteHistory(n, r)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {startRevisionOpen && (
        <StartRevisionFromHistoryModal
          scope="paint"
          history={history}
          currentDraft={draft}
          onClose={() => setStartRevisionOpen(false)}
          onStart={(revisedDraft) => {
            setDraft(normalizePaintSubmittal(revisedDraft as PaintSubmittalData));
            setStartRevisionOpen(false);
            setStatus(
              `Editing Submittal #${String(revisedDraft.submittal_number).padStart(3, "0")} Rev ${revisedDraft.revision_number} (draft). Save or issue when ready.`,
            );
          }}
        />
      )}

      {emailOpen && userSettings && (
        <EmailVendorModal
          jobNumber={project.job_number}
          jobName={project.job_name}
          items={(emailDraft ?? draft).items}
          submittalType={(emailDraft ?? draft).submittal_type}
          vendors={userSettings.vendors}
          defaultQty={userSettings.default_brushout_qty}
          signature={userSettings.signature}
          logoUrl={branding.logoUrl}
          superName={gcSuperintendentContact(project.jobInfo).name}
          superEmail={gcSuperEmail(project.jobInfo)}
          superRoleLabel="GC super"
          foremanName={project.jobInfo?.icbi_foreman}
          foremanEmail={project.jobInfo?.icbi_foreman_email}
          composeEmailMethod={userSettings.compose_email_method}
          onClose={() => {
            setEmailOpen(false);
            setEmailDraft(null);
          }}
        />
      )}

      {prepOpen && (
        <ImportBrushoutPrepModal
          preps={openPreps}
          onImport={importPrepItems}
          onClose={() => setPrepOpen(false)}
        />
      )}
    </div>
  );
}
