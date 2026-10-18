import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { TransmittalCustomLineModal } from "../components/transmittal/TransmittalCustomLineModal";
import { TransmittalEmailRelayModal } from "../components/transmittal/TransmittalEmailRelayModal";
import { DateInput } from "../components/DateInput";
import { TransmittalEnclosureRow } from "../components/transmittal/TransmittalEnclosureRow";
import { TransmittalLogPickerModal } from "../components/transmittal/TransmittalLogPickerModal";
import { TransmittalSentHistoryModal, transmittalFromHistoryEntry } from "../components/transmittal/TransmittalSentHistoryModal";
import { TransmittalSheetPickerModal } from "../components/transmittal/TransmittalSheetPickerModal";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import { useLetterhead } from "../contexts/LetterheadContext";
import { useAuth } from "../contexts/AuthContext";
import {
  applyJobInfoToTransmittal,
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  projectHasFrp,
  projectHasWallcovering,
  transmittalPrintInfo,
} from "../lib/jobInfo";
import { loadPaintUserSettings } from "../lib/paintUserSettings";
import {
  loadSubmittalLogRows,
  markRowsSubmitted,
} from "../lib/submittalLogService";
import { applyTransmittalProfileDefaults } from "../lib/userProfile";
import {
  transmittalFilename,
} from "../lib/transmittalNumber";
import {
  applyTransmittalContractNumber,
  mergeActiveTransmittalNumber,
  startNewTransmittal,
} from "../lib/transmittalPerContract";
import { parseFlexibleDate } from "../lib/dateInputUtils";
import { remarkTemplateGroups, remarkTemplateSubject } from "../lib/transmittalRemarks";
import { downloadTransmittal } from "../lib/transmittalPrint";
import {
  defaultFrpSubmittalNum,
  defaultPaintSubmittalNum,
  defaultWallcoveringSubmittalNum,
} from "../lib/transmittalCombine";
import {
  addTransmittalHistoryEntry,
  archiveWorkingTransmittal,
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
  appendLogRowsToEnclosures,
  appendPendingToEnclosures,
  applyPendingSheetIncludes,
  includedLogRowIds,
  logRowAsPending,
  logRowSuggestionLabel,
  productPackageNumberForLogRow,
  paintSheetLabel,
  patchEnclosureList,
  pendingItemLabel,
  readyLogRowsForTransmittal,
  removePendingItems,
} from "../lib/transmittalHelpers";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import { useTradeDraftDirty } from "../lib/useTradeDraftDirty";
import { useUnsavedNavigationGuard } from "../contexts/UnsavedNavigationContext";
import {
  defaultTransmittal,
  emptyEnclosure,
  normalizeTransmittal,
  type TransmittalData,
  type TransmittalEnclosure,
} from "../types/tradeDocuments";
import type { ProjectForm } from "../types/database";
import type { SubmittalLogRow } from "../types/submittalLog";

type Ctx = { project: ProjectForm; projectId: string };

const DELIVERY_SEGMENTS = [
  { label: "FedEx", value: "FedEx" },
  { label: "UPS", value: "UPS" },
  { label: "Courier", value: "Courier" },
  { label: "Hand", value: "Hand Delivered" },
  { label: "Other", value: "Other" },
] as const;

