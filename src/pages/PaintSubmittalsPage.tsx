import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { StartRevisionFromHistoryModal } from "../components/submittals/StartRevisionFromHistoryModal";
import { applySubmittalEdit } from "../lib/submittalDraftGuard";
import { AtticStockOrderModal } from "../components/paint/AtticStockOrderModal";
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
  loadFieldToolsPaintCatalog,
  loadPaintColors,
  loadPaintProducts,
  loadPaintSheens,
  omitCatalogPrimerItems,
  paintItemPrimerView,
  type PaintColorsDb,
  type PaintProduct,
} from "../lib/paintCatalog";
import {
  applyPaintAutoLabels,
  dropPaintPlaceholders,
  paintColorColumnCh,
  paintItemsReadiness,
  paintRowAutoLabel,
} from "../lib/paintItemLabels";
import { paintRevisionChangeLabel } from "../lib/paintBrushouts";
import { syncApprovedBrushoutPrimers } from "../lib/approvedBrushouts";
import { paintItemsFromExtractedRows, type ExtractedPaintRow } from "../lib/paintImageImport";
import { gcSuperEmail, gcSuperintendentContact, icbiSuperEmail, icbiSuperintendent, projectPrintInfo } from "../lib/jobInfo";
import { downloadPaintSubmittal } from "../lib/paintSubmittalPrint";
import {
  groupPaintItemsForPackage,
  paintPackageGaps,
  paintSchedulePackageWarning,
  productPackagePdfNote,
} from "../lib/paintPackageLink";
import { formatSubmittalNumberDisplay } from "../lib/printCore";
import { paintSubmittalFilename } from "../lib/pdfFilenames";
import { patchPaintTrackerSubmittalOrdered, paintVendorSnapshot, reloadProject, resolvePaintTracker } from "../lib/fieldTrackerProject";
import {
  addSubmittalToHistory,
  createNewSubmittalPackageDraft,
  previousIssuedHistoryEntryForRevision,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { issueSubmittalDraft, startNextRevision, submittalDraftIsLocked } from "../lib/submittalPackageActions";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { parseSpecSectionForLog } from "../lib/submittalLogHelpers";
import { listOpenBrushoutPreps, loadPaintUserSettings } from "../lib/paintUserSettings";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import type { ProjectForm } from "../types/database";
import {
  defaultPaintSubmittal,
  emptyPaintItem,
  leadSpecSection,
  normalizePaintSubmittal,
  normalizeSdsPacket,
  paintDualSpecEnabled,
  paintItemSpecScope,
  paintSpecSectionShortLabel,
  paintSubjectForType,
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

export function PaintSubmittalsPage() {
  const { user } = useAuth();
  const { branding, profile } = useLetterhead();
  const { project, projectId, setProject } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<PaintSubmittalData>(defaultPaintSubmittal());
  const [history, setHistory] = useState<SubmittalHistoryEntry[]>([]);
  const [products, setProducts] = useState<PaintProduct[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<PaintProduct[]>([]);
  const [sheens, setSheens] = useState<string[]>([]);
  const [colors, setColors] = useState<PaintColorsDb | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [startRevisionOpen, setStartRevisionOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [atticOpen, setAtticOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<PaintSubmittalData | null>(null);
  const [prepOpen, setPrepOpen] = useState(false);
  const [toolbarMenu, setToolbarMenu] = useState<"new" | "help" | null>(null);
  const [itemsMenu, setItemsMenu] = useState<"add" | "more" | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const itemsActionsRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [dragOverScope, setDragOverScope] = useState<PaintItemSpecScope | null>(null);
  const [clearItemsConfirm, setClearItemsConfirm] = useState(false);
  const [userSettings, setUserSettings] = useState<Awaited<ReturnType<typeof loadPaintUserSettings>> | null>(
    null,
  );

  const dirtyState = useMemo(() => ({ draft, history }), [draft, history]);
  const { isDirty, syncBaseline, readBaseline } = useTradeDraftDirty(dirtyState, !loading);

  const persist = useCallback(
    async (nextDraft: PaintSubmittalData, nextHistory = history) => {
      const previousItems = normalizePaintSubmittal(tradeData.paint_submittal).items;
      const snapshot = await paintVendorSnapshot(projectId);
      const paint_vendor = snapshot?.paint_vendor ?? nextDraft.paint_vendor;
      const ok = await save({
        ...tradeData,
        ...(snapshot ? { paint_tracker: snapshot.paint_tracker } : {}),
        paint_submittal: { ...nextDraft, paint_vendor },
        paint_submittal_history: nextHistory,
      });
      if (ok) {
        const nextSubmittal = { ...nextDraft, paint_vendor };
        setDraft(nextSubmittal);
        setHistory(nextHistory);
        syncBaseline({ draft: nextSubmittal, history: nextHistory });
        setError(null);
        try {
          await syncApprovedBrushoutPrimers({
            projectId,
            previous: previousItems,
            next: nextDraft.items,
            products: catalogProducts,
          });
        } catch {
          /* Paint saved. The next save retries the brush-out primer update. */
        }
        const updated = await reloadProject(projectId);
        if (updated) setProject(updated);
      }
      return ok;
    },
    [history, tradeData, save, setError, syncBaseline, projectId, setProject, catalogProducts],
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
    if (!toolbarMenu) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const menus = toolbarRef.current?.querySelectorAll(".paint-toolbar-menu");
      if (!menus) return;
      for (const menu of menus) {
        if (menu.contains(target)) return;
      }
      setToolbarMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setToolbarMenu(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolbarMenu]);

  useEffect(() => {
    if (!itemsMenu) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const anchors = itemsActionsRef.current?.querySelectorAll(".paint-items-menu-anchor");
      if (!anchors) return;
      for (const anchor of anchors) {
        if (anchor.contains(target)) return;
      }
      setItemsMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setItemsMenu(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [itemsMenu]);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const uid = user?.id ?? null;
        await loadFieldToolsPaintCatalog(true);
        const [visible, all, s, c] = await Promise.all([
          loadPaintProducts(uid),
          loadPaintProducts(uid, { includeHidden: true }),
          loadPaintSheens(uid),
          loadPaintColors(),
        ]);
        if (!cancelled) {
          setProducts(visible);
          setCatalogProducts(all);
          setSheens(s);
          setColors(c);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load paint catalogs");
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    };
    void loadCatalog();
    const onFocus = () => {
      void loadCatalog();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
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
  const previouslyOrderedItems = useMemo(() => {
    if (draft.revision_number < 1) return [];
    const entry = previousIssuedHistoryEntryForRevision(
      history,
      draft.submittal_number,
      draft.revision_number,
    );
    return (entry?.items as PaintItem[] | undefined) ?? [];
  }, [draft.revision_number, draft.submittal_number, history]);
  const showRevisionChange =
    !showPreviousColor && previouslyOrderedItems.some((item) => item.color.trim() || item.label.trim());
  const autoLabel = draft.auto_label !== false;
  const secondaryOn = paintDualSpecEnabled(draft);
  const secondaryLabel = paintSpecSectionShortLabel(draft.spec_sections?.[1] ?? "");
  const secondarySection = draft.spec_sections?.[1] ?? "";
  const leadSection = draft.spec_sections?.[0] ?? draft.spec_section;
  const itemsReadiness = useMemo(
    () => paintItemsReadiness(omitCatalogPrimerItems(draft.items, catalogProducts)),
    [draft.items, catalogProducts],
  );
  const primerStatus = useMemo(() => {
    const missing = draft.items.filter((item) => paintItemPrimerView(item, catalogProducts).missing).length;
    if (missing === 0) return { tone: "ok" as const, text: "Every item has a primer" };
    return {
      tone: "bad" as const,
      text: `${missing} ${missing === 1 ? "item" : "items"} missing a primer`,
    };
  }, [draft.items, catalogProducts]);
  const productPacket = useMemo(() => normalizeSdsPacket(tradeData.sds_packet), [tradeData.sds_packet]);
  const paintLinkGaps = useMemo(() => {
    const lead = leadSpecSection(draft);
    const secondary = draft.spec_sections?.[1]?.trim() ?? "";
    const groups = groupPaintItemsForPackage(
      draft.items,
      (item) => (paintItemSpecScope(item) === "secondary" && secondary ? secondary : lead),
      catalogProducts,
    );
    return paintPackageGaps(groups, productPacket.sections);
  }, [draft, productPacket.sections, catalogProducts]);
  const itemsStatus = useMemo(() => {
    const packageNumber = formatSubmittalNumberDisplay(productPacket.submittal_number);
    const missingFromPackage = paintLinkGaps.scheduleOnly.length;
    if (itemsReadiness.missingColor > 0) {
      const n = itemsReadiness.missingColor;
      return { tone: "warn" as const, text: `${n} missing color${n === 1 ? "" : "s"}` };
    }
    if (missingFromPackage > 0) {
      return {
        tone: "warn" as const,
        text: `${missingFromPackage} not in Package #${packageNumber}`,
        title: "Add these to a package from the Package tab",
      };
    }
    return { tone: "ok" as const, text: `Complete · all in Package #${packageNumber}` };
  }, [itemsReadiness.missingColor, paintLinkGaps.scheduleOnly.length, productPacket.submittal_number]);

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
      package_type: "Paint Brush-Outs / Color Samples" as const,
      submittal_type: t,
      subject: paintSubjectForType(t),
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

  function clearPaintItems() {
    updateDraft((d) => ({
      ...d,
      items: withMaybeAutoLabels([emptyPaintItem()], d.auto_label !== false),
    }));
    setClearItemsConfirm(false);
    setStatus("Cleared paint items. Save to keep changes.");
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
    const colorCh = paintColorColumnCh(indexedRows.map(({ item }) => item.color));
    return (
      <div
        className={`paint-items-grid${showPreviousColor ? " paint-items-grid--substitution" : ""}${
          showRevisionChange ? " paint-items-grid--revision-status" : ""
        }${
          !options.showFloor ? " paint-items-grid--no-floor" : ""
        }${dragFrom !== null && dragOverScope === options.scope ? " paint-items-grid--scope-dragover" : ""}`}
        role="table"
        aria-label={options.ariaLabel}
        style={{ "--paint-color-ch": colorCh } as CSSProperties}
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
          {options.showFloor && <span className="paint-col-head paint-col-floor">Location</span>}
          <span className="paint-col-head paint-col-color paint-col-color-head">
            Color
            <span
              className="paint-col-info"
              title="Type a name or number (SW7004 or 7004), then Enter, Tab, or search"
              aria-label="Type a name or number (SW7004 or 7004), then Enter, Tab, or search"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v6" />
                <path d="M12 8h.01" />
              </svg>
            </span>
          </span>
          {showPreviousColor && <span className="paint-col-head paint-col-prev">Previous</span>}
          <span className="paint-col-head paint-col-product">Product</span>
          <span className="paint-col-head paint-col-sheen">Sheen</span>
          {showRevisionChange && <span className="paint-col-head paint-col-rev-status">Status</span>}
          <span className="paint-col-head paint-col-head-actions" aria-hidden />
        </div>
        {indexedRows.map(({ item, index }) => (
          <PaintItemRow
            key={index}
            item={item}
            index={index}
            total={draft.items.length}
            products={products}
            catalogProducts={catalogProducts}
            sheenOptions={sheens}
            colors={colors}
            showPreviousColor={showPreviousColor}
            showFloor={options.showFloor}
            revisionChange={
              showRevisionChange ? paintRevisionChangeLabel(item, previouslyOrderedItems) : null
            }
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
    const packet = normalizeSdsPacket(tradeData.sds_packet);
    const packageWarning = paintSchedulePackageWarning(
      paintLinkGaps,
      packet.submittal_number,
      packet.sections.length > 0,
    );
    const itemNote = readiness.complete ? "" : readiness.confirmMessage.replace(/\n?Continue\?$/, "");
    const parts = [itemNote.trim(), packageWarning].filter(Boolean);
    if (!parts.length) return true;
    return window.confirm(`${parts.join("\n\n")}\n\nContinue?`);
  }

  function onImported(rows: ExtractedPaintRow[]) {
    const mapped = paintItemsFromExtractedRows(rows, products).map((item) => ({
      ...item,
      spec_scope: "primary" as const,
    }));
    updateDraft((d) => {
      const existing = dropPaintPlaceholders(d.items);
      const merged = [...existing, ...mapped];
      const items = merged.length ? merged : [emptyPaintItem()];
      return {
        ...d,
        items: withMaybeAutoLabels(items, d.auto_label !== false),
      };
    });
    setError(null);
  }

  function loadHistoryItems(items: PaintItem[], replace: boolean) {
    const mapped = items.length ? items.map((i) => ({ ...emptyPaintItem(), ...i })) : [emptyPaintItem()];
    updateDraft((d) => ({
      ...d,
      items: replace ? mapped : [...dropPaintPlaceholders(d.items), ...mapped],
    }));
    setHistoryOpen(false);
    setStatus(`Loaded ${items.length} item(s) from history. Save to keep changes.`);
  }

  function importPrepItems(items: PaintItem[], replace: boolean, link: BrushoutPrepLink) {
    const mapped = items.length ? items.map((i) => ({ ...emptyPaintItem(), ...i })) : [emptyPaintItem()];
    updateDraft((d) => ({
      ...d,
      items: replace ? mapped : [...dropPaintPlaceholders(d.items), ...mapped],
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
      await downloadPaintSubmittal(
        projectPrintInfo(project, project.jobInfo),
        draft,
        branding,
        previouslyOrderedItems,
        productPacket.sections.length ? productPackagePdfNote(productPacket.submittal_number) : undefined,
      );
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
      try {
        const parsed = parseSpecSectionForLog(draft.spec_section);
        await recordPdfLogRow(projectId, {
          submittal_type: draft.package_type,
          scope: "Paint",
          spec: parsed.spec || "099000",
          section: parsed.section || draft.spec_section,
          notes: `Paint submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
      } catch {
        /* log row optional */
      }
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
      package_type: "Paint Brush-Outs / Color Samples" as const,
      subject: paintSubjectForType("new"),
      auto_label: false,
      items: withMaybeAutoLabels([emptyPaintItem()], false),
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
      <div className="card paint-toolbar" ref={toolbarRef}>
        <div className="paint-toolbar-row">
        <div className="paint-toolbar-menu">
          <button
            type="button"
            className="btn paint-toolbar-new"
            aria-haspopup="menu"
            aria-expanded={toolbarMenu === "new"}
            onClick={() => setToolbarMenu((open) => (open === "new" ? null : "new"))}
          >
            + New
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {toolbarMenu === "new" ? (
            <div className="paint-toolbar-dropdown" role="menu">
              <button
                type="button"
                role="menuitem"
                title="Assign the next submittal number (Rev 0, draft). Does not lock or issue."
                onClick={() => {
                  setToolbarMenu(null);
                  onNewSubmittalPackage();
                }}
              >
                New submittal package
              </button>
              <button
                type="button"
                role="menuitem"
                title="Copy paint lines from a saved brush-out request into this submittal"
                onClick={() => {
                  setToolbarMenu(null);
                  setPrepOpen(true);
                }}
              >
                Import request
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolbarMenu(null);
                  setStartRevisionOpen(true);
                }}
              >
                Start revision from…
              </button>
              {!draftLocked ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={saving}
                  title="Lock this revision in history as issued"
                  onClick={() => {
                    setToolbarMenu(null);
                    void onIssueSubmittal();
                  }}
                >
                  Issue submittal
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  title="Copy this issued package into the next revision"
                  onClick={() => {
                    setToolbarMenu(null);
                    onCreateRevision();
                  }}
                >
                  Create next revision
                </button>
              )}
            </div>
          ) : null}
        </div>

        <div className="paint-toolbar-brush" aria-label="Brush-outs">
          <span className="paint-toolbar-label">Brush-outs</span>
          <div className="paint-toolbar-segment">
            <button type="button" className="btn paint-toolbar-order" onClick={() => setEmailOpen(true)}>
              Order
            </button>
            <button
              type="button"
              className={`btn paint-toolbar-ordered${draft.submittal_ordered ? " is-on" : ""}`}
              aria-pressed={Boolean(draft.submittal_ordered)}
              onClick={() => void onSubmittalOrderedChange(!Boolean(draft.submittal_ordered))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Ordered
            </button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => setAtticOpen(true)}>
            Attic stock
          </button>
        </div>

        <div className="paint-toolbar-end">
          <button type="button" className="btn btn-secondary paint-toolbar-history" onClick={() => setHistoryOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v5l3 2" />
            </svg>
            History
          </button>
          <div className="paint-toolbar-menu">
            <button
              type="button"
              className="paint-toolbar-help-btn"
              aria-label="How revisions work"
              aria-expanded={toolbarMenu === "help"}
              title="How revisions work"
              onClick={() => setToolbarMenu((open) => (open === "help" ? null : "help"))}
            >
              ?
            </button>
            {toolbarMenu === "help" ? (
              <div className="paint-toolbar-help" role="dialog" aria-label="How revisions work">
                <strong>How revisions work</strong>
                <p>
                  Added colors or a color switch after the first package was issued: use{" "}
                  <strong>Create next revision</strong> (same submittal number). It copies the list — change the
                  color on the existing row, and <strong>Add row</strong> for new colors. Do not import the whole
                  schedule again, or labels will duplicate. <strong>Download PDF</strong> on the revision is a new
                  file for the GC: the full updated list, Revision number, and your revision note. Lines are marked{" "}
                  <strong>NEW</strong>, <strong>REVISED</strong>, <strong>Removed</strong>, or <strong>No Change</strong>{" "}
                  against the previous issued package. It does not replace the first PDF they already received.{" "}
                  <strong>Order</strong> lets you check which colors to request — on a revision, new and switched
                  colors are selected; use All if you need every color again.
                </p>
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <span className="paint-toolbar-download-wrap">
            <button
              type="button"
              className="btn btn-primary paint-toolbar-download"
              onClick={() => void onDownloadPdf()}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 4v10" />
                <path d="m7 11 5 5 5-5" />
                <path d="M5 19h14" />
              </svg>
              Download PDF
            </button>
            <span className="paint-toolbar-download-tip" role="tooltip">
              {submittalPdfFilename}
            </span>
          </span>
        </div>
        </div>
        {draft.brushout_prep?.prep_id ? (
          <p className="paint-toolbar-filename">
            <span className="muted small">
              Linked prep: {draft.brushout_prep.prep_id}
              {draft.brushout_prep.site_location ? ` · ${draft.brushout_prep.site_location}` : ""}
            </span>
          </p>
        ) : null}
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      {draftLocked && (
        <div className="banner banner-warn">
          This revision is <strong>{draft.issue_status.replace(/_/g, " ")}</strong>. Create a new revision to
          change items, or update issue status below.
        </div>
      )}

      <PaintSubmittalMetaPanel
        draft={draft}
        draftLocked={draftLocked}
        onSubmittalNumberChange={(submittal_number) => setDraft({ ...draft, submittal_number })}
        onIssueStatusChange={(issue_status) => setDraft({ ...draft, issue_status })}
        onDateChange={(date) => setDraft({ ...draft, date })}
        onTypeChange={setType}
        onSubjectChange={(subject) => setDraft({ ...draft, subject })}
        onSpecSectionsChange={updateDraft}
        onRevisionNoteChange={(revision_note) => setDraft({ ...draft, revision_note })}
        onCreateNextRevision={draftLocked ? onCreateRevision : undefined}
      />

      <PaintImageImport onImported={onImported}>
        {(zone) => (
      <section
        className={`card stack paint-items-section${zone.dragOver ? " paint-items-section--drop" : ""}`}
        onDragOver={zone.onDragOver}
        onDragLeave={zone.onDragLeave}
        onDrop={zone.onDrop}
      >
        <div className="row-between paint-items-toolbar">
          <div className="paint-items-title">
            <h3>Paint items ({draft.items.length})</h3>
            <p className={`paint-items-status paint-items-status--${primerStatus.tone}`}>{primerStatus.text}</p>
            <p
              className={`paint-items-status paint-items-status--${itemsStatus.tone}`}
              title={"title" in itemsStatus ? itemsStatus.title : undefined}
            >
              {itemsStatus.tone === "ok" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="m8 12 2.5 2.5L16 9" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="M10.3 4.8 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0z" />
                </svg>
              )}
              {itemsStatus.text}
            </p>
            {draft.items.some((item) => item.pdf_hidden) ? (
              <p className="muted small paint-items-pdf-note">
                {draft.items.filter((item) => item.pdf_hidden).length} hidden from the PDF
              </p>
            ) : null}
          </div>
          <div className="paint-items-toolbar-actions" ref={itemsActionsRef}>
            <button
              type="button"
              className={`paint-toggle-btn${draft.show_floor === true ? " is-on" : ""}`}
              aria-pressed={draft.show_floor === true}
              title={secondaryOn ? "Location column on the primary table" : "Show the location column"}
              onClick={() => setDraft({ ...draft, show_floor: draft.show_floor !== true })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              Location
            </button>
            <button
              type="button"
              className={`paint-toggle-btn${autoLabel ? " is-on" : ""}`}
              aria-pressed={autoLabel}
              title="Label rows in order"
              onClick={() => {
                const enabled = !autoLabel;
                updateDraft((d) => ({
                  ...d,
                  auto_label: enabled,
                  items: enabled ? applyPaintAutoLabels(d.items) : d.items,
                }));
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M8 6h13M8 12h13M8 18h13" />
                <path d="M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
              Auto-label
            </button>
            <span className="paint-items-actions-rule" aria-hidden />
            <button
              type="button"
              className="btn btn-secondary paint-items-action-btn paint-import-schedule-btn"
              title={zone.error ?? "Paste (Ctrl+V), drop an image, or choose a file"}
              onClick={() => (zone.importing ? zone.cancelImport() : zone.openFilePicker())}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 8V5h4" />
                <path d="M16 5h4v3" />
                <path d="M20 16v3h-4" />
                <path d="M8 19H4v-3" />
                <path d="M7 12h10" />
              </svg>
              {zone.importing ? "Reading…" : "Import schedule"}
            </button>
            {!secondaryOn && (
              <div className="paint-items-menu-anchor paint-split-btn">
                <button
                  type="button"
                  className="btn btn-secondary paint-items-action-btn paint-split-btn-main"
                  onClick={() => addPaintRow("primary")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add row
                </button>
                <button
                  type="button"
                  className="btn btn-secondary paint-items-action-btn paint-split-btn-caret"
                  aria-label="Add row options"
                  aria-haspopup="menu"
                  aria-expanded={itemsMenu === "add"}
                  onClick={() => setItemsMenu((open) => (open === "add" ? null : "add"))}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {itemsMenu === "add" ? (
                  <div className="paint-items-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setItemsMenu(null);
                        addPaintRow("primary");
                      }}
                    >
                      Add row
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={catalogLoading}
                      onClick={() => {
                        setItemsMenu(null);
                        setBulkOpen(true);
                      }}
                    >
                      Add multiple…
                    </button>
                  </div>
                ) : null}
              </div>
            )}
            <div className="paint-items-menu-anchor">
              <button
                type="button"
                className="btn btn-secondary paint-items-action-btn paint-items-more-btn"
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={itemsMenu === "more"}
                onClick={() => setItemsMenu((open) => (open === "more" ? null : "more"))}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>
              {itemsMenu === "more" ? (
                <div className="paint-items-menu paint-items-menu--end" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="paint-items-menu-danger"
                    disabled={!dropPaintPlaceholders(draft.items).length}
                    onClick={() => {
                      setItemsMenu(null);
                      setClearItemsConfirm(true);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                    Clear all rows
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {clearItemsConfirm ? (
          <div className="sds-clear-confirm" role="alert">
            <span>
              Remove all {dropPaintPlaceholders(draft.items).length} paint items?
            </span>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setClearItemsConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-small sds-clear-confirm-go" onClick={clearPaintItems}>
              Clear all
            </button>
          </div>
        ) : null}

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
                  <p className="muted small">{secondaryIndexed.length} line(s) · no location column</p>
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

      </section>
        )}
      </PaintImageImport>

      {bulkOpen && (
        <PaintBulkAddModal
          products={products}
          sheenOptions={sheens}
          autoLabel={autoLabel}
          nextAutoLabelIndex={dropPaintPlaceholders(draft.items).length}
          onAdd={(items, opts) =>
            updateDraft((d) => {
              const kept = dropPaintPlaceholders(d.items);
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

      {atticOpen && userSettings && (
        <AtticStockOrderModal
          projectId={projectId}
          jobNumber={project.job_number}
          jobName={project.job_name}
          items={draft.items}
          vendors={userSettings.vendors}
          signature={userSettings.signature}
          logoUrl={branding.logoUrl}
          composeEmailMethod={userSettings.compose_email_method}
          createdBy={user?.id}
          createdByName={profile.name}
          onOrdered={(message) => {
            setStatus(message);
            setError(null);
          }}
          onClose={() => setAtticOpen(false)}
        />
      )}

      {emailOpen && userSettings && (
        <EmailVendorModal
          jobNumber={project.job_number}
          jobName={project.job_name}
          items={omitCatalogPrimerItems((emailDraft ?? draft).items, catalogProducts)}
          submittalType={(emailDraft ?? draft).submittal_type}
          vendors={userSettings.vendors}
          defaultQty={userSettings.default_brushout_qty}
          signature={userSettings.signature}
          logoUrl={branding.logoUrl}
          superName={gcSuperintendentContact(project.jobInfo).name}
          superEmail={gcSuperEmail(project.jobInfo)}
          superRoleLabel="GC super"
          staffSuperName={icbiSuperintendent(project.jobInfo)}
          staffSuperEmail={icbiSuperEmail(project.jobInfo)}
          staffSuperRoleLabel="Super"
          foremanName={project.jobInfo?.icbi_foreman}
          foremanEmail={project.jobInfo?.icbi_foreman_email}
          composeEmailMethod={userSettings.compose_email_method}
          previouslyOrderedItems={omitCatalogPrimerItems(previouslyOrderedItems, catalogProducts)}
          includeItemFloor={draft.show_floor === true}
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
