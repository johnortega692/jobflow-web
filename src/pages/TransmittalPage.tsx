import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { TransmittalCustomLineModal } from "../components/transmittal/TransmittalCustomLineModal";
import { TransmittalEmailRelayModal } from "../components/transmittal/TransmittalEmailRelayModal";
import { EmailVendorModal } from "../components/paint/EmailVendorModal";
import { DateInput } from "../components/DateInput";
import { TransmittalEnclosureRow } from "../components/transmittal/TransmittalEnclosureRow";
import { TransmittalHistoryPickerModal } from "../components/transmittal/TransmittalHistoryPickerModal";
import { TransmittalSentHistoryModal, transmittalFromHistoryEntry } from "../components/transmittal/TransmittalSentHistoryModal";
import { TransmittalSheetPickerModal } from "../components/transmittal/TransmittalSheetPickerModal";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import { useLetterhead } from "../contexts/LetterheadContext";
import { useAuth } from "../contexts/AuthContext";
import {
  applyJobInfoToTransmittal,
  applyTransmittalContractIfDistinct,
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  icbiSuperEmail,
  icbiSuperintendent,
  transmittalPrintInfo,
} from "../lib/jobInfo";
import { loadPaintUserSettings } from "../lib/paintUserSettings";
import {
  loadSubmittalLogRows,
  markRowsSubmitted,
} from "../lib/submittalLogService";
import { applyTransmittalProfileDefaults } from "../lib/userProfile";
import {
  nextTransmittalNumber,
  transmittalFilename,
} from "../lib/transmittalNumber";
import {
  applyTransmittalContractNumber,
  bumpTransmittalNumberForContract,
  mergeActiveTransmittalNumber,
} from "../lib/transmittalPerContract";
import { remarkTemplateGroups } from "../lib/transmittalRemarks";
import { downloadTransmittal } from "../lib/transmittalPrint";
import {
  defaultFrpSubmittalNum,
  defaultPaintSubmittalNum,
  defaultWallcoveringSubmittalNum,
} from "../lib/transmittalCombine";
import {
  addTransmittalHistoryEntry,
  buildTransmittalHistoryEntry,
} from "../lib/transmittalSendHistory";
import {
  addItemsFromPaintHistory,
  addItemsFromWallcoveringHistory,
  appendPendingToEnclosures,
  buildAtticStockFromTransmittal,
  includedLogRowIds,
  moveEnclosure,
  paintSheetLabel,
  patchEnclosureList,
  pendingItemLabel,
  refreshEnclosuresFromTradeData,
  removePendingItems,
} from "../lib/transmittalHelpers";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import type { AtticStockCustomItem, AtticStockPaintItem } from "../lib/paintVendorEmail";
import {
  type PaintItem,
  type WallcoveringItem,
  defaultTransmittal,
  emptyEnclosure,
  normalizeTransmittal,
  type TransmittalData,
  type TransmittalEnclosure,
} from "../types/tradeDocuments";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

const CONTENT_CHECKS: { key: keyof TransmittalData; label: string }[] = [
  { key: "cb_submittal", label: "Submittal" },
  { key: "cb_product_data", label: "Product Data" },
  { key: "cb_samples", label: "Samples" },
  { key: "cb_shop_drawings", label: "Shop Drawings" },
  { key: "cb_om_manuals", label: "O&M Manuals" },
  { key: "cb_plans", label: "Plans" },
  { key: "cb_letters", label: "Letters" },
  { key: "cb_specifications", label: "Specifications" },
  { key: "cb_prints", label: "Prints" },
  { key: "cb_addenda", label: "Addenda" },
  { key: "cb_change_orders", label: "Change Orders" },
  { key: "cb_sds_safety", label: "SDS/Safety" },
  { key: "cb_arch_drawings", label: "Architectural Drawings" },
  { key: "cb_invoices", label: "Invoices" },
  { key: "cb_eng_drawings", label: "Engineering Drawings" },
];

const DELIVERY_RADIO = ["FedEx", "UPS", "Courier", "Hand Delivered"] as const;

