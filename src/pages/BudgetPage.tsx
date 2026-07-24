import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { BudgetSplitLineModal } from "../components/budget/BudgetSplitLineModal";
import {
  BudgetIconAdd,
  BudgetIconAutoPush,
  BudgetIconClear,
  BudgetIconDuplicate,
  BudgetIconExcel,
  BudgetIconEyeOff,
  BudgetIconHide,
  BudgetIconImport,
  BudgetIconPdf,
  BudgetIconPush,
  BudgetIconRemove,
  BudgetIconSelectAll,
  BudgetIconSplit,
} from "../components/budget/BudgetLineToolbarIcons";
import { BudgetBucketsModal } from "../components/budget/BudgetSettingsModal";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import { useAuth } from "../contexts/AuthContext";
import {
  coerceTransmittalContract,
  budgetProfileValues,
  hasTransmittalContractSwitch,
  TRANSMITTAL_CONTRACT_LABELS,
  transmittalPrintInfo,
} from "../lib/jobInfo";
import {
  contractManpowerAlreadyPushed,
  manpowerPushForContract,
  patchManpowerPushForContract,
} from "../lib/budgetManpowerPush";
import {
  applyBudgetContractSlice,
  mergeActiveBudgetContractSlice,
} from "../lib/budgetPerContract";
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
  computeManpowerBudgetHours,
  defaultTemplateDraftPatch,
  formatPct,
  resolveDefaultTemplateName,
} from "../lib/budgetMakerCore";
import { parseBudgetPdf } from "../lib/budgetPdfParse";
import { pushBudgetHoursToManpower } from "../lib/pushBudgetHoursToManpower";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultBudgetMaker,
  defaultBudgetLibrary,
  emptyBudgetScanLine,
  normalizeBudgetMaker,
  parseBudgetNumber,
  BUDGET_LINE_TABLE_COLS,
  BUDGET_LINE_TABLE_LABELS,
  type BudgetLibrary,
  type BudgetMakerData,
  type BudgetScanLine,
} from "../types/budgetMaker";

type Ctx = { project: ProjectForm; projectId: string };

function fmtMoney(n: number): string {
  return n ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
}

