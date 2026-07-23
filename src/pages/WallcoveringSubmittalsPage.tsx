import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { StartRevisionFromHistoryModal } from "../components/submittals/StartRevisionFromHistoryModal";
import { applySubmittalEdit } from "../lib/submittalDraftGuard";
import { SubmittalHistoryModal } from "../components/paint/SubmittalHistoryModal";
import { WallcoveringBulkAddModal } from "../components/wallcovering/WallcoveringBulkAddModal";
import { WallcoveringItemRow } from "../components/wallcovering/WallcoveringItemRow";
import { WallcoveringSubmittalMetaPanel } from "../components/wallcovering/WallcoveringSubmittalMetaPanel";
import { WcOrderSamplesModal } from "../components/wallcovering/WcOrderSamplesModal";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { loadContactDirectory } from "../lib/contactDirectory";
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
import { buildWcTrackerLinesFromSubmittal, saveWcTrackerLines, syncWcSubmittalOrdered } from "../lib/fieldTrackerProject";
import {
  applyGotTrackToggle,
  detectGotTrack,
  isTrackInfillItem,
  withTrackRowLast,
} from "../lib/wcTrackInfill";
import {
  applyWcAutoLabels,
  wcContentItems,
  wcItemsHaveFloor,
  wcItemsReadiness,
  wcRowAutoLabel,
} from "../lib/wcItemLabels";
import {
  applyTransmittalContractIfDistinct,
  icbiProjectManager,
  jobArchitectAddressOneLine,
  jobFullAddressOneLine,
  wcPrintInfo,
} from "../lib/jobInfo";
import { orderedWallcoveringItems } from "../lib/wcSampleOrderEmail";
import { downloadWallcoveringSubmittal } from "../lib/wallcoveringSubmittalPrint";
import { wallcoveringSubmittalFilename } from "../lib/pdfFilenames";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import type { MaterialVendor } from "../types/contactDirectory";
import type { ProjectForm } from "../types/database";
import {
  defaultTransmittal,
  defaultWallcoveringSubmittal,
  emptyWallcoveringItem,
  normalizeWallcoveringSubmittal,
  paintSpecSectionShortLabel,
  WALLCOVERING_PACKAGE_TYPE_OPTIONS,
  wcDualSpecEnabled,
  wcItemSpecScope,
  wcSubjectForPackage,
  withWcSpecSections,
  type PaintItemSpecScope,
  type SubmittalHistoryEntry,
  type TradeSubmittalType,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function normalizeWcDraft(raw: WallcoveringSubmittalData): WallcoveringSubmittalData {
  const normalized = normalizeWallcoveringSubmittal(raw);
  return {
    ...normalized,
    items: withTrackRowLast(normalized.items),
    got_track: raw.got_track ?? detectGotTrack(normalized.items),
  };
}

export function WallcoveringSubmittalsPage() {
  const { user } = useAuth();
  const { branding } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<WallcoveringSubmittalData>(defaultWallcoveringSubmittal());
  const [history, setHistory] = useState<SubmittalHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [startRevisionOpen, setStartRevisionOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [trackerBusy, setTrackerBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [dragOverScope, setDragOverScope] = useState<PaintItemSpecScope | null>(null);
  const [savedTrackItem, setSavedTrackItem] = useState<WallcoveringItem | null>(null);
  const [vendors, setVendors] = useState<MaterialVendor[]>([]);
  const [samplesOpen, setSamplesOpen] = useState(false);

  const dirtyState = useMemo(() => ({ draft, history }), [draft, history]);
  const { isDirty, syncBaseline, readBaseline } = useTradeDraftDirty(dirtyState, !loading);

  const persist = useCallback(
    async (nextDraft: WallcoveringSubmittalData, nextHistory = history) => {
      const ok = await save({
        ...tradeData,
        wallcovering_submittal: nextDraft,
        wallcovering_submittal_history: nextHistory,
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
    sectionLabel: "Wallcovering submittals",
    isDirty,
    onSave: () => persist(draft, history),
    onDiscard: onDiscardUnsaved,
  });

  useEffect(() => {
    if (!loading) {
      const d = normalizeWcDraft(tradeData.wallcovering_submittal ?? defaultWallcoveringSubmittal());
      const h = tradeData.wallcovering_submittal_history ?? [];
      setDraft(d);
      setHistory(h);
      syncBaseline({ draft: d, history: h });
    }
  }, [loading, tradeData.wallcovering_submittal, tradeData.wallcovering_submittal_history, syncBaseline]);

  useEffect(() => {
    if (!user?.id) return;
    void loadContactDirectory(user.id).then((d) => setVendors(d.material_vendors));
  }, [user?.id]);

  const showPreviousColor = draft.submittal_type === "substitution";
  const wcPrint = useMemo(() => wcPrintInfo(project, project.jobInfo), [project]);
  const draftLocked = submittalDraftIsLocked(draft);
  const autoLabel = draft.auto_label !== false;
  const showFloor = draft.show_floor === true || wcItemsHaveFloor(draft.items);
  const hasTrack = Boolean(draft.got_track) || draft.items.some(isTrackInfillItem);
  const contentCount = wcContentItems(draft.items).length;
  const itemsReadiness = useMemo(() => wcItemsReadiness(draft.items), [draft.items]);
  const sampleItems = useMemo(() => orderedWallcoveringItems(draft.items), [draft.items]);
  const secondaryOn = wcDualSpecEnabled(draft);
  const secondaryLabel = paintSpecSectionShortLabel(draft.spec_sections?.[1] ?? "");
  const secondarySection = draft.spec_sections?.[1] ?? "";
  const leadSection = draft.spec_sections?.[0] ?? draft.spec_section;

  const primaryIndexed = useMemo(
    () =>
      draft.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !secondaryOn || wcItemSpecScope(item) === "primary"),
    [draft.items, secondaryOn],
  );
  const secondaryIndexed = useMemo(
    () =>
      draft.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !isTrackInfillItem(item) && wcItemSpecScope(item) === "secondary"),
    [draft.items],
  );

  function updateDraft(updater: (d: WallcoveringSubmittalData) => WallcoveringSubmittalData) {
    setDraft((current) => {
      const next = applySubmittalEdit(current, history, updater);
      if (!next) return current;
      if (next.revision_number !== current.revision_number) {
        setStatus(`Now editing Rev ${next.revision_number} (draft).`);
      }
      const items = withTrackRowLast(next.items);
      return {
        ...next,
        items,
        got_track: detectGotTrack(items),
        show_floor: next.show_floor === true || wcItemsHaveFloor(items),
      };
    });
  }

  function setType(t: TradeSubmittalType) {
    updateDraft((d) => ({
      ...d,
      submittal_type: t,
      subject: wcSubjectForPackage(d.package_type, t),
    }));
  }

  function withMaybeAutoLabels(items: WallcoveringItem[], enabled: boolean): WallcoveringItem[] {
    return enabled ? applyWcAutoLabels(items) : items;
  }

  function clearDragState() {
    setDragFrom(null);
    setDragOver(null);
    setDragOverScope(null);
  }

  function addWcRow(scope: PaintItemSpecScope = "primary") {
    updateDraft((d) => {
      const enabled = d.auto_label !== false;
      const content = wcContentItems(d.items);
      const row = emptyWallcoveringItem();
      row.spec_scope = scope;
      if (enabled) row.label = wcRowAutoLabel(content.length);
      const track = d.items.find(isTrackInfillItem);
      const next = track ? [...content, row, track] : [...content, row];
      // Keep secondary rows after primary content but before track when dual.
      if (scope === "secondary" && track) {
        const withoutTrack = next.filter((i) => !isTrackInfillItem(i));
        const primary = withoutTrack.filter((i) => wcItemSpecScope(i) === "primary");
        const secondary = withoutTrack.filter((i) => wcItemSpecScope(i) === "secondary");
        return {
          ...d,
          items: withMaybeAutoLabels([...primary, ...secondary, track], enabled),
        };
      }
      return { ...d, items: withMaybeAutoLabels(next, enabled) };
    });
  }

  /** Move a content row into a CSI table. Track/infill always stays primary. */
  function moveItemToScope(from: number, scope: PaintItemSpecScope) {
    updateDraft((d) => {
      const current = d.items[from];
      if (!current || isTrackInfillItem(current)) return d;
      if (wcItemSpecScope(current) === scope) return d;

      const without = d.items.filter((_, i) => i !== from);
      const moved = { ...current, spec_scope: scope };
      let insertAt = without.length;

      for (let i = without.length - 1; i >= 0; i--) {
        const row = without[i]!;
        if (isTrackInfillItem(row)) continue;
        if (wcItemSpecScope(row) === scope) {
          insertAt = i + 1;
          break;
        }
      }

      if (!without.some((item) => !isTrackInfillItem(item) && wcItemSpecScope(item) === scope)) {
        if (scope === "primary") {
          const firstSecondary = without.findIndex(
            (item) => !isTrackInfillItem(item) && wcItemSpecScope(item) === "secondary",
          );
          insertAt = firstSecondary >= 0 ? firstSecondary : without.findIndex(isTrackInfillItem);
          if (insertAt < 0) insertAt = without.length;
        } else {
          const trackAt = without.findIndex(isTrackInfillItem);
          insertAt = trackAt >= 0 ? trackAt : without.length;
        }
      }

      const next = [...without];
      next.splice(insertAt, 0, moved);
      return { ...d, items: withMaybeAutoLabels(withTrackRowLast(next), d.auto_label !== false) };
    });
  }

  function patchItem(index: number, patch: Partial<WallcoveringItem>) {
    updateDraft((d) => {
      const enabled = d.auto_label !== false;
      const items = d.items.map((item, i) => {
        if (i !== index) return item;
        if (isTrackInfillItem(item)) return { ...item, ...patch, label: "", spec_scope: "primary" as const };
        return { ...item, ...patch };
      });
      const floorForced = typeof patch.floor === "string" && patch.floor.trim().length > 0;
      return {
        ...d,
        show_floor: floorForced || d.show_floor === true || wcItemsHaveFloor(items),
        items: withMaybeAutoLabels(items, enabled),
      };
    });
  }

  function reorderContentItems(from: number, to: number) {
    updateDraft((d) => {
      if (isTrackInfillItem(d.items[from]!) || isTrackInfillItem(d.items[to]!)) return d;
      const targetScope = wcItemSpecScope(d.items[to]!);
      const scoped = d.items.map((item, i) =>
        i === from ? { ...item, spec_scope: targetScope } : item,
      );
      const moved = withTrackRowLast(moveItem(scoped, from, to));
      return { ...d, items: withMaybeAutoLabels(moved, d.auto_label !== false) };
    });
  }

  function renderWcItemsTable(
    indexedRows: { item: WallcoveringItem; index: number }[],
    options: {
      ariaLabel: string;
      scope: PaintItemSpecScope;
      emptyHint?: string;
    },
  ) {
    return (
      <div
        className={`wc-items-list${
          dragFrom !== null && dragOverScope === options.scope ? " wc-items-list--scope-dragover" : ""
        }`}
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
        <div className="wc-items-header" role="row">
          <span className="wc-row-handle-spacer" aria-hidden />
          <span className="wc-col-head wc-col-label">Label</span>
          <span className="wc-col-head wc-col-mfr">Manufacturer</span>
          <span className="wc-col-head wc-col-product">Product</span>
          {showPreviousColor && <span className="wc-col-head wc-col-prev">Previous</span>}
          <span className="wc-col-head wc-col-color">Color / Pattern</span>
          <span className="wc-col-head wc-col-head-actions" aria-hidden />
        </div>
        {indexedRows.map(({ item, index }) => (
          <WallcoveringItemRow
            key={index}
            item={item}
            index={index}
            totalContent={contentCount}
            showPreviousColor={showPreviousColor}
            autoLabel={autoLabel}
            showFloor={showFloor && options.scope === "primary"}
            dragging={dragFrom === index}
            dragOver={dragOver === index}
            onChange={(patch) => patchItem(index, patch)}
            onDragStart={() => setDragFrom(index)}
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              if (!isTrackInfillItem(item)) {
                setDragOver(index);
                setDragOverScope(options.scope);
              }
            }}
            onDragLeave={() => setDragOver((cur) => (cur === index ? null : cur))}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== index) reorderContentItems(dragFrom, index);
              clearDragState();
            }}
            onDragEnd={clearDragState}
            onRemove={() =>
              updateDraft((d) => {
                const filtered =
                  d.items.length > 1 ? d.items.filter((_, i) => i !== index) : d.items;
                return {
                  ...d,
                  items: withMaybeAutoLabels(withTrackRowLast(filtered), d.auto_label !== false),
                };
              })
            }
          />
        ))}
        {indexedRows.length === 0 && options.emptyHint ? (
          <div className="wc-items-drop-empty" role="status">
            {options.emptyHint}
          </div>
        ) : null}
      </div>
    );
  }

  function onGotTrackChange(checked: boolean) {
    if (!checked) {
      const track = draft.items.find(isTrackInfillItem);
      if (track) setSavedTrackItem({ ...track });
    }
    updateDraft((d) => ({
      ...d,
      got_track: checked,
      items: withMaybeAutoLabels(
        applyGotTrackToggle(d.items, checked, checked ? savedTrackItem : null),
        d.auto_label !== false,
      ),
    }));
  }

  function confirmGapsIfNeeded(): boolean {
    const readiness = wcItemsReadiness(draft.items);
    if (readiness.complete || (readiness.missingColor === 0 && readiness.missingQty === 0 && readiness.missingManufacturer === 0)) {
      return true;
    }
    return window.confirm(readiness.confirmMessage);
  }

  function loadHistoryItems(items: WallcoveringItem[], replace: boolean) {
    const mapped = items.length
      ? items.map((i) => ({
          ...emptyWallcoveringItem(),
          ...i,
          order: i.order ?? false,
          spec_scope: i.spec_scope === "secondary" ? ("secondary" as const) : ("primary" as const),
        }))
      : [emptyWallcoveringItem()];
    updateDraft((d) => ({
      ...d,
      items: replace
        ? mapped
        : [
            ...d.items.filter((i) => i.label || i.color || i.manufacturer || i.product),
            ...mapped,
          ],
      got_track: detectGotTrack(replace ? mapped : [...d.items, ...mapped]),
    }));
    setHistoryOpen(false);
    setStatus(`Loaded ${items.length} item(s) from history. Save to keep changes.`);
  }

  async function onSave() {
    await persist(draft, history);
  }

  async function onDownloadPdf() {
    if (!confirmGapsIfNeeded()) return;
    try {
      await downloadWallcoveringSubmittal(wcPrint, draft, branding);
      let nextHistory = history;
      if (draftLocked) {
        nextHistory = addSubmittalToHistory(
          history,
          draft.submittal_number,
          draft.revision_number,
          draft.items,
          draft.submittal_type,
          "wallcovering",
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
          scope: "Wallcovering",
          spec: parsed.spec || "096000",
          section: parsed.section || draft.spec_section,
          notes: `Wallcovering submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* log row optional */
      }
      const autoOn = await loadTransmittalContentAutoOn();
      let transmittal = queuePendingItem(
        tradeData.transmittal ?? defaultTransmittal(),
        {
          submittal_type: draft.package_type,
          scope: "Wallcovering",
          source: "wallcovering_submittal",
          trade_submittal_number: String(draft.submittal_number),
          log_row_id: logRowId,
          spec_section: draft.spec_section,
          section: draft.spec_section,
        },
        autoOn,
      );
      transmittal = applyTransmittalContractIfDistinct(project, transmittal, "wallcovering");
      await save({
        ...tradeData,
        wallcovering_submittal: draft,
        wallcovering_submittal_history: nextHistory,
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
    const trackerErr = await syncWcSubmittalOrdered(projectId, checked);
    if (trackerErr) {
      setStatus(`Saved submittal. Wallcovering tracker update failed: ${trackerErr}`);
      return;
    }
    setStatus(checked ? "Submittal marked ordered." : "Submittal ordered cleared.");
  }

  function startOrderSamples() {
    if (!sampleItems.length) {
      setError('Check the "Order" box on items to include in sample requests.');
      return;
    }
    setError(null);
    setSamplesOpen(true);
  }

  async function onCopyToTracker() {
    setTrackerBusy(true);
    setError(null);
    setStatus(null);
    try {
      const lines = buildWcTrackerLinesFromSubmittal(draft.items);
      if (!lines.length) {
        setError("No wallcovering items with data to copy.");
        return;
      }
      const saveErr = await saveWcTrackerLines(
        projectId,
        lines,
        `Copied ${lines.length} wallcovering line${lines.length === 1 ? "" : "s"} from submittal`,
      );
      if (saveErr) {
        setError(saveErr);
        return;
      }
      setStatus(`Copied ${lines.length} line${lines.length === 1 ? "" : "s"} to Job Tracker → Wallcovering.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save tracker lines.");
    } finally {
      setTrackerBusy(false);
    }
  }

  async function onIssueSubmittal() {
    if (!confirmGapsIfNeeded()) return;
    const { draft: issued, history: nextHistory } = issueSubmittalDraft(draft, history, "wallcovering");
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
    setDraft({ ...next, got_track: detectGotTrack(next.items) });
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
    setSavedTrackItem(null);
    const nextBase = {
      ...createNewSubmittalPackageDraft(draft, history),
      submittal_type: "new" as const,
      subject: wcSubjectForPackage(draft.package_type, "new"),
      auto_label: true,
      items: applyWcAutoLabels([emptyWallcoveringItem()]),
      got_track: false,
      show_floor: false,
    };
    const leadOnly = (draft.spec_sections?.[0] ?? draft.spec_section)?.trim();
    setDraft(withWcSpecSections(nextBase, leadOnly ? [leadOnly] : ["09 72 00 - Wall Coverings"]));
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
      wallcoveringSubmittalFilename(
        wcPrint.job_name,
        wcPrint.job_number,
        draft.submittal_number,
        draft.submittal_type,
        draft.spec_section,
      ),
    [wcPrint.job_name, wcPrint.job_number, draft.submittal_number, draft.submittal_type, draft.spec_section],
  );

  if (loading) return <p className="muted">Loading wallcovering submittal…</p>;

  return (
    <div className="stack wc-submittal-page">
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
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onDownloadPdf()}>
            Download PDF
          </button>
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

      <section className="card wc-action-bar">
        <div className="wc-main-buttons row-gap wrap">
          <button type="button" className="btn btn-secondary" onClick={startOrderSamples}>
            Order samples
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
            Submittal history…
          </button>
          <label className="check paint-action-check">
            <input
              type="checkbox"
              checked={Boolean(draft.submittal_ordered)}
              onChange={(e) => void onSubmittalOrderedChange(e.target.checked)}
            />
            Ordered
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={trackerBusy}
            onClick={() => void onCopyToTracker()}
          >
            {trackerBusy ? "Saving…" : "Copy to Job Tracker"}
          </button>
        </div>
      </section>

      <WallcoveringSubmittalMetaPanel
        draft={draft}
        draftLocked={draftLocked}
        packageTypeOptions={WALLCOVERING_PACKAGE_TYPE_OPTIONS}
        onSubmittalNumberChange={(submittal_number) => setDraft({ ...draft, submittal_number })}
        onIssueStatusChange={(issue_status) => setDraft({ ...draft, issue_status })}
        onDateChange={(date) => setDraft({ ...draft, date })}
        onPackageTypeChange={(package_type) =>
          updateDraft((d) => ({
            ...d,
            package_type,
            subject: wcSubjectForPackage(package_type, d.submittal_type),
          }))
        }
        onTypeChange={setType}
        onSubjectChange={(subject) => setDraft({ ...draft, subject })}
        onSpecSectionsChange={updateDraft}
        onRevisionNoteChange={(revision_note) => setDraft({ ...draft, revision_note })}
        onCreateNextRevision={draftLocked ? onCreateRevision : undefined}
      />

      <section className="card stack wc-items-section">
        <div className="row-between wc-items-toolbar">
          <div>
            <h3>
              Wallcovering items ({contentCount}
              {hasTrack ? " + track" : ""})
            </h3>
          </div>
          <div className="wc-items-toolbar-actions">
            <label className="check wc-got-track">
              <input
                type="checkbox"
                checked={Boolean(draft.got_track)}
                onChange={(e) => onGotTrackChange(e.target.checked)}
              />
              Got Track?
            </label>
            <label className="check wc-got-track">
              <input
                type="checkbox"
                checked={showFloor}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  if (!enabled && wcItemsHaveFloor(draft.items)) return;
                  updateDraft((d) => ({ ...d, show_floor: enabled }));
                }}
              />
              Show floor
              {secondaryOn ? <span className="muted"> (primary table only)</span> : null}
            </label>
            <label className="check wc-got-track">
              <input
                type="checkbox"
                checked={autoLabel}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  updateDraft((d) => ({
                    ...d,
                    auto_label: enabled,
                    items: enabled ? applyWcAutoLabels(d.items) : d.items,
                  }));
                }}
              />
              Auto-label by order
            </label>
            {!secondaryOn && (
              <div className="paint-add-buttons">
                <button type="button" className="btn btn-primary btn-small" onClick={() => addWcRow("primary")}>
                  + Add row
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setBulkOpen(true)}
                >
                  Add multiple…
                </button>
              </div>
            )}
          </div>
        </div>

        {secondaryOn ? (
          <>
            <div className="paint-items-scope-block">
              <div className="paint-items-scope-heading">
                <div>
                  <h4>Primary · {leadSection || "Spec section"}</h4>
                  <p className="muted small">
                    {primaryIndexed.filter(({ item }) => !isTrackInfillItem(item)).length} line(s)
                    {hasTrack ? " + track" : ""}
                  </p>
                </div>
                <div className="paint-add-buttons">
                  <button type="button" className="btn btn-primary btn-small" onClick={() => addWcRow("primary")}>
                    + Add row
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setBulkOpen(true)}
                  >
                    Add multiple…
                  </button>
                </div>
              </div>
              {renderWcItemsTable(primaryIndexed, {
                ariaLabel: "Primary wallcovering items",
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
                    onClick={() => addWcRow("secondary")}
                  >
                    + Add row
                  </button>
                </div>
              </div>
              {renderWcItemsTable(secondaryIndexed, {
                ariaLabel: `${secondaryLabel} wallcovering items`,
                scope: "secondary",
                emptyHint: `Drag ⠿ rows here from primary for ${secondaryLabel}`,
              })}
            </div>
          </>
        ) : (
          renderWcItemsTable(primaryIndexed, {
            ariaLabel: "Wallcovering items",
            scope: "primary",
          })
        )}

        <div className="row-between wc-items-footer">
          <p className="muted small wc-items-drag-hint">
            {autoLabel ? "Drag ⠿ to reorder · labels follow order" : "Drag ⠿ to reorder"}
            {secondaryOn ? " · drag between tables for 2nd spec" : ""}
            {hasTrack ? " · track row stays last" : ""}
          </p>
          <p
            className={`small wc-items-readiness${
              itemsReadiness.missingColor > 0 ||
              itemsReadiness.missingQty > 0 ||
              itemsReadiness.missingManufacturer > 0
                ? " wc-items-readiness--warn"
                : itemsReadiness.count > 0
                  ? " wc-items-readiness--ok"
                  : ""
            }`}
          >
            {itemsReadiness.summaryLine}
          </p>
        </div>
      </section>

      {bulkOpen && (
        <WallcoveringBulkAddModal
          autoLabel={autoLabel}
          nextAutoLabelIndex={contentCount}
          onAdd={(items, opts) =>
            updateDraft((d) => {
              const content = wcContentItems(d.items).filter(
                (i) => i.label || i.color || i.manufacturer || i.product,
              );
              const track = d.items.find(isTrackInfillItem);
              const merged = track ? [...content, ...items, track] : [...content, ...items];
              if (opts.turnOffAutoLabel) {
                return { ...d, auto_label: false, items: withTrackRowLast(merged) };
              }
              const enabled = d.auto_label !== false;
              return { ...d, items: withMaybeAutoLabels(withTrackRowLast(merged), enabled) };
            })
          }
          onClose={() => setBulkOpen(false)}
        />
      )}

      {historyOpen && (
        <SubmittalHistoryModal
          scope="wallcovering"
          jobNumber={wcPrint.job_number}
          jobName={wcPrint.job_name}
          history={history}
          onLoadWallcovering={loadHistoryItems}
          onDelete={(n, r) => void onDeleteHistory(n, r)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {startRevisionOpen && (
        <StartRevisionFromHistoryModal
          scope="wallcovering"
          history={history}
          currentDraft={draft}
          onClose={() => setStartRevisionOpen(false)}
          onStart={(revisedDraft) => {
            const next = normalizeWcDraft(revisedDraft as WallcoveringSubmittalData);
            setDraft(next);
            setStartRevisionOpen(false);
            setStatus(
              `Editing Submittal #${String(next.submittal_number).padStart(3, "0")} Rev ${next.revision_number} (draft). Save or issue when ready.`,
            );
          }}
        />
      )}

      {samplesOpen && (
        <WcOrderSamplesModal
          jobNumber={project.job_number}
          jobName={project.job_name}
          jobLocation={jobFullAddressOneLine(project, project.jobInfo)}
          architect={project.architect}
          specifierAddress={jobArchitectAddressOneLine(project.jobInfo)}
          pmName={icbiProjectManager(project.jobInfo)}
          items={sampleItems}
          vendors={vendors}
          onClose={() => setSamplesOpen(false)}
        />
      )}
    </div>
  );
}
