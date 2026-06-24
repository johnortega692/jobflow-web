import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { FrpAddTrimModal } from "../components/frp/FrpAddTrimModal";
import { FrpItemRow } from "../components/frp/FrpItemRow";
import { SubmittalHistoryModal } from "../components/paint/SubmittalHistoryModal";
import { DateInput } from "../components/DateInput";
import { RevisionNoteField } from "../components/submittals/RevisionNoteField";
import { SubmittalIssueStatusSelect } from "../components/submittals/SubmittalIssueStatusSelect";
import { SubmittalPackageTypeSelect } from "../components/submittals/SubmittalPackageTypeSelect";
import { useLetterhead } from "../contexts/LetterheadContext";
import type { FrpCatalog } from "../lib/frpCatalog";
import { loadFrpCatalog } from "../lib/frpCatalog";
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
import { queuePendingItem } from "../lib/transmittalHelpers";
import { useProjectTradeData } from "../lib/useProjectTradeData";
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
  return Boolean(item.manufacturer.trim() || item.product.trim() || item.label.trim());
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

  useEffect(() => {
    if (!loading) {
      setDraft(normalizeFrpSubmittal(tradeData.frp_submittal));
      setHistory(tradeData.frp_submittal_history ?? []);
    }
  }, [loading, tradeData.frp_submittal, tradeData.frp_submittal_history]);

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
  const frpPrint = useMemo(() => frpPrintInfo(project, project.jobInfo), [project]);
  const frpNum = frpJobNumber(project);
  const frpName = frpJobName(project);

  async function persist(nextDraft: FrpSubmittalData, nextHistory = history) {
    const ok = await save({
      ...tradeData,
      frp_submittal: nextDraft,
      frp_submittal_history: nextHistory,
    });
    if (ok) {
      setDraft(nextDraft);
      setHistory(nextHistory);
      setError(null);
    }
    return ok;
  }

  function updateDraft(updater: (d: FrpSubmittalData) => FrpSubmittalData) {
    const next = applySubmittalEdit(draft, history, updater);
    if (!next) return;
    if (next.revision_number !== draft.revision_number) {
      setStatus(`Now editing Rev ${next.revision_number} (draft).`);
    }
    setDraft(next);
  }

  function patchItem(index: number, patch: Partial<FrpItem>) {
    updateDraft((d) => ({
      ...d,
      items: d.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function loadHistoryItems(items: FrpItem[], replace: boolean) {
    const mapped = items.length
      ? items.map((i) => ({ ...emptyFrpItem(), ...i, order: i.order ?? false }))
      : [emptyFrpItem()];
    updateDraft((d) => ({
      ...d,
      items: replace
        ? mapped
        : [...d.items.filter(frpItemHasContent), ...mapped],
    }));
    setHistoryOpen(false);
    setStatus(`Loaded ${items.length} item(s) from history. Save to keep changes.`);
  }

  async function onSave() {
    await persist(draft, history);
    setStatus("FRP submittal saved.");
  }

  async function onSubmittalPdf() {
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
          },
        );
      }
      await persist(draft, nextHistory);
      let logRowId = "";
      try {
        const row = await recordPdfLogRow(projectId, {
          submittal_type: draft.package_type,
          scope: "FRP",
          spec: "066000",
          notes: `FRP submittal #${draft.submittal_number}`,
          trade_submittal_number: String(draft.submittal_number),
          status: "Ready",
        });
        logRowId = row.id;
      } catch {
        /* optional */
      }
      let transmittal = queuePendingItem(tradeData.transmittal ?? defaultTransmittal(), {
        submittal_type: draft.package_type,
        scope: "FRP",
        source: "frp_submittal",
        trade_submittal_number: String(draft.submittal_number),
        log_row_id: logRowId,
      });
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
      items: [emptyFrpItem()],
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
      const existing = d.items.filter(frpItemHasContent);
      const merged = [...existing, ...items];
      return { ...d, items: merged.length ? merged : [emptyFrpItem()] };
    });
    setStatus(`Added ${items.length} trim item(s). Save to keep changes.`);
  }

  const submittalPdfFilename = useMemo(
    () => frpSubmittalFilename(frpPrint.job_name, frpPrint.job_number, draft.submittal_number),
    [frpPrint.job_name, frpPrint.job_number, draft.submittal_number],
  );

  if (loading || catalogLoading) return <p className="muted">Loading FRP submittal…</p>;
  if (!catalog) return <p className="muted">FRP catalog unavailable.</p>;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>FRP</h2>
          <p className="muted small">
            FRP items and submittal PDFs. Material orders →{" "}
            <Link to={`/projects/${projectId}/orders`}>Orders</Link>.
          </p>
          {hasDistinctFrpContract(project) && (
            <p className="muted small">Contract: {frpJobLabel(project)}.</p>
          )}
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary" onClick={onNewSubmittalPackage}>
            New submittal package
          </button>
          {!draftLocked && (
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onIssueSubmittal()}>
              Issue submittal
            </button>
          )}
          {draftLocked && (
            <button type="button" className="btn btn-secondary" onClick={onCreateRevision}>
              Create next revision
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

      <section className="card stack">
        <div className="grid-2">
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
          <label>
            Revision
            <input type="number" min={0} value={draft.revision_number} readOnly />
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
            options={FRP_PACKAGE_TYPE_OPTIONS}
            disabled={draftLocked}
            onChange={(package_type) =>
              updateDraft((d) => ({
                ...d,
                package_type,
                subject: frpSubjectForPackage(package_type),
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

      <section className="card frp-items-section">
        <div className="frp-items-toolbar row-gap wrap">
          <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              updateDraft((d) => ({
                ...d,
                items: [...d.items.filter(frpItemHasContent), emptyFrpItem()],
              }))
            }
          >
            Add
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setTrimOpen(true)}>
            Add trim
          </button>
        </div>

        <div className="frp-items-list">
          {draft.items.map((item, index) => (
            <FrpItemRow
              key={index}
              item={item}
              index={index}
              total={draft.items.length}
              catalog={catalog}
              onChange={(patch) => patchItem(index, patch)}
              onMoveUp={() =>
                updateDraft((d) => ({ ...d, items: moveItem(d.items, index, index - 1) }))
              }
              onMoveDown={() =>
                updateDraft((d) => ({ ...d, items: moveItem(d.items, index, index + 1) }))
              }
              onRemove={() =>
                updateDraft((d) => {
                  const next = d.items.filter((_, i) => i !== index);
                  return { ...d, items: next.length ? next : [emptyFrpItem()] };
                })
              }
            />
          ))}
        </div>
      </section>

      {trimOpen && (
        <FrpAddTrimModal catalog={catalog} onAdd={addTrimItems} onClose={() => setTrimOpen(false)} />
      )}

      {historyOpen && (
        <SubmittalHistoryModal
          scope="frp"
          jobNumber={project.job_number}
          jobName={project.job_name}
          history={history}
          onLoadFrp={loadHistoryItems}
          onDelete={(n, r) => void onDeleteHistory(n, r)}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
