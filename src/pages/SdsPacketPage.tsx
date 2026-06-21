import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { SdsSectionEditorModal } from "../components/sds/SdsSectionEditorModal";
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
import {
  SDS_ATTACHMENT_KINDS,
  sdsFileMark,
  sdsHasAttachment,
  sdsNotesPreview,
  sdsSectionNotes,
} from "../lib/sdsSectionDisplay";
import {
  appendSdsPacketSubmittalRow,
  queueSdsForTransmittal,
} from "../lib/sdsSubmittalIntegrations";
import { applySdsProfileDefaults } from "../lib/userProfile";
import { useProjectTradeData } from "../lib/useProjectTradeData";
import type { ProjectForm } from "../types/database";
import {
  DEFAULT_SPEC_SECTIONS,
  defaultCoverPurpose,
  coverMainTitle,
  isPresetCoverPurpose,
  SDS_PACKET_TYPES,
  defaultSdsPacket,
  emptySdsSection,
  normalizeSdsPacket,
  sdsPacketOutputName,
  sdsSectionsFromPaintItems,
  sdsSectionsFromWallcoveringItems,
  type SdsSection,
  type ProjectTradeData,
} from "../types/tradeDocuments";
import type { SdsPacketType } from "../lib/sdsPacketPresets";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<EditorState>(null);

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

  const selectedIndices = useMemo(() => {
    const idToIndex = new Map(draft.sections.map((s, i) => [s.id, i]));
    return [...selected]
      .map((id) => idToIndex.get(id))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);
  }, [draft.sections, selected]);

  function replaceSection(section: SdsSection) {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === section.id ? section : s)),
    }));
  }

  function addSectionRow(section: SdsSection) {
    setDraft((d) => ({ ...d, sections: [...d.sections, section] }));
    setSelected(new Set([section.id]));
  }

  function moveSections(idxs: number[], delta: number) {
    if (!idxs.length) return;
    setDraft((d) => {
      const sections = [...d.sections];
      const order =
        delta < 0
          ? [...idxs].sort((a, b) => a - b)
          : [...idxs].sort((a, b) => b - a);
      for (const i of order) {
        const next = i + delta;
        if (next < 0 || next >= sections.length) continue;
        const [row] = sections.splice(i, 1);
        sections.splice(next, 0, row!);
      }
      return { ...d, sections };
    });
  }

  function removeSections(ids: string[]) {
    const remove = new Set(ids);
    setDraft((d) => ({ ...d, sections: d.sections.filter((s) => !remove.has(s.id)) }));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => !remove.has(id)));
      return next;
    });
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
    const paint = tradeData.paint_submittal;
    if (!paint?.items.length) {
      setError("Save paint submittal line items first, then import.");
      return;
    }
    const imported = sdsSectionsFromPaintItems(paint.items);
    if (!imported.length) {
      setError("No products found to import from paint.");
      return;
    }
    mergeImportedSections(imported, "paint");
  }

  function importFromWallcovering() {
    const wc = tradeData.wallcovering_submittal;
    if (!wc?.items.length) {
      setError("Save wallcovering submittal line items first, then import.");
      return;
    }
    const imported = sdsSectionsFromWallcoveringItems(wc.items);
    if (!imported.length) {
      setError("No products found to import from wallcovering.");
      return;
    }
    mergeImportedSections(imported, "wallcovering");
  }

  function mergeImportedSections(imported: SdsSection[], contract?: TransmittalContract) {
    setDraft((d) => ({
      ...d,
      sections: [...d.sections, ...imported],
      ...(contract && showContractSwitch ? { contract } : {}),
    }));
    setError(null);
  }

  function onRowClick(id: string, multi: boolean) {
    if (multi) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
  }

  function openAddSection() {
    setEditor({ mode: "add", section: emptySdsSection() });
  }

  function openEditSection(section: SdsSection) {
    setEditor({ mode: "edit", section: { ...section } });
  }

  function onEditSelected() {
    const id = selectedIndices[0] !== undefined ? draft.sections[selectedIndices[0]!]?.id : null;
    const section = id ? draft.sections.find((s) => s.id === id) : null;
    if (!section) {
      setError("Select a section first.");
      return;
    }
    openEditSection(section);
    setError(null);
  }

  function onRemoveSelected() {
    if (!selected.size) {
      setError("Select one or more sections to remove.");
      return;
    }
    removeSections([...selected]);
  }

  function onClearAll() {
    if (!draft.sections.length) return;
    if (!window.confirm("Remove all sections?")) return;
    setDraft((d) => ({ ...d, sections: [] }));
    setSelected(new Set());
  }

  async function onSave() {
    const ok = await save({ ...tradeData, sds_packet: draft });
    if (ok) {
      setError(null);
      setSuccess("Submittal package saved.");
    }
  }

  async function onBuild() {
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
          nextTrade = queueSdsForTransmittal(nextTrade, draft, outputName, row?.id);
          await save(nextTrade);
          notes.push("Queued for Transmittal (Pending for next send).");
        }
      } else if (draft.add_to_transmittal) {
        nextTrade = queueSdsForTransmittal(nextTrade, draft, outputName);
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

  const sectionCountLabel =
    draft.sections.length === 1 ? "1 section" : `${draft.sections.length} sections`;

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
      <div className="row-between">
        <div>
          <h2>Submittal package</h2>
        </div>
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

      <p className="sds-filename-preview muted small">
        PDF filename: <code>{outputFilename}</code>
      </p>

      {error && <div className="banner banner-error">{error}</div>}
      {success && <div className="banner banner-ok">{success}</div>}
      {buildProgress && (
        <div className="banner banner-warn">
          Building… {buildProgress.step} ({buildProgress.percent}%)
        </div>
      )}

      <div className="card stack">
        <h3>Packet options</h3>
        <div className="row-gap sds-checks">
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
      </div>

      <div className="card stack">
        <h3>Cover &amp; project info</h3>
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
        <div className="grid-2">
          <label>
            Spec section <span className="muted small">(optional)</span>
            <select
              value={draft.spec_section}
              onChange={(e) => setDraft({ ...draft, spec_section: e.target.value })}
            >
              <option value="">None / not applicable</option>
              {DEFAULT_SPEC_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
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
          <label>
            Package #
            <input
              type="number"
              min={1}
              value={draft.submittal_number}
              onChange={(e) => setDraft({ ...draft, submittal_number: Number(e.target.value) || 1 })}
            />
          </label>
        </div>
      </div>

      <section className="card stack sds-sections-panel">
        <div className="sds-sections-hint row-between wrap">
          <span className="muted small">
            Add PDFs with <strong>+ Add Section</strong> · Double-click a row to edit
          </span>
          <span className="muted small">{sectionCountLabel}</span>
        </div>
        <div className="sds-sections-toolbar row-gap wrap">
          <button type="button" className="btn btn-success btn-small" onClick={openAddSection}>
            + Add Section
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={!selectedIndices.length || selectedIndices[0] === 0}
            onClick={() => moveSections(selectedIndices, -1)}
          >
            ↑ Move Up
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={
              !selectedIndices.length ||
              selectedIndices[selectedIndices.length - 1] === draft.sections.length - 1
            }
            onClick={() => moveSections(selectedIndices, 1)}
          >
            ↓ Move Down
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={selected.size !== 1}
            onClick={onEditSelected}
          >
            Edit Details
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={!selected.size}
            onClick={onRemoveSelected}
          >
            Remove
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
        <div className="table-wrap sds-sections-table-wrap">
          <table className="data-table sds-sections-table selectable">
            <thead>
              <tr>
                <th className="sds-col-num">#</th>
                <th>Category</th>
                <th>Manufacturer</th>
                <th>Product</th>
                <th>Finish / Type</th>
                <th>System / Material</th>
                <th>Color / Pattern / Finish</th>
                <th>Notes / Intended use</th>
                {SDS_ATTACHMENT_KINDS.map((k) => (
                  <th key={k.kind} className="sds-col-mark" title={k.label}>
                    {k.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draft.sections.length === 0 ? (
                <tr>
                  <td colSpan={8 + SDS_ATTACHMENT_KINDS.length} className="muted small">
                    No sections yet. Click <strong>+ Add Section</strong>, import from a trade tab,
                    or enter products manually.
                  </td>
                </tr>
              ) : (
                draft.sections.map((section, index) => (
                  <tr
                    key={section.id}
                    className={selected.has(section.id) ? "selected" : undefined}
                    onClick={(e) => onRowClick(section.id, e.ctrlKey || e.metaKey)}
                    onDoubleClick={() => openEditSection(section)}
                  >
                    <td className="sds-col-num">{index + 1}</td>
                    <td>{section.category}</td>
                    <td>{section.manufacturer}</td>
                    <td>{section.product}</td>
                    <td>{section.finish_type}</td>
                    <td>{section.system_material}</td>
                    <td>{section.color}</td>
                    <td className="sds-col-notes" title={sdsSectionNotes(section)}>
                      {sdsNotesPreview(sdsSectionNotes(section))}
                    </td>
                    {SDS_ATTACHMENT_KINDS.map((k) => (
                      <td key={k.kind} className="sds-col-mark" title={k.label}>
                        {sdsFileMark(sdsHasAttachment(section, k.kind))}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editor?.mode === "add" && (
        <SdsSectionEditorModal
          title="Add Section"
          section={editor.section}
          projectId={projectId}
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
          title="Edit Section"
          section={editor.section}
          projectId={projectId}
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
