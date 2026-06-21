import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BudgetSplitLineModal } from "../components/budget/BudgetSplitLineModal";
import { BudgetBucketsModal } from "../components/budget/BudgetBucketsModal";
import { BudgetLibraryModal } from "../components/budget/BudgetLibraryModal";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import { useAuth } from "../contexts/AuthContext";
import {
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  transmittalPrintInfo,
} from "../lib/jobInfo";
import { loadBudgetLibrary, downloadBudgetExcel, saveBudgetLibrary } from "../lib/budgetLibrary";
import { downloadBudgetPdf, downloadHoursPdf } from "../lib/budgetExportPdf";
import { budgetHoursPdfFilename, budgetPdfFilename } from "../lib/pdfFilenames";
import {
  activeLines,
  applyLineSplit,
  autoPushLines,
  bucketDisplay,
  bucketLabel,
  buildSummaryRows,
  computeSummaryMetrics,
  defaultTemplateDraftPatch,
  formatPct,
  resolveDefaultTemplateName,
} from "../lib/budgetMakerCore";
import { parseBudgetPdf } from "../lib/budgetPdfParse";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultBudgetMaker,
  defaultBudgetLibrary,
  emptyBudgetScanLine,
  normalizeBudgetMaker,
  parseBudgetNumber,
  PUSH_COLS,
  BUDGET_LINE_CATEGORIES,
  BUDGET_UOM_OPTIONS,
  type BudgetLibrary,
  type BudgetMakerData,
  type BudgetScanLine,
} from "../types/budgetMaker";

type Ctx = { project: ProjectForm; projectId: string };

