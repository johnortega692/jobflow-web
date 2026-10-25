import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ImportPaintPackageModal } from "../components/sds/ImportPaintPackageModal";
import { PackageHistoryModal } from "../components/sds/PackageHistoryModal";
import { SdsSectionEditorModal } from "../components/sds/SdsSectionEditorModal";
import { SdsSectionListRow } from "../components/sds/SdsSectionListRow";
import { DateInput } from "../components/DateInput";
import { useAuth } from "../contexts/AuthContext";
import { useLetterhead } from "../contexts/LetterheadContext";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import {
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  jobFullAddressOneLine,
  transmittalPrintInfo,
  type TransmittalContract,
} from "../lib/jobInfo";
import { loadPaintProducts, type PaintProduct } from "../lib/paintCatalog";
import { countPaintItemsMissingPrimer, paintScheduleSpecLabel, buildPaintSystemSchedule, snapshotFromPaintSchedule } from "../lib/paintSystemSchedule";
import { buildSdsPacketPdf, downloadPdfBytes, type BuildProgress } from "../lib/sdsPacketBuild";
import { fillItemImageUrlsFromTracker, resolveWcTrackerLines } from "../lib/fieldTrackerProject";
import { evaluatePacketReadiness } from "../lib/sdsPacketRequirements";
import {
  applyPaintPackageChoices,
  colorScheduleCoverValue,
  groupPaintItemsForPackage,
  packageScheduleWarning,
  paintItemsForPackageSchedule,
  paintPackageGaps,
  paintPackageImportSummary,
  type PaintPackageGroup,
} from "../lib/paintPackageLink";
import { appendSdsPacketSubmittalRow } from "../lib/sdsSubmittalIntegrations";
import { applySdsProfileDefaults } from "../lib/userProfile";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  defaultCoverPurpose,
  coverMainTitle,
  isPresetCoverPurpose,
  SDS_PACKET_TYPES,
  defaultSdsPacket,
  emptySdsSection,
  leadSpecSection,
  normalizePaintSubmittal,
  normalizeSdsPacket,
  normalizeSdsPacketHistory,
  normalizeWallcoveringSubmittal,
  paintItemSpecScope,
  sdsPacketOutputName,
  sdsSectionsFromWallcoveringItems,
  startNewSdsPackage,
  upsertSdsPacketHistory,
  type SdsPacketData,
  type SdsSection,
  type ProjectTradeData,
} from "../types/tradeDocuments";
import type { SdsPacketType } from "../lib/sdsPacketPresets";
import { formatSubmittalNumberDisplay } from "../lib/printCore";
import { setSelfPrimingNote, sortSdsSectionsBySpec } from "../lib/sdsSectionModel";

type Ctx = { project: ProjectForm; projectId: string };

type EditorState =
  | { mode: "add"; section: SdsSection }
  | { mode: "edit"; section: SdsSection }
  | null;

