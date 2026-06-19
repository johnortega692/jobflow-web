import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BudgetSplitLineModal } from "../components/budget/BudgetSplitLineModal";
import { BudgetBucketsModal } from "../components/budget/BudgetBucketsModal";
import { BudgetLibraryModal } from "../components/budget/BudgetLibraryModal";
import { useAuth } from "../contexts/AuthContext";
import { loadBudgetLibrary, downloadBudgetExcel } from "../lib/budgetLibrary";
import { downloadBudgetPdf, downloadHoursPdf } from "../lib/budgetExportPdf";
import {
  activeLines,
  applyLineSplit,
  autoPushLines,
  bucketDisplay,
  bucketLabel,
  buildSummaryRows,
  computeSummaryMetrics,
  formatPct,
} from "../lib/budgetMakerCore";
import { parseBudgetPdf } from "../lib/budgetPdfParse";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultBudgetMaker,
  normalizeBudgetMaker,
  PUSH_COLS,
  type BudgetLibrary,
  type BudgetMakerData,
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
      setDraft(normalizeBudgetMaker(raw, project.job_name));
    }
  }, [loading, tradeData.budget_maker, tradeData, project.job_name]);

  useEffect(() => {
    if (library?.default_bucket_template && draft.buckets.length === 0 && !draft.loaded_template_name) {
      const tpl = library.bucket_templates.find((t) => t.name === library.default_bucket_template);
      if (tpl?.buckets?.length) {
        setDraft((d) => ({
          ...d,
          buckets: tpl.buckets.map((b) => ({ ...b })),
          loaded_template_name: tpl.name,
        }));
      }
    }
  }, [library, draft.buckets.length, draft.loaded_template_name]);

  const lib = library ?? { cost_codes: [], cost_classes: [], bucket_templates: [], default_bucket_template: "" };
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

  function patchLine(id: string, patchRow: Partial<BudgetMakerData["lines"][0]>) {
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
    if (!draft.lines.length) {
      setError("Scan a PDF first.");
      return;
    }
    if (!draft.buckets.length) {
      setError("Open Buckets & Templates and add at least one bucket first.");
      return;
    }
    const ids = [...selectedLineIds];
    if (!ids.length) {
      setError("Select one or more PDF lines.");
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
    if (!draft.lines.length) {
      setError("Scan a PDF first.");
      return;
    }
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
    if (!draft.lines.length) {
      setError("Nothing to export yet. Scan a PDF first.");
      return;
    }
    downloadBudgetExcel(draft, lib);
    setError(null);
  }

  async function exportPdf() {
    if (!draft.lines.length) {
      setError("Nothing to export yet. Scan a PDF first.");
      return;
    }
    try {
      await downloadBudgetPdf(draft, lib);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    }
  }

  async function exportHoursPdf() {
    if (!draft.lines.length) {
      setError("Nothing to export yet. Scan a PDF first.");
      return;
    }
    try {
      await downloadHoursPdf(draft, lib);
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
      setError("Select exactly one PDF line to split.");
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

  function applyFromJob() {
    patch({ job_name: project.job_name || project.job_number });
  }

  const hiddenCount = draft.lines.filter((l) => l.Hidden).length;

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="stack budget-maker-page">
        <div className="row-between wrap">
          <div>
            <h2>Budget Maker</h2>
            <p className="muted small">Scan a Job Cost Summary PDF, push lines to buckets, export Excel.</p>
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
          <div className="row-between wrap">
            <div className="row-gap wrap budget-summary-inputs">
              <label>
                Job
                <input value={draft.job_name} onChange={(e) => patch({ job_name: e.target.value })} />
              </label>
              <span className="muted small budget-scan-status">
                {draft.lines.length
                  ? `📄 ${visibleLines.length} item${visibleLines.length === 1 ? "" : "s"} · ${draft.scanned_pdf_name}${hiddenCount ? ` · ${hiddenCount} hidden` : ""}`
                  : "No PDF loaded"}
              </span>
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
              <button type="button" className="btn btn-primary btn-sm" onClick={() => pdfRef.current?.click()} disabled={scanning}>
                {scanning ? "Scanning…" : "Open PDF…"}
              </button>
              <input ref={pdfRef} type="file" hidden accept=".pdf,application/pdf" onChange={(e) => void onPdfFile(e.target.files?.[0] ?? null)} />
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
              <button type="button" className="btn btn-secondary btn-sm" onClick={runAutoPush}>
                Auto-push
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
            </div>
            {draft.loaded_template_name && (
              <span className="muted small">Template: {draft.loaded_template_name}</span>
            )}
          </div>

          {!draft.lines.length && (
            <p className="muted budget-drop-hint">
              Upload a Job Cost Summary PDF to scan line items (File → Open PDF in desktop app).
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
                      <td>{line.Category}</td>
                      <td>{line["PDF Code"]}</td>
                      <td>{line.Description}</td>
                      <td className="num">{line.Quantity ?? ""}</td>
                      <td>{line.UoM}</td>
                      <td className="num">{line["Unit Cost"] ?? ""}</td>
                      <td className="num">{line.Amount ?? ""}</td>
                      <td className="num">{line["Man Hours"] ?? ""}</td>
                      <td>
                        <input
                          className="budget-notes-input"
                          value={line.Notes}
                          onChange={(e) => patchLine(line.id, { Notes: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card stack">
          <div className="row-between wrap">
            <h3>Export</h3>
            <div className="row-gap wrap">
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportExcel}>
                Export Excel…
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportPdf()}>
                Export PDF…
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportHoursPdf()}>
                Export Hours PDF…
              </button>
            </div>
          </div>
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