export function BudgetPage() {
  const { user, isAdmin } = useAuth();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading, load } = useProjectTradeData(projectId);
  const [library, setLibrary] = useState<BudgetLibrary | null>(null);
  const [draft, setDraft] = useState(() => defaultBudgetMaker(project.job_name));
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [targetBucket, setTargetBucket] = useState(0);
  const [showBuckets, setShowBuckets] = useState(false);
  const [splitLineId, setSplitLineId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pushingManpower, setPushingManpower] = useState(false);
  const [pdfDragOver, setPdfDragOver] = useState(false);
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
      const contract = coerceTransmittalContract(project, base.contract);
      const profile = budgetProfileValues(project, contract);
      setDraft(
        applyBudgetContractSlice(base, contract, profile.jobName, profile.grandTotal),
      );
    }
  }, [loading, tradeData.budget_maker, tradeData, project.job_name, project]);

  useEffect(() => {
    if (!library || loading) return;
    if (draft.buckets.length > 0) return;
    const tplPatch = defaultTemplateDraftPatch(library);
    if (!tplPatch) return;
    setDraft((d) => ({ ...d, ...tplPatch }));
  }, [library, loading, draft.contract, draft.buckets.length]);

  const contractJob = useMemo(
    () => transmittalPrintInfo(project, draft.contract),
    [project, draft.contract],
  );
  const profileBudget = useMemo(
    () => budgetProfileValues(project, draft.contract),
    [project, draft.contract],
  );
  const exportDraft = useMemo(
    () => ({
      ...draft,
      job_name: profileBudget.jobName,
      grand_total: profileBudget.grandTotal,
    }),
    [draft, profileBudget.grandTotal, profileBudget.jobName],
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
    () => computeSummaryMetrics(draft.lines, profileBudget.grandTotal),
    [draft.lines, profileBudget.grandTotal],
  );
  const summaryRows = useMemo(
    () => buildSummaryRows(draft.buckets, draft.lines, lib, draft.hide_zero_amounts),
    [draft.buckets, draft.lines, lib, draft.hide_zero_amounts],
  );
  const includeSupervisionInManpowerPush = draft.manpower_push_include_supervision === true;
  const manpowerHours = useMemo(
    () =>
      computeManpowerBudgetHours(
        draft.buckets,
        draft.lines,
        includeSupervisionInManpowerPush,
      ),
    [draft.buckets, draft.lines, includeSupervisionInManpowerPush],
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
    const profile = budgetProfileValues(project, draft.contract);
    const merged = mergeActiveBudgetContractSlice({
      ...draft,
      job_name: profile.jobName,
      grand_total: profile.grandTotal,
      saved_at: new Date().toLocaleString(),
    });
    const { budget_maker: _saved, ...rest } = tradeData;
    const ok = await save({ ...rest, budget_maker: merged });
    if (ok) {
      setDraft(applyBudgetContractSlice(merged, merged.contract, profile.jobName, profile.grandTotal));
      setSavedAt(merged.saved_at ?? null);
    }
    return ok;
  }

  async function handlePushToManpower() {
    const activeContract = draft.contract;
    if (contractManpowerAlreadyPushed(draft, activeContract)) return;

    const { pushHours, supervisionHours } = manpowerHours;
    if (!pushHours || pushHours <= 0) {
      setError(
        includeSupervisionInManpowerPush
          ? "Add man hours to the budget before pushing to Manpower."
          : "Add field man-hours to the budget before pushing (or enable Include supervision).",
      );
      return;
    }

    const jobLabel = [contractJob.job_number, contractJob.job_name].filter(Boolean).join(" ").trim();
    const contractLabel = TRANSMITTAL_CONTRACT_LABELS[activeContract];
    const supervisionNote =
      includeSupervisionInManpowerPush && supervisionHours > 0
        ? `\nIncludes ${supervisionHours.toFixed(1)} supervision hrs (990).`
        : supervisionHours > 0
          ? `\nSupervision (${supervisionHours.toFixed(1)} hrs) is excluded.`
          : "";
    const confirmed = window.confirm(
      `Push ${pushHours.toFixed(1)} budget hours to Manpower for the ${contractLabel} contract (${jobLabel || "this job"})?${supervisionNote}\n\nThis can only be done once per contract and cannot be undone from JobFlow.`,
    );
    if (!confirmed) return;

    setPushingManpower(true);
    setError(null);
    try {
      const saved = await handleSave();
      if (!saved) return;

      const { data, error: pushErr } = await pushBudgetHoursToManpower(
        projectId,
        pushHours,
        includeSupervisionInManpowerPush,
        activeContract,
      );
      if (pushErr) {
        setError(pushErr);
        return;
      }

      await load();
      if (data?.pushed_at) {
        setDraft((d) =>
          patchManpowerPushForContract(d, activeContract, {
            pushed_at: data.pushed_at,
            hours: data.budgeted_hours,
            include_supervision: includeSupervisionInManpowerPush,
            manpower_job_name: data.job_name,
          }),
        );
      }
    } finally {
      setPushingManpower(false);
    }
  }

  function manpowerPushControl() {
    const activeContract = draft.contract;
    const priorPush = manpowerPushForContract(draft, activeContract);
    if (priorPush?.pushed_at) {
      const incl = priorPush.include_supervision;
      const contractLabel = TRANSMITTAL_CONTRACT_LABELS[activeContract];
      return (
        <span
          className="budget-manpower-status-pill"
          role="status"
          title={`${contractLabel} budget hours were sent to Manpower Cal (one-time push per contract)`}
        >
          <span className="budget-manpower-status-dot" aria-hidden="true" />
          Manpower: {contractLabel} Manpower pushed{" "}
          {new Date(priorPush.pushed_at).toLocaleString()}
          {priorPush.hours != null ? ` · ${priorPush.hours.toFixed(1)} hrs` : ""}
          {incl != null ? (incl ? " · incl. supervision" : " · field only") : ""}
        </span>
      );
    }

    const pushHours = manpowerHours.pushHours;
    const contractLabel = TRANSMITTAL_CONTRACT_LABELS[activeContract];

    return (
      <div className="budget-manpower-push-actions">
        <label className="checkbox-inline budget-manpower-supervision-opt">
          <input
            type="checkbox"
            checked={includeSupervisionInManpowerPush}
            onChange={(e) => patch({ manpower_push_include_supervision: e.target.checked })}
          />
          Include supervision
        </label>
        <button
          type="button"
          className="btn btn-success btn-sm"
          disabled={pushingManpower || saving || !pushHours}
          onClick={() => void handlePushToManpower()}
          title={
            pushHours
              ? `Send ${contractLabel} budget man-hours to Manpower Cal (one time per contract)`
              : "Add man hours to the budget first"
          }
        >
          {pushingManpower
            ? "Pushing to Manpower…"
            : `Push ${pushHours ? pushHours.toFixed(1) : "0"} hrs (${contractLabel})`}
        </button>
      </div>
    );
  }

  async function handleDefaultTemplateChange(name: string) {
    if (!user) return;
    const nextLib = { ...lib, default_bucket_template: name };
    if (isAdmin) {
      const err = await saveBudgetLibrary(user.id, nextLib);
      if (err) {
        setError(err);
        return;
      }
      setLibrary(nextLib);
    } else {
      // Non-admins can pick a template for this session/job only.
      setLibrary(nextLib);
    }
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

  function pickPdfFromDataTransfer(dataTransfer: DataTransfer | null): File | null {
    if (!dataTransfer?.files.length) return null;
    return [...dataTransfer.files].find((file) => file.name.toLowerCase().endsWith(".pdf")) ?? null;
  }

  function onPdfDragEnter(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setPdfDragOver(true);
  }

  function onPdfDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setPdfDragOver(true);
  }

  function onPdfDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setPdfDragOver(false);
  }

  function onPdfDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setPdfDragOver(false);
    const file = pickPdfFromDataTransfer(e.dataTransfer);
    if (file) void onPdfFile(file);
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

  function selectAllVisibleLines() {
    if (!visibleLines.length) return;
    const allSelected = visibleLines.every((l) => selectedLineIds.has(l.id));
    setSelectedLineIds(allSelected ? new Set() : new Set(visibleLines.map((l) => l.id)));
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
    downloadBudgetExcel(exportDraft, lib);
    setError(null);
  }

  async function exportPdf() {
    if (!requireLines("export")) return;
    try {
      await downloadBudgetPdf(exportDraft, lib, contractJob.job_number);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    }
  }

  async function exportHoursPdf() {
    if (!requireLines("export")) return;
    try {
      await downloadHoursPdf(exportDraft, lib, contractJob.job_number);
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
    if (contract === draft.contract) return;
    setDraft((current) => {
      const stored = mergeActiveBudgetContractSlice(current);
      const profile = budgetProfileValues(project, contract);
      return applyBudgetContractSlice(stored, contract, profile.jobName, profile.grandTotal);
    });
    setSelectedLineIds(new Set());
    setTargetBucket(0);
    setSplitLineId(null);
    setError(null);
  }

  const hiddenCount = draft.lines.filter((l) => l.Hidden).length;
  const showContractSwitch = hasTransmittalContractSwitch(project);

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="stack budget-maker-page">
        {savedAt && (
          <div className="row-gap wrap budget-maker-page-header">
            <span className="muted small">Saved {savedAt}</span>
          </div>
        )}

        <section
          className={`card stack budget-tools-card${pdfDragOver ? " budget-lines-section-dragover" : ""}`}
          onDragEnter={onPdfDragEnter}
          onDragOver={onPdfDragOver}
          onDragLeave={onPdfDragLeave}
          onDrop={onPdfDrop}
        >
          <div className="budget-tools-row budget-tools-row--primary">
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowBuckets(true)}>
              Buckets…
            </button>
            <span className="budget-tools-spacer" aria-hidden="true" />
            {manpowerPushControl()}
          </div>

          <div className="budget-tools-row">
            <label
              className="btn btn-secondary btn-sm budget-toolbar-btn"
              style={scanning ? { opacity: 0.65, pointerEvents: "none" } : undefined}
              title="Import a Job Cost Summary PDF into line items"
            >
              <BudgetIconImport />
              {scanning ? "Scanning…" : "Import PDF"}
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
            <span className="budget-tools-divider" aria-hidden="true" />
            <div className="budget-attached-cluster" role="group" aria-label="Export">
              <span className="budget-attached-cluster-label">Export</span>
              <button type="button" className="budget-attached-cluster-btn" onClick={exportExcel}>
                <BudgetIconExcel />
                Excel
              </button>
              <button type="button" className="budget-attached-cluster-btn" onClick={() => void exportPdf()}>
                <BudgetIconPdf />
                Budget PDF
              </button>
              <button type="button" className="budget-attached-cluster-btn" onClick={() => void exportHoursPdf()}>
                <BudgetIconPdf />
                Hours PDF
              </button>
            </div>
            <button
              type="button"
              className={`budget-toggle-chip${draft.combine_cost_codes_on_export !== false ? " budget-toggle-chip--on" : ""}`}
              aria-pressed={draft.combine_cost_codes_on_export !== false}
              onClick={() =>
                patch({ combine_cost_codes_on_export: draft.combine_cost_codes_on_export === false })
              }
            >
              <span className="budget-toggle-chip-dot" aria-hidden="true" />
              Combine same codes
            </button>
            <button
              type="button"
              className={`budget-toggle-chip${draft.hide_zero_amounts ? " budget-toggle-chip--on" : ""}`}
              aria-pressed={draft.hide_zero_amounts}
              onClick={() => patch({ hide_zero_amounts: !draft.hide_zero_amounts })}
            >
              <span className="budget-toggle-chip-dot" aria-hidden="true" />
              Hide $0 rows
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

          <p className="budget-save-as-line">
            Will save as: <code>{budgetPdfName}</code>
            {" · "}
            <code>{budgetHoursPdfName}</code>
          </p>
        </section>

        <section className="card stack">
          {showContractSwitch && (
            <>
              <TradeContractTabs
                project={project}
                value={draft.contract}
                onChange={onContractChange}
                showJobLabel
              />
              <p className="muted small">
                Each contract has its own budget lines and buckets. Switch tabs to edit paint vs
                wallcovering separately; save keeps all contracts.
              </p>
            </>
          )}
          <div className="row-gap wrap budget-summary-inputs">
              <label className="budget-inline-label">
                {isAdmin ? "Default template" : "Template"}
                <select
                  value={resolveDefaultTemplateName(lib)}
                  disabled={!templateNames.length}
                  onChange={(e) => void handleDefaultTemplateChange(e.target.value)}
                >
                  <option value="">
                    {templateNames.length ? "— Select —" : "No saved templates"}
                  </option>
                  {templateNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="muted small budget-scan-status">{lineSourceLabel()}</span>
            </div>

          <div className="budget-metrics-bar">
            {[
              ["Budget", fmtMoney(metrics.budgetTotal), ""],
              ["Grand total", metrics.userGrandTotal != null ? fmtMoney(metrics.userGrandTotal) : "—", ""],
              ["Profit & OH", profit != null ? fmtMoney(profit) : "—", "ok"],
              ["Profit %", profit != null && metrics.userGrandTotal ? formatPct(profit, metrics.userGrandTotal) : "—", "ok"],
              ["Hours", metrics.totalHours ? String(Math.trunc(metrics.totalHours)) : "—", ""],
              ["Unassigned", fmtMoney(metrics.unassignedTotal), "warn"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className={`budget-metric ${tone}`}>
                <span className="muted small">{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section
          className={`card stack budget-lines-section${pdfDragOver ? " budget-lines-section-dragover" : ""}`}
          onDragEnter={onPdfDragEnter}
          onDragOver={onPdfDragOver}
          onDragLeave={onPdfDragLeave}
          onDrop={onPdfDrop}
        >
          <div className="budget-line-toolbar">
            <div className="budget-toolbar-group">
              <button type="button" className="btn btn-success btn-sm budget-toolbar-btn" onClick={addLine}>
                <BudgetIconAdd />
                Add
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm budget-toolbar-btn"
                onClick={duplicateSelectedLines}
                disabled={selectedLineIds.size === 0}
              >
                <BudgetIconDuplicate />
                Dupe
              </button>
            </div>

            <span className="budget-toolbar-divider" aria-hidden="true" />

            <div className="budget-toolbar-group">
              <button
                type="button"
                className="btn btn-secondary btn-sm budget-toolbar-btn"
                onClick={selectAllVisibleLines}
              >
                <BudgetIconSelectAll />
                {visibleLines.length > 0 && visibleLines.every((l) => selectedLineIds.has(l.id))
                  ? "Clear all"
                  : "Select all"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm budget-toolbar-btn"
                onClick={hideSelected}
                disabled={selectedLineIds.size === 0}
              >
                <BudgetIconHide />
                Hide
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm budget-toolbar-btn budget-toolbar-btn--danger"
                onClick={removeSelectedLines}
                disabled={selectedLineIds.size === 0}
              >
                <BudgetIconRemove />
                Delete
              </button>
            </div>

            <span className="budget-toolbar-divider" aria-hidden="true" />

            <div className="budget-attached-cluster" role="group" aria-label="Bucket actions">
              <span className="budget-attached-cluster-label">Bucket</span>
              <select
                className="budget-bucket-cluster-select"
                aria-label="Target bucket"
                value={String(targetBucket)}
                onChange={(e) => setTargetBucket(parseInt(e.target.value, 10))}
                disabled={!draft.buckets.length}
              >
                {draft.buckets.map((b, i) => (
                  <option key={i} value={String(i)}>
                    {bucketLabel(b, i, lib, { showIndex: false, showTemplate: false })}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="budget-attached-cluster-btn budget-attached-cluster-btn--push"
                onClick={pushSelected}
                disabled={selectedLineIds.size === 0}
              >
                <BudgetIconPush />
                Push
              </button>
              <button
                type="button"
                className="budget-attached-cluster-btn"
                onClick={clearSelectedBuckets}
                disabled={selectedLineIds.size === 0}
                title="Clear bucket assignment"
              >
                <BudgetIconClear />
                Clear
              </button>
              <button
                type="button"
                className="budget-attached-cluster-btn"
                onClick={openSplitDialog}
                disabled={selectedLineIds.size !== 1 || !draft.buckets.length}
                title="Split one line across buckets"
              >
                <BudgetIconSplit />
                Split
              </button>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm budget-toolbar-btn"
              onClick={runAutoPush}
              title="Auto-assign lines to buckets using rules"
            >
              <BudgetIconAutoPush />
              Auto-push
            </button>

            {selectedLineIds.size > 0 && (
              <span className="budget-selection-chip">
                {selectedLineIds.size} selected
                <button
                  type="button"
                  className="budget-selection-chip-clear"
                  onClick={() => setSelectedLineIds(new Set())}
                >
                  clear
                </button>
              </span>
            )}
          </div>

          {!draft.lines.length && (
            <p className="muted budget-drop-hint">
              Drag and drop a Job Cost Summary PDF here, use <strong>Import PDF</strong>, or click{" "}
              <strong>Add</strong> to enter job cost items by hand.
            </p>
          )}

          {draft.lines.length > 0 && (
            <div className="table-wrap budget-lines-table">
              <table>
                <colgroup>
                  <col className="budget-col-check" />
                  <col className="budget-col-bucket" />
                  <col className="budget-col-code" />
                  <col className="budget-col-desc" />
                  <col className="budget-col-amount" />
                  <col className="budget-col-hours" />
                </colgroup>
                <thead>
                  <tr>
                    <th></th>
                    {BUDGET_LINE_TABLE_COLS.map((c) => (
                      <th key={c}>{BUDGET_LINE_TABLE_LABELS[c] ?? c}</th>
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
                      <td>{bucketDisplay(line.Bucket, draft.buckets, lib, { showTemplate: false, showIndex: false })}</td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card stack">
          <h3>Bucket totals</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="budget-hours-pdf-check" title="Include on Hours PDF export">
                    <span className="sr-only">Hours PDF</span>
                    <BudgetIconEyeOff />
                  </th>
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
                  <tr
                    key={r.bucketIdx}
                    className={draft.buckets[r.bucketIdx]?.hide_from_hours_pdf ? "budget-hours-pdf-hidden" : undefined}
                  >
                    <td className="budget-hours-pdf-check">
                      <input
                        type="checkbox"
                        checked={!draft.buckets[r.bucketIdx]?.hide_from_hours_pdf}
                        title="Include on Hours PDF"
                        aria-label={`Include ${r.costCode || r.workItem} on Hours PDF`}
                        onChange={(e) => {
                          const buckets = draft.buckets.map((b, i) =>
                            i === r.bucketIdx
                              ? {
                                  ...b,
                                  hide_from_hours_pdf: e.target.checked ? undefined : true,
                                }
                              : b,
                          );
                          patch({ buckets });
                        }}
                      />
                    </td>
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

      {showBuckets && user && (
        <BudgetBucketsModal
          userId={user.id}
          library={lib}
          draft={draft}
          canEditCatalog={isAdmin}
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
