import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
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
  getProductDisplayList,
  loadPaintColors,
  loadPaintProducts,
  loadPaintSheens,
  type PaintColorsDb,
  type PaintProduct,
} from "../lib/paintCatalog";
import type { ExtractedPaintRow } from "../lib/paintImageImport";
import { applyTransmittalContractIfDistinct, projectPrintInfo } from "../lib/jobInfo";
import { downloadPaintSubmittal } from "../lib/paintSubmittalPrint";
import { paintSubmittalFilename } from "../lib/pdfFilenames";
import { patchPaintTrackerSubmittalOrdered } from "../lib/fieldTrackerProject";
import {
  addSubmittalToHistory,
  createNewSubmittalPackageDraft,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { issueSubmittalDraft, startNextRevision, submittalDraftIsLocked } from "../lib/submittalPackageActions";
import { recordPdfLogRow } from "../lib/submittalLogService";
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
  PAINT_PACKAGE_TYPE_OPTIONS,
  paintSubjectForPackage,
  type BrushoutPrepLink,
  type PaintItem,
  type PaintSubmittalData,
  type SubmittalHistoryEntry,
  type TradeSubmittalType,
} from "../types/tradeDocuments";

type Ctx = { project: ProjectForm; projectId: string };

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
  const { project, projectId } = useOutletContext<Ctx>();
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
  const [userSettings, setUserSettings] = useState<Awaited<ReturnType<typeof loadPaintUserSettings>> | null>(
    null,
  );

  const dirtyState = useMemo(() => ({ draft, history }), [draft, history]);
  const { isDirty, syncBaseline, readBaseline } = useTradeDraftDirty(dirtyState, !loading);

  const persist = useCallback(
    async (nextDraft: PaintSubmittalData, nextHistory = history) => {
      const ok = await save({
        ...tradeData,
        paint_submittal: nextDraft,
        paint_submittal_history: nextHistory,
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
    sectionLabel: "Paint submittals",
    isDirty,
    onSave: () => persist(draft, history),
    onDiscard: onDiscardUnsaved,
  });

  useEffect(() => {
    if (!loading) {
      const d = normalizePaintSubmittal(tradeData.paint_submittal);
      const h = tradeData.paint_submittal_history ?? [];
      setDraft(d);
      setHistory(h);
      syncBaseline({ draft: d, history: h });
    }
  }, [loading, tradeData.paint_submittal, tradeData.paint_submittal_history, syncBaseline]);

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

  const productOptions = useMemo(() => getProductDisplayList(products, "PPG"), [products]);
  const openPreps = useMemo(
    () => listOpenBrushoutPreps(userSettings?.brushout_preps ?? []),
    [userSettings?.brushout_preps],
  );
  const showPreviousColor = draft.submittal_type === "substitution";
  const draftLocked = submittalDraftIsLocked(draft);

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

  function patchItem(index: number, patch: Partial<PaintItem>) {
    updateDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
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
          },
        );
      }
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const row = await recordPdfLogRow(projectId, {
          submittal_type: draft.package_type,
          scope: "Paint",
          spec: "099000",
          notes: `Paint submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* log row optional */
      }
      let transmittal = queuePendingItem(tradeData.transmittal ?? defaultTransmittal(), {
        submittal_type: draft.package_type,
        scope: "Paint",
        source: "paint_submittal",
        trade_submittal_number: String(draft.submittal_number),
        log_row_id: logRowId,
      });
      transmittal = applyTransmittalContractIfDistinct(project, transmittal, "paint");
      await save({
        ...tradeData,
        paint_submittal: draft,
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
    } else {
      setStatus(checked ? "Submittal marked ordered." : "Submittal ordered cleared.");
    }
  }

  async function onIssueSubmittal() {
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
    setDraft({
      ...createNewSubmittalPackageDraft(draft, history),
      submittal_type: "new",
      subject: paintSubjectForPackage(draft.package_type, "new"),
      items: [emptyPaintItem()],
    });
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
      ),
    [project.job_name, project.job_number, draft.submittal_number, draft.submittal_type],
  );

  if (loading) return <p className="muted">Loading paint submittal…</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Paint submittals</h2>
          <p className="muted small">Product, sheen, color lookup, vendor email, and submittal history.</p>
        </div>
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

      <section className="card paint-action-row">
        <button type="button" className="btn btn-secondary" onClick={() => setEmailOpen(true)}>
          Email vendor
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

      <PaintImageImport onImported={onImported} layout="row" />

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
        onRevisionNoteChange={(revision_note) => setDraft({ ...draft, revision_note })}
        onCreateNextRevision={draftLocked ? onCreateRevision : undefined}
      />

      <section className="card stack paint-items-section">
        <div className="row-between paint-items-toolbar">
          <div>
            <h3>Paint items</h3>
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
            </label>
            <div className="paint-add-buttons">
              <button
                type="button"
                className="btn btn-icon btn-primary"
                title="Add row"
                onClick={() =>
                  updateDraft((d) => ({ ...d, items: [...d.items, emptyPaintItem()] }))
                }
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-icon btn-primary"
                title="Add multiple rows"
                disabled={catalogLoading}
                onClick={() => setBulkOpen(true)}
              >
                ++
              </button>
            </div>
          </div>
        </div>

        {catalogLoading && <p className="muted small">Loading color catalog…</p>}

        <div
          className={`paint-items-grid${showPreviousColor ? " paint-items-grid--substitution" : ""}${draft.show_floor !== true ? " paint-items-grid--no-floor" : ""}`}
          role="table"
          aria-label="Paint items"
        >
          {draft.items.map((item, index) => (
            <PaintItemRow
              key={index}
              item={item}
              index={index}
              total={draft.items.length}
              products={products}
              sheenOptions={sheens}
              colors={colors}
              showPreviousColor={showPreviousColor}
              showFloor={draft.show_floor === true}
              onChange={(patch) => patchItem(index, patch)}
              onMoveUp={() =>
                updateDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                updateDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                updateDraft((d) => ({
                  ...d,
                  items: d.items.length > 1 ? d.items.filter((_, i) => i !== index) : d.items,
                }))
              }
            />
          ))}
        </div>
      </section>

      {bulkOpen && (
        <PaintBulkAddModal
          products={products}
          productOptions={productOptions}
          sheenOptions={sheens}
          onAdd={(items) =>
            updateDraft((d) => ({
              ...d,
              items: [...d.items.filter((i) => i.label || i.color || i.product), ...items],
            }))
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
            setDraft(revisedDraft as PaintSubmittalData);
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
          superEmails={userSettings.super_emails}
          defaultQty={userSettings.default_brushout_qty}
          signature={userSettings.signature}
          logoUrl={branding.logoUrl}
          jobSuper={project.jobInfo?.gc_superintendent}
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
