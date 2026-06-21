import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { CreateRevisedSubmittalModal } from "../components/submittals/CreateRevisedSubmittalModal";
import { DateInput } from "../components/DateInput";
import { SubmittalHistoryModal } from "../components/paint/SubmittalHistoryModal";
import { WallcoveringBulkAddModal } from "../components/wallcovering/WallcoveringBulkAddModal";
import { WallcoveringItemRow } from "../components/wallcovering/WallcoveringItemRow";
import { useLetterhead } from "../contexts/LetterheadContext";
import {
  addSubmittalToHistory,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { queuePendingItem } from "../lib/transmittalHelpers";
import { buildWcTrackerLinesFromSubmittal, saveWcTrackerLines } from "../lib/fieldTrackerProject";
import { applyGotTrackToggle, detectGotTrack } from "../lib/wcTrackInfill";
import {
  applyTransmittalContractIfDistinct,
  hasDistinctWcContract,
  wcPrintInfo,
  wcTrackerJobLabel,
} from "../lib/jobInfo";
import { printWallcoveringSubmittal } from "../lib/wallcoveringSubmittalPrint";
import { wallcoveringSubmittalFilename } from "../lib/pdfFilenames";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultTransmittal,
  defaultWallcoveringSubmittal,
  emptyWallcoveringItem,
  WALLCOVERING_SUBMITTAL_TYPES,
  wcSubjectForType,
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
  const items = (raw.items ?? [emptyWallcoveringItem()]).map((i) => ({
    ...emptyWallcoveringItem(),
    ...i,
    order: i.order ?? false,
  }));
  return {
    ...defaultWallcoveringSubmittal(),
    ...raw,
    items,
    got_track: raw.got_track ?? detectGotTrack(items),
  };
}