export function SdsPacketPage() {
  const { user } = useAuth();
  const { branding, profile } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState(defaultSdsPacket());
  const [history, setHistory] = useState<SdsPacketData[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [paintImportGroups, setPaintImportGroups] = useState<PaintPackageGroup[] | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [lastSpecSection, setLastSpecSection] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [products, setProducts] = useState<PaintProduct[]>([]);
  const [clearConfirm, setClearConfirm] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const coverPurposeRef = useRef<HTMLTextAreaElement>(null);

  function fitCoverPurpose(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    fitCoverPurpose(coverPurposeRef.current);
  }, [draft.cover_purpose]);

  useEffect(() => {
    if (!importOpen) return;
    function onPointer(event: MouseEvent) {
      if (!importMenuRef.current?.contains(event.target as Node)) setImportOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setImportOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [importOpen]);

  useEffect(() => {
    if (!loading) {
      const base = applySdsProfileDefaults(normalizeSdsPacket(tradeData.sds_packet), profile);
      setDraft({
        ...base,
        contract: coerceTransmittalContract(project, base.contract),
      });
      setHistory(normalizeSdsPacketHistory(tradeData.sds_packet_history));
    }
  }, [loading, tradeData.sds_packet, tradeData.sds_packet_history, profile, project]);

  const showContractSwitch = hasTransmittalContractSwitch(project);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    let cancelled = false;
    void loadPaintProducts(uid, { includeHidden: true })
      .then((rows) => {
        if (!cancelled) setProducts(rows);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const readiness = useMemo(
    () => evaluatePacketReadiness(draft.sections, draft.packet_type),
    [draft.sections, draft.packet_type],
  );

  const paintSubmittal = useMemo(
    () => normalizePaintSubmittal(tradeData.paint_submittal),
    [tradeData.paint_submittal],
  );

  const paintLinkGaps = useMemo(() => {
    const lead = leadSpecSection(paintSubmittal);
    const secondary = paintSubmittal.spec_sections?.[1]?.trim() ?? "";
    const groups = groupPaintItemsForPackage(
      paintSubmittal.items,
      (item) => (paintItemSpecScope(item) === "secondary" && secondary ? secondary : lead),
      products,
    );
    return paintPackageGaps(groups, draft.sections);
  }, [paintSubmittal, draft.sections, products]);

  const colorScheduleLabel = useMemo(() => {
    const hasProduct = paintSubmittal.items.some((item) => item.product.trim() || item.manufacturer.trim());
    if (!hasProduct) return "";
    return colorScheduleCoverValue(paintSubmittal.submittal_number, paintSubmittal.revision_number);
  }, [paintSubmittal]);

  const sectionStatus = useMemo(() => {
    const packageCount = draft.sections.length;
    if (!packageCount) return { tone: "warn" as const, text: "Empty" };
    if (draft.contract !== "paint") return null;
    const missing = paintLinkGaps.scheduleOnly.length;
    if (missing > 0) {
      return {
        tone: "warn" as const,
        text: `${missing} product${missing === 1 ? "" : "s"} from schedule not included`,
      };
    }
    if (!colorScheduleLabel) return null;
    return {
      tone: "ok" as const,
      text: `Matches Submittal #${formatSubmittalNumberDisplay(paintSubmittal.submittal_number)}`,
    };
  }, [
    colorScheduleLabel,
    draft.contract,
    draft.sections.length,
    paintLinkGaps.scheduleOnly.length,
    paintSubmittal.submittal_number,
  ]);

  function replaceSection(section: SdsSection) {
    if (section.spec_section.trim()) setLastSpecSection(section.spec_section.trim());
    setDraft((d) => ({
      ...d,
      sections: sortSdsSectionsBySpec(d.sections.map((s) => (s.id === section.id ? section : s))),
    }));
  }

  function addSectionRow(section: SdsSection) {
    if (section.spec_section.trim()) setLastSpecSection(section.spec_section.trim());
    setDraft((d) => ({
      ...d,
      sections: sortSdsSectionsBySpec([...d.sections, section]),
    }));
  }

  function reorderSection(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setDraft((d) => {
      if (from >= d.sections.length || to >= d.sections.length) return d;
      const fromSpec = d.sections[from]?.spec_section.trim() ?? "";
      const toSpec = d.sections[to]?.spec_section.trim() ?? "";
      // Only allow reorder within the same CSI so sort-by-spec stays stable.
      if (fromSpec !== toSpec) return d;
      const sections = [...d.sections];
      const [row] = sections.splice(from, 1);
      sections.splice(to, 0, row!);
      return { ...d, sections: sortSdsSectionsBySpec(sections) };
    });
  }

  function removeSection(id: string) {
    setDraft((d) => ({ ...d, sections: d.sections.filter((s) => s.id !== id) }));
  }

  function onPacketTypeChange(packet_type: SdsPacketType) {
    setDraft((d) => {
      const purposeIsPreset = isPresetCoverPurpose(d.packet_type, d.cover_purpose);
      const switchingToCustom = packet_type === "Custom";
      return {
        ...d,
        packet_type,
        cover_purpose: switchingToCustom
          ? purposeIsPreset
            ? ""
            : d.cover_purpose
          : purposeIsPreset
            ? defaultCoverPurpose(packet_type)
            : d.cover_purpose,
        cover_title: switchingToCustom
          ? d.cover_title.trim() || coverMainTitle(d.packet_type)
          : "",
      };
    });
  }

  function resetCoverPurpose() {
    setDraft((d) => ({ ...d, cover_purpose: defaultCoverPurpose(d.packet_type) }));
  }

  function paintScheduleGroups(): PaintPackageGroup[] {
    const paint = normalizePaintSubmittal(tradeData.paint_submittal);
    const lead = leadSpecSection(paint);
    const secondary = paint.spec_sections?.[1]?.trim() ?? "";
    return groupPaintItemsForPackage(
      paint.items,
      (item) => (paintItemSpecScope(item) === "secondary" && secondary ? secondary : lead),
      products,
    );
  }

  function applyPaintImport(groups: PaintPackageGroup[], targets: Record<string, string | null>) {
    const merged = applyPaintPackageChoices(draft.sections, groups, targets);
    setDraft((d) => ({
      ...d,
      sections: sortSdsSectionsBySpec(merged.sections),
      ...(showContractSwitch ? { contract: "paint" as const } : {}),
    }));
    setPaintImportGroups(null);
    setError(null);
    setSuccess(`${paintPackageImportSummary(merged.added, merged.updated)} Save to keep it.`);
  }

  function importFromPaint() {
    const groups = paintScheduleGroups();
    if (!groups.length) {
      setError("No products found on the color schedule.");
      return;
    }
    if (!draft.sections.length) {
      applyPaintImport(
        groups,
        Object.fromEntries(groups.map((group) => [group.key, null])),
      );
      return;
    }
    setPaintImportGroups(groups);
    setError(null);
  }

  function importFromWallcovering() {
    const wc = normalizeWallcoveringSubmittal(tradeData.wallcovering_submittal);
    if (!wc.items.length) {
      setError("Save wallcovering submittal line items first, then import.");
      return;
    }
    const imported = sdsSectionsFromWallcoveringItems(wc.items, wc.spec_section);
    if (!imported.length) {
      setError("No products found to import from wallcovering.");
      return;
    }
    mergeImportedSections(imported, "wallcovering");
  }

  function mergeImportedSections(imported: SdsSection[], contract?: TransmittalContract) {
    setDraft((d) => ({
      ...d,
      sections: sortSdsSectionsBySpec([...d.sections, ...imported]),
      ...(contract && showContractSwitch ? { contract } : {}),
    }));
    setError(null);
  }

  function openAddSection() {
    setEditor({
      mode: "add",
      section: { ...emptySdsSection(), spec_section: lastSpecSection },
    });
  }

  function openEditSection(section: SdsSection) {
    setEditor({ mode: "edit", section: { ...section } });
  }

  function onClearAll() {
    setClearConfirm(false);
    setDraft((d) => ({ ...d, sections: [] }));
  }

  function packetTrade(nextDraft: SdsPacketData, nextHistory: SdsPacketData[]): ProjectTradeData {
    return { ...tradeData, sds_packet: nextDraft, sds_packet_history: nextHistory };
  }

  function otherPackageSections(packetNumber: number): SdsSection[][] {
    const packets = history.filter((row) => row.submittal_number !== packetNumber);
    if (draft.submittal_number !== packetNumber) packets.push(draft);
    return packets.map((row) => row.sections);
  }

  async function catalogForSchedule(): Promise<PaintProduct[]> {
    if (products.length || !user?.id) return products;
    try {
      const rows = await loadPaintProducts(user.id, { includeHidden: true });
      setProducts(rows);
      return rows;
    } catch {
      return products;
    }
  }

  function computeScheduleSnapshot(packet: SdsPacketData, catalog: PaintProduct[]) {
    const items = paintItemsForPackageSchedule(
      paintSubmittal.items,
      packet.sections,
      otherPackageSections(packet.submittal_number),
    );
    const specSection = paintScheduleSpecLabel({ ...paintSubmittal, items });
    const schedule = buildPaintSystemSchedule(items, catalog, packet.sections, specSection);
    return snapshotFromPaintSchedule(schedule, packet.sections, specSection);
  }

  /** A schedule loaded from History stays as loaded. Refresh is the only recompute. */
  function withScheduleSnapshot(packet: SdsPacketData, catalog: PaintProduct[]): SdsPacketData {
    if (packet.contract !== "paint" || packet.paint_schedule) return packet;
    return { ...packet, paint_schedule: computeScheduleSnapshot(packet, catalog) };
  }

  async function onRefreshSchedule() {
    if (draft.contract !== "paint" || !draft.paint_schedule) return;
    if (!window.confirm("Replace the saved schedule with current paint items and primers?")) return;
    const catalog = await catalogForSchedule();
    const nextDraft = { ...draft, paint_schedule: computeScheduleSnapshot(draft, catalog) };
    const nextHistory = upsertSdsPacketHistory(history, nextDraft);
    setDraft(nextDraft);
    setHistory(nextHistory);
    const ok = await save(packetTrade(nextDraft, nextHistory));
    if (ok) {
      setError(null);
      setSuccess("Schedule refreshed from the Paint tab.");
    }
  }

  async function onSave() {
    const catalog = await catalogForSchedule();
    const archived = draft.sections.length ? withScheduleSnapshot(draft, catalog) : null;
    const nextHistory = archived ? upsertSdsPacketHistory(history, archived) : history;
    const ok = await save(packetTrade(draft, nextHistory));
    if (ok) {
      setHistory(nextHistory);
      setError(null);
      setSuccess("Submittal package saved.");
    }
  }

  async function onNewPackage() {
    if (
      !window.confirm(
        "Start a new package? This one stays in History. The next Packet PDF gets its own submittal log row.",
      )
    ) {
      return;
    }
    const catalog = await catalogForSchedule();
    const current = draft.sections.length ? withScheduleSnapshot(draft, catalog) : draft;
    const next = startNewSdsPackage(current, history);
    setDraft(next.draft);
    setHistory(next.history);
    const ok = await save(packetTrade(next.draft, next.history));
    if (ok) {
      setSuccess(`Package #${String(next.draft.submittal_number).padStart(3, "0")} started.`);
    }
  }

  async function onOpenHistoryPackage(packet: SdsPacketData) {
    if (packet.submittal_number === draft.submittal_number) {
      setHistoryOpen(false);
      return;
    }
    const catalog = await catalogForSchedule();
    const current = draft.sections.length ? withScheduleSnapshot(draft, catalog) : draft;
    const archived = draft.sections.length ? upsertSdsPacketHistory(history, current) : history;
    const opened = normalizeSdsPacket(packet);
    const nextHistory = upsertSdsPacketHistory(archived, opened);
    setDraft(opened);
    setHistory(nextHistory);
    setHistoryOpen(false);
    const ok = await save(packetTrade(opened, nextHistory));
    if (ok) {
      setSuccess(`Opened package #${String(opened.submittal_number).padStart(3, "0")}.`);
    }
  }

  async function onDeleteHistoryPackage(submittalNumber: number) {
    const label = `Package #${String(submittalNumber).padStart(3, "0")}`;
    if (!window.confirm(`Remove ${label} from history? The submittal log row stays.`)) return;
    const nextHistory = history.filter((packet) => packet.submittal_number !== submittalNumber);
    setHistory(nextHistory);
    const ok = await save(packetTrade(draft, nextHistory));
    if (ok) setSuccess(`${label} removed from history.`);
  }

  async function onBuild() {
    if (!draft.sections.length) return;
    let catalog = products;
    if (draft.contract === "paint" && !catalog.length && user?.id) {
      try {
        catalog = await loadPaintProducts(user.id, { includeHidden: true });
        setProducts(catalog);
      } catch {
        catalog = [];
      }
    }
    const savedSchedule = draft.contract === "paint" ? draft.paint_schedule : undefined;
    const packageItems =
      draft.contract === "paint" && !savedSchedule
        ? paintItemsForPackageSchedule(
            paintSubmittal.items,
            draft.sections,
            otherPackageSections(draft.submittal_number),
          )
        : [];
    const missingPrimers = savedSchedule
      ? savedSchedule.rows.filter((row) => !row.primer_name && !row.self_priming).length
      : draft.contract === "paint"
        ? countPaintItemsMissingPrimer(packageItems, catalog)
        : 0;
    const primerWarning =
      missingPrimers > 0
        ? `${missingPrimers} ${missingPrimers === 1 ? "item has" : "items have"} no primer. Generate anyway?`
        : "";
    const scheduleWarning =
      draft.contract === "paint"
        ? packageScheduleWarning(
            {
              scheduleOnly: paintLinkGaps.scheduleOnly,
              packageOnly: colorScheduleLabel ? paintLinkGaps.packageOnly : [],
            },
            paintSubmittal.submittal_number,
          )
        : "";
    const confirmParts = [primerWarning, scheduleWarning, readiness.gaps.length ? readiness.confirmMessage : ""].filter(
      Boolean,
    );
    if (confirmParts.length && !window.confirm(confirmParts.join("\n\n"))) {
      return;
    }

    setBuilding(true);
    setBuildProgress(null);
    setSuccess(null);
    setError(null);
    try {
      const historyPacket = draft.contract === "paint" ? withScheduleSnapshot(draft, catalog) : draft;
      const nextHistory = upsertSdsPacketHistory(history, historyPacket);
      const nextTrade: ProjectTradeData = packetTrade(draft, nextHistory);
      const ok = await save(nextTrade);
      if (!ok) return;
      setHistory(nextHistory);

      const outputName = sdsPacketOutputName(packageJob.job_name, packageJob.job_number, draft);
      const bytes = await buildSdsPacketPdf(
        {
          job_name: packageJob.job_name,
          job_number: packageJob.job_number,
          job_address: jobFullAddressOneLine(project, project.jobInfo),
        },
        draft,
        branding,
        setBuildProgress,
        {
          ...(draft.contract === "paint" && colorScheduleLabel ? { colorSchedule: colorScheduleLabel } : {}),
          ...(draft.contract === "paint" && !savedSchedule
            ? {
                paint: {
                  items: paintSubmittal.items,
                  products: catalog,
                  specSection: paintScheduleSpecLabel({ ...paintSubmittal, items: packageItems }),
                  otherPackageSections: otherPackageSections(draft.submittal_number),
                },
              }
            : {}),
          wallcoveringItems: fillItemImageUrlsFromTracker(
            normalizeWallcoveringSubmittal(tradeData.wallcovering_submittal).items,
            resolveWcTrackerLines(tradeData),
          ),
        },
      );
      downloadPdfBytes(bytes, outputName);

      const notes: string[] = [`Downloaded ${outputName}.`];
      const row = await appendSdsPacketSubmittalRow(projectId, draft);
      if (row?.created) {
        const packageNo = String(draft.submittal_number).padStart(3, "0");
        notes.push(`Submittal log row #${row.line_number} added for package #${packageNo}.`);
      }
      setSuccess(notes.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setBuilding(false);
      setBuildProgress(null);
    }
  }

  const packageJob = useMemo(
    () => transmittalPrintInfo(project, draft.contract),
    [project, draft.contract],
  );

  const outputFilename = useMemo(
    () => sdsPacketOutputName(packageJob.job_name, packageJob.job_number, draft),
    [packageJob.job_name, packageJob.job_number, draft],
  );

  if (loading) return <p className="muted">Loading submittal package…</p>;

  return (
    <div className="stack sds-packet-page">
      {historyOpen ? (
        <PackageHistoryModal
          history={history}
          currentNumber={draft.submittal_number}
          onOpen={(packet) => void onOpenHistoryPackage(packet)}
          onDelete={(submittalNumber) => void onDeleteHistoryPackage(submittalNumber)}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      {error && <div className="banner banner-error">{error}</div>}
      {success && <div className="banner banner-ok">{success}</div>}
      {buildProgress && (
        <div className="banner banner-warn">
          Building… {buildProgress.step} ({buildProgress.percent}%)
        </div>
      )}

      <div className="sds-setup-grid">
        <div className="card stack sds-cover-panel">
          {showContractSwitch && (
            <TradeContractTabs
              project={project}
              value={draft.contract}
              onChange={(contract) => setDraft({ ...draft, contract })}
              showJobLabel
            />
          )}
          <div className="stack sds-cover-fields">
            <label>
              Packet type
              <select value={draft.packet_type} onChange={(e) => onPacketTypeChange(e.target.value as SdsPacketType)}>
                {SDS_PACKET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {draft.packet_type === "Custom" ? (
              <label>
                Cover title
                <input
                  value={draft.cover_title}
                  onChange={(e) => setDraft({ ...draft, cover_title: e.target.value })}
                  placeholder={coverMainTitle("Custom")}
                />
              </label>
            ) : (
              <label>
                Cover title
                <input
                  className="readonly"
                  readOnly
                  value={coverMainTitle(draft.packet_type)}
                  tabIndex={-1}
                  aria-readonly
                />
              </label>
            )}
            <label className="stack">
              <span className="row-between wrap">
                <span>Cover purpose</span>
                {draft.packet_type !== "Custom" &&
                  draft.cover_purpose.trim() !== defaultCoverPurpose(draft.packet_type) && (
                    <button type="button" className="btn btn-ghost btn-small" onClick={resetCoverPurpose}>
                      Reset to default
                    </button>
                  )}
              </span>
              <textarea
                ref={coverPurposeRef}
                className="sds-cover-purpose"
                value={draft.cover_purpose}
                onChange={(e) => {
                  setDraft({ ...draft, cover_purpose: e.target.value });
                  fitCoverPurpose(e.currentTarget);
                }}
                rows={2}
                placeholder={
                  draft.packet_type === "Custom"
                    ? "Describe the purpose of this submittal…"
                    : defaultCoverPurpose(draft.packet_type)
                }
              />
            </label>
          </div>
          <div className="sds-cover-meta-row">
            <label>
              Date
              <DateInput value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
            </label>
            <label>
              Prepared by
              <input
                value={draft.preparer}
                onChange={(e) => setDraft({ ...draft, preparer: e.target.value })}
                placeholder={profile.name || "From Settings → Your profile"}
              />
            </label>
            <label className="sds-package-num-field">
              Package #
              <input
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={draft.submittal_number}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setDraft({
                    ...draft,
                    submittal_number: Number.isFinite(n) ? Math.min(99, Math.max(1, Math.trunc(n))) : 1,
                  });
                }}
              />
            </label>
          </div>
        </div>

        <div className="card stack sds-options-panel">
          <h3>Packet options</h3>
          <div className="stack sds-checks">
            <label className="check">
              <input
                type="checkbox"
                checked={draft.include_cover}
                onChange={(e) => setDraft({ ...draft, include_cover: e.target.checked })}
              />
              Cover page
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.include_toc}
                onChange={(e) => setDraft({ ...draft, include_toc: e.target.checked })}
              />
              Generate table of contents
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.include_dividers}
                onChange={(e) => setDraft({ ...draft, include_dividers: e.target.checked })}
              />
              Section dividers
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.include_stamp}
                onChange={(e) => setDraft({ ...draft, include_stamp: e.target.checked })}
              />
              Add banner to product data
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.include_end}
                onChange={(e) => setDraft({ ...draft, include_end: e.target.checked })}
              />
              End page
            </label>
          </div>
          <div className="sds-options-actions stack">
            <p
              className={`sds-readiness-line small${readiness.ready ? " sds-readiness-line--ok" : " sds-readiness-line--warn"}`}
            >
              {readiness.ready ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="m8 12 2.5 2.5L16 9" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="M10.3 4.8 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0z" />
                </svg>
              )}
              {readiness.sectionCount ? readiness.summaryLine : "No sections · nothing to build"}
            </p>
            <div className="sds-package-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={building || !draft.sections.length}
                title={outputFilename}
                onClick={() => void onBuild()}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 4v10" />
                  <path d="m7 11 5 5 5-5" />
                  <path d="M5 19h14" />
                </svg>
                {building ? "Building…" : "Packet PDF"}
              </button>
              <div className="sds-package-actions-row">
                <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <path d="M17 21v-8H7v8" />
                    <path d="M7 3v5h8" />
                  </svg>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setHistoryOpen(true)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v5l3 2" />
                  </svg>
                  History
                </button>
              </div>
              {draft.contract === "paint" && draft.paint_schedule ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={saving || building}
                  onClick={() => void onRefreshSchedule()}
                >
                  Refresh schedule from Paint tab
                </button>
              ) : null}
              <hr className="sds-package-actions-rule" />
              <button type="button" className="sds-package-new" disabled={saving} onClick={() => void onNewPackage()}>
                + New package
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="card stack sds-sections-panel">
        <div className="sds-sections-head">
          <div className="paint-items-title">
            <h3>Sections ({draft.sections.length})</h3>
            {sectionStatus ? (
              <p className={`paint-items-status paint-items-status--${sectionStatus.tone}`}>
                {sectionStatus.tone === "ok" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8 12 2.5 2.5L16 9" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                    <path d="M10.3 4.8 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0z" />
                  </svg>
                )}
                {sectionStatus.text}
              </p>
            ) : null}
          </div>
          <div className="sds-sections-toolbar">
            <div className="paint-toolbar-menu" ref={importMenuRef}>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                aria-haspopup="menu"
                aria-expanded={importOpen}
                onClick={() => setImportOpen((open) => !open)}
              >
                Import
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {importOpen ? (
                <div className="paint-toolbar-dropdown" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    title="Add each product from the paint color schedule as a section in this package"
                    onClick={() => {
                      setImportOpen(false);
                      importFromPaint();
                    }}
                  >
                    From Paint schedule
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    title="Add each product from the wallcovering submittal as a section in this package"
                    onClick={() => {
                      setImportOpen(false);
                      importFromWallcovering();
                    }}
                  >
                    From Wallcovering
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" className="btn btn-secondary btn-small" onClick={openAddSection}>
              Add section
            </button>
            <span className="sds-sections-toolbar-rule" aria-hidden />
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={!draft.sections.length}
              onClick={() => setClearConfirm(true)}
            >
              Clear all
            </button>
          </div>
        </div>
        {clearConfirm ? (
          <div className="sds-clear-confirm" role="alert">
            <span>Remove all {draft.sections.length} sections from this package?</span>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setClearConfirm(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-small sds-clear-confirm-go" onClick={onClearAll}>
              Clear all
            </button>
          </div>
        ) : null}

        {draft.sections.length === 0 ? (
          <p className="muted small sds-sections-empty">
            No sections yet. Import from the Paint schedule or add one.
          </p>
        ) : (
          <ul className="sds-section-list">
            {draft.sections.map((section, index) => (
              <SdsSectionListRow
                key={section.id}
                section={section}
                index={index}
                packetType={draft.packet_type}
                dragging={dragFrom === index}
                dragOver={dragOver === index && dragFrom !== index}
                onDragStart={() => setDragFrom(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== index) setDragOver(index);
                }}
                onDragLeave={() => {
                  if (dragOver === index) setDragOver(null);
                }}
                onDrop={() => {
                  if (dragFrom != null) reorderSection(dragFrom, index);
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onEdit={() => openEditSection(section)}
                onRemove={() => {
                  if (window.confirm(`Remove section ${index + 1}?`)) removeSection(section.id);
                }}
                showSelfPriming={draft.contract === "paint"}
                onSelfPrimingChange={(on) =>
                  replaceSection({ ...section, intended_use: setSelfPrimingNote(section.intended_use, on) })
                }
              />
            ))}
          </ul>
        )}
      </section>

      {paintImportGroups ? (
        <ImportPaintPackageModal
          groups={paintImportGroups}
          sections={draft.sections}
          onConfirm={(targets) => applyPaintImport(paintImportGroups, targets)}
          onClose={() => setPaintImportGroups(null)}
        />
      ) : null}

      {editor?.mode === "add" && (
        <SdsSectionEditorModal
          mode="add"
          section={editor.section}
          projectId={projectId}
          packetType={draft.packet_type}
          showSelfPriming={draft.contract === "paint"}
          onSave={(section) => {
            addSectionRow(section);
            setEditor(null);
            setError(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.mode === "edit" && (
        <SdsSectionEditorModal
          mode="edit"
          section={editor.section}
          projectId={projectId}
          packetType={draft.packet_type}
          showSelfPriming={draft.contract === "paint"}
          onSave={(section) => {
            replaceSection(section);
            setEditor(null);
            setError(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
