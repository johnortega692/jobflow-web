import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { SdsSectionEditorModal } from "../components/sds/SdsSectionEditorModal";
import { SdsSectionListRow } from "../components/sds/SdsSectionListRow";
import { DateInput } from "../components/DateInput";
import { useLetterhead } from "../contexts/LetterheadContext";
import { TradeContractTabs } from "../components/jobinfo/TradeContractTabs";
import {
  coerceTransmittalContract,
  hasTransmittalContractSwitch,
  jobFullAddressOneLine,
  transmittalPrintInfo,
  type TransmittalContract,
} from "../lib/jobInfo";
import { buildSdsPacketPdf, downloadPdfBytes, type BuildProgress } from "../lib/sdsPacketBuild";
import { evaluatePacketReadiness } from "../lib/sdsPacketRequirements";
import {
  appendSdsPacketSubmittalRow,
  queueSdsForTransmittal,
} from "../lib/sdsSubmittalIntegrations";
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
  normalizeWallcoveringSubmittal,
  paintItemSpecScope,
  sdsPacketOutputName,
  sdsSectionsFromPaintItems,
  sdsSectionsFromWallcoveringItems,
  type SdsSection,
  type ProjectTradeData,
} from "../types/tradeDocuments";
import type { SdsPacketType } from "../lib/sdsPacketPresets";
import { sortSdsSectionsBySpec } from "../lib/sdsSectionModel";

type Ctx = { project: ProjectForm; projectId: string };

type EditorState =
  | { mode: "add"; section: SdsSection }
  | { mode: "edit"; section: SdsSection }
  | null;

export function SdsPacketPage() {
  const { branding, profile } = useLetterhead();
  const { project, projectId } = useOutletContext<Ctx>();
  const { tradeData, saving, error, setError, save, loading } = useProjectTradeData(projectId);
  const [draft, setDraft] = useState(defaultSdsPacket());
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [lastSpecSection, setLastSpecSection] = useState("");

  useEffect(() => {
    if (!loading) {
      const base = applySdsProfileDefaults(normalizeSdsPacket(tradeData.sds_packet), profile);
      setDraft({
        ...base,
        contract: coerceTransmittalContract(project, base.contract),
      });
    }
  }, [loading, tradeData.sds_packet, profile, project]);

  const showContractSwitch = hasTransmittalContractSwitch(project);

  const readiness = useMemo(
    () => evaluatePacketReadiness(draft.sections, draft.packet_type),
    [draft.sections, draft.packet_type],
  );

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

  function importFromPaint() {
    const paint = normalizePaintSubmittal(tradeData.paint_submittal);
    if (!paint.items.length) {
      setError("Save paint submittal line items first, then import.");
      return;
    }
    const lead = leadSpecSection(paint);
    const secondary = paint.spec_sections?.[1]?.trim() ?? "";
    const imported = paint.items.flatMap((item) => {
      const scopeSpec =
        paintItemSpecScope(item) === "secondary" && secondary ? secondary : lead;
      return sdsSectionsFromPaintItems([item], scopeSpec);
    });
    // Dedupe again across scopes (helper already dedupes within one call)
    const seen = new Set<string>();
    const unique = imported.filter((row) => {
      const key = [row.manufacturer, row.product, row.finish_type, row.spec_section]
        .map((s) => s.trim().toLowerCase())
        .join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!unique.length) {
      setError("No products found to import from paint.");
      return;
    }
    mergeImportedSections(unique, "paint");
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
    if (!draft.sections.length) return;
    if (!window.confirm("Remove all sections?")) return;
    setDraft((d) => ({ ...d, sections: [] }));
  }

  async function onSave() {
    const ok = await save({ ...tradeData, sds_packet: draft });
    if (ok) {
      setError(null);
      setSuccess("Submittal package saved.");
    }
  }

  async function onBuild() {
    if (!draft.sections.length) return;
    if (readiness.gaps.length && !window.confirm(readiness.confirmMessage)) {
      return;
    }

    setBuilding(true);
    setBuildProgress(null);
    setSuccess(null);
    setError(null);
    try {
      let nextTrade: ProjectTradeData = { ...tradeData, sds_packet: draft };
      const ok = await save(nextTrade);
      if (!ok) return;

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
      );
      downloadPdfBytes(bytes, outputName);

      const notes: string[] = [`Downloaded ${outputName}.`];
      if (draft.add_to_submittal_log) {
        const row = await appendSdsPacketSubmittalRow(projectId, draft);
        if (row) notes.push(`Submittal log row #${row.line_number} added (Ready).`);
        if (draft.add_to_transmittal) {
          nextTrade = await queueSdsForTransmittal(nextTrade, draft, outputName, row?.id);
          await save(nextTrade);
          notes.push("Queued for Transmittal (Pending for next send).");
        }
      } else if (draft.add_to_transmittal) {
        nextTrade = await queueSdsForTransmittal(nextTrade, draft, outputName);
        await save(nextTrade);
        notes.push("Queued for Transmittal (Pending for next send).");
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
                value={draft.cover_purpose}
                onChange={(e) => setDraft({ ...draft, cover_purpose: e.target.value })}
                rows={3}
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
              Header stamp on manufacturer PDFs
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
          <div className="stack sds-checks sds-checks-after">
            <p className="sds-checks-after-label muted small">After generating</p>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.add_to_submittal_log}
                onChange={(e) => setDraft({ ...draft, add_to_submittal_log: e.target.checked })}
              />
              Add submittal log row
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.add_to_transmittal}
                onChange={(e) => setDraft({ ...draft, add_to_transmittal: e.target.checked })}
              />
              Add to transmittal
            </label>
          </div>
          <div className="sds-options-actions stack">
            <p className="sds-filename-preview muted small">
              Filename: <code>{outputFilename}</code>
            </p>
            <p
              className={`sds-readiness-line small${readiness.gaps.length ? " sds-readiness-line--warn" : readiness.sectionCount ? " sds-readiness-line--ok" : ""}`}
            >
              {readiness.summaryLine}
            </p>
            <div className="row-gap wrap">
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onSave()}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={building || !draft.sections.length}
                onClick={() => void onBuild()}
              >
                {building ? "Building…" : "Packet PDF"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="card stack sds-sections-panel">
        <div className="sds-sections-hint">
          <span className="muted small">Drag ⋮⋮ to reorder</span>
        </div>
        <div className="sds-sections-toolbar row-gap wrap">
          <button type="button" className="btn btn-success btn-small" onClick={openAddSection}>
            + Add Section
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={importFromPaint}>
            Import · Paint
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={importFromWallcovering}>
            Import · Wallcovering
          </button>
          <span className="sds-sections-toolbar-spacer" aria-hidden />
          <button type="button" className="btn btn-ghost btn-small" onClick={onClearAll}>
            Clear All
          </button>
        </div>

        {draft.sections.length === 0 ? (
          <p className="muted small sds-sections-empty">
            No sections yet. Click <strong>+ Add Section</strong>, import from a trade tab, or enter
            products manually. Set Spec section on each product — the list sorts by CSI.
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
              />
            ))}
          </ul>
        )}
      </section>

      {editor?.mode === "add" && (
        <SdsSectionEditorModal
          mode="add"
          section={editor.section}
          projectId={projectId}
          packetType={draft.packet_type}
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