function fmtMoney(n: number): string {
  return n ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export function BudgetPage() {
  const { user } = useAuth();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [library, setLibrary] = useState<BudgetLibrary | null>(null);
  const [draft, setDraft] = useState(() => defaultBudgetMaker(project.job_name));
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [targetBucket, setTargetBucket] = useState(0);
  const [showBuckets, setShowBuckets] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [splitLineId, setSplitLineId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const lib = library ?? defaultBudgetLibrary();

  const templateNames = useMemo(
    () => lib.bucket_templates.map((t) => t.name).filter(Boolean),
    [lib],
  );

  const loadLib = useCallback(async () => {
    if (!user) return;
    setLibrary(await loadBudgetLibrary(user.id));
  }, [user]);

  useEffect(() => {
    void loadLib();
  }, [loadLib]);

  useEffect(() => {
    if (!loading) {
      const raw = tradeData.budget_maker ?? (tradeData as { budget?: unknown }).budget;
      const base = normalizeBudgetMaker(raw, project.job_name);
      setDraft({
        ...base,
        contract: coerceTransmittalContract(project, base.contract),
      });
    }
  }, [loading, tradeData.budget_maker, tradeData, project.job_name, project]);

  useEffect(() => {
    if (!library || loading) return;
    if (draft.buckets.length > 0) return;
    const tplPatch = defaultTemplateDraftPatch(library);
    if (!tplPatch) return;
    setDraft((d) => ({ ...d, ...tplPatch }));
  }, [library, loading, draft.buckets.length]);

  const contractJob = useMemo(
    () => transmittalPrintInfo(project, draft.contract),
    [project, draft.contract],
  );

  const budgetPdfName = useMemo(
    () => budgetPdfFilename(contractJob.job_name, contractJob.job_number),
    [contractJob.job_name, contractJob.job_number],
  );
  const budgetHoursPdfName = useMemo(
    () => budgetHoursPdfFilename(contractJob.job_name, contractJob.job_number),
    [contractJob.job_name, contractJob.job_number],
  );
  const visibleLines = useMemo(() => activeLines(draft.lines), [draft.lines]);
  const metrics = useMemo(
    () => computeSummaryMetrics(draft.lines, draft.grand_total),
    [draft.lines, draft.grand_total],
  );
  const summaryRows = useMemo(
    () => buildSummaryRows(draft.buckets, draft.lines, lib, draft.hide_zero_amounts),
    [draft.buckets, draft.lines, lib, draft.hide_zero_amounts],
  );

  const profit =
    metrics.userGrandTotal != null ? metrics.userGrandTotal - metrics.budgetTotal : null;

  function patch(p: Partial<BudgetMakerData>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function addLine() {
    const line = emptyBudgetScanLine();
    setDraft((d) => ({
      ...d,
      lines: [...d.lines, line],
      scanned_pdf_name: d.scanned_pdf_name || "Manual entry",
    }));
    setSelectedLineIds(new Set([line.id]));
    setError(null);
  }

  function removeSelectedLines() {
    if (!selectedLineIds.size) {
      setError("Select one or more lines to remove.");
      return;
    }
    const nextLines = draft.lines.filter((l) => !selectedLineIds.has(l.id));
    patch({
      lines: nextLines,
      scanned_pdf_name: nextLines.length === 0 ? "" : draft.scanned_pdf_name,
    });
    setSelectedLineIds(new Set());
    setError(null);
  }

  function duplicateSelectedLines() {
    const ids = [...selectedLineIds];
    if (!ids.length) {
      setError("Select one or more lines to duplicate.");
      return;
    }
    const copies = draft.lines
      .filter((l) => ids.includes(l.id))
      .map((l) => ({ ...l, id: crypto.randomUUID(), Bucket: "" }));
    setDraft((d) => ({
      ...d,
      lines: [...d.lines, ...copies],
      scanned_pdf_name: d.scanned_pdf_name || "Manual entry",
    }));
    setSelectedLineIds(new Set(copies.map((l) => l.id)));
    setError(null);
  }

  function lineSourceLabel(): string {
    if (!draft.lines.length) return "No lines yet";
    const name = draft.scanned_pdf_name.trim();
    if (name === "Manual entry") return `✏️ ${visibleLines.length} manual line${visibleLines.length === 1 ? "" : "s"}`;
    if (name) {
      return `📄 ${visibleLines.length} item${visibleLines.length === 1 ? "" : "s"} · ${name}${hiddenCount ? ` · ${hiddenCount} hidden` : ""}`;
    }
    return `${visibleLines.length} line${visibleLines.length === 1 ? "" : "s"}${hiddenCount ? ` · ${hiddenCount} hidden` : ""}`;
  }

  function requireLines(action: string): boolean {
    if (draft.lines.length) return true;
    setError(`Add lines manually or scan a PDF first (${action}).`);
    return false;
  }

  function patchLine(id: string, patchRow: Partial<BudgetScanLine>) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.id === id ? { ...l, ...patchRow } : l)),
    }));
  }

  async function handleSave() {
    const next = { ...draft, saved_at: new Date().toLocaleString() };
    const { budget_maker: _saved, ...rest } = tradeData;
    const ok = await save({ ...rest, budget_maker: next });
    if (ok) {
      setDraft(next);
      setSavedAt(next.saved_at ?? null);
    }
  }

  async function handleDefaultTemplateChange(name: string) {
    if (!user) return;
    const nextLib = { ...lib, default_bucket_template: name };
    const err = await saveBudgetLibrary(user.id, nextLib);
    if (err) {
      setError(err);
      return;
    }
    setLibrary(nextLib);
    setError(null);
    if (!draft.buckets.length && name) {
      const tplPatch = defaultTemplateDraftPatch(nextLib);
      if (tplPatch) setDraft((d) => ({ ...d, ...tplPatch }));
    }
  }

  async function onPdfFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const lines = await parseBudgetPdf(await file.arrayBuffer());
      if (!lines.length) {
        setError("No line items detected. Is this the expected Job Cost Summary format?");
        return;
      }
      patch({ lines, scanned_pdf_name: file.name });
      setSelectedLineIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF scan failed");
    } finally {
      setScanning(false);
      if (pdfRef.current) pdfRef.current.value = "";
    }
  }

  function pushSelected() {
    if (!requireLines("push to buckets")) return;
    if (!draft.buckets.length) {
      setError("Open Buckets & Templates and add at least one bucket first.");
      return;
    }
    const ids = [...selectedLineIds];
    if (!ids.length) {
      setError("Select one or more lines.");
      return;
    }
    patch({
      lines: draft.lines.map((l) =>
        ids.includes(l.id) ? { ...l, Bucket: String(targetBucket) } : l,
      ),
    });
    setSelectedLineIds(new Set());
  }

  function clearSelectedBuckets() {
    const ids = selectedLineIds;
    if (!ids.size) return;
    patch({
      lines: draft.lines.map((l) => (ids.has(l.id) ? { ...l, Bucket: "" } : l)),
    });
  }

  function runAutoPush() {
    if (!requireLines("auto-push")) return;
    if (!draft.buckets.length) {
      setError("Add buckets first.");
      return;
    }
    const { lines, matchedRule, matchedCode } = autoPushLines(draft.lines, draft.buckets);
    const matched = matchedRule + matchedCode;
    if (!matched) {
      setError(
        "No lines matched auto-push rules (Materials→970, Walking Paint→901, Paint Clean→990, or PDF code match).",
      );
      return;
    }
    patch({ lines });
    setError(null);
  }

  function hideSelected() {
    const ids = selectedLineIds;
    if (!ids.size) return;
    patch({
      lines: draft.lines.map((l) =>
        ids.has(l.id) ? { ...l, Hidden: true, Bucket: "" } : l,
      ),
    });
    setSelectedLineIds(new Set());
  }

  function exportExcel() {
    if (!requireLines("export")) return;
    downloadBudgetExcel(draft, lib);
    setError(null);
  }

  async function exportPdf() {
    if (!requireLines("export")) return;
    try {
      await downloadBudgetPdf(draft, lib, contractJob.job_number);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    }
  }

  async function exportHoursPdf() {
    if (!requireLines("export")) return;
    try {
      await downloadHoursPdf(draft, lib, contractJob.job_number);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hours PDF export failed");
    }
  }

  function openSplitDialog() {
    if (!draft.buckets.length) {
      setError("Add buckets first (Buckets & templates…).");
      return;
    }
    if (selectedLineIds.size !== 1) {
      setError("Select exactly one line to split.");
      return;
    }
    setSplitLineId([...selectedLineIds][0]);
    setError(null);
  }

  function applySplit(splits: Parameters<typeof applyLineSplit>[2]) {
    if (!splitLineId) return;
    patch({ lines: applyLineSplit(draft.lines, splitLineId, splits) });
    setSelectedLineIds(new Set());
    setSplitLineId(null);
  }

  const splitLine = splitLineId ? draft.lines.find((l) => l.id === splitLineId) : null;

  function onContractChange(contract: typeof draft.contract) {
    const ids = transmittalPrintInfo(project, contract);
    patch({
      contract,
      job_name: ids.job_name || ids.job_number,
    });
  }

  function applyFromJob() {
    onContractChange(draft.contract);
  }

  const hiddenCount = draft.lines.filter((l) => l.Hidden).length;

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="stack budget-maker-page">
        <div className="row-between wrap">
          <div>
            <h2>Budget Maker</h2>
            <p className="muted small">
              Scan a Job Cost Summary PDF or enter lines by hand, push to buckets, then export.
            </p>
          </div>
          <div className="row-gap wrap">
            {savedAt && <span className="muted small">Saved {savedAt}</span>}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowLibrary(true)}>
              Cost codes & classes…
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowBuckets(true)}>
              Buckets & templates…
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={applyFromJob}>
              Apply from job
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <section className="card stack">
          <div className="row-gap wrap">
            <label
              className="btn btn-primary btn-sm"
              style={scanning ? { opacity: 0.65, pointerEvents: "none" } : undefined}
            >
              {scanning ? "Scanning…" : "Open PDF…"}
              <input
                ref={pdfRef}
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                disabled={scanning}
                onClick={(e) => {
                  (e.currentTarget as HTMLInputElement).value = "";
                }}
                onChange={(e) => void onPdfFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={runAutoPush}>
              Auto-push
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={hideSelected}>
              Hide selected
            </button>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => patch({ lines: draft.lines.map((l) => ({ ...l, Hidden: false })) })}
              >
                Unhide all ({hiddenCount})
              </button>
            )}
            <span className="paint-action-sep" aria-hidden="true" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportExcel}>
              Export Excel…
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportPdf()}>
              Export PDF…
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportHoursPdf()}>
              Export Hours PDF…
            </button>
            <label className="budget-inline-label">
              Default template
              <select
                value={resolveDefaultTemplateName(lib)}
                disabled={!templateNames.length}
                onChange={(e) => void handleDefaultTemplateChange(e.target.value)}
              >
                <option value="">
                  {templateNames.length ? "— Select default —" : "No saved templates"}
                </option>
                {templateNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="sds-filename-preview muted small">
            Budget PDF: <code>{budgetPdfName}</code>
            {" · "}
            Hours PDF: <code>{budgetHoursPdfName}</code>
            {draft.loaded_template_name && (
              <>
                {" · "}
                Active template: <code>{draft.loaded_template_name}</code>
              </>
            )}
          </p>
        </section>

        <section className="card stack">
          {hasTransmittalContractSwitch(project) && (
            <TradeContractTabs
              project={project}
              value={draft.contract}
              onChange={onContractChange}
              showJobLabel
            />
          )}
          <div className="row-between wrap">
            <div className="row-gap wrap budget-summary-inputs">
              <label>
                Job
                <input value={draft.job_name} onChange={(e) => patch({ job_name: e.target.value })} />
              </label>
              {hasTransmittalContractSwitch(project) && (
                <label>
                  Job #
                  <input value={contractJob.job_number} readOnly className="readonly" />
                </label>
              )}
              <span className="muted small budget-scan-status">{lineSourceLabel()}</span>
              <label>
                Grand total
                <input value={draft.grand_total} onChange={(e) => patch({ grand_total: e.target.value })} placeholder="$" />
              </label>
              <span className="muted small">(contract / bid total for profit calc)</span>
            </div>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={draft.hide_zero_amounts}
                onChange={(e) => patch({ hide_zero_amounts: e.target.checked })}
              />
              Hide $0 rows
            </label>
          </div>

          <div className="budget-metrics-bar">
            {[
              ["Budget", fmtMoney(metrics.budgetTotal), ""],
              ["Grand total", metrics.userGrandTotal != null ? fmtMoney(metrics.userGrandTotal) : "—", ""],
              ["Profit & OH", profit != null ? fmtMoney(profit) : "—", "ok"],
              ["Profit %", profit != null && metrics.userGrandTotal ? formatPct(profit, metrics.userGrandTotal) : "—", "ok"],
              ["Hours", metrics.totalHours ? metrics.totalHours.toFixed(1) : "—", ""],
              ["Unassigned", fmtMoney(metrics.unassignedTotal), "warn"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className={`budget-metric ${tone}`}>
                <span className="muted small">{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="card stack">
          <div className="row-between wrap">
            <div className="row-gap wrap">
              <button type="button" className="btn btn-success btn-sm" onClick={addLine}>
                Add line
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={duplicateSelectedLines}>
                Duplicate selected
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={removeSelectedLines}>
                Remove selected
              </button>
              <label className="budget-inline-label">
                Target bucket
                <select
                  value={String(targetBucket)}
                  onChange={(e) => setTargetBucket(parseInt(e.target.value, 10))}
                  disabled={!draft.buckets.length}
                >
                  {draft.buckets.map((b, i) => (
                    <option key={i} value={String(i)}>
                      {bucketLabel(b, i, lib)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={pushSelected}>
                Push selected
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelectedBuckets}>
                Clear selected
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={openSplitDialog}
                disabled={selectedLineIds.size !== 1 || !draft.buckets.length}
                title="Split one selected line across buckets"
              >
                Split line…
              </button>
            </div>
            {draft.loaded_template_name && (
              <span className="muted small">Template: {draft.loaded_template_name}</span>
            )}
          </div>

          {!draft.lines.length && (
            <p className="muted budget-drop-hint">
              Scan a Job Cost Summary PDF with <strong>Open PDF…</strong>, or click <strong>Add line</strong> to
              enter job cost items by hand. You can mix PDF import and manual lines on the same job.
            </p>
          )}

          {draft.lines.length > 0 && (
            <div className="table-wrap budget-lines-table">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    {PUSH_COLS.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map((line) => (
                    <tr key={line.id} className={line.Bucket ? "assigned" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedLineIds.has(line.id)}
                          onChange={(e) => {
                            const next = new Set(selectedLineIds);
                            if (e.target.checked) next.add(line.id);
                            else next.delete(line.id);
                            setSelectedLineIds(next);
                          }}
                        />
                      </td>
                      <td>{bucketDisplay(line.Bucket, draft.buckets, lib)}</td>
                      <td>
                        <select
                          className="budget-cell-input"
                          value={line.Category}
                          onChange={(e) => patchLine(line.id, { Category: e.target.value })}
                        >
                          <option value="">—</option>
                          {BUDGET_LINE_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="budget-cell-input budget-cell-code"
                          value={line["PDF Code"]}
                          onChange={(e) => patchLine(line.id, { "PDF Code": e.target.value })}
                          placeholder="Code"
                        />
                      </td>
                      <td>
                        <input
                          className="budget-cell-input budget-cell-desc"
                          value={line.Description}
                          onChange={(e) => patchLine(line.id, { Description: e.target.value })}
                          placeholder="Description"
                        />
                      </td>
                      <td className="num">
                        <input
                          className="budget-cell-input budget-cell-num"
                          value={line.Quantity ?? ""}
                          onChange={(e) => patchLine(line.id, { Quantity: parseBudgetNumber(e.target.value) })}
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input
                          className="budget-cell-input budget-cell-uom"
                          value={line.UoM}
                          onChange={(e) => patchLine(line.id, { UoM: e.target.value.toUpperCase() })}
                          list="budget-uom-options"
                          placeholder="EA"
                        />
                      </td>
                      <td className="num">
                        <input
                          className="budget-cell-input budget-cell-num"
                          value={line["Unit Cost"] ?? ""}
                          onChange={(e) => patchLine(line.id, { "Unit Cost": parseBudgetNumber(e.target.value) })}
                          placeholder="0"
                        />
                      </td>
                      <td className="num">
                        <input
                          className="budget-cell-input budget-cell-num"
                          value={line.Amount ?? ""}
                          onChange={(e) => patchLine(line.id, { Amount: parseBudgetNumber(e.target.value) })}
                          placeholder="0"
                        />
                      </td>
                      <td className="num">
                        <input
                          className="budget-cell-input budget-cell-num"
                          value={line["Man Hours"] ?? ""}
                          onChange={(e) => patchLine(line.id, { "Man Hours": parseBudgetNumber(e.target.value) })}
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input
                          className="budget-cell-input budget-cell-notes"
                          value={line.Notes}
                          onChange={(e) => patchLine(line.id, { Notes: e.target.value })}
                          placeholder="Notes"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="budget-uom-options">
                {BUDGET_UOM_OPTIONS.map((uom) => (
                  <option key={uom} value={uom} />
                ))}
              </datalist>
            </div>
          )}
        </section>

        <section className="card stack">
          <h3>Bucket totals</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work Item</th>
                  <th>Cost Code</th>
                  <th>Class</th>
                  <th>GL</th>
                  <th>Hours</th>
                  <th>Amount</th>
                  <th>%</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => (
                  <tr key={r.bucketIdx}>
                    <td>{r.workItem}</td>
                    <td>{r.costCode}</td>
                    <td>{r.costClass}</td>
                    <td>{r.glAcct}</td>
                    <td className="num">{r.hours}</td>
                    <td className="num">${r.amount.toFixed(2)}</td>
                    <td>{r.pct}</td>
                    <td>
                      <input
                        className="budget-notes-input"
                        value={draft.buckets[r.bucketIdx]?.notes ?? ""}
                        onChange={(e) => {
                          const buckets = draft.buckets.map((b, i) =>
                            i === r.bucketIdx ? { ...b, notes: e.target.value } : b,
                          );
                          patch({ buckets });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showLibrary && user && (
        <BudgetLibraryModal
          userId={user.id}
          library={lib}
          onClose={() => setShowLibrary(false)}
          onSaved={(next) => {
            setLibrary(next);
            void loadLib();
          }}
        />
      )}

      {showBuckets && user && (
        <BudgetBucketsModal
          userId={user.id}
          library={lib}
          draft={draft}
          onClose={() => setShowBuckets(false)}
          onChange={patch}
          onLibraryChange={setLibrary}
        />
      )}

      {splitLine && (
        <BudgetSplitLineModal
          line={splitLine}
          buckets={draft.buckets}
          library={lib}
          onClose={() => setSplitLineId(null)}
          onSplit={applySplit}
        />
      )}
    </>
  );
}
