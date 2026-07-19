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
  PRIMARY_TRANSMITTAL_CONTENT_KEYS,
  TRANSMITTAL_CONTENT_CATEGORIES,
  applyInferredContentFlags,
  inferContentKeysFromPending,
  inferContentKeysFromTransmittal,
  loadTransmittalContentAutoOn,
  type TransmittalContentKey,
} from "../lib/transmittalCategories";
import {
  addItemsFromPaintHistory,
  addItemsFromWallcoveringHistory,
  appendPendingToEnclosures,
  buildAtticStockFromTransmittal,
  includedLogRowIds,
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

const DELIVERY_RADIO = ["FedEx", "UPS", "Courier", "Hand Delivered"] as const;

export function TransmittalPage() {
  const { user } = useAuth();
  const { branding, profile } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<TransmittalData>(defaultTransmittal());
  const [status, setStatus] = useState<string | null>(null);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [encDragFrom, setEncDragFrom] = useState<number | null>(null);
  const [encDragOver, setEncDragOver] = useState<number | null>(null);
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
  const [contentAutoOn, setContentAutoOn] = useState<TransmittalContentKey[]>([]);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

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

  useEffect(() => {
    void loadTransmittalContentAutoOn().then(setContentAutoOn);
  }, []);

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

  function reorderEnclosure(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setDraft((d) => {
      if (from >= d.enclosures.length || to >= d.enclosures.length) return d;
      const enclosures = [...d.enclosures];
      const [row] = enclosures.splice(from, 1);
      enclosures.splice(to, 0, row!);
      return { ...d, enclosures };
    });
  }

  async function onAddPendingIndices(indices: number[]) {
    if (!indices.length) {
      setError("No pending packages to add.");
      return;
    }
    const { transmittal: next, added, skipped } = appendPendingToEnclosures(draft, indices);
    if (!added && !skipped) {
      setError("No pending packages to add.");
      return;
    }
    let saved = removePendingItems(next, indices);
    const inferred = indices.flatMap((i) => {
      const item = draft.pending_submittal_queue?.[i];
      return item ? inferContentKeysFromPending(item) : [];
    });
    const autoOn = contentAutoOn.length ? contentAutoOn : await loadTransmittalContentAutoOn();
    saved = applyInferredContentFlags(saved, inferred, autoOn);
    await persistTransmittal(saved);
    if (skipped && !added) setStatus("Package(s) were already on the enclosure list.");
    else if (skipped) setStatus(`Added ${added} to enclosures. ${skipped} already on the list.`);
    else setStatus(`Added ${added} package(s) to enclosures.`);
    setError(null);
  }

  async function onAddAllPending() {
    await onAddPendingIndices((draft.pending_submittal_queue ?? []).map((_, i) => i));
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

  const inferredContentKeys = useMemo(() => inferContentKeysFromTransmittal(draft), [draft]);
  const autoAllowed = useMemo(() => new Set(contentAutoOn), [contentAutoOn]);
  const primaryCategories = TRANSMITTAL_CONTENT_CATEGORIES.filter((c) =>
    PRIMARY_TRANSMITTAL_CONTENT_KEYS.includes(c.key),
  );
  const overflowCategories = TRANSMITTAL_CONTENT_CATEGORIES.filter(
    (c) => !PRIMARY_TRANSMITTAL_CONTENT_KEYS.includes(c.key),
  );
  const visibleCategories = categoriesExpanded
    ? TRANSMITTAL_CONTENT_CATEGORIES
    : primaryCategories;
  const hiddenCategoryCount = overflowCategories.length;

  function toggleContentCategory(key: TransmittalContentKey) {
    patch({ [key]: !draft[key] });
  }

  if (loading) return <p className="muted">Loading transmittal…</p>;

  const queue = draft.pending_submittal_queue ?? [];
  const pendingCount = queue.length;
  const paintHistory = tradeData.paint_submittal_history ?? [];
  const wcHistory = tradeData.wallcovering_submittal_history ?? [];
  const frpHistory = tradeData.frp_submittal_history ?? [];
  const transmittalHistory = tradeData.transmittal_history ?? [];
  const enclosureCount = draft.enclosures.filter((e) => e.description.trim()).length;
  const includedEnclosureCount = draft.enclosures.filter(
    (e) => e.included && e.description.trim(),
  ).length;
  const enclosureStatusLabel =
    enclosureCount === 0
      ? "0 enclosures"
      : includedEnclosureCount === enclosureCount
        ? `${enclosureCount} · all included`
        : `${enclosureCount} · ${includedEnclosureCount} included`;
  const PENDING_PREVIEW = 3;
  const pendingHidden = Math.max(0, queue.length - PENDING_PREVIEW);
  const visiblePending = pendingExpanded ? queue : queue.slice(0, PENDING_PREVIEW);
  const allIncluded =
    enclosureCount > 0 && draft.enclosures.every((e) => !e.description.trim() || e.included);
  const buildSummary =
    pendingCount > 0
      ? `${includedEnclosureCount} enclosure${includedEnclosureCount === 1 ? "" : "s"} · ${pendingCount} pending not added`
      : `${includedEnclosureCount} enclosure${includedEnclosureCount === 1 ? "" : "s"} · ready`;

  return (
    <div className="stack transmittal-page">
      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <div className="row-gap wrap transmittal-tools-row">
        <button type="button" className="btn btn-secondary btn-small" onClick={onEmailRelay}>
          Email Relay
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={onOrderAtticStock}>
          Order Attic Stock
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setSentHistoryOpen(true)}>
          Transmittal history{transmittalHistory.length ? ` (${transmittalHistory.length})` : ""}
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setHistoryOpen(true)}>
          Submittal History
        </button>
      </div>

      <div className="transmittal-setup-grid">
        <div className="stack transmittal-main">
      <section className="card stack transmittal-section">
        <div className="transmittal-section-heading row-between wrap">
          <p className="transmittal-section-label">RECIPIENT &amp; SUBJECT</p>
          <div className="transmittal-job-heading row-gap wrap">
            <p className="transmittal-job-context muted small">
              {[transmittalJob.job_number.trim(), transmittalJob.job_name.trim()]
                .filter(Boolean)
                .join(" · ") || "Job # / name from Job Info"}
            </p>
            <button type="button" className="btn btn-secondary btn-small" onClick={pullFromJobInfo}>
              From Job Info
            </button>
          </div>
        </div>
        <div className="transmittal-header-grid">
          <label>
            Attn
            <input value={draft.to_name} onChange={(e) => patch({ to_name: e.target.value })} />
          </label>
          <label>
            GC Company
            <input value={draft.gc_name} onChange={(e) => patch({ gc_name: e.target.value })} />
          </label>
          <label>
            Address
            <textarea
              className="transmittal-address-field"
              rows={3}
              value={draft.to_address}
              onChange={(e) => patch({ to_address: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input value={draft.to_phone} onChange={(e) => patch({ to_phone: e.target.value })} />
          </label>
          <label>
            Subject
            <input value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} />
          </label>
          <div className="transmittal-meta-pair">
            <label>
              Date
              <DateInput value={draft.date} onChange={(v) => patch({ date: v })} />
            </label>
            <label>
              Transmittal #
              <input
                value={draft.transmittal_number}
                onChange={(e) => patchTransmittalNumber(e.target.value)}
                onBlur={normalizeActiveTransmittalNumber}
                placeholder="TR-001"
              />
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
        <div className="transmittal-section-heading row-between wrap">
          <p className="transmittal-section-label">Transmitting categories</p>
          <span className="muted small">Auto-set from enclosures · click to override</span>
        </div>
        <div className="transmittal-category-pills" role="group" aria-label="Transmitting categories">
          {visibleCategories.map(({ key, label }) => {
            const on = Boolean(draft[key]);
            const isAuto = on && autoAllowed.has(key) && inferredContentKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`transmittal-category-pill${on ? " is-on" : ""}${isAuto ? " is-auto" : ""}`}
                aria-pressed={on}
                onClick={() => toggleContentCategory(key)}
              >
                <span>{label}</span>
                {isAuto && <span className="transmittal-category-pill-auto">auto</span>}
              </button>
            );
          })}
          {!categoriesExpanded && hiddenCategoryCount > 0 && (
            <button
              type="button"
              className="transmittal-category-pill transmittal-category-pill--more"
              onClick={() => setCategoriesExpanded(true)}
            >
              + {hiddenCategoryCount} more
            </button>
          )}
          {categoriesExpanded && (
            <button
              type="button"
              className="transmittal-category-pill transmittal-category-pill--more"
              onClick={() => setCategoriesExpanded(false)}
            >
              Show less
            </button>
          )}
        </div>
      </section>

      <section className="card stack transmittal-section transmittal-enclosures-panel">
        <div className="transmittal-enc-panel-header">
          <div className="transmittal-enc-panel-title-row">
            <p className="transmittal-section-label">ENCLOSURES</p>
            <span className="muted small">{enclosureStatusLabel}</span>
          </div>
          <div className="transmittal-enc-panel-tools row-gap wrap">
            <label className="check transmittal-enc-inline-check">
              <input
                type="checkbox"
                checked={draft.include_paint_floor}
                onChange={(e) => patch({ include_paint_floor: e.target.checked })}
              />
              Floor paint
            </label>
            <label className="check transmittal-enc-inline-check">
              <input
                type="checkbox"
                checked={draft.include_wc_floor}
                onChange={(e) => patch({ include_wc_floor: e.target.checked })}
              />
              Floor WC
            </label>
            <label className="check transmittal-enc-inline-check">
              <input
                type="checkbox"
                checked={draft.show_for_column}
                onChange={(e) => patch({ show_for_column: e.target.checked })}
              />
              &quot;For&quot; column
            </label>
            <button type="button" className="btn btn-secondary btn-small" onClick={onRefreshEnclosures}>
              Refresh
            </button>
            <button type="button" className="btn btn-primary btn-small" onClick={() => setCustomLineOpen(true)}>
              + Add item
            </button>
          </div>
        </div>

        {queue.length > 0 && (
          <div className="transmittal-pending-strip">
            <div className="transmittal-pending-strip-head">
              <span className="muted small">Suggested from pending</span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => void onAddAllPending()}
              >
                Add all
              </button>
            </div>
            <ul className="transmittal-pending-strip-list">
              {visiblePending.map((item) => {
                const index = queue.indexOf(item);
                return (
                  <li key={item.id} className="transmittal-pending-strip-item">
                    <span className="transmittal-pending-strip-label">{pendingItemLabel(item)}</span>
                    <button
                      type="button"
                      className="btn btn-warning btn-small"
                      onClick={() => void onAddPendingIndices([index])}
                    >
                      Add
                    </button>
                  </li>
                );
              })}
            </ul>
            {!pendingExpanded && pendingHidden > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-small transmittal-pending-more"
                onClick={() => setPendingExpanded(true)}
              >
                + {pendingHidden} more…
              </button>
            )}
            {pendingExpanded && queue.length > PENDING_PREVIEW && (
              <button
                type="button"
                className="btn btn-ghost btn-small transmittal-pending-more"
                onClick={() => setPendingExpanded(false)}
              >
                Show less
              </button>
            )}
          </div>
        )}

        <div className="transmittal-enc-table">
          <div
            className={`transmittal-enc-header${draft.show_for_column ? " transmittal-enc-header--for" : ""}`}
          >
            <span className="transmittal-enc-handle-spacer" aria-hidden />
            <label className="transmittal-enc-check" title="Include all / none">
              <input
                type="checkbox"
                checked={allIncluded}
                disabled={!enclosureCount}
                onChange={(e) => {
                  const included = e.target.checked;
                  setDraft((d) => ({
                    ...d,
                    enclosures: d.enclosures.map((row) => ({ ...row, included })),
                  }));
                }}
                aria-label="Include all enclosures"
              />
            </label>
            <span className="muted small">Description</span>
            <span
              className="muted small transmittal-enc-stamp-head"
              title="Stamp digital copy on this enclosure description in the PDF"
            >
              Stamp
            </span>
            <span className="muted small">Copies</span>
            {draft.show_for_column && <span className="muted small">For</span>}
            <span className="transmittal-enc-remove-spacer" aria-hidden />
          </div>
          <div className="transmittal-enc-list">
            {draft.enclosures.map((row, index) => (
              <TransmittalEnclosureRow
                key={row.id}
                row={row}
                index={index}
                showForColumn={draft.show_for_column}
                dragging={encDragFrom === index}
                dragOver={encDragOver === index && encDragFrom !== index}
                onChange={(p) => patchEnclosure(index, p)}
                onDragStart={() => setEncDragFrom(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (encDragOver !== index) setEncDragOver(index);
                }}
                onDragLeave={() => {
                  if (encDragOver === index) setEncDragOver(null);
                }}
                onDrop={() => {
                  if (encDragFrom != null) reorderEnclosure(encDragFrom, index);
                  setEncDragFrom(null);
                  setEncDragOver(null);
                }}
                onDragEnd={() => {
                  setEncDragFrom(null);
                  setEncDragOver(null);
                }}
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
        </div>
      </section>

      <section className="card stack transmittal-section">
        <div className="transmittal-section-heading row-between wrap">
          <p className="transmittal-section-label">REMARKS</p>
          <select
            className="transmittal-remark-insert"
            value={remarkTemplateKey}
            aria-label="Insert remark template"
            onChange={(e) => {
              const id = e.target.value;
              setRemarkTemplateKey(id);
              if (id) applyRemarkTemplate(id);
            }}
          >
            <option value="">Insert template…</option>
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
        </div>
        <textarea
          rows={4}
          value={draft.remarks}
          onChange={(e) => patch({ remarks: e.target.value })}
          placeholder="Remarks"
          aria-label="Remarks"
        />
        <div className="transmittal-remarks-meta grid-2">
          <label>
            Copies to
            <input value={draft.copies_to} onChange={(e) => patch({ copies_to: e.target.value })} />
          </label>
          <label>
            By
            <input
              value={draft.signer_name}
              onChange={(e) => patch({ signer_name: e.target.value })}
              placeholder={profile.name || "From Settings"}
            />
          </label>
        </div>
      </section>
        </div>

        <aside className="card stack transmittal-build-rail">
          <h3>Build transmittal</h3>
          {showContractSwitch && (
            <TradeContractTabs
              project={project}
              value={draft.contract}
              onChange={onContractChange}
            />
          )}
          <div className="stack transmittal-build-checks">
            <div className="transmittal-build-sheet-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.include_paint_sheet}
                  onChange={(e) => patchIncludePaintSheet(e.target.checked)}
                />
                Include Paint sheet
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-small transmittal-sheet-pick-btn"
                onClick={() => setSheetPicker("paint")}
                title="Choose paint sheet(s)"
              >
                {draft.paint_submittal_nums.length
                  ? paintSheetLabel(draft.paint_submittal_nums)
                  : "Choose…"}
                <span aria-hidden> ▾</span>
              </button>
            </div>
            <div className="transmittal-build-sheet-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.include_wc_sheet}
                  onChange={(e) => patchIncludeWcSheet(e.target.checked)}
                />
                Include WC sheet
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-small transmittal-sheet-pick-btn"
                onClick={() => setSheetPicker("wallcovering")}
                title="Choose wallcovering sheet(s)"
              >
                {draft.wc_submittal_nums.length
                  ? paintSheetLabel(draft.wc_submittal_nums)
                  : "Choose…"}
                <span aria-hidden> ▾</span>
              </button>
            </div>
            <div className="transmittal-build-sheet-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.include_frp_sheet}
                  onChange={(e) => patchIncludeFrpSheet(e.target.checked)}
                />
                Include FRP sheet
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-small transmittal-sheet-pick-btn"
                onClick={() => setSheetPicker("frp")}
                title="Choose FRP sheet(s)"
              >
                {draft.frp_submittal_nums.length
                  ? paintSheetLabel(draft.frp_submittal_nums)
                  : "Choose…"}
                <span aria-hidden> ▾</span>
              </button>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.combine_enclosures}
                onChange={(e) => patchCombineEnclosures(e.target.checked)}
              />
              Combine into one PDF
            </label>
          </div>
          <div className="sds-options-actions stack transmittal-build-actions">
            <p className="sds-filename-preview muted small">
              PDF filename: <code>{outputFilename}</code>
            </p>
            <p
              className={`sds-readiness-line small${pendingCount ? " sds-readiness-line--warn" : enclosureCount ? " sds-readiness-line--ok" : ""}`}
            >
              {buildSummary}
            </p>
            <div className="stack transmittal-build-buttons">
              <button type="button" className="btn btn-primary" onClick={() => void onGenerate()}>
                Download PDF
              </button>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
                {saving ? "Saving…" : "Save draft"}
              </button>
            </div>
          </div>
        </aside>
      </div>

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
          superRoleLabel="ICBI super"
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