export function TransmittalPage() {
  const { user } = useAuth();
  const { branding, profile } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const showWc = projectHasWallcovering(project.jobInfo);
  const showFrp = projectHasFrp(project.jobInfo);
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState<TransmittalData>(defaultTransmittal());
  const [status, setStatus] = useState<string | null>(null);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [logPickerOpen, setLogPickerOpen] = useState(false);
  const [logRows, setLogRows] = useState<SubmittalLogRow[]>([]);
  const [encDragFrom, setEncDragFrom] = useState<number | null>(null);
  const [encDragOver, setEncDragOver] = useState<number | null>(null);
  const [customLineOpen, setCustomLineOpen] = useState(false);
  const [sentHistoryOpen, setSentHistoryOpen] = useState(false);
  const [sheetPicker, setSheetPicker] = useState<"paint" | "wallcovering" | "frp" | null>(null);
  const [emailRelayOpen, setEmailRelayOpen] = useState(false);
  const [userSettings, setUserSettings] = useState<Awaited<ReturnType<typeof loadPaintUserSettings>> | null>(
    null,
  );
  const [remarkTemplateKey, setRemarkTemplateKey] = useState("");
  const [contentAutoOn, setContentAutoOn] = useState<TransmittalContentKey[]>([]);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [recipientEditor, setRecipientEditor] = useState<"auto" | "open" | "closed">("auto");
  const [recipientEditError, setRecipientEditError] = useState<string | null>(null);
  const [remarksOpen, setRemarksOpen] = useState(false);
  const remarksRef = useRef<HTMLTextAreaElement>(null);
  const recipientEditorProject = useRef(projectId);

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

  const reloadLogRows = useCallback(async () => {
    try {
      setLogRows(await loadSubmittalLogRows(projectId));
    } catch {
      /* suggestions stay empty if the log cannot load */
    }
  }, [projectId]);

  useEffect(() => {
    void reloadLogRows();
  }, [reloadLogRows]);

  useEffect(() => {
    if (remarksOpen) remarksRef.current?.focus();
  }, [remarksOpen]);

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

  function selectSentMode(mode: "enclosed" | "separate") {
    patch(
      mode === "enclosed"
        ? { cb_enclosed: true, cb_under_sep_cover: false }
        : { cb_enclosed: false, cb_under_sep_cover: true },
    );
  }

  function selectDeliveryMethod(method: string) {
    patch({ delivery_method: method, cb_via: true });
  }

  function finishRecipientEdit() {
    if (!draft.to_name.trim() || !draft.gc_name.trim() || !draft.to_address.trim()) {
      setRecipientEditError("Enter Attn, GC company, and address.");
      return;
    }
    setRecipientEditError(null);
    setRecipientEditor("closed");
  }

  function pullFromJobInfo() {
    setDraft((d) => {
      const next = applyJobInfoToTransmittal(d, project.contractor, project.jobInfo);
      const gcAddress = project.jobInfo.gc_address.trim();
      return gcAddress ? { ...next, to_address: gcAddress } : next;
    });
    setStatus("Filled recipient fields from Job Info.");
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
    const pendingItems = indices
      .map((i) => draft.pending_submittal_queue?.[i])
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const { transmittal: next, added, skipped } = appendPendingToEnclosures(draft, indices);
    if (!added && !skipped) {
      setError("No pending packages to add.");
      return;
    }
    let saved = removePendingItems(next, indices);
    const inferred = pendingItems.flatMap((item) => inferContentKeysFromPending(item));
    const autoOn = contentAutoOn.length ? contentAutoOn : await loadTransmittalContentAutoOn();
    saved = applyInferredContentFlags(saved, inferred, autoOn);
    saved = applyPendingSheetIncludes(saved, pendingItems);
    await persistTransmittal(saved);
    const linkedSheets =
      saved.include_paint_sheet || saved.include_wc_sheet || saved.include_frp_sheet;
    const sheetNote = linkedSheets ? " Trade sheet(s) selected under Build." : "";
    if (skipped && !added) setStatus(`Package(s) were already on the enclosure list.${sheetNote}`);
    else if (skipped) setStatus(`Added ${added} to enclosures. ${skipped} already on the list.${sheetNote}`);
    else setStatus(`Added ${added} package(s) to enclosures.${sheetNote}`);
    setError(null);
  }

  async function onAddAllPending() {
    await onAddPendingIndices((draft.pending_submittal_queue ?? []).map((_, i) => i));
  }

  async function onAddLogRows(rows: SubmittalLogRow[]) {
    if (!rows.length) {
      setError("No log rows to add.");
      return;
    }
    const { transmittal: next, added, skipped } = appendLogRowsToEnclosures(draft, rows);
    if (!added && !skipped) {
      setError("No log rows to add.");
      return;
    }
    setLogPickerOpen(false);
    const inferred = rows.flatMap((row) => inferContentKeysFromPending(logRowAsPending(row)));
    const autoOn = contentAutoOn.length ? contentAutoOn : await loadTransmittalContentAutoOn();
    const saved = applyInferredContentFlags(next, inferred, autoOn);
    await persistTransmittal(saved);
    const linkedSheets = saved.include_paint_sheet || saved.include_wc_sheet || saved.include_frp_sheet;
    const sheetNote = linkedSheets ? " Trade sheet(s) selected under Build." : "";
    if (skipped && !added) setStatus(`Log row(s) were already on the enclosure list.${sheetNote}`);
    else if (skipped) setStatus(`Added ${added} from the log. ${skipped} already on the list.${sheetNote}`);
    else setStatus(`Added ${added} from the submittal log.${sheetNote}`);
    setError(null);
  }

  async function onNewTransmittal() {
    const hasItems = draft.enclosures.some((row) => row.description.trim());
    if (
      !window.confirm(
        hasItems
          ? "Start a new transmittal? This one stays in History. Download PDF keeps this transmittal number."
          : "Start a new transmittal number? Recipient and cover setup stay. The enclosure list clears.",
      )
    ) {
      return;
    }
    const history = hasItems
      ? addTransmittalHistoryEntry(
          tradeData.transmittal_history ?? [],
          archiveWorkingTransmittal(draft, transmittalJob.job_number, transmittalJob.job_name),
        )
      : (tradeData.transmittal_history ?? []);
    const next = startNewTransmittal(mergeActiveTransmittalNumber(draft));
    const ok = await save({ ...tradeData, transmittal: next, transmittal_history: history });
    if (!ok) return;
    setDraft(next);
    syncBaseline(next);
    setStatus(`Transmittal ${next.transmittal_number} started.`);
    setError(null);
  }

  async function onSave() {
    const ok = await persistTransmittal(mergeActiveTransmittalNumber(draft));
    if (ok) setStatus("Transmittal saved.");
  }

  async function onGenerate() {
    const mergedDraft = mergeActiveTransmittalNumber({
      ...draft,
      include_wc_sheet: showWc ? draft.include_wc_sheet : false,
      include_frp_sheet: showFrp ? draft.include_frp_sheet : false,
    });
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
    const nextDraft = { ...mergedDraft, pending_submittal_queue: nextQueue };
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
    void reloadLogRows();
    setStatus(parts.join(" "));
    setError(null);
  }

  function onEmailRelay() {
    setEmailRelayOpen(true);
  }

  function applyRemarkTemplate(templateId: string) {
    if (!templateId) return;
    const groups = remarkTemplateGroups();
    const template = groups.flatMap((g) => g.templates).find((t) => t.id === templateId);
    if (!template) return;
    const subject = remarkTemplateSubject(template);
    if (
      draft.remarks.trim() &&
      draft.remarks.trim() !== template.text &&
      !window.confirm(`Replace current remarks with the selected template? Subject will be set to “${subject}”.`)
    ) {
      setRemarkTemplateKey("");
      return;
    }
    patch({ remarks: template.text, subject });
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

  if (recipientEditorProject.current !== projectId) {
    recipientEditorProject.current = projectId;
    setRecipientEditor("auto");
  }

  if (loading) return <p className="muted">Loading transmittal…</p>;

  const queue = draft.pending_submittal_queue ?? [];
  const readyLogRows = readyLogRowsForTransmittal(logRows, draft);
  const productPackets = [tradeData.sds_packet, ...(tradeData.sds_packet_history ?? [])].filter(
    (packet): packet is NonNullable<typeof packet> => Boolean(packet),
  );
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
  const recipientView = isDirty ? draft : buildDraftFromTradeData();
  const recipientAttn = recipientView.to_name.trim();
  const recipientCompany = recipientView.gc_name.trim();
  const recipientAddress = recipientView.to_address.replace(/\s+/g, " ").trim();
  const recipientPhone = recipientView.to_phone.trim();
  const recipientIncomplete = !recipientAttn || !recipientCompany || !recipientAddress;
  const showRecipientEditor = recipientEditor === "open" || (recipientEditor === "auto" && recipientIncomplete);
  const sentCover = recipientView.cb_enclosed
    ? "Enclosed"
    : recipientView.cb_under_sep_cover
      ? "Under separate cover"
      : "";
  const sentMethod =
    recipientView.delivery_method === "Hand Delivered"
      ? "Hand"
      : recipientView.delivery_method === "Other"
        ? recipientView.delivery_other_text.trim() || "Other"
        : recipientView.delivery_method.trim();
  const sentVia = [sentCover, sentMethod ? `via ${sentMethod}` : ""].filter(Boolean).join(" ");
  const addressComma = recipientAddress.indexOf(",");
  const addressLine1 = addressComma === -1 ? recipientAddress : recipientAddress.slice(0, addressComma + 1).trim();
  const addressLine2 = addressComma === -1 ? "" : recipientAddress.slice(addressComma + 1).trim();
  const recipientDateLong = (() => {
    const raw = recipientView.date.trim();
    if (!raw) return "—";
    const parsed = parseFlexibleDate(raw);
    if (!parsed) return raw;
    return parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  })();
  const copiesTo = recipientView.copies_to.trim();
  const jobLabel =
    [transmittalJob.job_number.trim(), transmittalJob.job_name.trim()].filter(Boolean).join(" · ") ||
    "Job # / name from Job Info";
  const sheetPickLabel = (nums: number[]) => (nums.length ? `Sheet ${paintSheetLabel(nums)}` : "Choose…");
  const enclosureLabel = `${enclosureCount} enclosure${enclosureCount === 1 ? "" : "s"}`;

  return (
    <div className="stack transmittal-page">
      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner banner-ok">{status}</div>}

      <div className="transmittal-setup-grid">
        <div className="stack transmittal-main">
      <section className="card transmittal-to-card" aria-label="To">
        <div className="transmittal-to-head">
          <p className="transmittal-to-caption">
            <span className="transmittal-section-label">To</span>
            <span className="transmittal-to-job">· {jobLabel}</span>
          </p>
          <div className="transmittal-to-actions">
            <button
              type="button"
              className="transmittal-to-icon"
              title="Refresh from job info"
              aria-label="Refresh from job info"
              onClick={pullFromJobInfo}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M21 12a9 9 0 0 1-15.5 6.4" />
                <path d="M3 12a9 9 0 0 1 15.5-6.4" />
                <path d="M21 3v6h-6" />
                <path d="M3 21v-6h6" />
              </svg>
            </button>
            {!showRecipientEditor && (
              <button
                type="button"
                className="transmittal-to-icon"
                title="Edit"
                aria-label="Edit"
                onClick={() => {
                  setRecipientEditError(null);
                  setRecipientEditor("open");
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {showRecipientEditor ? (
          <>
            <div className="transmittal-recipient-fields">
              <div className="transmittal-recipient-row transmittal-recipient-row-1">
                <label>
                  Attn
                  <input value={draft.to_name} onChange={(e) => patch({ to_name: e.target.value })} />
                </label>
                <label>
                  GC Company
                  <input value={draft.gc_name} onChange={(e) => patch({ gc_name: e.target.value })} />
                </label>
                <label>
                  Phone
                  <input value={draft.to_phone} onChange={(e) => patch({ to_phone: e.target.value })} />
                </label>
              </div>
              <label>
                Address
                <input value={draft.to_address} onChange={(e) => patch({ to_address: e.target.value })} />
              </label>
              <div className="transmittal-recipient-row transmittal-recipient-row-3">
                <label>
                  Subject
                  <input value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} />
                </label>
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
              <div className="transmittal-recipient-row transmittal-recipient-row-2">
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
            </div>
            <div className="transmittal-sent-bar">
              <span className="transmittal-sent-word">Sent</span>
              <div className="transmittal-segment" role="group" aria-label="How items are sent">
                <button
                  type="button"
                  className={draft.cb_enclosed ? "is-on" : ""}
                  aria-pressed={draft.cb_enclosed}
                  onClick={() => selectSentMode("enclosed")}
                >
                  Enclosed
                </button>
                <button
                  type="button"
                  className={!draft.cb_enclosed && draft.cb_under_sep_cover ? "is-on" : ""}
                  aria-pressed={!draft.cb_enclosed && draft.cb_under_sep_cover}
                  onClick={() => selectSentMode("separate")}
                >
                  Separate cover
                </button>
              </div>
              <span className="transmittal-sent-word">via</span>
              <div className="transmittal-segment" role="group" aria-label="Delivery method">
                {DELIVERY_SEGMENTS.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    className={draft.delivery_method === method.value ? "is-on" : ""}
                    aria-pressed={draft.delivery_method === method.value}
                    onClick={() => selectDeliveryMethod(method.value)}
                  >
                    {method.label}
                  </button>
                ))}
              </div>
              {draft.delivery_method === "Other" && (
                <input
                  className="transmittal-other-input"
                  value={draft.delivery_other_text}
                  onChange={(e) => patch({ delivery_other_text: e.target.value })}
                  placeholder="(specify)"
                  aria-label="Other delivery method"
                />
              )}
            </div>
            {recipientEditError && <p className="transmittal-edit-error">{recipientEditError}</p>}
            <div className="transmittal-edit-done">
              <button type="button" className="btn btn-secondary btn-small" onClick={finishRecipientEdit}>
                Done
              </button>
            </div>
          </>
        ) : (
          <div className="transmittal-to-summary">
            <div className="transmittal-to-who">
              <p className="transmittal-to-attn">{recipientAttn || "—"}</p>
              <p>{recipientCompany || "—"}</p>
              <p>{addressLine1 || "—"}</p>
              {addressLine2 ? <p>{addressLine2}</p> : null}
              <p>{recipientPhone || "—"}</p>
            </div>
            <dl className="transmittal-to-meta">
              <dt>No.</dt>
              <dd>{recipientView.transmittal_number.trim() || "—"}</dd>
              <dt>Date</dt>
              <dd>{recipientDateLong}</dd>
              <dt>Subject</dt>
              <dd>{recipientView.subject.trim() || "—"}</dd>
              <dt>Sent</dt>
              <dd>{sentVia || "—"}</dd>
              {copiesTo ? (
                <>
                  <dt>CC</dt>
                  <dd>{copiesTo}</dd>
                </>
              ) : null}
              <dt>By</dt>
              <dd>{recipientView.signer_name.trim() || "—"}</dd>
            </dl>
          </div>
        )}
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
        <div className="transmittal-remarks-fold">
          <div className="transmittal-remarks-fold-head">
            <button
              type="button"
              className="transmittal-remarks-toggle"
              aria-expanded={remarksOpen}
              onClick={() => setRemarksOpen((open) => !open)}
            >
              <svg
                className={`transmittal-remarks-chevron${remarksOpen ? " is-open" : ""}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
              <span className="transmittal-section-label">Remarks</span>
            </button>
            {remarksOpen ? (
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
            ) : (
              <button
                type="button"
                className="transmittal-remarks-preview"
                onClick={() => setRemarksOpen(true)}
              >
                {draft.remarks.trim() || "Add remarks"}
              </button>
            )}
          </div>
          {remarksOpen && (
            <textarea
              ref={remarksRef}
              rows={4}
              value={draft.remarks}
              onChange={(e) => patch({ remarks: e.target.value })}
              placeholder="Remarks"
              aria-label="Remarks"
            />
          )}
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
                {sheetPickLabel(draft.paint_submittal_nums)}
                <span aria-hidden> ▾</span>
              </button>
            </div>
            {showWc && (
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
                {sheetPickLabel(draft.wc_submittal_nums)}
                <span aria-hidden> ▾</span>
              </button>
            </div>
            )}
            {showFrp && (
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
                {sheetPickLabel(draft.frp_submittal_nums)}
                <span aria-hidden> ▾</span>
              </button>
            </div>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={draft.combine_enclosures}
                onChange={(e) => patchCombineEnclosures(e.target.checked)}
              />
              Combine into one PDF
            </label>
          </div>
          <div className="transmittal-build-spacer" />
          <div className="sds-options-actions stack transmittal-build-actions">
            <div className="sds-package-actions">
              <p className={`transmittal-build-status${readyLogRows.length ? " transmittal-build-status--warn" : " transmittal-build-status--ok"}`}>
                {readyLogRows.length ? (
                  <>
                    {enclosureLabel} · {readyLogRows.length} from log not added ·{" "}
                    <button type="button" className="transmittal-readiness-add" onClick={() => setLogPickerOpen(true)}>
                      Add
                    </button>
                  </>
                ) : (
                  <>{enclosureLabel} · ready</>
                )}
              </p>
              <div className="transmittal-download-row">
                <button type="button" className="btn btn-primary" title={outputFilename} onClick={() => void onGenerate()}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M12 4v10" />
                    <path d="m7 11 5 5 5-5" />
                    <path d="M5 19h14" />
                  </svg>
                  Download PDF
                </button>
                <span className="transmittal-icon-tip">
                  <button type="button" className="btn btn-secondary transmittal-mail-btn" title="Email Relay" aria-label="Email Relay" onClick={onEmailRelay}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 7 9-7" />
                    </svg>
                  </button>
                  <span className="paint-toolbar-download-tip" role="tooltip">Email Relay</span>
                </span>
              </div>
              <div className="sds-package-actions-row">
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <path d="M17 21v-8H7v8" />
                    <path d="M7 3v5h8" />
                  </svg>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setSentHistoryOpen(true)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v5l3 2" />
                  </svg>
                  History
                </button>
              </div>
              <hr className="sds-package-actions-rule" />
              <button type="button" className="sds-package-new" disabled={saving} onClick={() => void onNewTransmittal()}>
                + New transmittal
              </button>
            </div>
          </div>
        </aside>
      </div>

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
                checked={draft.show_for_column}
                onChange={(e) => patch({ show_for_column: e.target.checked })}
              />
              &quot;For&quot; column
            </label>
            <div className="transmittal-enc-add-row">
              <button type="button" className="btn btn-secondary btn-small transmittal-enc-add-btn" onClick={() => setLogPickerOpen(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M8 6h13M8 12h13M8 18h13" />
                  <path d="M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                From log{readyLogRows.length ? ` (${readyLogRows.length})` : ""}
              </button>
              <button type="button" className="btn btn-secondary btn-small transmittal-enc-add-btn" onClick={() => setCustomLineOpen(true)}>
                + Add item
              </button>
            </div>
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
                      className="btn btn-secondary btn-small"
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
            {draft.enclosures.map((row, index) =>
              row.description.trim() ? (
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
              ) : null,
            )}
          </div>
        </div>
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

      {logPickerOpen ? (
        <TransmittalLogPickerModal
          rows={readyLogRows}
          labelFor={(row) => logRowSuggestionLabel(row, productPackageNumberForLogRow(row, productPackets))}
          onAdd={(rows) => void onAddLogRows(rows)}
          onClose={() => setLogPickerOpen(false)}
        />
      ) : null}

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

    </div>
  );
}
