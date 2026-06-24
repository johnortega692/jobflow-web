import { useEffect, useMemo, useState } from "react";
import { PaintItemRow } from "../paint/PaintItemRow";
import { RevisionNoteField } from "./RevisionNoteField";
import { WallcoveringItemRow } from "../wallcovering/WallcoveringItemRow";
import { recordPdfLogRow } from "../../lib/submittalLogService";
import type { PrintBranding } from "../../lib/printCore";
import { downloadPaintSubmittal } from "../../lib/paintSubmittalPrint";
import { downloadWallcoveringSubmittal } from "../../lib/wallcoveringSubmittalPrint";
import {
  filterHistoryByScope,
  formatSubmittalHistoryLabel,
  mapHistoryItemsForRevisedLoad,
  nextSubmittalNumber,
  nextRevisionNumber,
  type SubmittalScope,
} from "../../lib/submittalHistory";
import {
  projectPrintInfo,
  wcPrintInfo,
} from "../../lib/jobInfo";
import type { PaintColorsDb, PaintProduct } from "../../lib/paintCatalog";
import {
  defaultPackageForScope,
  emptyPaintItem,
  emptyWallcoveringItem,
  formatToday,
  paintSubjectForPackage,
  REVISED_SUBMITTAL_TYPES,
  wcSubjectForPackage,
  type PaintItem,
  type PaintSubmittalData,
  type SubmittalHistoryEntry,
  type TradeSubmittalType,
  type WallcoveringItem,
  type WallcoveringSubmittalData,
} from "../../types/tradeDocuments";
import type { ProjectForm } from "../../types/database";

type ProjectInfo = Pick<ProjectForm, "job_number" | "job_name" | "job_address" | "job_address2" | "jobInfo">;

type PaintCatalogProps = {
  products: PaintProduct[];
  productOptions: string[];
  sheenOptions: string[];
  colors: PaintColorsDb | null;
};

type Props = {
  scope: SubmittalScope;
  projectId: string;
  project: ProjectInfo;
  history: SubmittalHistoryEntry[];
  branding: PrintBranding;
  paintCatalog?: PaintCatalogProps;
  onEmailVendor?: (draft: PaintSubmittalData) => void;
  onClose: () => void;
  onCreated: (payload: {
    draft: PaintSubmittalData | WallcoveringSubmittalData;
    history: SubmittalHistoryEntry[];
  }) => void;
};

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

