import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { CreateRevisedSubmittalModal } from "../components/submittals/CreateRevisedSubmittalModal";
import { DateInput } from "../components/DateInput";
import { EmailVendorModal } from "../components/paint/EmailVendorModal";
import { ImportBrushoutPrepModal } from "../components/paint/ImportBrushoutPrepModal";
import { PaintBulkAddModal } from "../components/paint/PaintBulkAddModal";
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
import { copyBrushoutsRow, sendToBrushoutsTracker } from "../lib/paintBrushouts";
import type { ExtractedPaintRow } from "../lib/paintImageImport";
import { printPaintSubmittal } from "../lib/paintSubmittalPrint";
import { syncSubmittalOrderedToSheets } from "../lib/paintSheetsSync";
import {
  addSubmittalToHistory,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { queuePendingItem } from "../lib/transmittalHelpers";
import { listOpenBrushoutPreps, loadPaintUserSettings } from "../lib/paintUserSettings";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultPaintSubmittal,
  defaultTransmittal,
  emptyPaintItem,
  PAINT_SUBMITTAL_TYPES,
  PAINT_VENDOR_OPTIONS,
  paintSubjectForType,
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
  const [revisedOpen, setRevisedOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<PaintSubmittalData | null>(null);
  const [prepOpen, setPrepOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [brushoutsBusy, setBrushoutsBusy] = useState(false);
  const [userSettings, setUserSettings] = useState<Awaited<ReturnType<typeof loadPaintUserSettings>> | null>(
    null,
  );

  useEffect(() => {
    if (!loading) {
      setDraft(tradeData.paint_submittal ?? defaultPaintSubmittal());
      setHistory(tradeData.paint_submittal_history ?? []);
    }
  }, [loading, tradeData.paint_submittal, tradeData.paint_submittal_history]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [p, s, c] = await Promise.all([loadPaintProducts(), loadPaintSheens(), loadPaintColors()]);
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
  }, [setError]);

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
  const paintVendor = draft.paint_vendor ?? "PPG";

  async function persist(nextDraft: PaintSubmittalData, nextHistory = history) {
    const ok = await save({
      ...tradeData,
      paint_submittal: nextDraft,
      paint_submittal_history: nextHistory,
    });
    if (ok) {
      setDraft(nextDraft);
      setHistory(nextHistory);
      setError(null);
    }
    return ok;
  }

  function setType(t: TradeSubmittalType) {
    setDraft((d) => ({ ...d, submittal_type: t, subject: paintSubjectForType(t) }));
  }

  function patchItem(index: number, patch: Partial<PaintItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function onImported(rows: ExtractedPaintRow[], mode: "replace" | "append") {
    const mapped: PaintItem[] = rows.map((r) => ({
      label: r.label,
      floor: r.floor,
      manufacturer: r.manufacturer,
      color: r.color,
      product: r.product,
      sheen: r.sheen,
      previous_color: "",
    }));
    setDraft((d) => ({
      ...d,
      items:
        mode === "append"
          ? [...d.items.filter((i) => i.label || i.color || i.product), ...mapped]
          : mapped.length
            ? mapped
            : [emptyPaintItem()],
    }));
    setError(null);
  }

  function loadHistoryItems(items: PaintItem[], replace: boolean) {
    const mapped = items.length ? items.map((i) => ({ ...emptyPaintItem(), ...i })) : [emptyPaintItem()];
    setDraft((d) => ({
      ...d,
      items: replace ? mapped : [...d.items.filter((i) => i.label || i.color || i.product), ...mapped],
    }));
    setHistoryOpen(false);
    setStatus(`Loaded ${items.length} item(s) from history. Save to keep changes.`);
  }

  function importPrepItems(items: PaintItem[], replace: boolean, link: BrushoutPrepLink) {
    const mapped = items.length ? items.map((i) => ({ ...emptyPaintItem(), ...i })) : [emptyPaintItem()];
    setDraft((d) => ({
      ...d,
      items: replace ? mapped : [...d.items.filter((i) => i.label || i.color || i.product), ...mapped],
      brushout_prep: link,
    }));
    setStatus(`Imported ${items.length} line(s) from prep ${link.prep_id}. Save to keep changes.`);
  }

  async function onSave() {
    await persist(draft, history);
  }

  async function onPrint() {
    try {
      printPaintSubmittal(
        {
          job_number: project.job_number,
          job_name: project.job_name,
          job_address: project.job_address ?? "",
        },
        draft,
        branding,
      );
      const nextHistory = addSubmittalToHistory(
        history,
        draft.submittal_number,
        draft.items,
        draft.submittal_type,
        "paint",
      );
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const row = await recordPdfLogRow(projectId, {
          submittal_type: "Color Samples",
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
      const transmittal = queuePendingItem(tradeData.transmittal ?? defaultTransmittal(), {
        submittal_type: "Color Samples",
        scope: "Paint",
        source: "paint_submittal",
        trade_submittal_number: String(draft.submittal_number),
        log_row_id: logRowId,
      });
      await save({
        ...tradeData,
        paint_submittal: draft,
        paint_submittal_history: nextHistory,
        transmittal,
      });
      setStatus(`Submittal #${draft.submittal_number} saved to history.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
    }
  }

  async function onCopyBrushouts() {
    try {
      const count = await copyBrushoutsRow(
        project.job_number,
        project.job_name,
        paintVendor,
        draft.items,
      );
      setStatus(`BrushOuts row copied (${count} color(s)). Paste into columns A–D+ in the sheet.`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed");
    }
  }

  async function onAddBrushouts() {
    if (!project.job_number.trim() || !project.job_name.trim()) {
      setError("Job number and job name are required.");
      return;
    }
    setBrushoutsBusy(true);
    try {
      await sendToBrushoutsTracker(
        userSettings?.google_urls.brushouts_tracker,
        project.job_number,
        project.job_name,
        paintVendor,
        draft.items,
      );
      setStatus("Paint data sent to BrushOuts tracker.");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "BrushOuts send failed");
    } finally {
      setBrushoutsBusy(false);
    }
  }

  async function onSubmittalOrderedChange(checked: boolean) {
    const next = { ...draft, submittal_ordered: checked };
    setDraft(next);
    const ok = await persist(next, history);
    if (!ok) return;
    const sheetsUrl =
      userSettings?.google_urls.job_manager ?? userSettings?.google_urls.paint_tracker;
    if (sheetsUrl && project.job_number.trim()) {
      const syncErr = await syncSubmittalOrderedToSheets(sheetsUrl, project.job_number, checked);
      if (syncErr) setStatus(`Saved locally. Sheets sync: ${syncErr}`);
      else setStatus(checked ? "Submittal marked ordered (Paint Tracker updated)." : "Submittal ordered cleared.");
    }
  }

  async function onDeleteHistory(submittalNumber: number) {
    const nextHistory = removeSubmittalFromHistory(history, submittalNumber);
    setHistory(nextHistory);
    await persist(draft, nextHistory);
    setStatus(`Removed submittal #${submittalNumber} from history.`);
  }

  async function onEmailSent() {
    const next = { ...draft, submittal_ordered: true };
    setDraft(next);
    await persist(next, history);
    const sheetsUrl =
      userSettings?.google_urls.job_manager ?? userSettings?.google_urls.paint_tracker;
    if (sheetsUrl && project.job_number.trim()) {
      await syncSubmittalOrderedToSheets(sheetsUrl, project.job_number, true);
    }
    setEmailOpen(false);
  }

  if (loading) return <p className="muted">Loading paint submittal…</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Paint submittals</h2>
          <p className="muted small">Product, sheen, color lookup, BrushOuts, vendor email, and submittal history.</p>
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary" onClick={() => setRevisedOpen(true)}>
            Create revised submittal
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onPrint()}>
            Submittal PDF
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card row-gap wrap paint-action-row">
        <button
          type="button"
          className="btn btn-warning"
          disabled={brushoutsBusy}
          onClick={() => void onAddBrushouts()}
        >
          {brushoutsBusy ? "Sending…" : "Add BrushOuts"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void onCopyBrushouts()}>
          Copy
        </button>
        <label className="paint-vendor-select">
          Paint vendor
          <select
            value={paintVendor}
            onChange={(e) => setDraft((d) => ({ ...d, paint_vendor: e.target.value }))}
          >
            {PAINT_VENDOR_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {draft.brushout_prep?.prep_id && (
          <span className="muted small">
            Linked prep: {draft.brushout_prep.prep_id}
            {draft.brushout_prep.site_location ? ` · ${draft.brushout_prep.site_location}` : ""}
          </span>
        )}
      </section>

      <section className="card stack">
        <div className="grid-3">
          <label>
            Submittal #
            <input
              type="number"
              min={1}
              value={draft.submittal_number}
              onChange={(e) => setDraft({ ...draft, submittal_number: Number(e.target.value) || 1 })}
            />
          </label>
          <label>
            Type
            <select
              value={draft.submittal_type}
              onChange={(e) => setType(e.target.value as TradeSubmittalType)}
            >
              {PAINT_SUBMITTAL_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <DateInput value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
          </label>
        </div>
        <label>
          Subject
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </label>
      </section>

      <PaintImageImport onImported={onImported} />

      <section className="card stack paint-items-section">
        <div className="row-between paint-items-toolbar">
          <div>
            <h3>Paint items</h3>
            <p className="muted small paint-lookup-hint">
              Color lookup: type a color number and press <kbd>Enter</kbd> or <kbd>Tab</kbd> to look up and
              fill the name.
            </p>
          </div>
          <div className="paint-add-buttons">
            <button
              type="button"
              className="btn btn-icon btn-primary"
              title="Add row"
              onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyPaintItem()] }))}
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

        {catalogLoading && <p className="muted small">Loading color catalog…</p>}

        <div
          className={`paint-items-grid${showPreviousColor ? " paint-items-grid--substitution" : ""}`}
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
              productOptions={productOptions}
              sheenOptions={sheens}
              colors={colors}
              showPreviousColor={showPreviousColor}
              onChange={(patch) => patchItem(index, patch)}
              onMoveUp={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                setDraft((d) => ({
                  ...d,
                  items: d.items.length > 1 ? d.items.filter((_, i) => i !== index) : d.items,
                }))
              }
            />
          ))}
        </div>
      </section>

      <section className="card row-between wrap paint-bottom-actions">
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary" onClick={() => setEmailOpen(true)}>
            Email vendor
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setPrepOpen(true)}>
            Import brush-out prep…
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
            Submittal history…
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(draft.submittal_ordered)}
            onChange={(e) => void onSubmittalOrderedChange(e.target.checked)}
          />
          Submittal ordered
        </label>
      </section>

      {bulkOpen && (
        <PaintBulkAddModal
          productOptions={productOptions}
          sheenOptions={sheens}
          onAdd={(items) =>
            setDraft((d) => ({
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
          onDelete={(n) => void onDeleteHistory(n)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {revisedOpen && (
        <CreateRevisedSubmittalModal
          scope="paint"
          projectId={projectId}
          project={{
            job_number: project.job_number,
            job_name: project.job_name,
            job_address: project.job_address ?? "",
          }}
          history={history}
          branding={branding}
          paintCatalog={{ products, productOptions, sheenOptions: sheens, colors }}
          onEmailVendor={(d) => {
            setEmailDraft(d);
            setEmailOpen(true);
          }}
          onClose={() => setRevisedOpen(false)}
          onCreated={({ draft: revisedDraft, history: nextHistory }) => {
            void persist(revisedDraft as PaintSubmittalData, nextHistory);
            setRevisedOpen(false);
            setStatus(`Revised submittal #${revisedDraft.submittal_number} saved.`);
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
          fromEmail={branding.signerEmail}
          jobSuper={project.jobInfo?.gc_superintendent}
          onClose={() => {
            setEmailOpen(false);
            setEmailDraft(null);
          }}
          onSent={() => void onEmailSent()}
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