export function TransmittalPage() {
  const { user } = useAuth();
  const { branding, profile } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<TransmittalData>(defaultTransmittal());
  const [status, setStatus] = useState<string | null>(null);
  const [pendingSelected, setPendingSelected] = useState<number[]>([]);
  const [customLineOpen, setCustomLineOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sentHistoryOpen, setSentHistoryOpen] = useState(false);
  const [sheetPicker, setSheetPicker] = useState<"paint" | "wallcovering" | "frp" | null>(null);
  const [emailRelayOpen, setEmailRelayOpen] = useState(false);
  const [atticStockOpen, setAtticStockOpen] = useState(false);
  const [atticStockData, setAtticStockData] = useState<{
    paintItems: AtticStockPaintItem[];
    customItems: AtticStockCustomItem[];
  } | null>(null);
  const [userSettings, setUserSettings] = useState<Awaited<ReturnType<typeof loadPaintUserSettings>> | null>(
    null,
  );
  const [remarkTemplateKey, setRemarkTemplateKey] = useState("");

  const showContractSwitch = hasTransmittalContractSwitch(project);
  const transmittalJob = useMemo(
    () => transmittalPrintInfo(project, draft.contract),
    [project, draft.contract],
  );

  const outputFilename = useMemo(
    () =>
      transmittalFilename(
        transmittalJob.job_name,
        transmittalJob.job_number,
        draft.transmittal_number,
      ),
    [transmittalJob.job_name, transmittalJob.job_number, draft.transmittal_number],
  );

  const buildDraftFromTradeData = useCallback(() => {
    const base = normalizeTransmittal(tradeData.transmittal);
    const withProfile = applyTransmittalProfileDefaults(base, profile, branding);
    const withJobInfo = applyJobInfoToTransmittal(withProfile, project.contractor, project.jobInfo);
    return {
      ...withJobInfo,
      contract: coerceTransmittalContract(project, withJobInfo.contract),
    };
  }, [tradeData.transmittal, profile, branding, project]);

  const { isDirty, syncBaseline, readBaseline } = useTradeDraftDirty(draft, !loading);

  const persistTransmittal = useCallback(
    async (next: TransmittalData) => {
      setDraft(next);
      const ok = await save({ ...tradeData, transmittal: next });
      if (ok) {
        syncBaseline(next);
        setError(null);
        return true;
      }
      return false;
    },
    [tradeData, save, syncBaseline, setError],
  );

  const reloadDraft = useCallback(() => {
    const next = buildDraftFromTradeData();
    setDraft(next);
    syncBaseline(next);
  }, [buildDraftFromTradeData, syncBaseline]);

  const onDiscardUnsaved = useCallback(() => {
    const baseline = readBaseline();
    if (!baseline) return;
    setDraft(baseline);
  }, [readBaseline]);

  useUnsavedNavigationGuard({
    sectionLabel: "Transmittal",
    isDirty,
    onSave: () => persistTransmittal(draft),
    onDiscard: onDiscardUnsaved,
  });

  useEffect(() => {
    if (!loading) reloadDraft();
  }, [loading, reloadDraft]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPaintUserSettings(user.id).then(setUserSettings);
  }, [user?.id]);

  function patch(patch: Partial<TransmittalData>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function onContractChange(contract: TransmittalData["contract"]) {
    setDraft((current) => {
      const stored = mergeActiveTransmittalNumber(current);
      return applyTransmittalContractNumber(stored, contract);
    });
  }

  function patchTransmittalNumber(value: string) {
    setDraft((d) => ({ ...d, transmittal_number: value }));
  }

  function normalizeActiveTransmittalNumber() {
    setDraft((d) => mergeActiveTransmittalNumber(d));
  }

  function patchIncludePaintSheet(checked: boolean) {
    const next: Partial<TransmittalData> = { include_paint_sheet: checked };
    if (checked && !draft.paint_submittal_nums.length) {
      const num = defaultPaintSubmittalNum(tradeData);
      if (num) next.paint_submittal_nums = [num];
    }
    patch(next);
  }

  function patchIncludeWcSheet(checked: boolean) {
    const next: Partial<TransmittalData> = { include_wc_sheet: checked };
    if (checked && !draft.wc_submittal_nums.length) {
      const num = defaultWallcoveringSubmittalNum(tradeData);
      if (num) next.wc_submittal_nums = [num];
    }
    patch(next);
  }

  function patchIncludeFrpSheet(checked: boolean) {
    const next: Partial<TransmittalData> = { include_frp_sheet: checked };
    if (checked && !draft.frp_submittal_nums.length) {
      const num = defaultFrpSubmittalNum(tradeData);
      if (num) next.frp_submittal_nums = [num];
    }
    patch(next);
  }

  function patchCombineEnclosures(checked: boolean) {
    const next: Partial<TransmittalData> = { combine_enclosures: checked };
    if (checked && !draft.include_paint_sheet && defaultPaintSubmittalNum(tradeData)) {
      next.include_paint_sheet = true;
      if (!draft.paint_submittal_nums.length) {
        const num = defaultPaintSubmittalNum(tradeData);
        if (num) next.paint_submittal_nums = [num];
      }
    }
    patch(next);
  }

  function patchEnclosure(index: number, rowPatch: Partial<TransmittalEnclosure>) {
    setDraft((d) => ({
      ...d,
      enclosures: patchEnclosureList(d.enclosures, index, rowPatch),
    }));
  }

  function pullFromJobInfo() {
    setDraft((d) => {
      const next = applyJobInfoToTransmittal(d, project.contractor, project.jobInfo);
      const gcAddress = project.jobInfo.gc_address.trim();
      return gcAddress ? { ...next, to_address: gcAddress } : next;
    });
    setStatus("Filled recipient fields from Job Info.");
  }

  function onRefreshEnclosures() {
    setDraft((d) => refreshEnclosuresFromTradeData(d, tradeData));
    setStatus("Refreshed enclosure list from paint and wallcovering tabs.");
  }

  function togglePendingSelect(index: number) {
    setPendingSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }

  async function onAddPendingToEnclosures(all = false) {
    const indices = all
      ? (draft.pending_submittal_queue ?? []).map((_, i) => i)
      : pendingSelected;
    const { transmittal: next, added, skipped } = appendPendingToEnclosures(draft, indices);
    if (!added && !skipped) {
      setError(all ? "No pending packages to add." : "Select pending package(s) first.");
      return;
    }
    await persistTransmittal(next);
    setPendingSelected([]);
    if (skipped && !added) setStatus("Selected package(s) are already on the enclosure list.");
    else if (skipped) setStatus(`Added ${added} to enclosures. ${skipped} already on the list.`);
    else setStatus(`Added ${added} package(s) to enclosures.`);
    setError(null);
  }

  async function onRemovePending() {
    if (!pendingSelected.length) {
      setError("Select a pending package to remove.");
      return;
    }
    const next = removePendingItems(draft, pendingSelected);
    await persistTransmittal(next);
    setPendingSelected([]);
    setStatus("Removed pending package(s).");
  }

  async function onSave() {
    const ok = await persistTransmittal(mergeActiveTransmittalNumber(draft));
    if (ok) setStatus("Transmittal saved.");
  }

  async function onGenerate() {
    const mergedDraft = mergeActiveTransmittalNumber(draft);
    const ok = await persistTransmittal(mergedDraft);
    if (!ok) return;
    let pdfResult;
    try {
      pdfResult = await downloadTransmittal(transmittalJob, mergedDraft, branding, {
        projectForm: project,
        tradeData,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed");
      return;
    }

    const logIds = includedLogRowIds(mergedDraft);
    let stamped = 0;
    if (logIds.length) {
      try {
        const rows = await loadSubmittalLogRows(projectId);
        const toMark = rows.filter((r) => logIds.includes(r.id));
        if (toMark.length) {
          await markRowsSubmitted(projectId, toMark, mergedDraft.transmittal_number);
          stamped = toMark.length;
        }
      } catch {
        /* optional */
      }
    }

    const consumedPending = new Set(
      mergedDraft.enclosures.filter((e) => e.included && e.pending_id).map((e) => e.pending_id!),
    );
    const nextQueue = (mergedDraft.pending_submittal_queue ?? []).filter((p) => !consumedPending.has(p.id));
    const nextNumber = nextTransmittalNumber(mergedDraft.transmittal_number);
    const historyEntry = buildTransmittalHistoryEntry(
      mergedDraft,
      transmittalJob.job_number,
      transmittalJob.job_name,
      pdfResult,
    );
    const nextTransmittalHistory = addTransmittalHistoryEntry(
      tradeData.transmittal_history ?? [],
      historyEntry,
    );
    const nextDraft = bumpTransmittalNumberForContract(
      { ...mergedDraft, pending_submittal_queue: nextQueue },
      nextNumber,
    );
    const okAfter = await save({
      ...tradeData,
      transmittal: nextDraft,
      transmittal_history: nextTransmittalHistory,
    });
    if (okAfter) {
      setDraft(nextDraft);
      syncBaseline(nextDraft);
    }

    const parts = [`Transmittal downloaded as ${outputFilename}.`];
    if (pdfResult.combined) {
      parts.push(
        `Combined PDF includes the cover sheet plus ${pdfResult.appendedSheets} trade submittal sheet(s).`,
      );
    }
    if (pdfResult.missing.length) {
      parts.push(pdfResult.missing.join(" "));
    } else if (
      (mergedDraft.include_paint_sheet || mergedDraft.include_wc_sheet || mergedDraft.include_frp_sheet) &&
      !pdfResult.combined
    ) {
      parts.push("No trade submittal sheets were appended — check Include sheet options and Paint tab data.");
    }
    if (stamped) parts.push(`Stamped ${stamped} submittal log row(s) as Submitted.`);
    else if (logIds.length === 0) {
      parts.push("No submittal log rows stamped — link enclosures to log rows before generating.");
    }
    setStatus(parts.join(" "));
    setError(null);
  }

  function onEmailRelay() {
    setEmailRelayOpen(true);
  }

  function onOrderAtticStock() {
    const jobNumber = transmittalJob.job_number.trim();
    const jobName = transmittalJob.job_name.trim();
    if (!jobNumber || !jobName) {
      setError("Please fill in Job Number and Job Name (Job Info tab).");
      setStatus(null);
      return;
    }
    const result = buildAtticStockFromTransmittal(draft, tradeData);
    if (!result.ok) {
      setError(result.error);
      setStatus(null);
      return;
    }
    if (!userSettings) {
      setError("Paint vendor settings are still loading. Try again in a moment.");
      setStatus(null);
      return;
    }
    setAtticStockData({ paintItems: result.paintItems, customItems: result.customItems });
    setAtticStockOpen(true);
    setError(null);
    setStatus(null);
  }

  function applyRemarkTemplate(templateId: string) {
    if (!templateId) return;
    const groups = remarkTemplateGroups();
    const template = groups.flatMap((g) => g.templates).find((t) => t.id === templateId);
    if (!template) return;
    if (
      draft.remarks.trim() &&
      draft.remarks.trim() !== template.text &&
      !window.confirm("Replace current remarks with the selected template?")
    ) {
      setRemarkTemplateKey("");
      return;
    }
    patch({ remarks: template.text });
    setRemarkTemplateKey("");
  }

  if (loading) return <p className="muted">Loading transmittal…</p>;

  const queue = draft.pending_submittal_queue ?? [];
  const paintHistory = tradeData.paint_submittal_history ?? [];
  const wcHistory = tradeData.wallcovering_submittal_history ?? [];
  const frpHistory = tradeData.frp_submittal_history ?? [];
  const transmittalHistory = tradeData.transmittal_history ?? [];

  return (
    <div className="stack transmittal-page">
      <div className="row-between">
        <div>
          <h2>Transmittal</h2>
          <p className="muted small">
            Cover letter, enclosures, email relay, attic stock orders, and submittal log stamping.
          </p>
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onGenerate()}>
            Download PDF
          </button>
        </div>
      </div>

      <p className="sds-filename-preview muted small">
        PDF filename: <code>{outputFilename}</code>
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <section className="card stack transmittal-generate-section">
        <div className="row-gap wrap transmittal-generate-row">
          <button type="button" className="btn btn-secondary" onClick={onEmailRelay}>
            Email Relay
          </button>
          <button type="button" className="btn btn-secondary" onClick={pullFromJobInfo}>
            From Job Info
          </button>
          <button type="button" className="btn btn-secondary" onClick={onOrderAtticStock}>
            Order Attic Stock
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setSentHistoryOpen(true)}>
            Transmittal history{transmittalHistory.length ? ` (${transmittalHistory.length})` : ""}
          </button>
        </div>
        <p className="muted small">
          Check <strong>Include Paint sheet</strong> and <strong>Combine into one PDF</strong> to merge the
          transmittal cover with the paint submittal table. Issued history is used when available; otherwise
          the current Paint tab draft is included.
        </p>
        <div className="transmittal-sheet-row row-gap wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_paint_sheet}
              onChange={(e) => patchIncludePaintSheet(e.target.checked)}
            />
            Include Paint sheet
          </label>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setSheetPicker("paint")}>
            Choose…
          </button>
          <span className="muted small">{paintSheetLabel(draft.paint_submittal_nums)}</span>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_wc_sheet}
              onChange={(e) => patchIncludeWcSheet(e.target.checked)}
            />
            Include Wallcovering sheet
          </label>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setSheetPicker("wallcovering")}>
            Choose…
          </button>
          <span className="muted small">{paintSheetLabel(draft.wc_submittal_nums)}</span>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_frp_sheet}
              onChange={(e) => patchIncludeFrpSheet(e.target.checked)}
            />
            Include FRP sheet
          </label>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setSheetPicker("frp")}>
            Choose…
          </button>
          <span className="muted small">{paintSheetLabel(draft.frp_submittal_nums)}</span>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.combine_enclosures}
              onChange={(e) => patchCombineEnclosures(e.target.checked)}
            />
            Combine into one PDF
          </label>
        </div>
      </section>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">RECIPIENT &amp; SUBJECT</p>
        <div className="transmittal-header-grid">
          <div className="stack">
            <label>
              Attn:
              <input value={draft.to_name} onChange={(e) => patch({ to_name: e.target.value })} />
            </label>
            <label>
              GC Name:
              <input value={draft.gc_name} onChange={(e) => patch({ gc_name: e.target.value })} />
            </label>
            <label>
              Address:
              <textarea
                rows={3}
                value={draft.to_address}
                onChange={(e) => patch({ to_address: e.target.value })}
              />
            </label>
          </div>
          <div className="stack transmittal-header-right">
            {showContractSwitch && (
              <TradeContractTabs
                project={project}
                value={draft.contract}
                onChange={onContractChange}
              />
            )}
            <div className="transmittal-meta-row">
              <label>
                Date:
                <DateInput value={draft.date} onChange={(v) => patch({ date: v })} />
              </label>
              <label className="transmittal-meta-job-number">
                Job #:
                <input value={transmittalJob.job_number} readOnly className="readonly" />
              </label>
              <label className="transmittal-meta-number">
                Transmittal #:
                <input
                  value={draft.transmittal_number}
                  onChange={(e) => patchTransmittalNumber(e.target.value)}
                  onBlur={normalizeActiveTransmittalNumber}
                  placeholder="TR-001"
                />
              </label>
              <label className="transmittal-meta-subject">
                Subject:
                <input value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} />
              </label>
            </div>
            <label>
              Job Name:
              <input value={transmittalJob.job_name} readOnly className="readonly" />
            </label>
            <label>
              Phone:
              <input value={draft.to_phone} onChange={(e) => patch({ to_phone: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="transmittal-delivery-row">
          <span className="transmittal-delivery-label">Delivery Method:</span>
          <div className="row-gap wrap">
            {DELIVERY_RADIO.map((m) => (
              <label key={m} className="check">
                <input
                  type="radio"
                  name="delivery"
                  checked={draft.delivery_method === m}
                  onChange={() => patch({ delivery_method: m })}
                />
                {m}
              </label>
            ))}
            <label className="check">
              <input
                type="radio"
                name="delivery"
                checked={draft.delivery_method === "Other"}
                onChange={() => patch({ delivery_method: "Other" })}
              />
              Other
            </label>
            <input
              value={draft.delivery_other_text}
              onChange={(e) => patch({ delivery_other_text: e.target.value })}
              placeholder="(specify)"
              style={{ width: "10rem" }}
            />
          </div>
        </div>
        <div className="row-gap wrap transmittal-sent-row">
          <span>Items listed are being sent:</span>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_enclosed}
              onChange={(e) => patch({ cb_enclosed: e.target.checked })}
            />
            Enclosed
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_under_sep_cover}
              onChange={(e) => patch({ cb_under_sep_cover: e.target.checked })}
            />
            Under Separate Cover
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.cb_via}
              onChange={(e) => patch({ cb_via: e.target.checked })}
            />
            Via
          </label>
        </div>
      </section>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">WE ARE TRANSMITTING THE FOLLOWING TO YOU:</p>
        <div className="check-grid">
          {CONTENT_CHECKS.map(({ key, label }) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={Boolean(draft[key])}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">
          PENDING FOR NEXT SEND — double-click or Add to enclosures; Generate Transmittal stamps
          SUBMIT on checked rows
        </p>
        <div className="transmittal-pending-panel">
          <div className="transmittal-pending-list" role="listbox" aria-multiselectable="true">
            {!queue.length ? (
              <p className="muted small transmittal-pending-empty">
                No pending packages — build a submittal package or print a paint/wallcovering
                submittal with transmittal options checked to queue items here.
              </p>
            ) : (
              queue.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={pendingSelected.includes(index)}
                  className={`transmittal-pending-item${pendingSelected.includes(index) ? " selected" : ""}`}
                  onClick={() => togglePendingSelect(index)}
                  onDoubleClick={async () => {
                    const { transmittal: next, added } = appendPendingToEnclosures(draft, [index]);
                    if (added) {
                      await persistTransmittal(next);
                      setStatus("Added pending package to enclosures.");
                    }
                  }}
                >
                  {pendingItemLabel(item)}
                </button>
              ))
            )}
          </div>
          <div className="transmittal-pending-actions stack">
            <button
              type="button"
              className="btn btn-warning"
              onClick={() => void onAddPendingToEnclosures(false)}
            >
              Add to enclosures
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onAddPendingToEnclosures(true)}>
              Add all
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void onRemovePending()}>
              Remove
            </button>
          </div>
        </div>
      </section>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">
          LIST OF ENCLOSURES (SELECT AND REORDER; INCLUDE ONLY CHECKED)
        </p>
        <div className="transmittal-enc-toolbar row-gap wrap">
          <button type="button" className="btn btn-primary btn-small" onClick={onRefreshEnclosures}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary btn-small" onClick={() => setCustomLineOpen(true)}>
            Add Item
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                enclosures: d.enclosures.map((e) => ({ ...e, included: true })),
              }))
            }
          >
            Include all
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                enclosures: d.enclosures.map((e) => ({ ...e, included: false })),
              }))
            }
          >
            Exclude all
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_paint_floor}
              onChange={(e) => patch({ include_paint_floor: e.target.checked })}
            />
            Include Floor paint
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.include_wc_floor}
              onChange={(e) => patch({ include_wc_floor: e.target.checked })}
            />
            Include Floor WC
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.show_for_column}
              onChange={(e) => patch({ show_for_column: e.target.checked })}
            />
            Show For column
          </label>
        </div>
        <div className="transmittal-enc-list">
          {draft.enclosures.map((row, index) => (
            <TransmittalEnclosureRow
              key={row.id}
              row={row}
              index={index}
              showForColumn={draft.show_for_column}
              canMoveUp={index > 0}
              canMoveDown={index < draft.enclosures.length - 1}
              onChange={(p) => patchEnclosure(index, p)}
              onMoveUp={() =>
                setDraft((d) => ({ ...d, enclosures: moveEnclosure(d.enclosures, index, -1) }))
              }
              onMoveDown={() =>
                setDraft((d) => ({ ...d, enclosures: moveEnclosure(d.enclosures, index, 1) }))
              }
              onRemove={() =>
                setDraft((d) => ({
                  ...d,
                  enclosures:
                    d.enclosures.length > 1
                      ? d.enclosures.filter((_, i) => i !== index)
                      : [{ ...emptyEnclosure() }],
                }))
              }
            />
          ))}
        </div>
      </section>

      <button type="button" className="btn btn-primary btn-small transmittal-history-btn" onClick={() => setHistoryOpen(true)}>
        Submittal History
      </button>

      <section className="card stack transmittal-section">
        <p className="transmittal-section-label">REMARKS</p>
        <label>
          Remark template
          <select
            value={remarkTemplateKey}
            onChange={(e) => {
              const id = e.target.value;
              setRemarkTemplateKey(id);
              if (id) applyRemarkTemplate(id);
            }}
          >
            <option value="">Choose a remark template…</option>
            {remarkTemplateGroups().map(({ group, templates }) => (
              <optgroup key={group} label={group}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Remarks
          <textarea
            rows={4}
            value={draft.remarks}
            onChange={(e) => patch({ remarks: e.target.value })}
          />
        </label>
        <label>
          Copies To:
          <input value={draft.copies_to} onChange={(e) => patch({ copies_to: e.target.value })} />
        </label>
        <label>
          By:
          <input
            value={draft.signer_name}
            onChange={(e) => patch({ signer_name: e.target.value })}
            placeholder={profile.name || "From Settings"}
          />
        </label>
      </section>

      {customLineOpen && (
        <TransmittalCustomLineModal
          showForColumn={draft.show_for_column}
          onAdd={(payload) =>
            setDraft((d) => ({
              ...d,
              enclosures: [
                ...d.enclosures.filter((e) => e.description.trim()),
                { ...emptyEnclosure(), ...payload, included: true },
              ],
            }))
          }
          onClose={() => setCustomLineOpen(false)}
        />
      )}

      {historyOpen && (
        <TransmittalHistoryPickerModal
          paintHistory={paintHistory}
          wcHistory={wcHistory}
          onAddPaint={(entry, replace) => {
            setDraft((d) => {
              let next = addItemsFromPaintHistory(
                d,
                entry.items as PaintItem[],
                replace,
                d.include_paint_floor,
              );
              next = applyTransmittalContractIfDistinct(project, next, "paint");
              return next;
            });
            setHistoryOpen(false);
            setStatus(`Loaded paint submittal #${entry.submittal_number} into enclosures.`);
          }}
          onAddWallcovering={(entry, replace) => {
            setDraft((d) => {
              let next = addItemsFromWallcoveringHistory(
                d,
                entry.items as WallcoveringItem[],
                replace,
                d.include_wc_floor,
              );
              next = applyTransmittalContractIfDistinct(project, next, "wallcovering");
              return next;
            });
            setHistoryOpen(false);
            setStatus(`Loaded wallcovering submittal #${entry.submittal_number} into enclosures.`);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {sentHistoryOpen && (
        <TransmittalSentHistoryModal
          project={project}
          history={transmittalHistory}
          onLoadSnapshot={(entry) => {
            const loaded = transmittalFromHistoryEntry(entry);
            setDraft(loaded);
            setSentHistoryOpen(false);
            setStatus(`Loaded transmittal ${entry.transmittal_number} into draft. Save to keep changes.`);
          }}
          onClose={() => setSentHistoryOpen(false)}
        />
      )}

      {sheetPicker && (
        <TransmittalSheetPickerModal
          scope={sheetPicker}
          history={
            sheetPicker === "paint"
              ? paintHistory
              : sheetPicker === "wallcovering"
                ? wcHistory
                : frpHistory
          }
          selected={
            sheetPicker === "paint"
              ? draft.paint_submittal_nums
              : sheetPicker === "wallcovering"
                ? draft.wc_submittal_nums
                : draft.frp_submittal_nums
          }
          onSave={(nums) => {
            if (sheetPicker === "paint") patch({ paint_submittal_nums: nums, include_paint_sheet: nums.length > 0 });
            else if (sheetPicker === "wallcovering") patch({ wc_submittal_nums: nums, include_wc_sheet: nums.length > 0 });
            else patch({ frp_submittal_nums: nums, include_frp_sheet: nums.length > 0 });
            setSheetPicker(null);
          }}
          onClose={() => setSheetPicker(null)}
        />
      )}

      {emailRelayOpen && userSettings && (
        <TransmittalEmailRelayModal
          project={transmittalJob}
          transmittal={draft}
          composeEmailMethod={userSettings.compose_email_method}
          signature={userSettings.signature}
          logoUrl={branding.logoUrl}
          onClose={() => setEmailRelayOpen(false)}
          onDone={(msg) => {
            setStatus(msg);
            setError(null);
          }}
        />
      )}

      {atticStockOpen && userSettings && atticStockData && (
        <EmailVendorModal
          mode="attic_stock"
          jobNumber={transmittalJob.job_number}
          jobName={transmittalJob.job_name}
          items={atticStockData.paintItems}
          atticCustomItems={atticStockData.customItems}
          submittalType="revised"
          vendors={userSettings.vendors}
          defaultQty={userSettings.default_brushout_qty}
          signature={userSettings.signature}
          logoUrl={branding.logoUrl}
          superName={icbiSuperintendent(project.jobInfo)}
          superEmail={icbiSuperEmail(project.jobInfo)}
          foremanName={project.jobInfo?.icbi_foreman}
          foremanEmail={project.jobInfo?.icbi_foreman_email}
          composeEmailMethod={userSettings.compose_email_method}
          onClose={() => {
            setAtticStockOpen(false);
            setAtticStockData(null);
          }}
        />
      )}
    </div>
  );
}