export function CreateRevisedSubmittalModal({
  scope,
  projectId,
  project,
  history,
  branding,
  paintCatalog,
  onEmailVendor,
  onClose,
  onCreated,
}: Props) {
  const scopedHistory = useMemo(() => filterHistoryByScope(history, scope), [history, scope]);
  const [submittalType, setSubmittalType] = useState<TradeSubmittalType>("revised");
  const [historyIdx, setHistoryIdx] = useState(0);
  const [paintItems, setPaintItems] = useState<PaintItem[]>([emptyPaintItem()]);
  const [wcItems, setWcItems] = useState<WallcoveringItem[]>([emptyWallcoveringItem()]);
  const [revisionNote, setRevisionNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showPreviousColor = submittalType === "substitution";
  const nextSubmittalNum = useMemo(() => nextSubmittalNumber(scopedHistory), [scopedHistory]);
  const baseEntry = scopedHistory[historyIdx];
  const targetSubmittalNum = baseEntry?.submittal_number ?? nextSubmittalNum;
  const targetRevisionNum = useMemo(
    () => nextRevisionNumber(scopedHistory, targetSubmittalNum),
    [scopedHistory, targetSubmittalNum],
  );
  const title =
    scope === "paint" ? "Create Revised Paint Submittal" : "Create Revised Wallcovering Submittal";
  const printProject = useMemo(
    () => (scope === "wallcovering" ? wcPrintInfo(project, project.jobInfo) : projectPrintInfo(project, project.jobInfo)),
    [project, scope],
  );

  useEffect(() => {
    if (scopedHistory.length) setHistoryIdx(0);
  }, [scopedHistory.length]);

  function loadFromHistory(entry: SubmittalHistoryEntry) {
    if (scope === "paint") {
      const items = mapHistoryItemsForRevisedLoad(
        (entry.items as PaintItem[]).map((i) => ({ ...emptyPaintItem(), ...i })),
        submittalType,
      );
      setPaintItems(items.length ? items : [emptyPaintItem()]);
    } else {
      const items = mapHistoryItemsForRevisedLoad(
        (entry.items as WallcoveringItem[]).map((i) => ({ ...emptyWallcoveringItem(), ...i })),
        submittalType,
      );
      setWcItems(items.length ? items : [emptyWallcoveringItem()]);
    }
    setMessage(`Loaded ${entry.items.length} item(s) from Submittal #${entry.submittal_number}.`);
    setError(null);
  }

  function onLoadSelectedHistory() {
    const entry = scopedHistory[historyIdx];
    if (!entry) {
      setError("Select a previous submittal to load.");
      return;
    }
    loadFromHistory(entry);
  }

  function buildDraft(): PaintSubmittalData | WallcoveringSubmittalData {
    const submittal_number = targetSubmittalNum;
    const revision_number = targetRevisionNum;
    const package_type = baseEntry?.package_type ?? defaultPackageForScope(scope === "frp" ? "frp" : scope);
    const subject =
      scope === "paint"
        ? paintSubjectForPackage(package_type, submittalType)
        : wcSubjectForPackage(package_type, submittalType);
    const note = revisionNote.trim() || undefined;
    if (scope === "paint") {
      return {
        submittal_number,
        revision_number,
        issue_status: "draft",
        package_type,
        submittal_type: submittalType,
        subject,
        date: formatToday(),
        items: paintItems,
        revision_note: note,
      };
    }
    return {
      submittal_number,
      revision_number,
      issue_status: "draft",
      package_type,
      submittal_type: submittalType,
      subject,
      date: formatToday(),
      items: wcItems,
      revision_note: note,
    };
  }

  function onCreatePdf() {
    setError(null);
    void (async () => {
      try {
        const draft = buildDraft();
        const projectInfo = printProject;
        if (scope === "paint") {
          await downloadPaintSubmittal(projectInfo, draft as PaintSubmittalData, branding);
        } else {
          await downloadWallcoveringSubmittal(projectInfo, draft as WallcoveringSubmittalData, branding);
        }
        onCreated({ draft, history: scopedHistory });
        try {
          const logScope = scope === "paint" ? "Paint" : "Wallcovering";
          const logSpec = scope === "paint" ? "099000" : "096000";
          await recordPdfLogRow(projectId, {
            submittal_type: draft.submittal_type || submittalType,
            scope: logScope,
            spec: logSpec,
            notes: `${logScope} submittal #${draft.submittal_number}`,
            trade_submittal_number: String(draft.submittal_number),
            status: "Ready",
          });
        } catch {
          /* log row optional */
        }
        setMessage(
          `Submittal #${String(draft.submittal_number).padStart(3, "0")} Rev ${draft.revision_number} PDF downloaded. Issue when ready to lock this revision.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not download PDF.");
      }
    })();
  }

  function onEmail() {
    if (scope !== "paint" || !onEmailVendor) return;
    onEmailVendor(buildDraft() as PaintSubmittalData);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card stack revised-submittal-modal"
        role="dialog"
        aria-labelledby="revised-submittal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="revised-submittal-title">{title}</h3>

        <p className="muted small">
          Creates <strong>Submittal #{String(targetSubmittalNum).padStart(3, "0")} Rev {targetRevisionNum}</strong>{" "}
          from the selected package. The submittal number stays the same; only the revision increments after issue.
        </p>

        <section className="stack revised-section">
          <p className="paint-col-head">Source submittal package</p>
          {scopedHistory.length ? (
            <div className="row-gap wrap revised-history-row">
              <select
                value={historyIdx}
                onChange={(e) => setHistoryIdx(Number(e.target.value))}
                aria-label="Select previous submittal"
              >
                {scopedHistory.map((h, i) => (
                  <option key={`${h.submittal_number}-${h.revision_number ?? 0}`} value={i}>
                    {formatSubmittalHistoryLabel(h)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary btn-small" onClick={onLoadSelectedHistory}>
                Load
              </button>
            </div>
          ) : (
            <p className="muted small italic">No previous submittals found for this job.</p>
          )}
        </section>

        <section className="stack revised-section">
          <p className="paint-col-head">Submittal type</p>
          {REVISED_SUBMITTAL_TYPES.map((t) => (
            <label key={t.id} className="check revised-type-option">
              <input
                type="radio"
                name="revised-type"
                checked={submittalType === t.id}
                onChange={() => setSubmittalType(t.id)}
              />
              <span>
                <strong>{t.label}</strong>
                <span className="muted small"> — {t.hint}</span>
              </span>
            </label>
          ))}
        </section>

        <RevisionNoteField
          revisionNumber={targetRevisionNum}
          value={revisionNote}
          onChange={setRevisionNote}
        />

        <section className="stack revised-section">
          <div className="row-between">
            <p className="paint-col-head">
              {scope === "paint" ? "Paint items" : "Wallcovering items"}
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() =>
                scope === "paint"
                  ? setPaintItems((items) => [...items, emptyPaintItem()])
                  : setWcItems((items) => [...items, emptyWallcoveringItem()])
              }
            >
              + Add another item
            </button>
          </div>
          <p className="muted small">Add or edit items for the revised submittal.</p>

          {scope === "paint" && paintCatalog ? (
            <div
              className={`paint-items-grid${showPreviousColor ? " paint-items-grid--substitution" : ""}`}
            >
              {paintItems.map((item, index) => (
                <PaintItemRow
                  key={index}
                  item={item}
                  index={index}
                  total={paintItems.length}
                  products={paintCatalog.products}
                  sheenOptions={paintCatalog.sheenOptions}
                  colors={paintCatalog.colors}
                  showPreviousColor={showPreviousColor}
                  onChange={(patch) =>
                    setPaintItems((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
                    )
                  }
                  onMoveUp={() => setPaintItems((rows) => moveItem(rows, index, index - 1))}
                  onMoveDown={() => setPaintItems((rows) => moveItem(rows, index, index + 1))}
                  onRemove={() =>
                    setPaintItems((rows) =>
                      rows.length > 1 ? rows.filter((_, i) => i !== index) : rows,
                    )
                  }
                />
              ))}
            </div>
          ) : null}

          {scope === "wallcovering"
            ? wcItems.map((item, index) => (
                <WallcoveringItemRow
                  key={index}
                  item={item}
                  index={index}
                  total={wcItems.length}
                  showPreviousColor={showPreviousColor}
                  onChange={(patch) =>
                    setWcItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
                  }
                  onMoveUp={() => setWcItems((rows) => moveItem(rows, index, index - 1))}
                  onMoveDown={() => setWcItems((rows) => moveItem(rows, index, index + 1))}
                  onRemove={() =>
                    setWcItems((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows))
                  }
                />
              ))
            : null}
        </section>

        {error && <div className="banner banner-error">{error}</div>}
        {message && <div className="banner banner-ok">{message}</div>}

        <div className="row-gap wrap">
          {scope === "paint" && onEmailVendor && (
            <button type="button" className="btn btn-secondary" onClick={onEmail}>
              Email vendor
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onCreatePdf}>
            Download PDF submittal
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
