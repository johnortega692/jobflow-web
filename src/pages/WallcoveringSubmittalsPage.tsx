import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { StartRevisionFromHistoryModal } from "../components/submittals/StartRevisionFromHistoryModal";
import { RevisionNoteField } from "../components/submittals/RevisionNoteField";
import { SubmittalPackageTypeSelect } from "../components/submittals/SubmittalPackageTypeSelect";
import { SubmittalRevisionField } from "../components/submittals/SubmittalRevisionField";
import { applySubmittalEdit } from "../lib/submittalDraftGuard";
import { DateInput } from "../components/DateInput";
import { SubmittalHistoryModal } from "../components/paint/SubmittalHistoryModal";
import { WallcoveringBulkAddModal } from "../components/wallcovering/WallcoveringBulkAddModal";
import { WallcoveringItemRow } from "../components/wallcovering/WallcoveringItemRow";
import { useLetterhead } from "../contexts/LetterheadContext";
import { SubmittalIssueStatusSelect } from "../components/submittals/SubmittalIssueStatusSelect";
import {
  addSubmittalToHistory,
  createNewSubmittalPackageDraft,
  removeSubmittalFromHistory,
} from "../lib/submittalHistory";
import { issueSubmittalDraft, startNextRevision, submittalDraftIsLocked } from "../lib/submittalPackageActions";
import { recordPdfLogRow } from "../lib/submittalLogService";
import { queuePendingItem } from "../lib/transmittalHelpers";
import { buildWcTrackerLinesFromSubmittal, saveWcTrackerLines, syncWcSubmittalOrdered } from "../lib/fieldTrackerProject";
import { applyGotTrackToggle, detectGotTrack } from "../lib/wcTrackInfill";
import {
  applyTransmittalContractIfDistinct,
  hasDistinctWcContract,
  wcPrintInfo,
  wcTrackerJobLabel,
} from "../lib/jobInfo";
import { downloadWallcoveringSubmittal } from "../lib/wallcoveringSubmittalPrint";
import { wallcoveringSubmittalFilename } from "../lib/pdfFilenames";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import type { ProjectForm } from "../types/database";
import {
  defaultTransmittal,
  defaultWallcoveringSubmittal,
  emptyWallcoveringItem,
  normalizeWallcoveringSubmittal,
  WALLCOVERING_PACKAGE_TYPE_OPTIONS,
  WALLCOVERING_SUBMITTAL_TYPES,
  wcSubjectForPackage,
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
  const items = normalized.items.map((i) => ({ ...i, order: i.order ?? false }));
  return {
    ...normalized,
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
  const [startRevisionOpen, setStartRevisionOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [trackerBusy, setTrackerBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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

  const showPreviousColor = draft.submittal_type === "substitution";
  const wcPrint = useMemo(() => wcPrintInfo(project, project.jobInfo), [project]);
  const draftLocked = submittalDraftIsLocked(draft);

  function updateDraft(updater: (d: WallcoveringSubmittalData) => WallcoveringSubmittalData) {
    setDraft((current) => {
      const next = applySubmittalEdit(current, history, updater);
      if (!next) return current;
      if (next.revision_number !== current.revision_number) {
        setStatus(`Now editing Rev ${next.revision_number} (draft).`);
      }
      return { ...next, got_track: detectGotTrack(next.items) };
    });
  }

  function setType(t: TradeSubmittalType) {
    updateDraft((d) => ({
      ...d,
      submittal_type: t,
      subject: wcSubjectForPackage(d.package_type, t),
    }));
  }

  function patchItem(index: number, patch: Partial<WallcoveringItem>) {
    updateDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function onGotTrackChange(checked: boolean) {
    updateDraft((d) => ({
      ...d,
      got_track: checked,
      items: applyGotTrackToggle(d.items, checked),
    }));
  }

  function loadHistoryItems(items: WallcoveringItem[], replace: boolean) {
    const mapped = items.length
      ? items.map((i) => ({ ...emptyWallcoveringItem(), ...i, order: i.order ?? false }))
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
          },
        );
      }
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const row = await recordPdfLogRow(projectId, {
          submittal_type: draft.package_type,
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
        submittal_type: draft.package_type,
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
    setDraft({
      ...createNewSubmittalPackageDraft(draft, history),
      submittal_type: "new",
      subject: wcSubjectForPackage(draft.package_type, "new"),
      items: [emptyWallcoveringItem()],
      got_track: false,
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

      <section className="card wc-action-bar">
        <div className="wc-main-buttons row-gap wrap">
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

      <section className="card stack">
        <div className="grid-3">
          <label>
            Submittal #
            <input
              type="number"
              min={1}
              value={draft.submittal_number}
              disabled={draftLocked}
              onChange={(e) => setDraft({ ...draft, submittal_number: Number(e.target.value) || 1 })}
            />
          </label>
          <SubmittalRevisionField
            revisionNumber={draft.revision_number}
            locked={draftLocked}
            onCreateNextRevision={draftLocked ? onCreateRevision : undefined}
          />
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
          <SubmittalIssueStatusSelect
            value={draft.issue_status}
            onChange={(issue_status) => setDraft({ ...draft, issue_status })}
          />
          <SubmittalPackageTypeSelect
            value={draft.package_type}
            options={WALLCOVERING_PACKAGE_TYPE_OPTIONS}
            disabled={draftLocked}
            onChange={(package_type) =>
              updateDraft((d) => ({
                ...d,
                package_type,
                subject: wcSubjectForPackage(package_type, d.submittal_type),
              }))
            }
          />
        </div>
        <label>
          Subject
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </label>
        <RevisionNoteField
          revisionNumber={draft.revision_number}
          value={draft.revision_note ?? ""}
          onChange={(revision_note) => setDraft({ ...draft, revision_note })}
        />
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
                onClick={() =>
                  updateDraft((d) => ({ ...d, items: [...d.items, emptyWallcoveringItem()] }))
                }
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
                updateDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                updateDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                updateDraft((d) => {
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
            updateDraft((d) => ({
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
    </div>
  );
}