export function WallcoveringSubmittalsPage() {
  const { branding } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<WallcoveringSubmittalData>(defaultWallcoveringSubmittal());
  const [history, setHistory] = useState<SubmittalHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisedOpen, setRevisedOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [trackerBusy, setTrackerBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      setDraft(
        normalizeWcDraft(tradeData.wallcovering_submittal ?? defaultWallcoveringSubmittal()),
      );
      setHistory(tradeData.wallcovering_submittal_history ?? []);
    }
  }, [loading, tradeData.wallcovering_submittal, tradeData.wallcovering_submittal_history]);

  const showPreviousColor = draft.submittal_type === "substitution";
  const wcPrint = useMemo(() => wcPrintInfo(project, project.jobInfo), [project]);

  async function persist(nextDraft: WallcoveringSubmittalData, nextHistory = history) {
    const ok = await save({
      ...tradeData,
      wallcovering_submittal: nextDraft,
      wallcovering_submittal_history: nextHistory,
    });
    if (ok) {
      setDraft(nextDraft);
      setHistory(nextHistory);
      setError(null);
    }
    return ok;
  }

  function setType(t: TradeSubmittalType) {
    setDraft((d) => ({ ...d, submittal_type: t, subject: wcSubjectForType(t) }));
  }

  function patchItem(index: number, patch: Partial<WallcoveringItem>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function onGotTrackChange(checked: boolean) {
    setDraft((d) => ({
      ...d,
      got_track: checked,
      items: applyGotTrackToggle(d.items, checked),
    }));
  }

  function loadHistoryItems(items: WallcoveringItem[], replace: boolean) {
    const mapped = items.length
      ? items.map((i) => ({ ...emptyWallcoveringItem(), ...i, order: i.order ?? false }))
      : [emptyWallcoveringItem()];
    setDraft((d) => ({
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

  async function onPrint() {
    try {
      printWallcoveringSubmittal(wcPrint, draft, branding);
      const nextHistory = addSubmittalToHistory(
        history,
        draft.submittal_number,
        draft.items,
        draft.submittal_type,
        "wallcovering",
      );
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const row = await recordPdfLogRow(projectId, {
          submittal_type: "Color Samples",
          scope: "Wallcovering",
          spec: "096000",
          notes: `Wallcovering submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* log row optional */
      }
      let transmittal = queuePendingItem(tradeData.transmittal ?? defaultTransmittal(), {
        submittal_type: "Color Samples",
        scope: "Wallcovering",
        source: "wallcovering_submittal",
        trade_submittal_number: String(draft.submittal_number),
        log_row_id: logRowId,
      });
      transmittal = applyTransmittalContractIfDistinct(project, transmittal, "wallcovering");
      await save({
        ...tradeData,
        wallcovering_submittal: draft,
        wallcovering_submittal_history: nextHistory,
        transmittal,
      });
      setStatus(`Submittal #${draft.submittal_number} saved to history.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Print failed");
    }
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

  async function onDeleteHistory(submittalNumber: number) {
    const nextHistory = removeSubmittalFromHistory(history, submittalNumber);
    setHistory(nextHistory);
    await persist(draft, nextHistory);
    setStatus(`Removed submittal #${submittalNumber} from history.`);
  }

  const submittalPdfFilename = useMemo(
    () =>
      wallcoveringSubmittalFilename(
        wcPrint.job_name,
        wcPrint.job_number,
        draft.submittal_number,
        draft.submittal_type,
      ),
    [wcPrint.job_name, wcPrint.job_number, draft.submittal_number, draft.submittal_type],
  );

  if (loading) return <p className="muted">Loading wallcovering submittal…</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Wallcovering submittals</h2>
          <p className="muted small">
            Wallcovering submittals, tracker sync, and history. Material orders →{" "}
            <Link to={`/projects/${projectId}/orders`}>Orders</Link>.
            {hasDistinctWcContract(project) && (
              <> Contract: {wcTrackerJobLabel(project)}.</>
            )}
          </p>
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

      <p className="sds-filename-preview muted small">
        PDF filename: <code>{submittalPdfFilename}</code>
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card wc-action-bar">
        <div className="wc-main-buttons row-gap wrap">
          <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
            Submittal history…
          </button>
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
              {WALLCOVERING_SUBMITTAL_TYPES.map((t) => (
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

      <section className="card stack wc-items-section">
        <div className="row-between wc-items-toolbar">
          <h3 className="muted small">Wallcovering items</h3>
          <div className="row-gap wrap">
            <label className="check wc-got-track">
              <input
                type="checkbox"
                checked={Boolean(draft.got_track)}
                onChange={(e) => onGotTrackChange(e.target.checked)}
              />
              Got Track?
            </label>
            <div className="paint-add-buttons">
              <button
                type="button"
                className="btn btn-icon btn-primary"
                title="Add row"
                onClick={() => setDraft((d) => ({ ...d, items: [...d.items, emptyWallcoveringItem()] }))}
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-icon btn-primary"
                title="Add multiple rows"
                onClick={() => setBulkOpen(true)}
              >
                ++
              </button>
            </div>
          </div>
        </div>

        <div className="wc-items-list">
          {draft.items.map((item, index) => (
            <WallcoveringItemRow
              key={index}
              item={item}
              index={index}
              total={draft.items.length}
              showPreviousColor={showPreviousColor}
              onChange={(patch) => patchItem(index, patch)}
              onMoveUp={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                setDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                setDraft((d) => {
                  const nextItems =
                    d.items.length > 1 ? d.items.filter((_, i) => i !== index) : d.items;
                  return {
                    ...d,
                    items: nextItems,
                    got_track: detectGotTrack(nextItems),
                  };
                })
              }
            />
          ))}
        </div>
      </section>

      {bulkOpen && (
        <WallcoveringBulkAddModal
          onAdd={(items) =>
            setDraft((d) => ({
              ...d,
              items: [
                ...d.items.filter((i) => i.label || i.color || i.manufacturer || i.product),
                ...items,
              ],
              got_track: detectGotTrack([...d.items, ...items]),
            }))
          }
          onClose={() => setBulkOpen(false)}
        />
      )}

      {historyOpen && (
        <SubmittalHistoryModal
          scope="wallcovering"
          jobNumber={wcJobNumber}
          jobName={wcJobName}
          history={history}
          onLoadWallcovering={loadHistoryItems}
          onDelete={(n) => void onDeleteHistory(n)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {revisedOpen && (
        <CreateRevisedSubmittalModal
          scope="wallcovering"
          projectId={projectId}
          project={{
            job_number: project.job_number,
            job_name: project.job_name,
            job_address: project.job_address ?? "",
            job_address2: project.job_address2 ?? "",
            jobInfo: project.jobInfo,
          }}
          history={history}
          branding={branding}
          onClose={() => setRevisedOpen(false)}
          onCreated={({ draft: revisedDraft, history: nextHistory }) => {
            void persist(normalizeWcDraft(revisedDraft as WallcoveringSubmittalData), nextHistory);
            setRevisedOpen(false);
            setStatus(`Revised submittal #${revisedDraft.submittal_number} saved.`);
          }}
        />
      )}
    </div>
  );
}
